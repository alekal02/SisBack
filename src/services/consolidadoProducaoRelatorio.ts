/**
 * Agrega linhas da CONSOLIDADO para o PDF gerencial do dia / ciclo.
 */
import type { LinhaConsolidadoProducao, TipoServicoConsolidado } from './consolidadoProducaoPlanilhaParser';
import { TipoServico } from '../enums/TipoServico';

export interface TopLocalConsolidado {
  local: string;
  registros: number;
  quantitativo: number;
}

export interface CardTipoConsolidado {
  tipoSistema: TipoServicoConsolidado;
  tipoLabel: string;
  registros: number;
  quantitativo: number;
  und: string | null;
  locais: number;
  registrosManual: number;
  quantitativoManual: number;
  registrosMecanizada: number;
  quantitativoMecanizada: number;
  topLocais: TopLocalConsolidado[];
}

export interface RelatorioDiaConsolidado {
  dataIso: string;
  avisos: string[];
  totalRegistros: number;
  cards: CardTipoConsolidado[];
}

export interface DiaSerieConsolidado {
  dataIso: string;
  registros: number;
  porTipo: Array<{
    tipoSistema: TipoServicoConsolidado;
    tipoLabel: string;
    registros: number;
    quantitativo: number;
    und: string | null;
  }>;
}

export interface RelatorioPacoteConsolidado {
  dia: RelatorioDiaConsolidado;
  ciclo: {
    dataInicio: string;
    dataFim: string;
    diasComDados: number;
    totalRegistros: number;
    cards: CardTipoConsolidado[];
    serie: DiaSerieConsolidado[];
  };
}

function isoDe(l: LinhaConsolidadoProducao): string | null {
  return l.dataSaida ? l.dataSaida.toISOString().slice(0, 10) : null;
}

export function ultimaDataLinhasConsolidado(linhas: LinhaConsolidadoProducao[]): string | null {
  const datas = linhas.map(isoDe).filter((d): d is string => !!d).sort();
  return datas.length ? datas[datas.length - 1] : null;
}

function undDoTipo(tipo: TipoServicoConsolidado, undLinha: string | null): string | null {
  if (tipo === TipoServico.ROCADEIRA) return 'm²';
  if (tipo === TipoServico.VARRICAO || tipo === TipoServico.CAPINA) {
    const u = String(undLinha || '').toLowerCase();
    if (u.includes('m²') || u === 'm2') return 'm²';
    if (u === 'm' || u.includes('metro')) return 'm';
    return 'km';
  }
  if (tipo === TipoServico.PODA) return 'pontos';
  if (tipo === TipoServico.REMOCAO || tipo === TipoServico.GERAL) return 'pontos';
  return undLinha;
}

export function agregarLinhasConsolidado(
  linhas: LinhaConsolidadoProducao[],
  dataIso?: string | null,
  topN = 8,
): CardTipoConsolidado[] {
  const filtradas = dataIso
    ? linhas.filter((l) => isoDe(l) === dataIso)
    : linhas;
  const map = new Map<TipoServicoConsolidado, LinhaConsolidadoProducao[]>();
  for (const l of filtradas) {
    const arr = map.get(l.tipoSistema) || [];
    arr.push(l);
    map.set(l.tipoSistema, arr);
  }
  const cards: CardTipoConsolidado[] = [];
  for (const [tipoSistema, arr] of map) {
    const locais = new Map<string, TopLocalConsolidado>();
    for (const l of arr) {
      const nome = l.local || '—';
      const cur = locais.get(nome) || { local: nome, registros: 0, quantitativo: 0 };
      cur.registros += 1;
      cur.quantitativo += l.quantitativo;
      locais.set(nome, cur);
    }
    const man = arr.filter((l) => l.tipoExecucao === 'manual');
    const mec = arr.filter((l) => l.tipoExecucao === 'mecanizada');
    const labels = [...new Set(arr.map((l) => l.tipoLabel))];
    cards.push({
      tipoSistema,
      tipoLabel: labels.length === 1 ? labels[0] : labels.join(' / '),
      registros: arr.length,
      quantitativo: Math.round(arr.reduce((s, l) => s + l.quantitativo, 0) * 1000) / 1000,
      und: undDoTipo(tipoSistema, arr[0]?.und || null),
      locais: locais.size,
      registrosManual: man.length,
      quantitativoManual: Math.round(man.reduce((s, l) => s + l.quantitativo, 0) * 1000) / 1000,
      registrosMecanizada: mec.length,
      quantitativoMecanizada: Math.round(mec.reduce((s, l) => s + l.quantitativo, 0) * 1000) / 1000,
      topLocais: [...locais.values()]
        .sort((a, b) => b.quantitativo - a.quantitativo || b.registros - a.registros)
        .slice(0, topN)
        .map((x) => ({ ...x, quantitativo: Math.round(x.quantitativo * 1000) / 1000 })),
    });
  }
  cards.sort((a, b) => b.registros - a.registros);
  return cards;
}

export function montarRelatorioDiaConsolidado(
  linhas: LinhaConsolidadoProducao[],
  avisos: string[],
  dataIso?: string | null,
): RelatorioDiaConsolidado | null {
  const dia = dataIso || ultimaDataLinhasConsolidado(linhas);
  if (!dia) return null;
  const cards = agregarLinhasConsolidado(linhas, dia);
  if (cards.length === 0) return null;
  return {
    dataIso: dia,
    avisos: avisos.filter((a) => /Power Query|não reconhecido/i.test(a)),
    totalRegistros: cards.reduce((s, c) => s + c.registros, 0),
    cards,
  };
}

export function fmtQtd(n: number, und: string | null): string {
  const num = n.toLocaleString('pt-BR', { maximumFractionDigits: n >= 100 ? 0 : 2 });
  return und ? `${num} ${und}` : num;
}

export function primeiraDataLinhasConsolidado(linhas: LinhaConsolidadoProducao[]): string | null {
  const datas = linhas.map(isoDe).filter((d): d is string => !!d).sort();
  return datas.length ? datas[0] : null;
}

export function montarSerieConsolidado(linhas: LinhaConsolidadoProducao[]): DiaSerieConsolidado[] {
  const porDia = new Map<string, LinhaConsolidadoProducao[]>();
  for (const l of linhas) {
    const d = isoDe(l);
    if (!d) continue;
    const arr = porDia.get(d) || [];
    arr.push(l);
    porDia.set(d, arr);
  }
  return [...porDia.keys()].sort().map((dataIso) => {
    const cards = agregarLinhasConsolidado(porDia.get(dataIso) || [], dataIso, 0);
    return {
      dataIso,
      registros: cards.reduce((s, c) => s + c.registros, 0),
      porTipo: cards.map((c) => ({
        tipoSistema: c.tipoSistema,
        tipoLabel: c.tipoLabel,
        registros: c.registros,
        quantitativo: c.quantitativo,
        und: c.und,
      })),
    };
  });
}

/** Dia operacional + acumulado do ciclo na mesma planilha (envio diário no grupo). */
export function montarPacoteConsolidado(
  linhas: LinhaConsolidadoProducao[],
  avisos: string[],
  dataIso?: string | null,
): RelatorioPacoteConsolidado | null {
  const dia = montarRelatorioDiaConsolidado(linhas, avisos, dataIso);
  if (!dia) return null;
  const dataInicio = primeiraDataLinhasConsolidado(linhas) || dia.dataIso;
  const dataFim = ultimaDataLinhasConsolidado(linhas) || dia.dataIso;
  const cardsCiclo = agregarLinhasConsolidado(linhas, null, 8);
  const serie = montarSerieConsolidado(linhas);
  return {
    dia,
    ciclo: {
      dataInicio,
      dataFim,
      diasComDados: serie.length,
      totalRegistros: linhas.length,
      cards: cardsCiclo,
      serie,
    },
  };
}
