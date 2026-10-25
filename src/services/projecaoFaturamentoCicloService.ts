import { encontrarValorColuna } from './FormulaEngine';
import { parseDataPlanilha } from '../utils/formatarDataPlanilha';

export interface ProjecaoFaturamentoCiclo {
  realizado: number;
  projetado: number;
  mediaDiaria: number;
  diasComDados: number;
  diasTotaisCiclo: number;
  diasDecorridos: number;
  cicloEmAndamento: boolean;
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseIsoDate(iso: string): Date {
  return new Date(`${iso}T12:00:00`);
}

function diffDaysInclusive(inicio: string, fim: string): number {
  const a = parseIsoDate(inicio).getTime();
  const b = parseIsoDate(fim).getTime();
  if (b < a) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

/** Dias distintos com registros operacionais no ciclo. */
export function contarDiasComDadosOperacionais(dados: Record<string, unknown>[]): number {
  const dias = new Set<string>();

  for (const row of dados) {
    const d = row as Record<string, unknown>;
    const raw =
      encontrarValorColuna(d, 'DATA SAIDA')
      ?? encontrarValorColuna(d, 'DATA SAÍDA')
      ?? encontrarValorColuna(d, 'DATA')
      ?? d.dataSaida;

    let parsed: Date | null = null;
    if (raw instanceof Date && !isNaN(raw.getTime())) {
      parsed = raw;
    } else if (raw) {
      parsed = parseDataPlanilha(raw) || null;
    }

    if (parsed && !isNaN(parsed.getTime())) {
      dias.add(isoDate(parsed));
    }
  }

  return dias.size;
}

/**
 * Projeção do faturamento para o ciclo completo:
 * média diária (realizado ÷ dias decorridos do ciclo) × total de dias do ciclo.
 */
export function calcularProjecaoFaturamentoCiclo(
  faturamentoRealizado: number,
  dadosNorm: Record<string, unknown>[],
  dataInicio: string,
  dataFim: string,
  hoje: Date = new Date(),
): ProjecaoFaturamentoCiclo {
  const hojeIso = isoDate(hoje);
  const diasTotaisCiclo = diffDaysInclusive(dataInicio, dataFim);
  const diasComDados = contarDiasComDadosOperacionais(dadosNorm);

  const fimReferencia = hojeIso < dataFim ? hojeIso : dataFim;
  const diasDecorridos = Math.max(1, diffDaysInclusive(dataInicio, fimReferencia));
  const cicloEmAndamento = hojeIso < dataFim;

  const baseMedia = diasDecorridos;
  const mediaDiaria = baseMedia > 0 && faturamentoRealizado > 0
    ? faturamentoRealizado / baseMedia
    : 0;

  const projetado = cicloEmAndamento && mediaDiaria > 0
    ? Math.round(mediaDiaria * diasTotaisCiclo * 100) / 100
    : Math.round(faturamentoRealizado * 100) / 100;

  return {
    realizado: Math.round(faturamentoRealizado * 100) / 100,
    projetado,
    mediaDiaria: Math.round(mediaDiaria * 100) / 100,
    diasComDados,
    diasTotaisCiclo,
    diasDecorridos,
    cicloEmAndamento,
  };
}
