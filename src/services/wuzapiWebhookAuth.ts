import { createHash, createHmac, timingSafeEqual } from 'crypto';

export function segredoWebhookConfere(esperado: string, recebido: string): boolean {
  const a = createHash('sha256').update(String(esperado)).digest();
  const b = createHash('sha256').update(String(recebido)).digest();
  return timingSafeEqual(a, b);
}

/**
 * Produção com segredo vazio aceita qualquer POST no webhook.
 * Não feche isso no código enquanto a WuzAPI não enviar o segredo:
 * configurarWebhook só grava a URL, e a sessão já conectada deixaria de entregar mensagens.
 */
export function webhookAbertoEmProducao(nodeEnv: string | undefined, segredo: string | undefined): boolean {
  return nodeEnv === 'production' && !String(segredo || '').trim();
}

export function assinaturaHmacSha256(segredo: string, corpo: Buffer | string): string {
  return createHmac('sha256', segredo).update(corpo).digest('hex');
}

export function assinaturaHmacConfere(segredo: string, corpo: Buffer | string, recebida: string): boolean {
  const esperada = assinaturaHmacSha256(segredo, corpo);
  return segredoWebhookConfere(esperada, String(recebida || '').trim());
}

/** Cabeçalho que a WuzAPI envia quando há chave HMAC. Não registra o valor. */
export function assinaturaRecebida(headers: Record<string, unknown>): string {
  const header = headers['x-hmac-signature'];
  if (typeof header === 'string') return header.trim();
  if (Array.isArray(header) && typeof header[0] === 'string') return header[0].trim();
  return '';
}

/**
 * O bloqueio só existe com WUZAPI_WEBHOOK_ENFORCE=true.
 * Sem isso, a ausência de assinatura não interrompe o chatbot.
 */
export function webhookHmacDeveRecusar(opts: {
  exigir: boolean;
  segredo: string;
  corpo: Buffer | null;
  assinatura: string;
  hmacCalculado?: string;
}): boolean {
  if (!opts.exigir) return false;
  if (!opts.segredo || !opts.assinatura) return true;
  if (opts.hmacCalculado) return !segredoWebhookConfere(opts.hmacCalculado, opts.assinatura);
  if (!opts.corpo) return true;
  return !assinaturaHmacConfere(opts.segredo, opts.corpo, opts.assinatura);
}

export function segredoRecebidoWebhook(headers: Record<string, unknown>, query: Record<string, unknown>): string {
  const header = headers['x-webhook-secret'];
  if (typeof header === 'string' && header) return header;
  if (Array.isArray(header) && typeof header[0] === 'string') return header[0];
  const auth = headers.authorization || headers.Authorization;
  const authStr = Array.isArray(auth) ? String(auth[0] || '') : String(auth || '');
  const bearer = authStr.match(/^Bearer\s+(.+)$/i);
  if (bearer) return bearer[1].trim();
  const q = query.secret;
  if (typeof q === 'string') return q;
  if (Array.isArray(q) && typeof q[0] === 'string') return q[0];
  return '';
}
