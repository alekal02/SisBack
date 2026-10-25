export type {
  PeriodoCicloContrato,
  PeriodoContratoQuery,
  QuinzenaPeriodo,
  PeriodoRecortadoCiclo,
  JanelasComparativoCiclo,
} from '@sistemma/shared';

export {
  normalizarDiaInicioCiclo,
  inferirMesReferenciaAtual,
  inferirMesReferenciaDeData,
  inferirCicloReferenciaDeDatas,
  restringirDatasAoCicloDaDataMaisRecente,
  calcularCicloMensalContrato,
  deslocarMesReferencia,
  limitarDiasAusentesAoPeriodoDaPlanilha,
  mesInputParaReferencia,
  referenciaParaMesInput,
  listarDatasIntervalo,
  calcularQuinzenasDoPeriodo,
  isIsoDate,
  formatarDataBr,
  isoHojeLocal,
  recortarPeriodoAteReferencia,
  primeirosNDiasPeriodo,
  montarJanelasComparativoCiclo,
} from '@sistemma/shared';

import {
  calcularCicloMensalContrato,
  formatarDataBr,
  inferirMesReferenciaAtual,
  isIsoDate,
  normalizarDiaInicioCiclo,
  recortarPeriodoAteReferencia,
} from '@sistemma/shared';
import type { PeriodoCicloContrato, PeriodoContratoQuery } from '@sistemma/shared';

export function parsePeriodosPorContratoQuery(
  query: Record<string, any>,
): Record<string, PeriodoContratoQuery> {
  const raw = query.periodosPorContrato;
  if (!raw || typeof raw !== 'string') return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const result: Record<string, PeriodoContratoQuery> = {};
    for (const [id, val] of Object.entries(parsed)) {
      const v = val as PeriodoContratoQuery;
      const item: PeriodoContratoQuery = {};
      if (isIsoDate(v?.dataInicio) && isIsoDate(v?.dataFim)) {
        item.dataInicio = v.dataInicio;
        item.dataFim = v.dataFim;
      }
      const mes = parseInt(String(v?.mes), 10);
      const ano = parseInt(String(v?.ano), 10);
      if (!Number.isNaN(mes) && !Number.isNaN(ano) && mes >= 1 && mes <= 12 && ano >= 2000) {
        item.mes = mes;
        item.ano = ano;
      }
      if (id && (item.dataInicio || item.mes)) {
        result[id] = item;
      }
    }
    return result;
  } catch {
    return {};
  }
}

export function resolverFiltrosPeriodoQuery(
  query: Record<string, any>,
  diaInicioCiclo?: number | null,
  contractId?: string | null,
): {
  filtros: { dataInicio?: string; dataFim?: string };
  periodo?: PeriodoCicloContrato;
} {
  const d = normalizarDiaInicioCiclo(diaInicioCiclo);
  const periodosMap = parsePeriodosPorContratoQuery(query);

  if (contractId && periodosMap[contractId]?.dataInicio && periodosMap[contractId]?.dataFim) {
    const p = periodosMap[contractId];
    return {
      filtros: { dataInicio: p.dataInicio, dataFim: p.dataFim },
      periodo: {
        mesReferencia: 0,
        anoReferencia: 0,
        diaInicioCiclo: d,
        dataInicio: p.dataInicio!,
        dataFim: p.dataFim!,
        label: `${formatarDataBr(p.dataInicio!)} a ${formatarDataBr(p.dataFim!)}`,
      },
    };
  }

  if (!contractId && (query.dataInicio || query.dataFim)) {
    const dataInicio = query.dataInicio as string | undefined;
    const dataFim = query.dataFim as string | undefined;
    return {
      filtros: { dataInicio, dataFim },
      periodo: isIsoDate(dataInicio) && isIsoDate(dataFim) ? {
        mesReferencia: 0,
        anoReferencia: 0,
        diaInicioCiclo: d,
        dataInicio: dataInicio!,
        dataFim: dataFim!,
        label: `${formatarDataBr(dataInicio!)} a ${formatarDataBr(dataFim!)}`,
      } : undefined,
    };
  }

  let mesRef = query.mesReferencia != null ? parseInt(String(query.mesReferencia), 10) : NaN;
  let anoRef = query.anoReferencia != null ? parseInt(String(query.anoReferencia), 10) : NaN;

  if (contractId && periodosMap[contractId]?.mes && periodosMap[contractId]?.ano) {
    mesRef = periodosMap[contractId].mes!;
    anoRef = periodosMap[contractId].ano!;
  }

  let ano: number;
  let mes: number;
  if (!Number.isNaN(mesRef) && !Number.isNaN(anoRef) && mesRef >= 1 && mesRef <= 12 && anoRef >= 2000) {
    ano = anoRef;
    mes = mesRef;
  } else {
    ({ ano, mes } = inferirMesReferenciaAtual(d));
  }

  const periodo = calcularCicloMensalContrato(ano, mes, d);
  const recorte = recortarPeriodoAteReferencia(periodo.dataInicio, periodo.dataFim);
  return {
    filtros: { dataInicio: recorte.dataInicio, dataFim: recorte.dataFim },
    periodo,
  };
}
