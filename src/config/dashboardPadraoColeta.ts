/**
 * Dashboard padrão para novos serviços de Coleta com Caminhão.
 * Exportado do serviço de referência (modelo validado na UI).
 */
import dashboardRaw from './dashboardPadraoColeta.export.json';
import { TipoServico } from '../enums/TipoServico';

type KpiExport = (typeof dashboardRaw.kpis)[number];
type GraficoExport = (typeof dashboardRaw.graficos)[number];

const TIPO = TipoServico.COLETA_CAMINHAO;

/** Widget de rankings melhores/piores — padrão em todo serviço de coleta */
export const RANKINGS_OPERACIONAIS_PADRAO_COLETA = {
  ativo: true,
  metrica: 'tonelagem',
  limite: 20,
  categorias: ['motoristas', 'coletores', 'rotas'] as const,
};

/** Indica se o dashboard deve exibir os rankings operacionais */
export function rankingsOperacionaisHabilitados(
  configDashboard: Record<string, any> | null | undefined,
  tipoServico?: string,
): boolean {
  const flag = configDashboard?.rankingsOperacionais;
  if (flag?.ativo === false) return false;
  if (flag?.ativo === true) return true;
  return tipoServico === TIPO;
}

/** Ajustes de fórmulas em relação ao snapshot exportado */
const CORRECOES_EXPRESSAO: Record<string, string> = {
  Viagens: 'VIAGENS_VALIDADAS()',
  'Peso por Coletor (kg)': 'DIVIDE(SUM(PESO TOTAL) / 1000, PLACAS_UNICAS())',
};

function normalizarKpi(kpi: KpiExport, index: number): Record<string, any> {
  const expressao = CORRECOES_EXPRESSAO[kpi.nome] || kpi.expressao;
  return {
    id: `padrao_coleta_kpi_${index}`,
    nome: kpi.nome,
    label: kpi.label,
    expressao,
    formato: kpi.formato,
    agregacao: kpi.agregacao || 'sum',
    ativo: true,
    descricao: kpi.descricao,
    unidade: kpi.unidade,
    cor: kpi.cor,
    categoria: kpi.categoria,
    colunasUsadas: kpi.colunasUsadas || [],
    valoresFixos: {},
    automatico: true,
    origemTemplate: true,
    templateTipo: TIPO,
  };
}

function normalizarGrafico(g: GraficoExport, index: number): Record<string, any> {
  const { reResolvido, reResolvidoEm, ...rest } = g as GraficoExport & {
    reResolvido?: boolean;
    reResolvidoEm?: string;
  };
  return {
    ...rest,
    id: g.key ? `padrao_coleta_${g.key}` : `padrao_coleta_grafico_${index}`,
    ativo: true,
    padrao: true,
    automatico: true,
    origemTemplate: true,
    templateTipo: TIPO,
    ordem: g.ordem ?? index + 1,
  };
}

/** KPIs padrão (20 indicadores do dashboard modelo) */
export function getKpisDashboardPadraoColeta(): Record<string, any>[] {
  return dashboardRaw.kpis.map(normalizarKpi);
}

/** Gráficos padrão (12 gráficos do dashboard modelo) */
export function getGraficosDashboardPadraoColeta(): Record<string, any>[] {
  return dashboardRaw.graficos.map(normalizarGrafico);
}

/** configDashboard completo para aplicar em serviço novo */
export function buildConfigDashboardPadraoColeta(): Record<string, any> {
  const kpis = getKpisDashboardPadraoColeta();
  const graficos = getGraficosDashboardPadraoColeta();
  const agora = new Date().toISOString();

  return {
    kpis,
    graficos,
    kpisTemplateAplicados: true,
    kpisTemplateTotal: kpis.length,
    kpisTemplateTipo: TIPO,
    kpisTemplateAplicadosEm: agora,
    graficosPadraoAplicados: true,
    graficosPadraoTotal: graficos.length,
    graficosPadraoTipo: TIPO,
    graficosPadraoAplicadosEm: agora,
    rankingsOperacionais: { ...RANKINGS_OPERACIONAIS_PADRAO_COLETA },
    dashboardPadraoVersao: 'coleta-referencia-v2',
  };
}

/** KPIs no formato KpiTemplate (compatível com TipoServicoTemplateService) */
export function getKpisTemplateColeta(): Array<{
  nome: string;
  label: string;
  expressao: string;
  formato: string;
  descricao: string;
  unidade: string;
  cor: string;
  categoria: string;
  colunasUsadas: string[];
}> {
  return getKpisDashboardPadraoColeta().map(k => ({
    nome: k.nome,
    label: k.label,
    expressao: k.expressao,
    formato: k.formato,
    descricao: k.descricao,
    unidade: k.unidade,
    cor: k.cor,
    categoria: k.categoria,
    colunasUsadas: k.colunasUsadas,
  }));
}

/** Gráficos no formato GraficoTemplate */
export function getGraficosTemplateColeta(): Array<{
  tipo: string;
  titulo: string;
  eixoX: string;
  eixoY: string;
  descricao: string;
}> {
  return getGraficosDashboardPadraoColeta().map(g => ({
    tipo: g.tipo,
    titulo: g.titulo,
    eixoX: g.eixoX,
    eixoY: g.eixoY,
    descricao: g.descricao,
  }));
}
