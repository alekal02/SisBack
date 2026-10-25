import { calcularExpressao, encontrarValorColuna } from './FormulaEngine';
import { resolvePlaceholdersNaFormula } from './PlaceholderResolver';
import { listarKpisAtivosParaCalculo, normalizarTexto } from './kpiDeduplicacaoService';
import {
  contarMotoristasUnicos,
  contarPlacasUnicas,
  contarDistritosUnicos,
} from './contadoresAtivosKpiService';
import {
  calcularMediaTonPorColetorViagem,
} from './coletoresUnicosService';
import { detectarTodasColunas } from './metricaExecutivaService';
import {
  calcularProjecaoFaturamentoCiclo,
} from './projecaoFaturamentoCicloService';
import { buildConfigDashboardPadraoColeta } from '../config/dashboardPadraoColeta';
import { TipoServico } from '../enums/TipoServico';
import type { Contract } from '../entities/Contract';
import type { Servico } from '../entities/Servico';

export interface KpiCalculadoResultado {
  id: string;
  nome: string;
  valor: number | null;
  formatado: string;
  formato: string;
  origem?: string;
  origemUniversal?: string;
  erro?: string;
  detalhe?: string;
  faturamentoRealizado?: number;
  faturamentoProjetado?: number;
  ehProjecaoCiclo?: boolean;
}

export function resolverExpressaoKpiViagensRealizadas(
  kpi: { nome?: string; label?: string; expressao?: string },
  expressao: string,
): string {
  const nome = (kpi.nome || '').trim();
  const label = (kpi.label || '').trim();
  const expr = (expressao || '').trim();

  const ehViagensRealizadas =
    nome === 'Viagens' ||
    nome === 'Viagens Realizadas' ||
    label === 'Viagens Realizadas' ||
    label.includes('Viagens Realizadas');

  if (!ehViagensRealizadas) return expressao;

  if (/VIAGENS_VALIDADAS\s*\(\s*\)/i.test(expr) || /VIAGENS_POR_ROTA\s*\(\s*\)/i.test(expr)) {
    return expr;
  }
  return 'VIAGENS_VALIDADAS()';
}

/** KPI "Total de Viagens (Contador)" — soma com fallback (PESO 1–4), não SUM bruto que ignora células vazias */
export function resolverExpressaoKpiContadorViagens(
  kpi: { nome?: string; label?: string; expressao?: string },
  expressao: string,
): string {
  const nome = (kpi.nome || '').trim();
  const label = (kpi.label || '').trim();
  const expr = (expressao || '').trim();

  const ehContadorViagens =
    nome === 'Total Viagens Contador' ||
    label === 'Total de Viagens (Contador)' ||
    label.includes('Total de Viagens (Contador)') ||
    (label.toLowerCase().includes('contador') && label.toLowerCase().includes('viagen'));

  if (!ehContadorViagens) return expressao;

  if (/VIAGENS_POR_ROTA\s*\(\s*\)/i.test(expr)) return expr;

  if (/SUM\s*\(\s*CONTADOR\s+DE\s+VIAGENS\s*\)/i.test(expr) || /SUM\s*\(\s*CONTADOR\s+VIAGENS\s*\)/i.test(expr)) {
    return 'VIAGENS_POR_ROTA()';
  }

  return expressao;
}

export function resolverExpressaoKpiMotoristas(
  kpi: { nome?: string; label?: string; expressao?: string },
  expressao: string,
): string {
  const texto = `${kpi.label || ''} ${kpi.nome || ''}`.toUpperCase();
  const expr = (expressao || '').trim();

  const ehMotoristas =
    texto.includes('MOTORISTAS ATIVOS') ||
    texto.includes('TOTAL DE MOTORISTAS') ||
    (texto.includes('MOTORISTAS') && !texto.includes('VIAGEM') && !texto.includes('PRODUTIV'));

  if (!ehMotoristas) return expressao;
  if (/MOTORISTAS_UNICOS\s*\(\s*\)/i.test(expr)) return expr;
  if (
    /COUNT\s*\(\s*DISTINCT\s+MOTORISTA/i.test(expr) ||
    /COUNT\s+DISTINCT\s*\(\s*MOTORISTA/i.test(expr)
  ) {
    return 'MOTORISTAS_UNICOS()';
  }
  if (!expr || /SUM\s*\(\s*MOTORISTA/i.test(expr) || (/COUNT\s*\(\s*MOTORISTA/i.test(expr) && !/DISTINCT/i.test(expr))) {
    return 'MOTORISTAS_UNICOS()';
  }
  return expressao;
}

export function resolverExpressaoKpiColetoresEquipe(
  kpi: { nome?: string; label?: string; expressao?: string },
  expressao: string,
): string {
  const nome = (kpi.nome || '').trim();
  const label = (kpi.label || '').trim();
  const expr = (expressao || '').trim();

  const ehColetoresEquipe =
    nome === 'Total Coletores Equipe' ||
    label === 'Total Coletores na Equipe' ||
    label.includes('Coletores na Equipe');

  if (!ehColetoresEquipe) {
    if (/SUM\s*\(\s*N[º°]?\s*DE\s*COLETORES\s*\)/i.test(expr)) {
      return 'COLETORES_UNICOS()';
    }
    return expressao;
  }

  if (expr !== 'COLETORES_UNICOS()') return 'COLETORES_UNICOS()';
  return expressao;
}

/** Tonelagem total do período ÷ placas/caminhões ativos (mesmo critério do card Coletores Ativos). */
export const EXPRESSAO_TON_POR_COLETOR_UNICO = 'DIVIDE(SUM(PESO TOTAL) / 1000, PLACAS_UNICAS())';

function ehKpiMediaTonColetorViagem(kpi: { nome?: string; label?: string }): boolean {
  const texto = `${kpi.label || ''} ${kpi.nome || ''}`.toUpperCase();
  return (texto.includes('MÉDIA') || texto.includes('MEDIA')) && texto.includes('COLETOR') && texto.includes('VIAGEM');
}

function ehKpiTonPorColetorPeriodo(kpi: { nome?: string; label?: string }): boolean {
  const texto = `${kpi.label || ''} ${kpi.nome || ''}`.toUpperCase();
  if (ehKpiMediaTonColetorViagem(kpi)) return false;
  return (
    texto.includes('PESO/COLETOR') ||
    texto.includes('TON/COLETOR') ||
    texto.includes('PESO POR COLETOR') ||
    (texto.includes('PESO') && texto.includes('COLETOR') && !texto.includes('FATURAMENTO'))
  );
}

/** Peso/Ton por Coletor = tonelagem total ÷ coletores únicos no período (não SUM de Nº DE COLETORES). */
export function resolverExpressaoKpiPesoColetor(
  kpi: { nome?: string; label?: string; expressao?: string; formula?: string },
  expressao: string,
): string {
  if (ehKpiMediaTonColetorViagem(kpi)) return expressao;
  if (!ehKpiTonPorColetorPeriodo(kpi)) return expressao;

  const expr = (expressao || kpi.formula || '').trim();
  if (/DIVIDE\s*\(\s*SUM\s*\(\s*PESO\s+TOTAL\s*\)\s*\/\s*1000\s*,\s*PLACAS_UNICAS\s*\(\s*\)\s*\)/i.test(expr)) {
    return expr;
  }

  return EXPRESSAO_TON_POR_COLETOR_UNICO;
}

export function formatarValorKpi(valor: number, formato: string): string {
  if (formato === 'moeda') {
    return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
  if (formato === 'porcentagem') {
    return valor.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + '%';
  }
  return valor.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

export function prepararKpisServico(servico: Servico, contract: Contract | null): any[] {
  const kpisContrato: any[] = (contract?.kpisConfig || [])
    .filter((k: any) => k.ativo !== false)
    .map((k: any) => ({ ...k, _origem: 'contrato' }));
  const kpisServico: any[] = (servico.configDashboard?.kpis || [])
    .filter((k: any) => k.ativo !== false)
    .map((k: any) => ({ ...k, _origem: 'servico' }));
  let todosKpis = listarKpisAtivosParaCalculo([...kpisContrato, ...kpisServico]);

  if (todosKpis.length === 0 && servico.tipo === TipoServico.COLETA_CAMINHAO) {
    todosKpis = (buildConfigDashboardPadraoColeta().kpis || []).filter((k: any) => k.ativo !== false);
  }

  for (const kpi of todosKpis) {
    const expr = kpi.expressao || '';
    if (
      /SUM\s*\(\s*PESO\s+TOTAL\s*\)\s*\/\s*1000\s*\*\s*VALOR_TRUCK/i.test(expr) ||
      /SUM\s*\(\s*PESO\s*\)\s*\/\s*1000\s*\*\s*VALOR_TRUCK/i.test(expr)
    ) {
      kpi.expressao = 'FATURAMENTO_EST(PESO TOTAL, TIPO CAMINHAO)';
    }
    kpi.expressao = resolverExpressaoKpiPesoColetor(kpi, kpi.expressao || kpi.formula || '');
  }

  return todosKpis;
}

function chaveMesclagemKpi(kpi: KpiCalculadoResultado & { origemUniversal?: string }): string {
  if (kpi.origemUniversal) return `uni:${kpi.origemUniversal}`;
  return `nome:${normalizarTexto(kpi.nome || '')}:${kpi.formato || 'numero'}`;
}

/** Recalcula KPIs de contagem distinta no dataset consolidado do período (executivo multi-serviço). */
export function ajustarKpisContagemDistintaConsolidada(
  kpis: KpiCalculadoResultado[],
  dadosNorm: Record<string, unknown>[],
): KpiCalculadoResultado[] {
  if (!dadosNorm.length) return kpis;

  const dados = dadosNorm as Record<string, any>[];
  const motoristas = contarMotoristasUnicos(dados);
  const placas = contarPlacasUnicas(dados);
  const distritos = contarDistritosUnicos(dados);

  return kpis.map((kpi) => {
    const texto = `${kpi.nome || ''}`.toUpperCase();
    let valor: number | null = null;

    if (
      texto.includes('TOTAL DE MOTORISTAS') ||
      texto.includes('MOTORISTAS ATIVOS') ||
      (texto.includes('MOTORISTAS') && !texto.includes('VIAGEM') && !texto.includes('PRODUTIV'))
    ) {
      valor = motoristas;
    } else if (texto.includes('DISTRITOS ATENDIDOS') || texto.includes('DISTRITOS')) {
      valor = distritos;
    } else if (
      texto.includes('PLACA') ||
      texto.includes('VEÍCULOS ATIVOS') ||
      texto.includes('VEICULOS ATIVOS') ||
      texto.includes('COLETORES ATIVOS')
    ) {
      valor = placas;
    }

    if (valor === null) return kpi;
    return {
      ...kpi,
      valor,
      formatado: formatarValorKpi(valor, kpi.formato),
    };
  });
}

/** Recalcula KPIs de coletor no dataset consolidado (executivo multi-serviço). */
export function ajustarKpisColetorConsolidada(
  kpis: KpiCalculadoResultado[],
  dadosNorm: Record<string, unknown>[],
  metricasRef?: { pesoTotalTon: number; qtdColetores: number },
): KpiCalculadoResultado[] {
  if (!dadosNorm.length && !metricasRef) return kpis;

  const dados = dadosNorm as Record<string, any>[];
  const mediaTonViagem = calcularMediaTonPorColetorViagem(dados);

  let tonPorColetorUnico: number | null = null;
  if (metricasRef && metricasRef.qtdColetores > 0 && metricasRef.pesoTotalTon > 0) {
    tonPorColetorUnico = Math.round((metricasRef.pesoTotalTon / metricasRef.qtdColetores) * 100) / 100;
  } else if (dados.length > 0) {
    const placasAtivas = contarPlacasUnicas(dados);
    const colunas = detectarTodasColunas(dados, 'kpi-ton-coletor');
    const colPeso = colunas.colPeso || 'PESO TOTAL';
    let somaPesoKg = 0;
    for (const d of dados) {
      somaPesoKg += Number(encontrarValorColuna(d, colPeso)) || 0;
    }
    tonPorColetorUnico = placasAtivas > 0
      ? Math.round((somaPesoKg / 1000 / placasAtivas) * 100) / 100
      : null;
  }

  return kpis.map((kpi) => {
    const ref = { nome: kpi.nome, label: kpi.nome };

    if (ehKpiMediaTonColetorViagem(ref)) {
      return {
        ...kpi,
        valor: mediaTonViagem,
        formatado: formatarValorKpi(mediaTonViagem, kpi.formato),
      };
    }

    if (!ehKpiTonPorColetorPeriodo(ref) || tonPorColetorUnico === null) return kpi;

    return {
      ...kpi,
      nome: 'Ton/Coletor',
      valor: tonPorColetorUnico,
      formatado: `${formatarValorKpi(tonPorColetorUnico, kpi.formato)} t`,
    };
  });
}

/** KPI de faturamento total do ciclo (não ratios como Receita/Km). */
export function ehKpiFaturamentoEstimadoCiclo(kpi: {
  nome?: string;
  label?: string;
  expressao?: string;
  formula?: string;
}): boolean {
  const label = (kpi.label || kpi.nome || '').trim();
  if (/FATURAMENTO\s*ESTIMADO/i.test(label)) return true;
  if (label === 'Faturamento' || kpi.nome === 'Faturamento') return true;

  const expr = (kpi.expressao || kpi.formula || '').trim();
  return /^FATURAMENTO_EST\s*\(/i.test(expr);
}

function prepararExpressaoKpiCalculo(kpi: any, expressaoRaw: string, colunasServico: string[]): string {
  let expressao = resolverExpressaoKpiViagensRealizadas(kpi, expressaoRaw);
  expressao = resolverExpressaoKpiContadorViagens(kpi, expressao);
  expressao = resolverExpressaoKpiMotoristas(kpi, expressao);
  expressao = resolverExpressaoKpiColetoresEquipe(kpi, expressao);
  expressao = resolverExpressaoKpiPesoColetor(kpi, expressao);
  const expressaoResolvida = resolvePlaceholdersNaFormula(expressao, { colunasServico });
  if (expressaoResolvida !== expressao) expressao = expressaoResolvida;
  return expressao;
}

export function coletarDefsKpisFaturamentoCiclo(
  servicos: Servico[],
  contractsCache: Map<string, Contract | null>,
): Map<string, any> {
  const map = new Map<string, any>();

  for (const servico of servicos) {
    const contract = contractsCache.get(servico.contract_id) ?? null;
    for (const kpi of prepararKpisServico(servico, contract)) {
      if (!ehKpiFaturamentoEstimadoCiclo(kpi)) continue;
      const chaves = [
        kpi.id,
        kpi.origemUniversal ? `uni:${kpi.origemUniversal}` : '',
        `nome:${normalizarTexto(kpi.label || kpi.nome || '')}`,
      ].filter(Boolean) as string[];
      for (const c of chaves) {
        if (!map.has(c)) map.set(c, kpi);
      }
    }
  }

  return map;
}

/** Recalcula Faturamento Estimado no dataset consolidado do ciclo do contrato. */
export function ajustarKpisFaturamentoCicloConsolidada(
  kpis: KpiCalculadoResultado[],
  dadosNormCiclo: Record<string, unknown>[],
  valoresFixos: Record<string, number>,
  defsPorChave: Map<string, any>,
  colunasServico: string[],
  periodoCiclo?: { dataInicio: string; dataFim: string; hoje?: Date },
): KpiCalculadoResultado[] {
  if (!dadosNormCiclo.length) return kpis;
  const dados = dadosNormCiclo as Record<string, any>[];

  return kpis.map((kpi) => {
    const chaves = [
      chaveMesclagemKpi(kpi),
      kpi.id,
      kpi.origemUniversal ? `uni:${kpi.origemUniversal}` : '',
      `nome:${normalizarTexto(kpi.nome || '')}`,
    ].filter(Boolean);

    let def: any = null;
    for (const c of chaves) {
      if (defsPorChave.has(c)) {
        def = defsPorChave.get(c);
        break;
      }
    }
    if (!def && ehKpiFaturamentoEstimadoCiclo({ nome: kpi.nome, label: kpi.nome })) {
      def = { expressao: 'FATURAMENTO_EST(PESO TOTAL, TIPO CAMINHAO)', formato: kpi.formato || 'moeda' };
    }
    if (!def || !ehKpiFaturamentoEstimadoCiclo(def)) return kpi;

    const expressao = prepararExpressaoKpiCalculo(
      def,
      def.expressao || def.formula || 'FATURAMENTO_EST(PESO TOTAL, TIPO CAMINHAO)',
      colunasServico,
    );

    const kpiValoresFixos = { ...valoresFixos };
    if (def.valoresFixos && typeof def.valoresFixos === 'object') {
      for (const [key, v] of Object.entries(def.valoresFixos)) {
        if (v !== null && v !== undefined && Number(v) > 0) {
          kpiValoresFixos[key] = Number(v);
        }
      }
    }

    try {
      const resultado = calcularExpressao(expressao, { dados, valoresFixos: kpiValoresFixos });
      const realizado = Math.round(resultado.valor * 100) / 100;
      const formatoMoeda = kpi.formato || def.formato || 'moeda';

      if (periodoCiclo?.dataInicio && periodoCiclo?.dataFim) {
        const proj = calcularProjecaoFaturamentoCiclo(
          realizado,
          dados,
          periodoCiclo.dataInicio,
          periodoCiclo.dataFim,
          periodoCiclo.hoje,
        );

        const mostrarProjecao =
          proj.cicloEmAndamento
          && proj.diasDecorridos > 0
          && proj.diasDecorridos < proj.diasTotaisCiclo
          && proj.projetado > realizado;

        if (mostrarProjecao) {
          const fmt = (v: number) => formatarValorKpi(v, formatoMoeda);
          return {
            ...kpi,
            nome: 'Faturamento Estimado',
            valor: proj.projetado,
            formatado: fmt(proj.projetado),
            detalhe: `Projeção ciclo • Realizado ${fmt(proj.realizado)} • média ${fmt(proj.mediaDiaria)}/dia • ${proj.diasDecorridos} de ${proj.diasTotaisCiclo} dias decorridos`,
            faturamentoRealizado: proj.realizado,
            faturamentoProjetado: proj.projetado,
            ehProjecaoCiclo: true,
          };
        }
      }

      return {
        ...kpi,
        valor: realizado,
        formatado: formatarValorKpi(realizado, formatoMoeda),
        faturamentoRealizado: realizado,
        faturamentoProjetado: realizado,
        ehProjecaoCiclo: false,
      };
    } catch {
      return kpi;
    }
  });
}

export function calcularKpisAtivos(
  dadosNorm: Record<string, unknown>[],
  valoresFixos: Record<string, number>,
  todosKpis: any[],
  viagens: number,
  colunasServico: string[],
): KpiCalculadoResultado[] {
  const cacheValoresFormula = new Map<string, number>();

  return todosKpis.map((kpi: any) => {
    try {
      let expressao = resolverExpressaoKpiViagensRealizadas(kpi, kpi.expressao || kpi.formula || '');
      expressao = resolverExpressaoKpiContadorViagens(kpi, expressao);
      expressao = resolverExpressaoKpiMotoristas(kpi, expressao);
      expressao = resolverExpressaoKpiColetoresEquipe(kpi, expressao);
      expressao = resolverExpressaoKpiPesoColetor(kpi, expressao);
      const expressaoResolvida = resolvePlaceholdersNaFormula(expressao, { colunasServico });
      if (expressaoResolvida !== expressao) expressao = expressaoResolvida;

      let valor: number;

      if (expressao.trim() && dadosNorm.length > 0) {
        const kpiValoresFixos = { ...valoresFixos };
        if (kpi.valoresFixos && typeof kpi.valoresFixos === 'object') {
          for (const [key, v] of Object.entries(kpi.valoresFixos)) {
            if (v !== null && v !== undefined && Number(v) > 0) {
              kpiValoresFixos[key] = Number(v);
            }
          }
        }
        const cacheKey = `${expressao}::${JSON.stringify(kpiValoresFixos)}`;
        if (cacheValoresFormula.has(cacheKey)) {
          valor = cacheValoresFormula.get(cacheKey)!;
        } else {
          const resultado = calcularExpressao(expressao, { dados: dadosNorm, valoresFixos: kpiValoresFixos });
          valor = Math.round(resultado.valor * 100) / 100;
          cacheValoresFormula.set(cacheKey, valor);
        }
      } else if (kpi.agregacao === 'count' && dadosNorm.length > 0) {
        const colNome = kpi.coluna2 || kpi.nome;
        if (!colNome) {
          valor = viagens;
        } else {
          const unicos = new Set(
            dadosNorm
              .map((d: any) => encontrarValorColuna(d, colNome))
              .filter((v: any) => v !== null && v !== undefined && v !== '')
              .map((v: any) => String(v).trim()),
          );
          valor = unicos.size;
        }
      } else if (!expressao.trim() && dadosNorm.length > 0) {
        const colNome = kpi.coluna2 || kpi.nome;
        if (!colNome) {
          valor = 0;
        } else {
          const vals = dadosNorm
            .map((d: any) => Number(encontrarValorColuna(d, colNome)))
            .filter((n: any) => !isNaN(n));
          if (vals.length === 0) {
            valor = 0;
          } else {
            switch (kpi.agregacao) {
              case 'sum': valor = vals.reduce((a: number, b: number) => a + b, 0); break;
              case 'avg': valor = vals.reduce((a: number, b: number) => a + b, 0) / vals.length; break;
              case 'min': valor = Math.min(...vals); break;
              case 'max': valor = Math.max(...vals); break;
              default: valor = vals.reduce((a: number, b: number) => a + b, 0);
            }
          }
        }
      } else {
        valor = 0;
      }

      return {
        id: kpi.id || kpi.origemUniversal || kpi.nome,
        nome: kpi.label || kpi.nome,
        valor: valor !== null ? Math.round(valor * 100) / 100 : null,
        formatado: valor !== null ? formatarValorKpi(valor, kpi.formato || 'numero') : '-',
        formato: kpi.formato || 'numero',
        origem: kpi._origem,
        origemUniversal: kpi.origemUniversal,
      };
    } catch (err: any) {
      return {
        id: kpi.id || kpi.origemUniversal || kpi.nome,
        nome: kpi.label || kpi.nome,
        valor: null,
        formatado: '-',
        formato: kpi.formato || 'numero',
        origem: kpi._origem,
        origemUniversal: kpi.origemUniversal,
        erro: err.message,
      };
    }
  });
}

/** KPIs de contagem distinta — somar entre serviços infla o número; usa o maior valor parcial. */
function deveUsarMaximoNaMesclagem(kpi: KpiCalculadoResultado): boolean {
  const texto = `${kpi.nome || ''}`.toUpperCase();
  if (texto.includes('MOTORISTAS') && !texto.includes('VIAGEM') && !texto.includes('PRODUTIV')) return true;
  if (texto.includes('DISTRITOS')) return true;
  if (texto.includes('PLACA') || texto.includes('VEÍCULOS') || texto.includes('VEICULOS')) return true;
  if (texto.includes('COLETORES ATIVOS')) return true;
  if (texto.includes('COLETOR') && (texto.includes('/') || texto.includes('MÉDIA') || texto.includes('MEDIA'))) return true;
  return false;
}

/** Mescla KPIs de vários serviços pelo id/origem/nome; soma métricas aditivas, max para contagens distintas. */
export function mesclarKpisCalculados(listas: KpiCalculadoResultado[][]): KpiCalculadoResultado[] {
  const mapa = new Map<string, KpiCalculadoResultado>();

  for (const lista of listas) {
    for (const kpi of lista) {
      const chave = chaveMesclagemKpi(kpi);
      const existente = mapa.get(chave);
      if (!existente) {
        mapa.set(chave, { ...kpi, id: chave });
        continue;
      }
      if (kpi.valor === null) continue;
      if (existente.valor === null) {
        existente.valor = kpi.valor;
        existente.formatado = kpi.formatado;
        continue;
      }
      const usarMax = deveUsarMaximoNaMesclagem(kpi);
      const combinado = usarMax
        ? Math.max(existente.valor, kpi.valor)
        : Math.round((existente.valor + kpi.valor) * 100) / 100;
      existente.valor = combinado;
      existente.formatado = formatarValorKpi(combinado, existente.formato);
    }
  }

  return Array.from(mapa.values());
}
