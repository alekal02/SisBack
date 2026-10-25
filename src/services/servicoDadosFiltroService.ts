import { encontrarValorColuna } from './FormulaEngine';
import { parseDataPlanilha } from '../utils/formatarDataPlanilha';

export function normalizarChaveColuna(chave: string): string {
  return chave.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
}

export function valorCorrespondeFiltro(valorDado: unknown, valorFiltro: string): boolean {
  if (!valorFiltro?.trim()) return true;
  const dadoNorm = String(valorDado ?? '').toUpperCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const valores = valorFiltro.split(',')
    .map(v => v.toUpperCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
    .filter(Boolean);
  if (valores.length === 0) return true;
  return valores.some(v => dadoNorm === v || dadoNorm.includes(v));
}

function obterDataLinha(d: Record<string, unknown>): Date | null {
  const candidatosPrioritarios = ['dataSaida', 'DATA SAIDA', 'DATA_SAIDA', 'DATA SAÍDA', 'DATA'];
  for (const nome of candidatosPrioritarios) {
    const val = (d as Record<string, unknown>)[nome] ?? encontrarValorColuna(d, nome);
    if (val !== null && val !== undefined && val !== '') {
      const parsed = parseDataPlanilha(val);
      if (parsed) return parsed;
      const data = val instanceof Date ? val : new Date(val as string | number);
      if (!isNaN(data.getTime())) return data;
    }
  }
  for (const chave of Object.keys(d)) {
    const chaveNorm = normalizarChaveColuna(chave);
    if (chaveNorm.includes('DATA') || chaveNorm.includes('DIA')) {
      const val = d[chave];
      if (val) {
        const parsed = parseDataPlanilha(val);
        if (parsed) return parsed;
        const data = val instanceof Date ? val : new Date(val as string | number);
        if (!isNaN(data.getTime())) return data;
      }
    }
  }
  return null;
}

/** Filtra linhas da planilha por intervalo de datas (mesma lógica do dashboard operacional). */
export function aplicarFiltrosPeriodoServico(
  dados: Record<string, unknown>[],
  dataInicio?: Date,
  dataFim?: Date,
): Record<string, unknown>[] {
  let resultados = [...dados];

  if (dataInicio) {
    resultados = resultados.filter(d => {
      const data = obterDataLinha(d);
      return data !== null && data >= dataInicio;
    });
  }

  if (dataFim) {
    const fim = new Date(dataFim);
    fim.setHours(23, 59, 59, 999);
    resultados = resultados.filter(d => {
      const data = obterDataLinha(d);
      return data !== null && data <= fim;
    });
  }

  return resultados;
}
