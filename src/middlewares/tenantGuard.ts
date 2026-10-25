import { Request, Response, NextFunction } from 'express';
import { ehGestorGlobal, TokenPayload } from './authMiddleware';

/**
 * Usuário preso a um contrato não altera outro, no banco único ou no multi-banco.
 * Super-admin e gestor sem contrato continuam podendo.
 * Sem contractId alvo, a alteração também é negada para quem está preso a um contrato.
 */
export function alteracaoNegada(
  usuario: TokenPayload | undefined | null,
  contractId: string | null | undefined,
): boolean {
  if (!usuario?.contractId) return false;
  if (usuario.role === 'superadmin') return false;
  const alvo = String(contractId || '').trim();
  if (!alvo) return true;
  return usuario.contractId !== alvo;
}

/** Recusa acesso se o contrato da URL não for o do usuário (gestor no hub passa). */
export function tenantGuard(req: Request, res: Response, next: NextFunction): void {
  const usuario = req.usuario;
  if (!usuario) {
    next();
    return;
  }

  if (ehGestorGlobal(usuario) && !usuario.contractId) {
    next();
    return;
  }

  const urlId = String(req.params.contractId || req.params.id || '');
  if (urlId && alteracaoNegada(usuario, urlId)) {
    res.status(403).json({ error: 'Sem acesso a este contrato' });
    return;
  }

  next();
}

/** Criar contrato não cabe a quem já está preso a um contrato. */
export function negarCriacaoContratoPreso(req: Request, res: Response, next: NextFunction): void {
  if (alteracaoNegada(req.usuario, null)) {
    res.status(403).json({ error: 'Sem permissão para criar outro contrato' });
    return;
  }
  next();
}
