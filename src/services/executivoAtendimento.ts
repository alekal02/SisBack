import {
  chaveCicloExecutivo,
  lerExecutivoCache,
  marcarCacheTabela,
} from './executivoCacheTabela';
import { calcularNoWorker, gerarPdfNoWorker, type ResultadoPdf } from './executivoPiscina';

const emVoo = new Map<string, Promise<Record<string, unknown>>>();

function texto(valor: unknown): string | undefined {
  if (typeof valor === 'string' && valor.trim()) return valor.trim();
  if (Array.isArray(valor) && typeof valor[0] === 'string' && valor[0].trim()) return valor[0].trim();
  return undefined;
}

function numero(valor: unknown): number | undefined {
  const cru = texto(valor);
  if (!cru) return undefined;
  const n = parseInt(cru, 10);
  return Number.isFinite(n) ? n : undefined;
}

export function normalizarConsultaExecutivo(
  consulta: Record<string, unknown>,
): Record<string, string | undefined> {
  return {
    periodo: texto(consulta.periodo) || 'ciclo',
    dataInicio: texto(consulta.dataInicio),
    dataFim: texto(consulta.dataFim),
    contractId: texto(consulta.contractId),
    servicoId: texto(consulta.servicoId),
    mesReferencia: texto(consulta.mesReferencia),
    anoReferencia: texto(consulta.anoReferencia),
    refresh: texto(consulta.refresh),
    nocache: texto(consulta.nocache),
  };
}

function umaVez(chave: string, trabalho: () => Promise<Record<string, unknown>>): Promise<Record<string, unknown>> {
  const existente = emVoo.get(chave);
  if (existente) return existente;
  const promessa = trabalho().finally(() => {
    if (emVoo.get(chave) === promessa) emVoo.delete(chave);
  });
  emVoo.set(chave, promessa);
  return promessa;
}

/**
 * A tela lê a tabela. O worker só calcula quando não há cache
 * ou a importação daquele contrato é mais nova que o cache.
 */
export async function atenderExecutivo(
  consultaBruta: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const consulta = normalizarConsultaExecutivo(consultaBruta);
  const contratoId = consulta.contractId;
  const ciclo = chaveCicloExecutivo({
    periodo: consulta.periodo,
    mesReferencia: numero(consulta.mesReferencia),
    anoReferencia: numero(consulta.anoReferencia),
    dataInicio: consulta.dataInicio,
    dataFim: consulta.dataFim,
    servicoId: consulta.servicoId,
  });
  const atualizar = consulta.refresh === '1' || consulta.nocache === '1';

  if (contratoId && !atualizar) {
    const hit = await lerExecutivoCache(contratoId, ciclo);
    if (hit) {
      console.log(`[Executivo] cache tabela ${ciclo}`);
      return marcarCacheTabela(hit.payload, hit.calculadoEm);
    }
  }

  return umaVez(`${contratoId || 'todos'}|${ciclo}|${atualizar ? 'r' : 'c'}`, async () => {
    if (contratoId && !atualizar) {
      const deNovo = await lerExecutivoCache(contratoId, ciclo);
      if (deNovo) return marcarCacheTabela(deNovo.payload, deNovo.calculadoEm);
    }
    const iniciadoEm = new Date();
    console.log(`[Executivo] calculando ${ciclo} no worker`);
    const payload = await calcularNoWorker({
      consulta,
      contratoId,
      ciclo,
      iniciadoEm: iniciadoEm.toISOString(),
    });
    return payload;
  });
}

export function atenderPdfExecutivo(corpo: Record<string, unknown>): Promise<ResultadoPdf> {
  return gerarPdfNoWorker(corpo);
}
