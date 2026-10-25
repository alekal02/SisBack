/**
 * Limites de memória/CPU — ajuste via variáveis de ambiente no Docker.
 * Máquinas fracas: GRAFICOS_DADOS_LIMITE=15000, KPIS_CONSOLIDADO_CONCURRENCY=2
 */

/** Máximo de linhas (rotas) carregadas por serviço na memória */
export const LIMITE_DADOS_MAX = parseInt(process.env.GRAFICOS_DADOS_LIMITE || '20000', 10);

/** TTL cache de dados por serviço (ms) */
export const DADOS_CACHE_TTL_MS = parseInt(process.env.DADOS_CACHE_TTL_MS || '120000', 10);

/** Máximo de entradas no cache de dados brutos */
export const DADOS_CACHE_MAX_ENTRADAS = parseInt(process.env.DADOS_CACHE_MAX_ENTRADAS || '12', 10);

/**
 * Teto de linhas somadas no cache de dados brutos.
 *
 * Contar entradas não protege a memória: medido, um serviço com 20 mil linhas
 * ocupa ~67 MB de heap, então 12 entradas projetam ~800 MB — mais do que o heap
 * de 512 MB do container. Limitar pelo total de linhas faz caber muitos serviços
 * pequenos ou poucos grandes, sem estourar.
 */
export const DADOS_CACHE_MAX_LINHAS = parseInt(
  process.env.DADOS_CACHE_MAX_LINHAS || '60000',
  10,
);

/** Concorrência padrão para KPIs consolidados / comparação */
export const KPIS_CONSOLIDADO_CONCURRENCY = parseInt(
  process.env.KPIS_CONSOLIDADO_CONCURRENCY || '2',
  10,
);

/** Concorrência para diagnóstico / comparar global */
export const ENDPOINTS_PESADOS_CONCURRENCY = parseInt(
  process.env.ENDPOINTS_PESADOS_CONCURRENCY || '2',
  10,
);

/** PDF cache — máximo de buffers em RAM */
export const PDF_CACHE_MAX_ENTRADAS = parseInt(process.env.PDF_CACHE_MAX_ENTRADAS || '5', 10);

/** Body parser Express (bytes) — alinhar com MAX_FILE_SIZE do compose */
export const MAX_BODY_BYTES = parseInt(process.env.MAX_FILE_SIZE || '10485760', 10);

/**
 * Webhook do WhatsApp. A planilha chega em base64 (~33% maior que o arquivo).
 * O limite geral de 10 MB recusava o POST, a WuzAPI desistia e o grupo via o chatbot mudo.
 */
export const WEBHOOK_BODY_LIMIT = process.env.WUZAPI_WEBHOOK_BODY_LIMIT || '64mb';

/** O webhook do WhatsApp aceita a planilha. As outras rotas continuam no teto pequeno. */
export function limiteCorpoPorRota(caminho: string): string | number {
  if (caminho.startsWith('/api/sala-tecnica')) return '40mb';
  if (caminho.startsWith('/api/wuzapi/webhook')) return WEBHOOK_BODY_LIMIT;
  return MAX_BODY_BYTES;
}
