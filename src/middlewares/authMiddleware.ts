import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UserRole } from '../entities/User';
import {
  getOrCreateTenantDataSource,
  isMultiTenant,
  runWithTenantSync,
} from '../database/data-source';
import { bancoDoContrato } from '../services/tenantDatabaseService';

function resolveJwtSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET é obrigatório em produção');
  }
  return 'abastecimento-secret-key-dev';
}

const JWT_SECRET = resolveJwtSecret();
const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN || '8h') as jwt.SignOptions['expiresIn'];
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || `${JWT_SECRET}-refresh`;
const JWT_REFRESH_EXPIRES_IN = (process.env.JWT_REFRESH_EXPIRY || '30d') as jwt.SignOptions['expiresIn'];
const REFRESH_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export interface TokenPayload {
  id: string;
  email: string;
  nome: string;
  role: UserRole;
  contractId?: string | null;
  tenantDb?: string | null;
}

export function isSuperadmin(usuario?: TokenPayload | null): boolean {
  return usuario?.role === 'superadmin';
}

export function isAdminOuSuper(usuario?: TokenPayload | null): boolean {
  return usuario?.role === 'admin' || usuario?.role === 'superadmin';
}

/** Enxerga todos os contratos: super-admin, ou admin que não está preso a um contrato. */
export function ehGestorGlobal(usuario?: TokenPayload | null): boolean {
  if (!usuario) return false;
  if (usuario.role === 'superadmin') return true;
  return usuario.role === 'admin' && !usuario.contractId;
}

export function payloadDoJwt(decoded: TokenPayload): TokenPayload {
  return {
    id: decoded.id,
    email: decoded.email,
    nome: decoded.nome,
    role: decoded.role,
    contractId: decoded.contractId ?? null,
    tenantDb: decoded.tenantDb ?? null,
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** contractId pedido na rota, na query ou no corpo — usado pelo gestor no hub. */
function contractIdDaRequisicao(req: Request): string | null {
  // Em /api/contracts/:id o parâmetro se chama "id" e é o contrato.
  const idDeContrato = /\/contracts$/.test(req.baseUrl || '') ? req.params?.id : undefined;
  const candidatos = [
    req.params?.contractId,
    idDeContrato,
    req.query?.contractId,
    (req.body && typeof req.body === 'object' ? (req.body as any).contractId : undefined),
  ];
  for (const c of candidatos) {
    const valor = typeof c === 'string' ? c.trim() : '';
    if (UUID_RE.test(valor)) return valor;
  }
  return null;
}

function abrirBanco(req: Request, res: Response, next: NextFunction, db: string): void {
  getOrCreateTenantDataSource(db)
    .then((ds) => {
      runWithTenantSync(ds, db, () => next());
    })
    .catch((err) => {
      console.error('[tenant] falha ao abrir banco', db, err);
      res.status(503).json({ error: 'Banco do contrato indisponível' });
    });
}

/**
 * Escolhe o banco da requisição quando cada contrato tem o seu:
 * usuário preso a um contrato usa o banco do token; o gestor no hub usa o banco
 * do contrato que a requisição pediu e, sem contrato, fica no banco de controle.
 */
function ativarTenantDoToken(req: Request, res: Response, next: NextFunction): void {
  if (!isMultiTenant()) {
    next();
    return;
  }

  const doToken = req.usuario?.tenantDb;
  if (doToken) {
    abrirBanco(req, res, next, doToken);
    return;
  }

  if (!ehGestorGlobal(req.usuario)) {
    next();
    return;
  }

  const contractId = contractIdDaRequisicao(req);
  if (!contractId) {
    next();
    return;
  }

  bancoDoContrato(contractId)
    .then((db) => {
      if (!db) {
        next();
        return;
      }
      abrirBanco(req, res, next, db);
    })
    .catch((err) => {
      console.error('[tenant] falha ao resolver contrato', contractId, err);
      next();
    });
}

// Extende a tipagem do Request para incluir o usuário
declare global {
  namespace Express {
    interface Request {
      usuario?: TokenPayload;
    }
  }
}

/**
 * Gera um token JWT para o usuário
 */
export function gerarToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function gerarRefreshToken(payload: TokenPayload): string {
  return jwt.sign({ ...payload, typ: 'refresh' }, JWT_REFRESH_SECRET, {
    expiresIn: JWT_REFRESH_EXPIRES_IN,
  });
}

type JwtComExp = TokenPayload & { exp?: number; typ?: string };

/** Lê Bearer do header Authorization. */
export function extrairBearer(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || !/^Bearer$/i.test(parts[0])) return null;
  return parts[1];
}

/**
 * Renova a sessão a partir do refresh token (ou do access token expirado há pouco).
 * Enquanto a TV/aba estiver ligada e renovando, a sessão não cai.
 */
export function verificarTokenRenovacao(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_REFRESH_SECRET) as JwtComExp;
    if (decoded?.id && decoded.typ === 'refresh') {
      return payloadDoJwt(decoded);
    }
  } catch {
    /* tenta access token abaixo */
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET, { ignoreExpiration: true }) as JwtComExp;
    if (!decoded?.id || decoded.typ === 'refresh') return null;
    if (decoded.exp) {
      const expiradoHa = Date.now() - decoded.exp * 1000;
      if (expiradoHa > REFRESH_GRACE_MS) return null;
    }
    return payloadDoJwt(decoded);
  } catch {
    return null;
  }
}

/**
 * Middleware que verifica se o usuário está autenticado
 */
export function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Suporta token via header Authorization ou query string ?token=
  let token: string | null = extrairBearer(req);

  // Fallback: token na query string (para download direto via window.open)
  if (!token && req.query.token) {
    token = req.query.token as string;
  }

  if (!token) {
    res.status(401).json({ error: 'Token de autenticação não fornecido' });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as TokenPayload;
    req.usuario = payloadDoJwt(decoded);
    ativarTenantDoToken(req, res, next);
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: 'Token expirado' });
      return;
    }
    res.status(401).json({ error: 'Token inválido' });
  }
}

/**
 * Middleware que verifica se o usuário tem uma role específica
 */
export function authorize(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.usuario) {
      res.status(401).json({ error: 'Usuário não autenticado' });
      return;
    }

    const permitido = roles.includes(req.usuario.role)
      || (roles.includes('admin') && req.usuario.role === 'superadmin');
    if (!permitido) {
      res.status(403).json({
        error: 'Acesso negado: você não tem permissão para esta ação',
      });
      return;
    }

    next();
  };
}

export { JWT_SECRET };
