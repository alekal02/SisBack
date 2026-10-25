import { Request, Response } from 'express';
import { Repository } from 'typeorm';
import { getControlDataSource, isMultiTenant } from '../database/data-source';
import { User, UserRole } from '../entities/User';
import { Tenant } from '../entities/Tenant';
import {
  gerarRefreshToken,
  gerarToken,
  isAdminOuSuper,
  isSuperadmin,
  TokenPayload,
  verificarTokenRenovacao,
} from '../middlewares/authMiddleware';

function payloadUsuario(user: User, tenantDb?: string | null): TokenPayload {
  return {
    id: user.id,
    email: user.email,
    nome: user.nome,
    role: user.role,
    contractId: user.contractId ?? null,
    tenantDb: tenantDb ?? null,
  };
}

/** Admin sem contrato fixo (ou super-admin) vê todos os contratos. */
function ehGestorPersistente(user: User): boolean {
  return user.role === 'superadmin' || (user.role === 'admin' && !user.contractId);
}

function userPublico(user: User, extras: Record<string, unknown> = {}) {
  return { ...user.toJSON(), gestor: ehGestorPersistente(user), ...extras };
}

class AuthController {
  private get repository(): Repository<User> {
    return getControlDataSource().getRepository(User);
  }

  private async tenantDbDoUsuario(user: User): Promise<string | null> {
    if (!isMultiTenant() || !user.contractId) return null;
    const tenant = await getControlDataSource().getRepository(Tenant).findOne({
      where: { contractId: user.contractId },
    });
    return tenant?.databaseName ?? null;
  }

  /**
   * POST /api/auth/register
   * Cria um novo usuário (apenas admin pode criar outros admins)
   */
  async register(req: Request, res: Response): Promise<void> {
    try {
      const { nome, email, senha, role, contractId } = req.body;

      // Validações básicas
      if (!nome || !email || !senha) {
        res.status(400).json({
          error: 'Campos obrigatórios: nome, email, senha',
        });
        return;
      }

      if (senha.length < 6) {
        res.status(400).json({
          error: 'Senha deve ter no mínimo 6 caracteres',
        });
        return;
      }

      // Verifica se email já existe
      const existente = await this.repository.findOne({
        where: { email: email.toLowerCase().trim() },
      });

      if (existente) {
        res.status(409).json({ error: 'Email já cadastrado' });
        return;
      }

      let roleFinal: UserRole = 'user';
      if (role === 'superadmin' && isSuperadmin(req.usuario)) {
        roleFinal = 'superadmin';
      } else if (role === 'admin' && (req.usuario?.role === 'admin' || isSuperadmin(req.usuario))) {
        roleFinal = 'admin';
      }

      const contratoDoUser = contractId || req.usuario?.contractId || null;

      const user = this.repository.create({
        nome: nome.trim(),
        email: email.toLowerCase().trim(),
        senha,
        role: roleFinal,
        contractId: roleFinal === 'superadmin' ? null : contratoDoUser,
      });

      await this.repository.save(user);

      const tenantDb = await this.tenantDbDoUsuario(user);
      const payload = payloadUsuario(user, tenantDb);
      const token = gerarToken(payload);
      const refreshToken = gerarRefreshToken(payload);

      res.status(201).json({
        message: 'Usuário cadastrado com sucesso',
        token,
        refreshToken,
        user: userPublico(user),
      });
    } catch (error) {
      console.error('Erro ao registrar usuário:', error);
      res.status(500).json({ error: 'Erro interno ao cadastrar usuário' });
    }
  }

  /**
   * POST /api/auth/login
   * Autentica um usuário e retorna token JWT
   */
  async login(req: Request, res: Response): Promise<void> {
    try {
      const { email, senha } = req.body;

      if (!email || !senha) {
        res.status(400).json({
          error: 'Campos obrigatórios: email, senha',
        });
        return;
      }

      const user = await this.repository.findOne({
        where: { email: email.toLowerCase().trim() },
      });

      if (!user) {
        res.status(401).json({ error: 'Email ou senha inválidos' });
        return;
      }

      if (!user.ativo) {
        res.status(401).json({ error: 'Usuário desativado. Contate o administrador.' });
        return;
      }

      const senhaValida = await user.validarSenha(senha);

      if (!senhaValida) {
        res.status(401).json({ error: 'Email ou senha inválidos' });
        return;
      }

      const tenantDb = await this.tenantDbDoUsuario(user);
      const payload = payloadUsuario(user, tenantDb);
      const token = gerarToken(payload);
      const refreshToken = gerarRefreshToken(payload);

      res.json({
        message: 'Login realizado com sucesso',
        token,
        refreshToken,
        user: userPublico(user, { tenantDb }),
      });
    } catch (error) {
      console.error('Erro ao fazer login:', error);
      res.status(500).json({ error: 'Erro interno ao fazer login' });
    }
  }

  /**
   * POST /api/auth/acesso-direto
   * Abre a área do gestor sem e-mail nem senha.
   * Desliga com ACESSO_LIVRE=false.
   */
  async acessoDireto(_req: Request, res: Response): Promise<void> {
    try {
      if (process.env.ACESSO_LIVRE === 'false') {
        res.status(403).json({ error: 'Acesso direto está desligado.' });
        return;
      }

      const ativos = await this.repository.find({ where: { ativo: true } });
      const gestor = ativos.find((u) => u.role === 'superadmin')
        || ativos.find((u) => u.role === 'admin' && !u.contractId);
      if (!gestor) {
        res.status(503).json({
          error: 'Nenhum gestor ativo. É preciso um administrador sem contrato fixo.',
        });
        return;
      }

      const payload = payloadUsuario(gestor, null);
      res.json({
        message: 'Acesso do gestor',
        token: gerarToken(payload),
        refreshToken: gerarRefreshToken(payload),
        user: userPublico(gestor, { contractId: null, tenantDb: null }),
      });
    } catch (error) {
      console.error('Erro no acesso direto:', error);
      res.status(500).json({ error: 'Erro interno ao abrir o gestor' });
    }
  }

  /**
   * POST /api/auth/refresh
   * Renova access + refresh. Aceita refresh token (body ou Bearer) ou
   * access token expirado há menos de 7 dias (TV/kiosk).
   */
  async refresh(req: Request, res: Response): Promise<void> {
    try {
      const raw =
        (typeof req.body?.refreshToken === 'string' && req.body.refreshToken)
        || (typeof req.headers.authorization === 'string'
          && req.headers.authorization.replace(/^Bearer\s+/i, ''))
        || '';
      const payload = raw ? verificarTokenRenovacao(raw) : null;
      if (!payload) {
        res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
        return;
      }

      const user = await this.repository.findOne({ where: { id: payload.id } });
      if (!user || !user.ativo) {
        res.status(401).json({ error: 'Usuário desativado. Contate o administrador.' });
        return;
      }

      const sessionContractId = user.contractId ?? payload.contractId ?? null;
      let tenantDb = payload.tenantDb ?? await this.tenantDbDoUsuario(user);
      if (isMultiTenant() && sessionContractId && !tenantDb) {
        const tenant = await getControlDataSource().getRepository(Tenant).findOne({
          where: { contractId: sessionContractId },
        });
        tenantDb = tenant?.databaseName ?? null;
      }
      const novo: TokenPayload = {
        ...payloadUsuario(user, tenantDb),
        contractId: sessionContractId,
        tenantDb,
      };
      res.json({
        token: gerarToken(novo),
        refreshToken: gerarRefreshToken(novo),
        user: userPublico(user, { contractId: sessionContractId, tenantDb }),
      });
    } catch (error) {
      console.error('Erro ao renovar sessão:', error);
      res.status(500).json({ error: 'Erro interno ao renovar sessão' });
    }
  }

  /**
   * GET /api/auth/me
   * Retorna os dados do usuário autenticado
   */
  async me(req: Request, res: Response): Promise<void> {
    try {
      const user = await this.repository.findOne({
        where: { id: req.usuario!.id },
      });

      if (!user) {
        res.status(404).json({ error: 'Usuário não encontrado' });
        return;
      }

      res.json({
        user: userPublico(user, {
          contractId: req.usuario?.contractId ?? user.contractId,
          tenantDb: req.usuario?.tenantDb ?? null,
        }),
      });
    } catch (error) {
      console.error('Erro ao buscar usuário:', error);
      res.status(500).json({ error: 'Erro interno ao buscar usuário' });
    }
  }

  /**
   * POST /api/auth/entrar-contrato
   * Super-admin escolhe um contrato e recebe JWT apontando para o banco dele.
   */
  async entrarContrato(req: Request, res: Response): Promise<void> {
    try {
      if (!isAdminOuSuper(req.usuario)) {
        res.status(403).json({ error: 'Apenas o gestor pode entrar em um contrato' });
        return;
      }
      const contractId = String(req.body?.contractId || '');
      if (!contractId) {
        res.status(400).json({ error: 'contractId é obrigatório' });
        return;
      }

      const user = await this.repository.findOne({ where: { id: req.usuario!.id } });
      if (!user) {
        res.status(404).json({ error: 'Usuário não encontrado' });
        return;
      }
      if (user.contractId && user.contractId !== contractId && user.role !== 'superadmin') {
        res.status(403).json({ error: 'Este usuário já pertence a outro contrato' });
        return;
      }

      let tenantDb: string | null = null;
      if (isMultiTenant()) {
        const tenant = await getControlDataSource().getRepository(Tenant).findOne({
          where: { contractId },
        });
        if (!tenant) {
          res.status(404).json({ error: 'Contrato não encontrado no catálogo' });
          return;
        }
        tenantDb = tenant.databaseName;
      }

      const payload: TokenPayload = {
        id: user.id,
        email: user.email,
        nome: user.nome,
        role: user.role,
        contractId,
        tenantDb,
      };
      res.json({
        token: gerarToken(payload),
        refreshToken: gerarRefreshToken(payload),
        user: userPublico(user, { contractId, tenantDb }),
      });
    } catch (error) {
      console.error('Erro ao entrar no contrato:', error);
      res.status(500).json({ error: 'Erro interno ao entrar no contrato' });
    }
  }

  /** Super-admin sai do contrato e volta ao hub. */
  async sairContrato(req: Request, res: Response): Promise<void> {
    try {
      if (!isAdminOuSuper(req.usuario)) {
        res.status(403).json({ error: 'Apenas o gestor pode sair do contrato' });
        return;
      }
      const user = await this.repository.findOne({ where: { id: req.usuario!.id } });
      if (!user) {
        res.status(404).json({ error: 'Usuário não encontrado' });
        return;
      }
      const payload = payloadUsuario(user, null);
      res.json({
        token: gerarToken(payload),
        refreshToken: gerarRefreshToken(payload),
        user: userPublico(user, { contractId: null, tenantDb: null }),
      });
    } catch (error) {
      console.error('Erro ao sair do contrato:', error);
      res.status(500).json({ error: 'Erro interno ao sair do contrato' });
    }
  }
}

export default new AuthController();
