/**
 * Classifica o tipo de planilha no upload do contrato (sem precisar escolher serviço).
 */
import * as XLSX from 'xlsx';
import { detectarPlanilhaServicosUnificados } from './servicosUnificadosPlanilhaParser';
import { detectarPlanilhaConsolidadoProducao } from './consolidadoProducaoPlanilhaParser';
import { parsearPlanilhaRocada, resumoParseRocada } from './rocadaPlanilhaParser';

export type TipoPlanilhaContrato =
  | 'consolidado_producao'
  | 'unificado'
  | 'rocada'
  | 'coleta'
  | 'desconhecido';

function normHeader(h: unknown): string {
  return String(h ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function headersTem(headers: string[], ...candidatos: string[]): boolean {
  return candidatos.some((c) => headers.some((h) => h === c || h.includes(c)));
}

/** Heurística de planilha de coleta (PLACA + peso/motorista/tipo caminhão). */
export function detectarPlanilhaColeta(buffer: Buffer): boolean {
  try {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true, sheetRows: 20 });
    for (const name of wb.SheetNames.slice(0, 8)) {
      const ws = wb.Sheets[name];
      if (!ws) continue;
      const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' }) as unknown[][];
      if (!rows.length) continue;
      // sonda primeiras 15 linhas como possível cabeçalho
      for (let r = 0; r < Math.min(15, rows.length); r++) {
        const headers = (rows[r] || []).map(normHeader).filter(Boolean);
        if (headers.length < 3) continue;
        const temPlaca = headersTem(headers, 'PLACA');
        const temPeso = headersTem(headers, 'PESO TOTAL', 'PESO', 'PESOTOTAL');
        const temMotorista = headersTem(headers, 'MOTORISTA');
        const temTipo = headersTem(headers, 'TIPO DE CAMINHAO', 'TIPO CAMINHAO', 'TIPO DE CAMINHÃO');
        if (temPlaca && (temPeso || temMotorista || temTipo)) return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

export function detectarPlanilhaRocadaLegado(buffer: Buffer): boolean {
  try {
    const parsed = parsearPlanilhaRocada(buffer);
    const resumo = resumoParseRocada(parsed);
    return resumo.podeImportar === true;
  } catch {
    return false;
  }
}

export function classificarPlanilhaContrato(buffer: Buffer): {
  tipo: TipoPlanilhaContrato;
  label: string;
} {
  if (detectarPlanilhaConsolidadoProducao(buffer)) {
    return { tipo: 'consolidado_producao', label: 'Produção padrão (CONSOLIDADO — um serviço cada)' };
  }
  if (detectarPlanilhaServicosUnificados(buffer)) {
    return { tipo: 'unificado', label: 'Serviços unificados (por TIPO DE SERVIÇO)' };
  }
  if (detectarPlanilhaColeta(buffer)) {
    return { tipo: 'coleta', label: 'Coleta com caminhão' };
  }
  if (detectarPlanilhaRocadaLegado(buffer)) {
    return { tipo: 'rocada', label: 'Roçada (planilha legada)' };
  }
  return { tipo: 'desconhecido', label: 'Formato não reconhecido' };
}
