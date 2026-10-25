/**
 * Calcula KPIs complementares do dia via métricas SQL (mesmo caminho do kpi-valores).
 * KPIs que exigem FormulaEngine in-memory retornam null e são omitidos.
 */
import type { Contract } from '../../entities/Contract';
import type { Servico } from '../../entities/Servico';
import { resolverKpiColetaSql, type MetricasColetaSql } from '../coletaAgregacaoService';
import { formatarValorKpi, prepararKpisServico } from '../kpiCalculoServicoService';
import { isKpiMetricaBaseOperacao } from './operacaoDia';
import type { KpiValorPdf } from './gerarHtmlRelatorioDiaOperacao';

function isKpiReceita(nome: string, formato: string): boolean {
  if (formato === 'moeda') return true;
  const n = nome.toLowerCase();
  return ['faturamento', 'receita', 'financeiro', 'valor', 'custo', 'lucro', 'preco', 'r$'].some((p) => n.includes(p));
}

export function calcularKpisOperacaoDiaSql(opts: {
  servico: Servico;
  contract: Contract | null;
  metricas: MetricasColetaSql;
  valoresFixos: Record<string, number>;
  limite?: number;
}): KpiValorPdf[] {
  const todosKpis = prepararKpisServico(opts.servico, opts.contract);
  const limite = opts.limite ?? 8;
  const out: KpiValorPdf[] = [];

  for (const kpi of todosKpis) {
    const nome = String(kpi.label || kpi.nome || '');
    const formato = String(kpi.formato || 'numero');
    if (isKpiReceita(nome, formato)) continue;
    if (isKpiMetricaBaseOperacao(nome)) continue;

    const expressao = String(kpi.expressao || kpi.formula || '');
    const kpiValoresFixos = { ...opts.valoresFixos };
    if (kpi.valoresFixos && typeof kpi.valoresFixos === 'object') {
      for (const [key, v] of Object.entries(kpi.valoresFixos)) {
        if (v !== null && v !== undefined && Number(v) > 0) {
          kpiValoresFixos[key] = Number(v);
        }
      }
    }

    const valor = resolverKpiColetaSql(expressao, opts.metricas, kpiValoresFixos);
    if (valor == null || Number.isNaN(valor)) continue;

    out.push({
      nome,
      formatado: formatarValorKpi(valor, formato),
    });
    if (out.length >= limite) break;
  }

  return out;
}
