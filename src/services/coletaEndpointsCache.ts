/**
 * Consultas de coleta com cache, num só lugar.
 *
 * A chave e o formato da resposta ficam aqui porque dois lados precisam deles: o
 * endpoint que responde ao navegador e o aquecimento que roda depois do import.
 * Quando estavam escritos direto no controller, o aquecimento gravava numa chave
 * que ninguém lia e a primeira abertura da tela continuava lenta.
 */
import { getEndpointCache, setEndpointCache } from './comparacaoCache';
import { escopoCacheContrato } from './coletaTotaisDiaService';
import {
  getAgregacaoColeta,
  getRankingsColetaSql,
  getMapeamentoOperacional,
} from './coletaAgregacaoService';
import { getFichaRotasCiclo } from './rotaCicloService';

export type PeriodoColeta = {
  data?: string;
  dataInicio?: string;
  dataFim?: string;
};

async function comCache<T>(chave: string, calcular: () => Promise<T>): Promise<T> {
  const cache = getEndpointCache<T>(chave);
  if (cache) return cache;
  const valor = await calcular();
  setEndpointCache(chave, valor);
  return valor;
}

export async function agregacaoColetaComCache(
  servicoId: string,
  opts: PeriodoColeta & { topN?: number; tipoServico?: string | null; valoresFixos?: Record<string, number> },
): Promise<any> {
  const chave = [
    escopoCacheContrato(),
    'coleta-agregacao',
    servicoId,
    opts.data || '',
    opts.dataInicio || '',
    opts.dataFim || '',
    String(opts.topN || ''),
  ].join(':');

  return comCache(chave, async () => {
    const agregacao = await getAgregacaoColeta(servicoId, {
      data: opts.data,
      dataInicio: opts.dataInicio,
      dataFim: opts.dataFim,
      topN: opts.topN,
      valoresFixos: opts.valoresFixos,
    });
    return { ...agregacao, tipoServico: opts.tipoServico, modo: 'coleta-sql' };
  });
}

export async function rankingsColetaComCache(
  servicoId: string,
  opts: { dataInicio?: string; dataFim?: string },
): Promise<any> {
  const chave = [escopoCacheContrato(), 'coleta-rankings', servicoId, opts.dataInicio || '', opts.dataFim || ''].join(':');
  return comCache(chave, () => getRankingsColetaSql(servicoId, { ...opts, topN: 100 }));
}

export async function mapeamentoOperacionalComCache(
  servicoId: string,
  opts: PeriodoColeta & { tipoServico?: string | null },
): Promise<any> {
  const chave = [
    escopoCacheContrato(),
    'mapeamento-operacional-v10',
    servicoId,
    opts.data || '',
    opts.dataInicio || '',
    opts.dataFim || '',
  ].join(':');

  return comCache(chave, async () => {
    const resultado = await getMapeamentoOperacional(servicoId, {
      data: opts.data,
      dataInicio: opts.dataInicio,
      dataFim: opts.dataFim,
    });
    return { ...resultado, tipoServico: opts.tipoServico };
  });
}

export async function fichaRotasCicloComCache(
  servicoId: string,
  opts: { dataInicio?: string; dataFim?: string },
): Promise<any> {
  const chave = [escopoCacheContrato(), 'rotas-ciclo-v1', servicoId, opts.dataInicio || '', opts.dataFim || ''].join(':');
  return comCache(chave, () => getFichaRotasCiclo(servicoId, opts));
}
