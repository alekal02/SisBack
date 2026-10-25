/**
 * Cache em memória de endpoints pesados (comparação, KPIs, gráficos).
 * Módulo separado para ContractController invalidar sem import circular.
 *
 * O TTL é longo de propósito: estes números só mudam quando entra planilha ou
 * quando se altera a configuração do serviço/contrato, e todos esses caminhos
 * chamam a invalidação abaixo. Sem isso, numa máquina modesta o usuário paga o
 * custo da agregação inteira a cada navegação.
 */

type Entrada = { data: any; criadoEm: number; ultimoAcesso: number };

const cacheBackend = new Map<string, Entrada>();

const CACHE_TTL_MS = Number(process.env.ENDPOINT_CACHE_TTL_MS || 6 * 60 * 60 * 1000);
const CACHE_MAX_ENTRADAS = Number(process.env.ENDPOINT_CACHE_MAX || 200);

/** Prefixos que agregam vários serviços e não citam o id de nenhum deles. */
const PREFIXOS_AGREGADOS = [
  'kpis-consolidado:',
  'comparar-global:',
  'comparar-tipo:',
  'diagnostico-servicos:',
];

export function getEndpointCache<T>(key: string): T | null {
  const item = cacheBackend.get(key);
  if (!item) return null;
  if (Date.now() - item.criadoEm >= CACHE_TTL_MS) {
    cacheBackend.delete(key);
    return null;
  }
  item.ultimoAcesso = Date.now();
  return item.data as T;
}

export function setEndpointCache(key: string, data: any): void {
  const agora = Date.now();
  cacheBackend.set(key, { data, criadoEm: agora, ultimoAcesso: agora });
  if (cacheBackend.size <= CACHE_MAX_ENTRADAS) return;

  for (const [k, v] of cacheBackend) {
    if (agora - v.criadoEm >= CACHE_TTL_MS) cacheBackend.delete(k);
  }
  if (cacheBackend.size <= CACHE_MAX_ENTRADAS) return;

  // Ainda cheio: descarta o que ficou mais tempo sem ser lido.
  const porRecencia = [...cacheBackend.entries()].sort((a, b) => a[1].ultimoAcesso - b[1].ultimoAcesso);
  const remover = cacheBackend.size - CACHE_MAX_ENTRADAS;
  for (let i = 0; i < remover; i++) cacheBackend.delete(porRecencia[i][0]);
}

export function invalidateEndpointCachePrefix(prefix: string): void {
  for (const key of [...cacheBackend.keys()]) {
    if (key.startsWith(prefix)) cacheBackend.delete(key);
  }
}

/**
 * Limpa tudo que dependa dos dados de um serviço: as chaves que citam o id e as
 * visões que somam vários serviços. Chamado após import, dedupe e mudança de
 * configuração — é o que sustenta o TTL longo.
 */
export function invalidarCacheDashboardServico(servicoId: string): void {
  for (const key of [...cacheBackend.keys()]) {
    if (key.includes(servicoId) || PREFIXOS_AGREGADOS.some((p) => key.startsWith(p))) {
      cacheBackend.delete(key);
    }
  }
}

/**
 * Limpa cache da comparação após alterar limites do contrato
 * (volume L, peso máx.) — a CAIXA MÉDIA depende desses valores.
 */
export function invalidarCacheComparacaoContrato(contractId: string): void {
  for (const key of [...cacheBackend.keys()]) {
    if (key.startsWith(`comparar-tipo:${contractId}:`) || key.startsWith('comparar-global:')) {
      cacheBackend.delete(key);
    }
  }
}

/**
 * Zera o cache de endpoints. Usado quando muda algo do contrato que entra em
 * conta espalhada (tarifa por tonelada, por tipo de caminhão): as chaves dos
 * serviços não carregam o id do contrato, então não há como filtrar.
 */
export function limparCacheEndpoints(): void {
  cacheBackend.clear();
}

/** Fingerprint dos limites do contrato para invalidar cache sem depender só de TTL. */
export function fingerprintLimitesContrato(configOperacional?: {
  pesoMaximoKg?: Record<string, number> | null;
  volumeL?: Record<string, number> | null;
  densidadeResiduoKgL?: number | null;
  densidadeKgL?: Record<string, number> | null;
  densidadeKgLPorPlaca?: Record<string, number> | null;
} | null): string {
  const peso = configOperacional?.pesoMaximoKg || {};
  const vol = configOperacional?.volumeL || {};
  const dens = configOperacional?.densidadeResiduoKgL ?? null;
  const densTipo = configOperacional?.densidadeKgL || {};
  const densPlaca = configOperacional?.densidadeKgLPorPlaca || {};
  return JSON.stringify({ p: peso, v: vol, d: dens, dt: densTipo, dp: densPlaca });
}
