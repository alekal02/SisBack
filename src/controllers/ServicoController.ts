import { Request, Response } from 'express';
import { In } from 'typeorm';
import AppDataSource from '../database/data-source';
import { Servico } from '../entities/Servico';
import { Contract } from '../entities/Contract';
import { PlanilhaUpload } from '../entities/PlanilhaUpload';
import { KpiUniversal } from '../entities/KpiUniversal';
import PlanilhaService from '../services/PlanilhaService';
import { TipoServico, TIPOS_SERVICO_VALORES, TIPOS_SERVICO_META } from '../enums/TipoServico';
import {
  calcularKpiComFormula,
  calcularExpressao,
  validarExpressao,
  normalizarDados,
  encontrarValorColuna,
  MODELO_EXECUTIVO_KPIS,
} from '../services/FormulaEngine';
import AutoIndicatorService, { AnaliseAutoIndicadores, ColunaInfo } from '../services/AutoIndicatorService';
import TipoServicoTemplateService from '../services/TipoServicoTemplateService';
import {
  buildConfigDashboardPadraoColeta,
  RANKINGS_OPERACIONAIS_PADRAO_COLETA,
} from '../config/dashboardPadraoColeta';
import { gerarConfigGraficosPadrao, reResolverGraficos } from '../services/graficosPadrao';
import { buildValoresFixosFaturamento, syncContractTarifasFromConfig } from '../services/configFaturamentoValores';
import { garantirServicosPadraoContrato } from '../services/servicosPadraoContratoService';
import {
  resolverValorUnitarioPorTipo,
  resolverLimitesDoContrato,
  extrairOverridesLimites,
} from '../config/pesoMaximoCaminhao';
import { calcularHorasProdutivasTotal } from '../services/horasProdutivasService';
import { isNomeColunaInvalido, detectarPadraoDeObjetos } from '../services/PadraoPlanilhaDetector';
import { ColetaData } from '../entities/ColetaData';
import { WhatsappGrupoMapa } from '../entities/WhatsappGrupoMapa';
import { removerRoteamentoPorServico } from '../services/whatsappRoteamentoService';
import ValidacaoViagemService from '../services/validacaoViagemService';
import { verificarContagemViagens } from '../services/verificarContagemViagensService';
import {
  apagarDatasDeUploadsAbertos,
  cicloEstaFechado,
  fecharCicloServico,
  listarCiclosFechados,
  montarAvisoDatasCicloFechado,
  reabrirCicloServico,
  verificarDatasEmCicloFechado,
} from '../services/cicloPlanilhaService';
import {
  gerarRelatorioSobrecargaPeso,
  extrairLimitesDeConfig,
} from '../services/relatorioSobrecargaPesoService';
import type { LimitesPesoKg } from '../config/pesoMaximoCaminhao';
import { contarViagensValidadas, sumarizarViagensPorRota, contarViagensPorRotaRegistro } from '../services/viagensPorRotaService';
import { agregarRankingColetores, calcularMediaTonPorColetorViagem } from '../services/coletoresUnicosService';
import {
  detectarColunaRankingRotas,
  labelColunaRankingRotas,
  separarMelhoresPiores,
} from '../services/rankingOperacionalService';
import { deduplicarKpisLista, chaveComparacaoKpi, listarKpisAtivosParaCalculo } from '../services/kpiDeduplicacaoService';
import { resolvePlaceholdersNaFormula } from '../services/PlaceholderResolver';
import { obterDadosServicoComCache, invalidarCacheDadosServico } from '../services/servicoDadosCache';
import {
  getEndpointCache,
  setEndpointCache,
  invalidateEndpointCachePrefix,
  invalidarCacheDashboardServico as invalidarCacheDashboardServicoImpl,
  fingerprintLimitesContrato,
} from '../services/comparacaoCache';
import {
  ENDPOINTS_PESADOS_CONCURRENCY,
  KPIS_CONSOLIDADO_CONCURRENCY,
  LIMITE_DADOS_MAX,
} from '../config/limitesRecursos';
import {
  ehHubDeContratos,
  emCadaContrato,
  emCadaContratoComServicos,
  escopoCacheTenant,
  unirDias,
} from '../services/tenantFanout';
import { parseDataPlanilha } from '../utils/formatarDataPlanilha';
import { resolverFiltrosPeriodoQuery, type PeriodoCicloContrato } from '../utils/periodoCicloContrato';
import {
  agregarDadosGrafico,
  agregarGraficosEmLote,
  GraficoAgregacaoInput,
} from '../services/graficoAgregacaoService';
import {
  analisarPesoColeta,
  normalizarDensidadeResiduoKgL,
  type AnalisePesoColeta,
} from '../services/analisePesoColetaService';
import { calcularFaturamentoRocadaPorAreas } from '../utils/rocadaTipoExecucao';
import {
  getAgregacaoRocada,
  getMetricasRocadaSql,
  resolverKpiRocadaSql,
} from '../services/rocadaAgregacaoService';
import {
  getMetricasColetaSql,
  resolverKpiColetaSql,
  metricaExecutivaDeColetaSql,
  agregarGraficoColetaSql,
} from '../services/coletaAgregacaoService';
import {
  agregacaoColetaComCache,
  rankingsColetaComCache,
  mapeamentoOperacionalComCache,
  fichaRotasCicloComCache,
} from '../services/coletaEndpointsCache';
import { invalidarCacheSaudeContratos } from './ContractController';

/** KPI "Viagens Realizadas" — viagens em rotas (linhas) validadas, não só contagem de linhas */
function resolverExpressaoKpiViagensRealizadas(
  kpi: { nome?: string; label?: string },
  expressao: string,
): string {
  const label = (kpi.label || kpi.nome || '').trim();
  const nome = (kpi.nome || '').trim();
  const expr = expressao.trim();
  const ehViagensRealizadas =
    label === 'Viagens Realizadas' ||
    nome === 'Viagens' ||
    label.toLowerCase().includes('viagens realizadas');
  if (ehViagensRealizadas && (expr === 'VIAGENS_POR_ROTA()' || expr === 'COUNT(*)')) {
    return 'VIAGENS_VALIDADAS()';
  }
  return expressao;
}

/** KPI "Total de Viagens (Contador)" — VIAGENS_POR_ROTA() em vez de SUM bruto */
function resolverExpressaoKpiContadorViagens(
  kpi: { nome?: string; label?: string },
  expressao: string,
): string {
  const label = (kpi.label || kpi.nome || '').trim();
  const nome = (kpi.nome || '').trim();
  const expr = expressao.trim();
  const ehContador =
    nome === 'Total Viagens Contador' ||
    label === 'Total de Viagens (Contador)' ||
    label.toLowerCase().includes('total de viagens (contador)');
  if (!ehContador) return expressao;
  if (/VIAGENS_POR_ROTA\s*\(\s*\)/i.test(expr)) return expr;
  if (/SUM\s*\(\s*CONTADOR/i.test(expr)) return 'VIAGENS_POR_ROTA()';
  return expressao;
}

/** KPI "Total Coletores na Equipe" — únicos, não soma de Nº DE COLETORES por viagem */
function resolverExpressaoKpiColetoresEquipe(
  kpi: { nome?: string; label?: string },
  expressao: string,
): string {
  const label = (kpi.label || kpi.nome || '').trim();
  const nome = (kpi.nome || '').trim();
  const expr = expressao.trim();

  const ehColetoresEquipe =
    label === 'Total Coletores na Equipe' ||
    nome === 'Total Coletores Equipe' ||
    label.includes('Coletores na Equipe');

  if (!ehColetoresEquipe) {
    if (/SUM\s*\(\s*N[º°]?\s*DE\s*COLETORES\s*\)/i.test(expr)) {
      return 'COLETORES_UNICOS()';
    }
    return expressao;
  }

  if (expr !== 'COLETORES_UNICOS()') {
    return 'COLETORES_UNICOS()';
  }
  return expressao;
}

/**
 * Detecta qual coluna existe nos dados dentre uma lista de candidatos
 */
function detectarColuna(dados: Record<string, any>[], candidatos: string[]): string {
  if (!dados || dados.length === 0) return '';
  const chaves = Object.keys(dados[0]);
  for (const candidato of candidatos) {
    const norm = candidato.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
    for (const chave of chaves) {
      const chaveNorm = chave.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
      if (chaveNorm === norm) return chave;
    }
  }
  // Fallback: tenta encontrar qualquer coluna que contenha algum token dos candidatos
  for (const chave of chaves) {
    const chaveNorm = chave.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
    for (const candidato of candidatos) {
      const norm = candidato.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
      // Match parcial: se o nome da coluna contem o candidato ou vice-versa
      if (chaveNorm.includes(norm) || norm.includes(chaveNorm)) return chave;
    }
  }
  return '';
}

/**
 * Detecta TODAS as colunas que correspondem a um padrão (por substring na normalizada)
 * Ex: detectarColunasPorPadrao(dadosNorm, ['HORA', 'SAIDA', 'ROTA']) -> ['HORA SAÍDA ROTA 01', 'HORA SAÍDA ROTA 02', ...]
 */
function detectarColunasPorPadrao(dados: Record<string, any>[], palavrasChave: string[]): string[] {
  if (!dados || dados.length === 0) return [];
  const chaves = Object.keys(dados[0]);
  const encontradas: string[] = [];
  for (const chave of chaves) {
    if (chave.startsWith('__EMPTY')) continue;
    const chaveNorm = chave.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
    const temTodas = palavrasChave.every(p => {
      const pNorm = p.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
      return chaveNorm.includes(pNorm);
    });
    if (temTodas) encontradas.push(chave);
  }
  return encontradas;
}

/**
 * Extrai nomes de colunas de uma expressão de fórmula
 */
function extrairNomesColunas(expressao: string): string[] {
  const nomes: string[] = [];
  // Extrair de funções agregadas: SUM(col), AVG(col), etc.
  const funcRegex = /(?:SUM|AVG|MIN|MAX|COUNT(?:\s+DISTINCT)?)\s*\(\s*([^)]+?)\s*(?:SE\s+.+)?\)/gi;
  let match;
  while ((match = funcRegex.exec(expressao)) !== null) {
    const col = match[1].trim();
    if (col !== '*') nomes.push(col);
  }
  // Extrair de FATURAMENTO_EST(col1, col2)
  const fatRegex = /FATURAMENTO_EST\s*\(\s*([^,]+)\s*,\s*([^)]+)\s*\)/gi;
  while ((match = fatRegex.exec(expressao)) !== null) {
    nomes.push(match[1].trim());
    nomes.push(match[2].trim());
  }
  // Extrair de DIVIDE(expr, expr) e MULTIPLY(expr, expr)
  const divMultRegex = /(?:DIVIDE|MULTIPLY)\s*\(\s*([^,]+)\s*,\s*([^)]+)\s*\)/gi;
  while ((match = divMultRegex.exec(expressao)) !== null) {
    const innerNomes = extrairNomesColunas(match[1]);
    innerNomes.forEach(n => { if (!nomes.includes(n)) nomes.push(n); });
    const innerNomes2 = extrairNomesColunas(match[2]);
    innerNomes2.forEach(n => { if (!nomes.includes(n)) nomes.push(n); });
  }
  // Também capturar tokens que parecem nomes de colunas (palavras maiúsculas)
  const tokenRegex = /\b([A-Z][A-Z\s]+[A-Z])\b/g;
  while ((match = tokenRegex.exec(expressao)) !== null) {
    const nome = match[1].trim();
    if (nome.length > 2 && !['SUM', 'AVG', 'MIN', 'MAX', 'COUNT', 'DISTINCT', 'IF', 'ABS', 'ROUND', 'DIVIDE', 'MULTIPLY', 'FATURAMENTO_EST', 'SE', 'TRUE', 'FALSE'].includes(nome) && !/^\d+(\.\d+)?$/.test(nome) && !nomes.includes(nome)) {
      nomes.push(nome);
    }
  }
  return [...new Set(nomes)];
}

/**
 * ⭐ Substitui TODAS as colunas de uma fórmula pelos nomes reais detectados na planilha
 */
function substituirColunasNaFormula(formula: string, colunasNomes: string[]): string {
  const colunasFormula = extrairNomesColunas(formula);
  let resultado = formula;
  for (const col of colunasFormula) {
    const colReal = detectarColunaPeloNome(colunasNomes, [col]);
    if (colReal && colReal !== col) {
      const escaped = col.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      resultado = resultado.replace(new RegExp('\\b' + escaped + '\\b', 'g'), colReal);
    }
  }
  return resultado;
}

/**
 * ⭐ Detecta coluna por nome em uma lista de nomes disponíveis
 */
function detectarColunaPeloNome(colunasNomes: string[], candidatos: string[]): string {
  for (const candidato of candidatos) {
    const norm = candidato.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
    for (const cn of colunasNomes) {
      const cnn = cn.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
      if (cnn === norm) return cn;
    }
  }
  for (const candidato of candidatos) {
    const norm = candidato.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
    for (const cn of colunasNomes) {
      const cnn = cn.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
      if (cnn.includes(norm) || norm.includes(cnn)) return cn;
    }
  }
  return '';
}

/**
 * Formata um valor numerico conforme o formato
 */
function normalizarNomeKpi(nome: string): string {
  return (nome || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function formatarValor(valor: number, formato: string): string {
  if (formato === 'moeda') {
    return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
  if (formato === 'porcentagem') {
    return valor.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + '%';
  }
  return valor.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

// ═══════════════════════════════════════════════════════════════
// ⚡ CACHE EM MEMÓRIA (comparacaoCache) — evita recálculos
// ═══════════════════════════════════════════════════════════════
const getCache = getEndpointCache;
const setCache = setEndpointCache;
const invalidateCache = invalidateEndpointCachePrefix;

/** Limpa caches de KPIs e gráficos após upload ou alteração de dados */
export function invalidarCacheDashboardServico(servicoId: string): void {
  invalidarCacheDashboardServicoImpl(servicoId);
}

/** Executa promises em paralelo com limite de concorrência */
async function mapComLimite<T, R>(
  items: T[],
  limite: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limite, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// ═══════════════════════════════════════════════════════════════
// Cache de colunas detectadas (evita detectarColuna N vezes)
// ═══════════════════════════════════════════════════════════════
const colunasDetectadasCache = new Map<string, Record<string, string>>();

function detectarTodasColunas(dados: Record<string, any>[], servicoId: string): Record<string, string> {
  if (!dados || dados.length === 0) return {};
  
  const cacheKey = `${servicoId}:${dados.length}`;
  const cached = colunasDetectadasCache.get(cacheKey);
  if (cached) return cached;
  
  const resultado: Record<string, string> = {};
  const categorias: Record<string, string[]> = {
    colPeso: ['PESO TOTAL', 'PESO', 'PESOTOTAL', 'PESO_TOTAL', 'pesoTotal'],
    colKm: ['KM TOTAL', 'KM', 'KMTOTAL', 'KM_TOTAL', 'kmTotal', 'QUILOMETRO', 'DISTANCIA'],
    colPlaca: ['PLACA', 'CAMINHAO', 'VEICULO', 'COLETOR', 'COLETORA', 'EQUIPAMENTO', 'placa'],
    colTipo: ['TIPO DE CAMINHÃO', 'TIPO DE CAMINHAO', 'TIPO CAMINHAO', 'TIPO_CAMINHAO', 'tipoCaminhao', 'TIPODECAMINHAO', 'CAMINHAO', 'CAMINHÃO'],
    colHora: ['HORA SAIDA', 'HORA', 'HORASAIDA', 'HORA_SAIDA', 'horaSaida', 'HR SAIDA BASE', 'HR_SAIDA_BASE', 'HRSAIDABASE', 'SAIDA BASE', 'HORA SÁIDA BASE', 'HORASAIDABASE', 'HORA SAIDA BASE'],
    colHoraChegada: ['HORA CHEGADA', 'HORACHEGADA', 'HORA_CHEGADA', 'horaChegada', 'HR CHEGA BASE', 'HR_CHEGA_BASE', 'HRCHEGABASE', 'CHEGADA BASE', 'HR CHEGADA BASE', 'HORA CHEGADA BASE', 'HORACHEGADABASE'],
    colNroColetores: ['Nº DE COLETORES', 'NDECOLETORES', 'NUMERO DE COLETORES', 'NÚMERO DE COLETORES', 'QTDE COLETORES', 'NRO COLETORES', 'QTD COLETORES'],
    colData: ['DATA SAIDA', 'DATA', 'DATA_SAIDA', 'DIA', 'dataSaida'],
    colMotorista: ['MOTORISTA', 'NOME MOTORISTA', 'NOME_MOTORISTA', 'NOME', 'OPERADOR', 'FUNCIONARIO'],
  };
  
  for (const [categoria, candidatos] of Object.entries(categorias)) {
    resultado[categoria] = detectarColuna(dados, candidatos);
  }
  
  colunasDetectadasCache.set(cacheKey, resultado);
  return resultado;
}

function normalizarChaveColuna(chave: string): string {
  return chave.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
}

function valorCorrespondeFiltro(valorDado: any, valorFiltro: string): boolean {
  if (!valorFiltro?.trim()) return true;
  const dadoNorm = String(valorDado ?? '').toUpperCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const valores = valorFiltro.split(',')
    .map(v => v.toUpperCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
    .filter(Boolean);
  if (valores.length === 0) return true;
  return valores.some(v => dadoNorm === v || dadoNorm.includes(v));
}

interface MetricaExecutivaCalc {
  viagens: number;
  qtdColetores: number;
  pesoTotalTon: number;
  kmTotal: number;
  horasProdutivas: number;
  faturamento: number;
  fatPorTipo: Record<string, number>;
  tonKm: number;
  prodColetor: number;
  kmMedioViagem: number;
  tonMediaColeta: number;
  receitaKm: number;
  receitaHora: number;
  temValor: boolean;
  colunasDetectadas: Record<string, string>;
}

function calcularMetricaExecutivaDeDados(
  dadosNorm: Record<string, any>[],
  valoresFixos: Record<string, number>,
  servicoId: string,
  cfgFat?: { ativo?: boolean; colunaQuantidade?: string; colunaTipoCaminhao?: string } | null,
): MetricaExecutivaCalc {
  const colunasDetectadas = detectarTodasColunas(dadosNorm, servicoId);
  const colPeso = (cfgFat?.ativo && cfgFat?.colunaQuantidade)
    ? cfgFat.colunaQuantidade
    : colunasDetectadas.colPeso;
  const colKm = colunasDetectadas.colKm;
  const colPlaca = colunasDetectadas.colPlaca;
  const colTipo = (cfgFat?.ativo && cfgFat?.colunaTipoCaminhao)
    ? cfgFat.colunaTipoCaminhao
    : colunasDetectadas.colTipo;
  const colNroColetores = colunasDetectadas.colNroColetores;
  const temValor = Object.keys(valoresFixos).length > 0;
  const FALLBACK_VALOR_TONELADA = 80;

  const viagens = contarViagensValidadas(dadosNorm);

  const coletoresSet = new Set<string>();
  for (const d of dadosNorm) {
    const v = encontrarValorColuna(d, colPlaca);
    if (v !== undefined && v !== null && v !== '') coletoresSet.add(String(v).trim());
  }
  const qtdColetores = coletoresSet.size;

  let kmTotal = 0;
  let pesoTotalKg = 0;
  for (const d of dadosNorm) {
    kmTotal += Number(encontrarValorColuna(d, colKm)) || 0;
    pesoTotalKg += Number(encontrarValorColuna(d, colPeso)) || 0;
  }
  const pesoTotalTon = pesoTotalKg / 1000;
  const horasProdutivas = calcularHorasProdutivasTotal(dadosNorm);

  let faturamento = 0;
  const fatPorTipo: Record<string, number> = {};
  if (temValor && colPeso) {
    for (const d of dadosNorm) {
      const tipoRaw = colTipo ? String(encontrarValorColuna(d, colTipo) || '').toUpperCase().trim() : '';
      if (/^\d+$/.test(tipoRaw)) continue;
      const peso = Number(encontrarValorColuna(d, colPeso)) || 0;
      if (peso <= 0) continue;
      const toneladas = peso / 1000;
      const valorUnitario = temValor
        ? (resolverValorUnitarioPorTipo(tipoRaw, valoresFixos, FALLBACK_VALOR_TONELADA) || FALLBACK_VALOR_TONELADA)
        : FALLBACK_VALOR_TONELADA;
      const receita = toneladas * valorUnitario;
      faturamento += receita;
      if (tipoRaw.length > 0) fatPorTipo[tipoRaw] = (fatPorTipo[tipoRaw] || 0) + receita;
    }
    if (faturamento === 0) {
      faturamento = pesoTotalKg / 1000 * (valoresFixos.VALOR_TONELADA || FALLBACK_VALOR_TONELADA);
    }
  } else if (colPeso) {
    faturamento = pesoTotalKg / 1000 * FALLBACK_VALOR_TONELADA;
  }

  const tonKm = kmTotal > 0 ? Math.round((pesoTotalTon / kmTotal) * 10000) / 10000 : 0;
  const prodColetor = calcularMediaTonPorColetorViagem(dadosNorm);
  const kmMedioViagem = viagens > 0 ? Math.round((kmTotal / viagens) * 100) / 100 : 0;
  const tonMediaColeta = viagens > 0 ? Math.round((pesoTotalTon / viagens) * 100) / 100 : 0;
  const receitaKm = kmTotal > 0 ? Math.round((faturamento / kmTotal) * 100) / 100 : 0;
  const receitaHora = horasProdutivas > 0
    ? Math.round((faturamento / horasProdutivas) * 100) / 100
    : 0;

  return {
    viagens,
    qtdColetores,
    pesoTotalTon: Math.round(pesoTotalTon * 100) / 100,
    kmTotal: Math.round(kmTotal * 100) / 100,
    horasProdutivas: Math.round(horasProdutivas * 100) / 100,
    faturamento: Math.round(faturamento * 100) / 100,
    fatPorTipo,
    tonKm,
    prodColetor,
    kmMedioViagem,
    tonMediaColeta,
    receitaKm,
    receitaHora,
    temValor,
    colunasDetectadas,
  };
}

export class ServicoController {
  private get repository() {
    return AppDataSource.getRepository(Servico);
  }

  private get contractRepo() {
    return AppDataSource.getRepository(Contract);
  }

  private get uploadRepo() {
    return AppDataSource.getRepository(PlanilhaUpload);
  }

  /**
   * GET /api/contracts/:contractId/servicos
   * Lista todos os serviços de um contrato
   */
  async listar(req: Request, res: Response): Promise<any> {
    try {
      const contractId = req.params.contractId as string;

      const servicos = await this.repository.find({
        where: { contract_id: contractId },
        order: { criadoEm: 'DESC' },
      });

      return res.json({ servicos, total: servicos.length });
    } catch (error) {
      console.error('Erro ao listar serviços:', error);
      return res.status(500).json({ error: 'Erro ao carregar serviços' });
    }
  }

  /**
   * GET /api/contracts/:contractId/servicos/:id
   * Busca um serviço específico
   */
  async buscarUm(req: Request, res: Response): Promise<any> {
    try {
      const id = req.params.id as string;
      const servico = await this.repository.findOne({ where: { id } });

      if (!servico) {
        return res.status(404).json({ error: 'Serviço não encontrado' });
      }

      return res.json(servico);
    } catch (error) {
      console.error('Erro ao buscar serviço:', error);
      return res.status(500).json({ error: 'Erro ao carregar serviço' });
    }
  }

  /**
   * POST /api/contracts/:contractId/servicos/garantir-padrao
   * Garante Roçada, Capina, Varrição e Poda no contrato (idempotente).
   */
  async garantirPadrao(req: Request, res: Response): Promise<any> {
    try {
      const contractId = req.params.contractId as string;
      const resultado = await garantirServicosPadraoContrato(contractId);
      return res.json({
        sucesso: true,
        criados: resultado.criados,
        jaExistiam: resultado.jaExistiam,
        servicos: resultado.servicos,
        mensagem: resultado.criados.length
          ? `${resultado.criados.length} serviço(s) padrão criado(s).`
          : 'Serviços padrão já estavam cadastrados.',
      });
    } catch (error: any) {
      const msg = error?.message || 'Erro ao garantir serviços padrão';
      const status = msg.includes('não encontrado') ? 404 : 500;
      console.error('Erro ao garantir serviços padrão:', error);
      return res.status(status).json({ error: msg });
    }
  }

  /**
   * POST /api/contracts/:contractId/servicos
   * Cria um novo serviço
   */
  async criar(req: Request, res: Response): Promise<any> {
    try {
      const contractId = req.params.contractId as string;
      const { nome, descricao, tipo, configDashboard, padraoPlanilha, configFaturamento } = req.body;

      // Verifica se o contrato existe
      const contract = await this.contractRepo.findOne({ where: { id: contractId } });
      if (!contract) {
        return res.status(404).json({ error: 'Contrato não encontrado' });
      }

      if (!nome || !nome.trim()) {
        return res.status(400).json({ error: 'Nome do serviço é obrigatório' });
      }

      // Valida tipo
      if (tipo && !TIPOS_SERVICO_VALORES.includes(tipo)) {
        return res.status(400).json({ error: `Tipo inválido. Valores aceitos: ${TIPOS_SERVICO_VALORES.join(', ')}` });
      }

      const servico = new Servico();
      servico.contract_id = contractId;
      servico.nome = nome.trim();
      servico.tipo = tipo || TipoServico.COLETA_CAMINHAO;
      servico.descricao = descricao || null;
      servico.configDashboard = configDashboard || null;
      servico.configFaturamento = configFaturamento || null;

      const tipoFinal = servico.tipo || TipoServico.COLETA_CAMINHAO;
      const kpisTemplate = TipoServicoTemplateService.converterKpisParaConfig(tipoFinal);
      const colunasNomesGraf: string[] = servico.padraoPlanilha?.colunas
        ? servico.padraoPlanilha.colunas.map((c: any) => c.nome)
        : [];
      const graficosPadrao = gerarConfigGraficosPadrao(tipoFinal, colunasNomesGraf);

      if (!servico.configDashboard) {
        // Coleta: dashboard completo do serviço modelo (KPIs + gráficos validados)
        if (tipoFinal === TipoServico.COLETA_CAMINHAO) {
          servico.configDashboard = buildConfigDashboardPadraoColeta();
        } else {
          servico.configDashboard = {
            kpis: kpisTemplate,
            graficos: graficosPadrao,
            kpisTemplateAplicados: kpisTemplate.length > 0,
            kpisTemplateTotal: kpisTemplate.length,
            kpisTemplateTipo: tipoFinal,
            kpisTemplateAplicadosEm: new Date().toISOString(),
            graficosPadraoAplicados: true,
            graficosPadraoTotal: graficosPadrao.length,
            graficosPadraoTipo: tipoFinal,
            graficosPadraoAplicadosEm: new Date().toISOString(),
          };
        }
      } else {
        // Adicionar KPIs do template (sem duplicar)
        const kpisExistentes: any[] = servico.configDashboard.kpis || [];
        const labelsExistentes = new Set(
          kpisExistentes.map((k: any) => k.label?.toLowerCase().trim())
        );
        const kpisNovosDoTemplate = kpisTemplate.filter(
          (k: any) => !labelsExistentes.has(k.label?.toLowerCase().trim())
        );
        if (kpisNovosDoTemplate.length > 0) {
          servico.configDashboard.kpis = deduplicarKpisLista(
            [...kpisExistentes, ...kpisNovosDoTemplate],
            { manterInativos: true },
          ).kpis;
          servico.configDashboard.kpisTemplateAplicados = true;
          servico.configDashboard.kpisTemplateTotal = kpisTemplate.length;
          servico.configDashboard.kpisTemplateTipo = tipoFinal;
          servico.configDashboard.kpisTemplateAplicadosEm = new Date().toISOString();
        }
        // Adicionar gráficos padrão
        const graficosExistentes = servico.configDashboard.graficos || [];
        const titulosExistentes = new Set(
          graficosExistentes.map((g: any) => g.titulo?.toLowerCase().trim())
        );
        const graficosNovos = graficosPadrao.filter(
          (g: any) => !titulosExistentes.has(g.titulo?.toLowerCase().trim())
        );
        servico.configDashboard.graficos = [...graficosExistentes, ...graficosNovos];
        servico.configDashboard.graficosPadraoAplicados = true;
        servico.configDashboard.graficosPadraoTotal = graficosPadrao.length;
        servico.configDashboard.graficosPadraoTipo = tipoFinal;
        servico.configDashboard.graficosPadraoAplicadosEm = new Date().toISOString();
      }

      if (tipoFinal === TipoServico.COLETA_CAMINHAO) {
        servico.configDashboard = {
          ...(servico.configDashboard || {}),
          rankingsOperacionais: servico.configDashboard?.rankingsOperacionais ?? {
            ...RANKINGS_OPERACIONAIS_PADRAO_COLETA,
          },
        };
      }

      servico.padraoPlanilha = padraoPlanilha || null;

      if (syncContractTarifasFromConfig(contract, configFaturamento)) {
        await this.contractRepo.save(contract);
      }

      const novoServico = await this.repository.save(servico);
      invalidarCacheSaudeContratos(contractId);
      return res.status(201).json(novoServico);
    } catch (error: any) {
      console.error('Erro ao criar serviço:', error);
      const detalhe = error?.message || String(error);
      return res.status(500).json({
        error: 'Erro ao criar serviço',
        detalhe: process.env.NODE_ENV === 'production' ? undefined : detalhe,
      });
    }
  }

  /**
   * PUT /api/contracts/:contractId/servicos/:id
   * Atualiza um serviço
   */
  async atualizar(req: Request, res: Response): Promise<any> {
    try {
      const id = req.params.id as string;
      const { nome, descricao, tipo, configDashboard, padraoPlanilha } = req.body;

      const servico = await this.repository.findOne({ where: { id } });
      if (!servico) {
        return res.status(404).json({ error: 'Serviço não encontrado' });
      }

      // Valida tipo se informado
      if (tipo !== undefined) {
        if (!TIPOS_SERVICO_VALORES.includes(tipo)) {
          return res.status(400).json({ error: `Tipo inválido. Valores aceitos: ${TIPOS_SERVICO_VALORES.join(', ')}` });
        }
        servico.tipo = tipo;
      }

      if (nome !== undefined) servico.nome = nome.trim();
      if (descricao !== undefined) servico.descricao = descricao;
      if (configDashboard !== undefined) servico.configDashboard = configDashboard;
      if (padraoPlanilha !== undefined) servico.padraoPlanilha = padraoPlanilha;

      await this.repository.save(servico);
      return res.json(servico);
    } catch (error) {
      console.error('Erro ao atualizar serviço:', error);
      return res.status(500).json({ error: 'Erro ao atualizar serviço' });
    }
  }

  /**
   * GET /api/contracts/:contractId/servicos/:id/padrao
   * Retorna o padrão da planilha + estatísticas do último upload vinculado
   */
  async getPadrao(req: Request, res: Response): Promise<any> {
    try {
      const id = req.params.id as string;
      const contractId = req.params.contractId as string;
      const servico = await this.repository.findOne({ where: { id } });

      if (!servico) {
        return res.status(404).json({ error: 'Serviço não encontrado' });
      }

      const resumoHub = String(req.query.resumo || '') === '1';

      if (resumoHub) {
        const [uploads, totalUploads, statsUploads] = await Promise.all([
          this.uploadRepo.find({
            where: { servico_id: id },
            order: { criadoEm: 'DESC' },
            take: 8,
          }),
          this.uploadRepo.count({ where: { servico_id: id } }),
          this.uploadRepo.createQueryBuilder('u')
            .select('COALESCE(SUM(u.totalLinhas), 0)', 'totalLinhas')
            .addSelect('COALESCE(SUM(u.linhasImportadas), 0)', 'totalImportados')
            .where('u.servico_id = :id', { id })
            .getRawOne(),
        ]);
        const totalLinhas = Number(statsUploads?.totalLinhas || 0);
        const totalImportados = Number(statsUploads?.totalImportados || 0);
        const padraoSanitizado = servico.padraoPlanilha
          ? {
              ...servico.padraoPlanilha,
              colunas: (servico.padraoPlanilha.colunas || []).filter(
                (c: { nome?: string }) => !isNomeColunaInvalido(c.nome || ''),
              ),
            }
          : null;
        return res.json({
          servico: {
            id: servico.id,
            nome: servico.nome,
            tipo: servico.tipo || 'coleta_caminhao',
            padraoPlanilha: padraoSanitizado,
            configDashboard: servico.configDashboard,
            configFaturamento: servico.configFaturamento,
          },
          periodoDados: null,
          uploads: {
            total: totalUploads,
            totalLinhas,
            totalImportados,
            registrosValidos: totalImportados,
            registrosTotais: totalLinhas,
            ultimos: uploads.map((u) => ({
              id: u.id,
              nomeArquivo: u.nomeArquivo,
              totalLinhas: u.totalLinhas,
              linhasImportadas: u.linhasImportadas,
              criadoEm: u.criadoEm,
              urlDownload: u.urlDownload || null,
            })),
          },
          tipoServico: servico.tipo || 'coleta_caminhao',
          valoresCaminhao: null,
          kpisUniversaisDisponiveis: [],
          totalKpisUniversais: 0,
          totalKpisAtivados: 0,
        });
      }

      // Coleta sem dashboard configurado: aplica padrão automaticamente
      if (servico.tipo === TipoServico.COLETA_CAMINHAO) {
        const cfgAtual = servico.configDashboard || {};
        const semKpis = !cfgAtual.kpis?.length;
        const semGraficos = !cfgAtual.graficos?.length;
        if (semKpis || semGraficos) {
          const padrao = buildConfigDashboardPadraoColeta();
          servico.configDashboard = {
            ...cfgAtual,
            kpis: semKpis ? padrao.kpis : cfgAtual.kpis,
            graficos: semGraficos ? padrao.graficos : cfgAtual.graficos,
            rankingsOperacionais: cfgAtual.rankingsOperacionais ?? padrao.rankingsOperacionais,
            dashboardPadraoVersao: padrao.dashboardPadraoVersao,
          };
          await this.repository.save(servico);
        }
      }

      // Buscar contrato para obter valores dos caminhões
      const contract = await this.contractRepo.findOne({ where: { id: contractId } });

      // Buscar uploads vinculados a este serviço
      const [uploads, totalUploads, statsUploads] = await Promise.all([
        this.uploadRepo.find({
          where: { servico_id: id },
          order: { criadoEm: 'DESC' },
          take: 20,
        }),
        this.uploadRepo.count({ where: { servico_id: id } }),
        this.uploadRepo.createQueryBuilder('u')
          .select('COALESCE(SUM(u.totalLinhas), 0)', 'totalLinhas')
          .addSelect('COALESCE(SUM(u.linhasImportadas), 0)', 'totalImportados')
          .where('u.servico_id = :id', { id })
          .getRawOne(),
      ]);

      const totalLinhas = Number(statsUploads?.totalLinhas || 0);
      const totalImportados = Number(statsUploads?.totalImportados || 0);
      const [contagemRegistros, periodoDados] = await Promise.all([
        PlanilhaService.getContagemRegistrosPorServico(id),
        PlanilhaService.getPeriodoDadosPorServico(id),
      ]);

      // Import via WhatsApp (ou falha no detector) pode deixar padraoPlanilha null
      // mesmo com dados válidos — reconstrói a partir de coleta_dados.dados.
      if (!(servico.padraoPlanilha?.colunas?.length) && contagemRegistros.total > 0) {
        try {
          const amostra = await AppDataSource.getRepository(ColetaData)
            .createQueryBuilder('c')
            .innerJoin(PlanilhaUpload, 'u', 'u.id = c.planilhaUploadId')
            .select(['c.id', 'c.dados'])
            .where('u.servico_id = :id', { id })
            .andWhere('c.dados IS NOT NULL')
            .orderBy('c.id', 'DESC')
            .take(200)
            .getMany();

          const colunasInferidas = detectarPadraoDeObjetos(
            amostra.map((r) => r.dados || {}).filter((d) => d && Object.keys(d).length > 0),
          );

          if (colunasInferidas.length > 0) {
            const ultimoUpload = uploads[0];
            const colunasNomes = colunasInferidas.map((c) => c.nome);
            const graficosAtuais = servico.configDashboard?.graficos || [];
            const graficosReResolvidos = graficosAtuais.length > 0
              ? reResolverGraficos(graficosAtuais, colunasNomes)
              : gerarConfigGraficosPadrao(servico.tipo || 'coleta_caminhao', colunasNomes);

            servico.padraoPlanilha = {
              colunas: colunasInferidas,
              totalLinhas: contagemRegistros.total,
              ultimoUpload: ultimoUpload?.id,
              ultimoUploadNome: ultimoUpload?.nomeArquivo,
              detectadoEm: new Date().toISOString(),
              origem: 'inferido_coleta_dados',
            };

            const cfgAtual = servico.configDashboard || {};
            servico.configDashboard = {
              ...cfgAtual,
              graficos: graficosReResolvidos,
              reResolvidoEm: new Date().toISOString(),
              reResolvido: true,
              graficosPadraoAplicados: true,
              graficosPadraoTotal: graficosReResolvidos.length,
            };

            await this.repository.save(servico);
            console.log(
              `[getPadrao] padraoPlanilha reconstruído para serviço ${id} (${colunasInferidas.length} colunas)`,
            );
          }
        } catch (err: any) {
          console.warn('[getPadrao] Falha ao inferir padraoPlanilha:', err?.message || err);
        }
      }

                  // ⭐ Buscar KPIs Universais do mesmo tipo de servico
      const kpiUniversalRepo = AppDataSource.getRepository(KpiUniversal);
      const kpisUniversais = await kpiUniversalRepo.find({
        where: { tipoServico: servico.tipo || 'coleta_caminhao' },
        order: { categoria: 'ASC', nome: 'ASC' },
      });

      // Marcar quais ja estao ativados no configDashboard
      const kpisAtivados: any[] = servico.configDashboard?.kpis || [];
      const kpisUniversaisDisponiveis = kpisUniversais.map(k => ({
        id: k.id,
        nome: k.nome,
        label: k.label,
        expressao: k.formula,
        formato: k.formato,
        descricao: k.descricao || '',
        categoria: k.categoria,
        cor: k.cor,
        unidade: k.unidade || '',
        criadoEm: k.criadoEm,
        jaAtivado: kpisAtivados.some((ka: any) => ka.origemUniversal === k.id),
      }));

      const padraoSanitizado = servico.padraoPlanilha
        ? {
            ...servico.padraoPlanilha,
            colunas: (servico.padraoPlanilha.colunas || []).filter(
              (c: { nome?: string }) => !isNomeColunaInvalido(c.nome || '')
            ),
          }
        : null;

      return res.json({
        servico: {
          id: servico.id,
          nome: servico.nome,
          tipo: servico.tipo || 'coleta_caminhao',
          padraoPlanilha: padraoSanitizado,
          configDashboard: servico.configDashboard,
          configFaturamento: servico.configFaturamento,
        },
        periodoDados,
        uploads: {
          total: totalUploads,
          totalLinhas,
          totalImportados,
          registrosValidos: contagemRegistros.validos,
          registrosTotais: contagemRegistros.total,
          ultimos: uploads.map(u => ({
            id: u.id,
            nomeArquivo: u.nomeArquivo,
            totalLinhas: u.totalLinhas,
            linhasImportadas: u.linhasImportadas,
            criadoEm: u.criadoEm,
            urlDownload: u.urlDownload || null,
          })),
        },
        tipoServico: servico.tipo || 'coleta_caminhao',
        valoresCaminhao: contract ? {
          VALOR_TONELADA: contract.valorTonelada ? Number(contract.valorTonelada) : null,
          VALOR_MINI: contract.valorMini ? Number(contract.valorMini) : null,
          VALOR_TRUCK: contract.valorTruck ? Number(contract.valorTruck) : null,
          VALOR_TOCO: contract.valorToco ? Number(contract.valorToco) : null,
          VALOR_BASCULANTE: contract.valorBasculante ? Number(contract.valorBasculante) : null,
        } : null,
        // ⭐ KPIs universais disponiveis para o tipo de servico
        kpisUniversaisDisponiveis,
        totalKpisUniversais: kpisUniversais.length,
        totalKpisAtivados: kpisUniversaisDisponiveis.filter((k: any) => k.jaAtivado).length,
      });
} catch (error) {
      console.error('Erro ao buscar padrão:', error);
      return res.status(500).json({ error: 'Erro ao carregar padrão' });
    }
  }

  /**
   * PUT /api/contracts/:contractId/servicos/:id/config-dashboard
   * Salva a configuração de indicadores do dashboard
   */
  async salvarConfigDashboard(req: Request, res: Response): Promise<any> {
    try {
      const id = req.params.id as string;
      const { configDashboard } = req.body;

      const servico = await this.repository.findOne({ where: { id } });
      if (!servico) {
        return res.status(404).json({ error: 'Serviço não encontrado' });
      }

      servico.configDashboard = configDashboard;
      await this.repository.save(servico);

      return res.json({ message: 'Configuração salva com sucesso', configDashboard });
    } catch (error) {
      console.error('Erro ao salvar config dashboard:', error);
      return res.status(500).json({ error: 'Erro ao salvar configuração' });
    }
  }

  /**
   * GET /api/contracts/:contractId/servicos/:id/dados
   * Retorna dados de coleta vinculados ao serviço (paginado)
   */
  async listarDados(req: Request, res: Response): Promise<any> {
    try {
      const id = req.params.id as string;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      const uploadId = req.query.uploadId ? parseInt(req.query.uploadId as string) : undefined;

      const result = await PlanilhaService.listarDadosPorServico(id, page, limit, uploadId);
      return res.json(result);
    } catch (error) {
      console.error('Erro ao listar dados do servico:', error);
      return res.status(500).json({ error: 'Erro ao carregar dados' });
    }
  }

  /**
   * GET /api/contracts/:contractId/servicos/:id/dados-brutos
   * Retorna dados brutos do serviço (cache compartilhado + teto LIMITE_DADOS_MAX).
   */
  async listarDadosBrutos(req: Request, res: Response): Promise<any> {
    try {
      const id = req.params.id as string;
      const limiteSolicitado = parseInt(req.query.limite as string, 10) || 1000;
      const limite = Math.min(Math.max(limiteSolicitado, 1), LIMITE_DADOS_MAX);
      const incluirInconsistentes = req.query.incluirInconsistentes === '1' || req.query.todos === '1';
      const apenasValidos = !incluirInconsistentes;
      const contagem = await PlanilhaService.getContagemRegistrosPorServico(id);
      const totalDisponivel = apenasValidos ? contagem.validos : contagem.total;

      // Cache compartilhado só cobre viagens válidas (mesmo dataset de KPIs/gráficos).
      // Pedidos com inconsistentes seguem consulta direta (uso raro / diagnóstico).
      const dados = apenasValidos
        ? await obterDadosServicoComCache(id, limite)
        : await PlanilhaService.getDadosBrutosPorServico(id, limite, { apenasValidos: false });

      return res.json({
        dados,
        total: dados.length,
        totalDisponivel,
        truncado: dados.length < totalDisponivel,
        limite,
        limiteMaximo: LIMITE_DADOS_MAX,
        apenasValidos,
        cache: apenasValidos,
      });
    } catch (error) {
      console.error('Erro ao carregar dados brutos:', error);
      return res.status(500).json({ error: 'Erro ao carregar dados' });
    }
  }

  /**
   * GET /api/contracts/:contractId/servicos/:id/coleta/agregacao
   * Resumo + rankings de coleta via SQL (escala 600k+ sem materializar linhas).
   */
  async getColetaAgregacao(req: Request, res: Response): Promise<any> {
    try {
      const id = req.params.id as string;
      const contractId = req.params.contractId as string;
      const servico = await this.repository.findOne({ where: { id }, select: ['id', 'tipo', 'configFaturamento'] as any });
      if (!servico) return res.status(404).json({ error: 'Serviço não encontrado' });
      const ehColeta = servico.tipo === TipoServico.COLETA_CAMINHAO || servico.tipo === 'coleta_caminhao';
      if (!ehColeta) {
        return res.status(400).json({ error: 'Agregação disponível apenas para serviços de coleta' });
      }

      const data = typeof req.query.data === 'string' ? req.query.data : undefined;
      const dataInicio = typeof req.query.dataInicio === 'string' ? req.query.dataInicio : undefined;
      const dataFim = typeof req.query.dataFim === 'string' ? req.query.dataFim : undefined;
      const topN = req.query.topN ? parseInt(String(req.query.topN), 10) : undefined;

      const contract = await this.contractRepo.findOne({ where: { id: contractId } });
      const valoresFixos = buildValoresFixosFaturamento(
        contract,
        servico.configFaturamento?.ativo ? servico.configFaturamento : null,
      );
      const response = await agregacaoColetaComCache(id, {
        data,
        dataInicio,
        dataFim,
        topN,
        valoresFixos,
        tipoServico: servico.tipo,
      });
      return res.json(response);
    } catch (error) {
      console.error('Erro na agregação de coleta:', error);
      return res.status(500).json({ error: 'Erro ao agregar dados de coleta' });
    }
  }

  /**
   * GET /api/contracts/:contractId/servicos/:id/mapeamento-operacional
   * Cruzamento rota × motorista × placa com tempo e km no período.
   */
  async getMapeamentoOperacional(req: Request, res: Response): Promise<any> {
    try {
      const id = req.params.id as string;
      const servico = await this.repository.findOne({ where: { id }, select: ['id', 'tipo'] as any });
      if (!servico) return res.status(404).json({ error: 'Serviço não encontrado' });
      const ehColeta = servico.tipo === TipoServico.COLETA_CAMINHAO || servico.tipo === 'coleta_caminhao';
      if (!ehColeta) {
        return res.status(400).json({ error: 'Mapeamento disponível apenas para serviços de coleta' });
      }

      const data = typeof req.query.data === 'string' ? req.query.data : undefined;
      const dataInicio = typeof req.query.dataInicio === 'string' ? req.query.dataInicio : undefined;
      const dataFim = typeof req.query.dataFim === 'string' ? req.query.dataFim : undefined;

      if (data && !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
        return res.status(400).json({ error: 'Data inválida. Use YYYY-MM-DD.' });
      }
      if (dataInicio && !/^\d{4}-\d{2}-\d{2}$/.test(dataInicio)) {
        return res.status(400).json({ error: 'dataInicio inválida. Use YYYY-MM-DD.' });
      }
      if (dataFim && !/^\d{4}-\d{2}-\d{2}$/.test(dataFim)) {
        return res.status(400).json({ error: 'dataFim inválida. Use YYYY-MM-DD.' });
      }

      const response = await mapeamentoOperacionalComCache(id, {
        data,
        dataInicio,
        dataFim,
        tipoServico: servico.tipo,
      });
      return res.json(response);
    } catch (error) {
      console.error('Erro no mapeamento operacional:', error);
      return res.status(500).json({ error: 'Erro ao montar mapeamento operacional' });
    }
  }

  /**
   * GET /api/contracts/:contractId/servicos/:id/relatorio-dia-operacao?data=YYYY-MM-DD
   * PDF diário idêntico ao do chatbot (formato Coleta BH).
   */
  async getRelatorioDiaOperacao(req: Request, res: Response): Promise<any> {
    try {
      const id = req.params.id as string;
      const servico = await this.repository.findOne({ where: { id } });
      if (!servico) return res.status(404).json({ error: 'Serviço não encontrado' });
      const ehColeta = servico.tipo === TipoServico.COLETA_CAMINHAO || servico.tipo === 'coleta_caminhao';
      if (!ehColeta) {
        return res.status(400).json({ error: 'Relatório de operação do dia disponível apenas para coleta' });
      }

      const data = typeof req.query.data === 'string' ? req.query.data : '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
        return res.status(400).json({ error: 'Data inválida. Use YYYY-MM-DD.' });
      }

      const contrato = servico.contract_id
        ? await AppDataSource.getRepository(Contract).findOne({ where: { id: servico.contract_id } })
        : null;

      const { montarHtmlRelatorioDiaColeta } = await import('../services/relatorioDia/montarRelatorioDiaColeta');
      const { html, nomeArquivo } = await montarHtmlRelatorioDiaColeta({
        servico,
        contrato,
        dataIso: data,
      });
      const { htmlToPdf } = await import('../services/PdfGeneratorService');
      const pdf = await htmlToPdf(html, {
        useCache: false,
        margin: { top: '10mm', bottom: '10mm', left: '8mm', right: '8mm' },
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
      return res.send(pdf);
    } catch (error: any) {
      console.error('Erro no PDF diário de operação:', error);
      return res.status(500).json({ error: 'Erro ao gerar o relatório do dia: ' + (error?.message || '') });
    }
  }

  /**
   * GET /api/contracts/:contractId/servicos/:id/rotas-ciclo
   * Ficha de cada rota no ciclo: mediana do dia, variabilidade e tendência.
   */
  async getRotasCiclo(req: Request, res: Response): Promise<any> {
    try {
      const id = req.params.id as string;
      const servico = await this.repository.findOne({ where: { id }, select: ['id', 'tipo'] as any });
      if (!servico) return res.status(404).json({ error: 'Serviço não encontrado' });
      const ehColeta = servico.tipo === TipoServico.COLETA_CAMINHAO || servico.tipo === 'coleta_caminhao';
      if (!ehColeta) {
        return res.status(400).json({ error: 'Ficha de rotas disponível apenas para serviços de coleta' });
      }

      const dataInicio = typeof req.query.dataInicio === 'string' ? req.query.dataInicio : undefined;
      const dataFim = typeof req.query.dataFim === 'string' ? req.query.dataFim : undefined;
      if (dataInicio && !/^\d{4}-\d{2}-\d{2}$/.test(dataInicio)) {
        return res.status(400).json({ error: 'dataInicio inválida. Use YYYY-MM-DD.' });
      }
      if (dataFim && !/^\d{4}-\d{2}-\d{2}$/.test(dataFim)) {
        return res.status(400).json({ error: 'dataFim inválida. Use YYYY-MM-DD.' });
      }

      const resultado = await fichaRotasCicloComCache(id, { dataInicio, dataFim });
      return res.json(resultado);
    } catch (error) {
      console.error('Erro na ficha de rotas do ciclo:', error);
      return res.status(500).json({ error: 'Erro ao montar ficha de rotas do ciclo' });
    }
  }

  /**
   * GET /api/contracts/:contractId/servicos/:id/rocada/agregacao
   * Resumo + rankings de roçada via SQL (escala 500k+ sem materializar linhas).
   * Query: data=YYYY-MM-DD | dataInicio=&dataFim= | topN=
   */
  async getRocadaAgregacao(req: Request, res: Response): Promise<any> {
    try {
      const id = req.params.id as string;
      const servico = await this.repository.findOne({ where: { id }, select: ['id', 'tipo'] });
      if (!servico) return res.status(404).json({ error: 'Serviço não encontrado' });
      const ehRocada = servico.tipo === TipoServico.ROCADEIRA || servico.tipo === 'rocadeira';
      if (!ehRocada) {
        return res.status(400).json({ error: 'Agregação disponível apenas para serviços de roçada' });
      }

      const data = typeof req.query.data === 'string' ? req.query.data : undefined;
      const dataInicio = typeof req.query.dataInicio === 'string' ? req.query.dataInicio : undefined;
      const dataFim = typeof req.query.dataFim === 'string' ? req.query.dataFim : undefined;
      const topN = req.query.topN ? parseInt(String(req.query.topN), 10) : undefined;
      const tipoRaw = typeof req.query.tipoExecucao === 'string' ? req.query.tipoExecucao.toLowerCase() : '';
      const tipoExecucao = tipoRaw === 'manual' || tipoRaw === 'mecanizada' ? tipoRaw : undefined;

      if (data && !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
        return res.status(400).json({ error: 'Data inválida. Use YYYY-MM-DD.' });
      }
      if (dataInicio && !/^\d{4}-\d{2}-\d{2}$/.test(dataInicio)) {
        return res.status(400).json({ error: 'dataInicio inválida. Use YYYY-MM-DD.' });
      }
      if (dataFim && !/^\d{4}-\d{2}-\d{2}$/.test(dataFim)) {
        return res.status(400).json({ error: 'dataFim inválida. Use YYYY-MM-DD.' });
      }

      const cacheKey = [
        'rocada-agregacao-v2', id,
        data || '', dataInicio || '', dataFim || '', String(topN || ''), tipoExecucao || '',
      ].join(':');
      const cached = getCache<any>(cacheKey);
      if (cached) return res.json(cached);

      const agregacao = await getAgregacaoRocada(id, { data, dataInicio, dataFim, topN, tipoExecucao });
      const response = { ...agregacao, tipoServico: servico.tipo };
      setCache(cacheKey, response);
      return res.json(response);
    } catch (error) {
      console.error('Erro na agregação de roçada:', error);
      return res.status(500).json({ error: 'Erro ao agregar dados de roçada' });
    }
  }

  /**
   * GET /api/contracts/:contractId/servicos/:id/dados-dia/:data
   * Registros upados em uma data (YYYY-MM-DD), consulta direta no banco.
   */
  async listarDadosDia(req: Request, res: Response): Promise<any> {
    try {
      const id = req.params.id as string;
      const data = req.params.data as string;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
        return res.status(400).json({ error: 'Data inválida. Use YYYY-MM-DD.' });
      }
      const incluirInconsistentes = req.query.incluirInconsistentes === '1' || req.query.todos === '1';      const servico = await this.repository.findOne({ where: { id }, select: ['id', 'tipo'] });
      const tipo = String(servico?.tipo || '');
      const ehServicoUnidade = (
        tipo === TipoServico.ROCADEIRA || tipo === 'rocadeira'
        || tipo === TipoServico.CAPINA || tipo === 'capina'
        || tipo === TipoServico.VARRICAO || tipo === 'varricao'
        || tipo === TipoServico.PODA || tipo === 'poda'
        || tipo === 'pintura_meio_fio'
      );
      const page = req.query.page ? Math.max(1, parseInt(String(req.query.page), 10) || 1) : undefined;
      // Pagina por padrão (coleta e roçada) — evita payloads de dezenas de MB/dia.
      const limitRaw = req.query.limit != null
        ? parseInt(String(req.query.limit), 10)
        : 100;
      const limit = !Number.isNaN(limitRaw) && limitRaw > 0 ? limitRaw : 100;
      // limit=0 ou all=1: comportamento legado (tudo) — uso raro / export
      const semPaginacao = req.query.all === '1' || req.query.limit === '0';
      const resultado = await PlanilhaService.getDadosBrutosPorDia(id, data, {
        apenasValidos: !incluirInconsistentes,
        pularValidacaoViagem: ehServicoUnidade,
        page: semPaginacao ? undefined : (page || 1),
        limit: semPaginacao ? undefined : limit,
      });
      return res.json({
        data,
        dados: resultado.dados,
        total: resultado.total,
        pagina: resultado.pagina,
        totalPaginas: resultado.totalPaginas,
        limit: resultado.limit,
        apenasValidos: !incluirInconsistentes,
        tipoServico: servico?.tipo || null,
        truncado: resultado.total > resultado.dados.length,
      });
    } catch (error) {
      console.error('Erro ao carregar dados do dia:', error);
      return res.status(500).json({ error: 'Erro ao carregar dados do dia' });
    }
  }

  /**
   * DELETE /api/contracts/:contractId/servicos/:id/dados-dia/:data
   * Apaga os registros de um dia em uploads ainda abertos, para permitir
   * reenviar a planilha corrigida sem manter o preenchimento errado.
   */
  async excluirDadosDia(req: Request, res: Response): Promise<any> {
    try {
      const contractId = req.params.contractId as string;
      const id = req.params.id as string;
      const data = req.params.data as string;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
        return res.status(400).json({ error: 'Data inválida. Use YYYY-MM-DD.' });
      }

      const servico = await this.repository.findOne({ where: { id, contract_id: contractId } });
      if (!servico) {
        return res.status(404).json({ error: 'Serviço não encontrado' });
      }

      const { bloqueadas, ciclos } = await verificarDatasEmCicloFechado(id, [data]);
      if (bloqueadas.includes(data)) {
        return res.status(409).json({ error: montarAvisoDatasCicloFechado(bloqueadas, ciclos) });
      }

      const removidos = await apagarDatasDeUploadsAbertos(id, [data]);
      const registrosRemovidos = removidos.reduce((soma, item) => soma + item.registrosRemovidos, 0);
      if (registrosRemovidos === 0) {
        return res.status(404).json({
          error: 'Nenhum registro em ciclo aberto encontrado neste dia.',
        });
      }

      invalidarCacheDadosServico(id);
      invalidarCacheDashboardServico(id);
      try {
        const { dashboardCache } = await import('../services/DashboardCacheManager');
        dashboardCache.invalidar(id);
      } catch { /* cache opcional */ }

      return res.json({
        sucesso: true,
        data,
        registrosRemovidos,
        mensagem: `${registrosRemovidos} registro(s) do dia apagado(s). Você pode subir a planilha corrigida.`,
      });
    } catch (error: any) {
      console.error('Erro ao apagar registros do dia:', error);
      return res.status(500).json({ error: error.message || 'Erro ao apagar registros do dia' });
    }
  }

  /**
   * POST /api/contracts/:contractId/servicos/:id/gerar-indicadores
   * Regenera automaticamente os indicadores do dashboard com base no padrão da planilha
   */
  async gerarIndicadores(req: Request, res: Response): Promise<any> {
    try {
      const id = req.params.id as string;
      const servico = await this.repository.findOne({ where: { id } });

      if (!servico) {
        return res.status(404).json({ error: 'Serviço não encontrado' });
      }

      if (!servico.padraoPlanilha?.colunas) {
        return res.status(400).json({ error: 'Nenhuma planilha vinculada. Faça upload primeiro.' });
      }

      const colunas = servico.padraoPlanilha.colunas as { nome: string; tipo: string; valoresUnicos?: number }[];
      const colunasNumericas = colunas.filter(c => c.tipo === 'numero').map(c => c.nome);
      const colunasTextoRelevantes = colunas.filter(c =>
        c.tipo === 'texto' &&
        (c.valoresUnicos === undefined || c.valoresUnicos <= 200)
      );
      const primeiraColunaTexto = colunas.find(c => c.tipo === 'texto')?.nome || colunas[0]?.nome || '';
      const primeiraColunaNum = colunasNumericas[0] || '';
      const segundaColunaNum = colunasNumericas[1] || '';

      const kpisGerados: any[] = [];
      for (const nome of colunasNumericas.slice(0, 4)) {
        kpisGerados.push({ nome, label: nome, agregacao: 'sum', formato: 'numero', ativo: true });
      }
      for (const col of colunasTextoRelevantes.slice(0, 6)) {
        kpisGerados.push({ nome: col.nome, label: col.nome, agregacao: 'count', formato: 'numero', ativo: true });
      }

      servico.configDashboard = {
        kpis: kpisGerados,
        graficos: [{
          tipo: 'barra',
          titulo: `Distribuição por ${primeiraColunaTexto || 'Categoria'}`,
          eixoX: primeiraColunaTexto,
          eixoY: primeiraColunaNum || segundaColunaNum,
          ativo: true,
        }],
      };

      await this.repository.save(servico);
      return res.json({ message: 'Indicadores gerados com sucesso!', configDashboard: servico.configDashboard });
    } catch (error: any) {
      console.error('Erro ao gerar indicadores:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao gerar indicadores' });
    }
  }

  /**
   * POST /api/contracts/:contractId/servicos/:id/analisar-indicadores-automaticos
   * ⭐ Analisa colunas da planilha e retorna indicadores + gráficos sugeridos
   * para a tela de revisão pós-upload.
   * 
   * Body (opcional):
   *   { forcarRecalculo?: boolean } — força recálculo mesmo se já houver indicadores salvos
   * 
   * Response: AnaliseAutoIndicadores
   */
  async analisarIndicadoresAutomaticos(req: Request, res: Response): Promise<any> {
    try {
      const id = req.params.id as string;
      const contractId = req.params.contractId as string;
      const { forcarRecalculo } = req.body || {};

      const servico = await this.repository.findOne({ where: { id } });
      if (!servico) {
        return res.status(404).json({ error: 'Serviço não encontrado' });
      }

      // Verificar se já tem análise recente (últimos 5 minutos)
      if (!forcarRecalculo && servico.configDashboard?.ultimaAnaliseAuto) {
        const ultimaAnalise = new Date(servico.configDashboard.ultimaAnaliseAuto);
        const agora = new Date();
        const diffMs = agora.getTime() - ultimaAnalise.getTime();
        if (diffMs < 5 * 60 * 1000) {
          // Retornar análise em cache
          return res.json({
            ...servico.configDashboard.ultimaAnaliseData,
            emCache: true,
          });
        }
      }

      if (!servico.padraoPlanilha?.colunas || servico.padraoPlanilha.colunas.length === 0) {
        return res.status(400).json({ error: 'Nenhuma planilha vinculada. Faça upload primeiro.' });
      }

      // Carregar dados brutos para cálculos mais precisos
      const dadosBrutos = await PlanilhaService.getDadosBrutosPorServico(id, 500);

      // Executar análise
      const analise = await AutoIndicatorService.analisar(
        id,
        contractId,
        servico.padraoPlanilha.colunas.map((c: any) => ({
          nome: c.nome,
          tipo: c.tipo as ColunaInfo['tipo'],
          valoresUnicos: c.valoresUnicos || 0,
          amostras: c.amostras || [],
          nulos: c.nulos || 0,
        })),
        dadosBrutos
      );

      // Converter para KPI/Gráfico format
      const kpisConvertidos = AutoIndicatorService.converterParaKpiConfig(analise.indicadoresSugeridos);
      const graficosConvertidos = AutoIndicatorService.converterParaGraficoConfig(analise.graficosSugeridos);

      const resultado = {
        ...analise,
        indicadores: kpisConvertidos,
        graficos: graficosConvertidos,
        geradoEm: new Date().toISOString(),
      };

      // Salvar cache no servico
      if (!servico.configDashboard) servico.configDashboard = {};
      servico.configDashboard.ultimaAnaliseAuto = new Date().toISOString();
      servico.configDashboard.ultimaAnaliseData = {
        indicadores: resultado.indicadores,
        graficos: resultado.graficos,
        indicadoresSugeridos: resultado.indicadoresSugeridos,
        graficosSugeridos: resultado.graficosSugeridos,
        totalRegistros: analise.totalRegistros,
        colunas: analise.colunas,
      };
      
      // Salvar colunas originais para detectar mudanças futuras
      if (servico.padraoPlanilha) {
        servico.padraoPlanilha.colunasOriginais = analise.colunasOriginais;
      }
      
      await this.repository.save(servico);

      return res.json(resultado);
    } catch (error: any) {
      console.error('Erro ao analisar indicadores automáticos:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao analisar indicadores: ' + (error?.message || '') });
    }
  }

  /**
   * POST /api/contracts/:contractId/servicos/:id/confirmar-indicadores-automaticos
   * Confirma e salva os indicadores automáticos sugeridos.
   * Body:
   *   { 
   *     indicadores: KpiConfig[],  // Lista de indicadores que o usuário aceitou
   *     graficos: GraficoConfig[], // Lista de gráficos que o usuário aceitou
   *     aceitarTodos?: boolean     // Se true, salva todos sem filtro
   *   }
   */
  async confirmarIndicadoresAutomaticos(req: Request, res: Response): Promise<any> {
    try {
      const id = req.params.id as string;
      const { indicadores, graficos, aceitarTodos } = req.body;

      const servico = await this.repository.findOne({ where: { id } });
      if (!servico) {
        return res.status(404).json({ error: 'Serviço não encontrado' });
      }

      // Se aceitarTodos, usar os indicadores salvos em cache
      let kpisSalvos = indicadores || [];
      let graficosSalvos = graficos || [];

      if (aceitarTodos && servico.configDashboard?.ultimaAnaliseData) {
        kpisSalvos = servico.configDashboard.ultimaAnaliseData.indicadores || [];
        graficosSalvos = servico.configDashboard.ultimaAnaliseData.graficos || [];
      }

      if (!kpisSalvos.length && !aceitarTodos) {
        return res.status(400).json({ error: 'Nenhum indicador recebido para salvar' });
      }

      // Mesclar com indicadores existentes (manter indicadores manuais)
      const kpisExistentes: any[] = servico.configDashboard?.kpis || [];
      const kpisManuais = kpisExistentes.filter((k: any) => !k.automatico);

      // Adicionar os automáticos confirmados
      const kpisAutomaticos = kpisSalvos.map((k: any) => ({
        ...k,
        automatico: true,
        aceitoEm: new Date().toISOString(),
      }));

      servico.configDashboard = {
        kpis: [...kpisManuais, ...kpisAutomaticos],
        graficos: graficosSalvos,
        indicadoresAutomaticosConfirmados: true,
        ultimaConfirmacaoAuto: new Date().toISOString(),
        // Manter cache da análise
        ultimaAnaliseAuto: servico.configDashboard?.ultimaAnaliseAuto,
        ultimaAnaliseData: servico.configDashboard?.ultimaAnaliseData,
      };

      await this.repository.save(servico);

      return res.json({
        message: `✅ ${kpisAutomaticos.length} indicador(es) automático(s) confirmado(s)!`,
        configDashboard: servico.configDashboard,
        totalKpis: kpisAutomaticos.length,
        totalGraficos: graficosSalvos.length,
      });
    } catch (error: any) {
      console.error('Erro ao confirmar indicadores automáticos:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao confirmar indicadores: ' + (error?.message || '') });
    }
  }

  /**
   * POST /api/contracts/:contractId/servicos/:id/reanalisar-colunas
   * Reanalisa as colunas após um novo upload e detecta o que mudou.
   * Útil quando o usuário faz um novo upload em um serviço que já tem indicadores.
   */
  async reanalisarColunas(req: Request, res: Response): Promise<any> {
    try {
      const id = req.params.id as string;
      const contractId = req.params.contractId as string;

      const servico = await this.repository.findOne({ where: { id } });
      if (!servico) {
        return res.status(404).json({ error: 'Serviço não encontrado' });
      }

      if (!servico.padraoPlanilha?.colunas) {
        return res.status(400).json({ error: 'Nenhuma planilha vinculada' });
      }

      // Análise atual
      const colunasAtuais: string[] = servico.padraoPlanilha.colunas.map((c: any) => c.nome);
      const colunasAnteriores: string[] = servico.padraoPlanilha.colunasOriginais || [];

      const colunasAdicionadas = colunasAtuais.filter(c => !colunasAnteriores.includes(c));
      const colunasRemovidas = colunasAnteriores.filter(c => !colunasAtuais.includes(c));

      // Carregar dados para análise
      const dadosBrutos = await PlanilhaService.getDadosBrutosPorServico(id, 500);

      const analise = await AutoIndicatorService.analisar(
        id,
        contractId,
        servico.padraoPlanilha.colunas.map((c: any) => ({
          nome: c.nome,
          tipo: c.tipo as ColunaInfo['tipo'],
          valoresUnicos: c.valoresUnicos || 0,
          amostras: c.amostras || [],
          nulos: c.nulos || 0,
        })),
        dadosBrutos
      );

      return res.json({
        ...analise,
        colunasAdicionadas,
        colunasRemovidas,
        temMudancas: colunasAdicionadas.length > 0 || colunasRemovidas.length > 0,
        indicadores: AutoIndicatorService.converterParaKpiConfig(analise.indicadoresSugeridos),
        graficos: AutoIndicatorService.converterParaGraficoConfig(analise.graficosSugeridos),
      });
    } catch (error: any) {
      console.error('Erro ao reanalisar colunas:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao reanalisar colunas: ' + (error?.message || '') });
    }
  }

  /**
   * GET /api/contracts/:contractId/servicos/:id/config-resumo
   * Retorna a configuração de visibilidade/ordem das métricas do resumo executivo
   */
  async getConfigResumo(req: Request, res: Response): Promise<any> {
    try {
      const id = req.params.id as string;
      const servico = await this.repository.findOne({ where: { id } });
      if (!servico) {
        return res.status(404).json({ error: 'Serviço não encontrado' });
      }

      const configResumo = servico.configDashboard?.configResumo || null;
      return res.json({ configResumo });
    } catch (error: any) {
      console.error('Erro ao buscar config resumo:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao buscar configuração do resumo' });
    }
  }

  /**
   * PUT /api/contracts/:contractId/servicos/:id/config-resumo
   * Salva a configuração de visibilidade/ordem das métricas do resumo executivo
   * Body: { 
   *   metricasAtivas: string[],   // keys das métricas visíveis
   *   ordem: string[],            // ordem das métricas (todas as keys)
   * }
   */
  async salvarConfigResumo(req: Request, res: Response): Promise<any> {
    try {
      const id = req.params.id as string;
      const { metricasAtivas, ordem } = req.body;

      const servico = await this.repository.findOne({ where: { id } });
      if (!servico) {
        return res.status(404).json({ error: 'Serviço não encontrado' });
      }

      if (!servico.configDashboard) {
        servico.configDashboard = {};
      }

      servico.configDashboard.configResumo = {
        metricasAtivas: metricasAtivas || [],
        ordem: ordem || [],
        atualizadoEm: new Date().toISOString(),
      };

      await this.repository.save(servico);

      return res.json({
        message: 'Configuração do resumo executivo salva com sucesso',
        configResumo: servico.configDashboard.configResumo,
      });
    } catch (error: any) {
      console.error('Erro ao salvar config resumo:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao salvar configuração do resumo' });
    }
  }

  /**
   * PUT /api/contracts/:contractId/servicos/:id/colunas/tipo
   * Altera o tipo de uma coluna no padrão da planilha
   * Body: { nome, tipo }
   */
  async alterarTipoColuna(req: Request, res: Response): Promise<any> {
    try {
      const id = req.params.id as string;
      const { nome, tipo } = req.body;

      if (!nome || !tipo) {
        return res.status(400).json({ error: 'Nome e tipo são obrigatórios' });
      }

      const tiposValidos = ['numero', 'texto', 'data', 'hora', 'desconhecido'];
      if (!tiposValidos.includes(tipo)) {
        return res.status(400).json({ error: 'Tipo inválido. Use: numero, texto, data, hora ou desconhecido' });
      }

      const servico = await this.repository.findOne({ where: { id } });
      if (!servico) {
        return res.status(404).json({ error: 'Serviço não encontrado' });
      }

      if (!servico.padraoPlanilha?.colunas) {
        return res.status(400).json({ error: 'Nenhuma planilha vinculada a este serviço' });
      }

      const colunas = servico.padraoPlanilha.colunas as any[];
      const colunaIdx = colunas.findIndex((c: any) => c.nome === nome);

      if (colunaIdx === -1) {
        return res.status(404).json({ error: `Coluna "${nome}" não encontrada` });
      }

      colunas[colunaIdx].tipo = tipo;
      servico.padraoPlanilha.colunas = colunas;

      await this.repository.save(servico);

      return res.json({
        message: `Tipo da coluna "${nome}" alterado para "${tipo}"`,
        colunas,
      });
    } catch (error: any) {
      console.error('Erro ao alterar tipo da coluna:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao alterar tipo da coluna' });
    }
  }

  /**
   * POST /api/contracts/:contractId/servicos/:id/kpi-preview
   * Preview de KPI com fórmula — testa a expressão contra dados reais
   * Body: { expressao, valoresFixos?, filtros? }
   *   filtros: { dataInicio?, dataFim?, placa?, regional?, tipoCaminhao? }
   */
  async previewKpi(req: Request, res: Response): Promise<any> {
    try {
      const id = req.params.id as string;
      const contractId = req.params.contractId as string;
      const { expressao, valoresFixos: valoresFixosBody, filtros: filtrosBody } = req.body;

      if (!expressao) {
        return res.status(400).json({ error: 'Expressão é obrigatória' });
      }

      // Validar expressão
      const validacao = validarExpressao(expressao);
      if (!validacao.valido) {
        return res.status(400).json({ error: validacao.erro, valido: false });
      }

      // Carregar dados brutos (sem limite — fonte de verdade)
      const dados = await obterDadosServicoComCache(id, LIMITE_DADOS_MAX);
      if (!dados || dados.length === 0) {
        return res.json({
          valido: true,
          valor: null,
          totalRegistros: 0,
          mensagem: 'Nenhum dado disponível para calcular. Faça upload primeiro.',
        });
      }

      // Aplicar filtros se enviados
      const dadosParaCalculo = filtrosBody ? this.aplicarFiltros(dados, {
        dataInicio: (filtrosBody as any).dataInicio,
        dataFim: (filtrosBody as any).dataFim,
        placa: (filtrosBody as any).placa,
        regional: (filtrosBody as any).regional,
        tipoCaminhao: (filtrosBody as any).tipoCaminhao,
      }) : dados;

      const [contract, servico] = await Promise.all([
        this.contractRepo.findOne({ where: { id: contractId } }),
        this.repository.findOne({ where: { id } }),
      ]);

      const valoresFixos: Record<string, number> = {
        ...buildValoresFixosFaturamento(contract, servico?.configFaturamento),
        ...(valoresFixosBody || {}),
      };

      // Calcular
      const dadosNorm = normalizarDados(dadosParaCalculo);
      const valor = calcularKpiComFormula(expressao, dadosNorm, valoresFixos);

      // Extrair colunas usadas na expressão para debug
      const colunasUsadas: string[] = [];
      const funcRegex = /(?:SUM|AVG|MIN|MAX|COUNT(?:\s+DISTINCT)?)\s*\(\s*([^)]+)\s*\)/gi;
      let match;
      while ((match = funcRegex.exec(expressao)) !== null) {
        const col = match[1].trim();
        if (col !== '*' && !colunasUsadas.includes(col)) {
          colunasUsadas.push(col);
        }
      }

      // Verificar se as colunas existem nos dados
      const colunasEncontradas: string[] = [];
      const colunasAusentes: string[] = [];
      for (const col of colunasUsadas) {
        const encontrou = dadosNorm.some(d => {
          const chaves = Object.keys(d);
          const normalizada = col.trim().toUpperCase().replace(/\s+/g, '');
          return chaves.some(k => k.trim().toUpperCase().replace(/\s+/g, '') === normalizada);
        });
        if (encontrou) colunasEncontradas.push(col);
        else colunasAusentes.push(col);
      }

      return res.json({
        valido: true,
        valor: Math.round(valor * 100) / 100,
        totalRegistros: dadosParaCalculo.length,
        totalRegistrosSemFiltro: dados.length,
        colunasUsadas,
        colunasEncontradas,
        colunasAusentes,
        expressao,
        valoresDisponiveis: Object.keys(valoresFixos).length > 0 ? valoresFixos : undefined,
      });
    } catch (error: any) {
      console.error('Erro no preview KPI:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao calcular preview: ' + (error?.message || 'erro desconhecido') });
    }
  }

  /**
   * GET /api/contracts/:contractId/servicos-kpis
   * Retorna KPIs de todos os serviços de um contrato (exceto o serviço atual, se informado)
   * Query: ?excluirServicoId=xxx
   */
  async listarKpisDeServicos(req: Request, res: Response): Promise<any> {
    try {
      const contractId = req.params.contractId as string;
      const excluirServicoId = req.query.excluirServicoId as string | undefined;

      const servicos = await this.repository.find({
        where: { contract_id: contractId },
        order: { nome: 'ASC' },
      });

      const servicosComKpis = servicos
        .filter(s => excluirServicoId ? s.id !== excluirServicoId : true)
        .map(s => ({
          id: s.id,
          nome: s.nome,
          kpis: (s.configDashboard?.kpis || []).filter((k: any) => k.ativo !== false),
          totalKpis: (s.configDashboard?.kpis || []).filter((k: any) => k.ativo !== false).length,
        }))
        .filter(s => s.totalKpis > 0);

      return res.json({ servicos: servicosComKpis });
    } catch (error) {
      console.error('Erro ao listar KPIs de serviços:', error);
      return res.status(500).json({ error: 'Erro ao carregar KPIs dos serviços' });
    }
  }

    /**
   * ⚡ OTIMIZADO: usa cache + agregações SQL (getMetricasAgregadasPorServico)
   * Só carrega dados brutos quando necessário (KPIs com fórmula).
   * Reduz de 999999 para 5000 registros quando carrega.
   */
  async getKpiValores(req: Request, res: Response): Promise<any> {
    try {
      const id = req.params.id as string;
      const contractId = req.params.contractId as string;

      // ═══════════════════════════════════════════════════════════
      // 1. GERAR CACHE KEY
      // ═══════════════════════════════════════════════════════════
      const cacheParts = [
        'kpi-valores', id, contractId,
        req.query.dataInicio || '', req.query.dataFim || '',
        req.query.placa || '', req.query.regional || '',
        req.query.tipoCaminhao || '', req.query.uploadId || '',
      ];
      for (const [key, value] of Object.entries(req.query)) {
        if (key.startsWith('filtro_') && typeof value === 'string') {
          cacheParts.push(key + '=' + value);
        }
      }
      const cacheKey = cacheParts.join(':');

      const cached = getCache<any>(cacheKey);
      if (cached) return res.json(cached);

      // ═══════════════════════════════════════════════════════════
      // 2. CARREGAR SERVICO + CONTRATO
      // ═══════════════════════════════════════════════════════════
      const [servico, contract] = await Promise.all([
        this.repository.findOne({ where: { id } }),
        this.contractRepo.findOne({ where: { id: contractId } }),
      ]);

      if (!servico) {
        return res.status(404).json({ error: 'Servico nao encontrado' });
      }

      // ═══════════════════════════════════════════════════════════
      // 3. VALORES FIXOS — configFaturamento do serviço tem prioridade
      // ═══════════════════════════════════════════════════════════
      const cfgFat = servico.configFaturamento;
      const valoresFixos = buildValoresFixosFaturamento(
        contract,
        cfgFat?.ativo ? cfgFat : null
      );
      const temValor = Object.keys(valoresFixos).length > 0;

      // ═══════════════════════════════════════════════════════════
      // 4. JUNTAR KPIs DO CONTRATO + SERVICO
      // ═══════════════════════════════════════════════════════════
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

      // ⭐ Migração automática: KPIs de Faturamento que usam VALOR_TRUCK diretamente
      //    agora usam FATURAMENTO_EST() que detecta o tipo de caminhão de cada viagem
      //    e aplica o valor correto (TRUCK, TOCO ou MINI)
      for (const kpi of todosKpis) {
        const expr = kpi.expressao || '';
        if (
          /SUM\s*\(\s*PESO\s+TOTAL\s*\)\s*\/\s*1000\s*\*\s*VALOR_TRUCK/i.test(expr) ||
          /SUM\s*\(\s*PESO\s*\)\s*\/\s*1000\s*\*\s*VALOR_TRUCK/i.test(expr)
        ) {
          kpi.expressao = 'FATURAMENTO_EST(PESO TOTAL, TIPO CAMINHAO)';
        }
      }

      // ═══════════════════════════════════════════════════════════
      // 5a. ROÇADA — KPIs via SQL (sem materializar 20k–500k linhas)
      // ═══════════════════════════════════════════════════════════
      const ehRocada = servico.tipo === TipoServico.ROCADEIRA || servico.tipo === 'rocadeira';
      if (ehRocada) {
        const metricasRocada = await getMetricasRocadaSql(id, {
          dataInicio: req.query.dataInicio as string | undefined,
          dataFim: req.query.dataFim as string | undefined,
        });

        if (metricasRocada.registros === 0) {
          const periodoDados = await PlanilhaService.getPeriodoDadosPorServico(id);
          const emptyResponse = {
            kpis: todosKpis.map((k: any) => ({
              id: k.id, nome: k.label || k.nome,
              valor: null, formatado: '-',
              formato: k.formato || 'numero', origem: k._origem,
            })),
            metrica_executiva: {
              viagens: 0, qtdColetores: 0, pesoTotalTon: 0, kmTotal: 0,
              horasProdutivas: 0, horasMediaRotas: 0, faturamento: 0, fatPorTipo: {},
              tonKm: 0, prodColetor: 0, kmMedioViagem: 0, tonMediaColeta: 0,
              receitaKm: 0, receitaHora: 0, temValor: false,
              areaM2: 0, registros: 0,
            },
            periodoDados,
            modo: 'rocada-sql',
          };
          setCache(cacheKey, emptyResponse);
          return res.json(emptyResponse);
        }

        const resultadosKpisRocada = todosKpis.map((kpi: any) => {
          try {
            let expressao = kpi.expressao || '';
            const colunasServico = (servico.padraoPlanilha?.colunas || []).map((c: any) => c.nome);
            const expressaoResolvida = resolvePlaceholdersNaFormula(expressao, { colunasServico });
            if (expressaoResolvida !== expressao) expressao = expressaoResolvida;

            const kpiValoresFixos = { ...valoresFixos };
            if (kpi.valoresFixos && typeof kpi.valoresFixos === 'object') {
              for (const [key, value] of Object.entries(kpi.valoresFixos)) {
                if (value !== null && value !== undefined && Number(value) > 0) {
                  kpiValoresFixos[key] = Number(value);
                }
              }
            }

            let valor = resolverKpiRocadaSql(expressao, metricasRocada, kpiValoresFixos);
            if (valor === null) {
              // Fallback por agregação simples / nome
              const nome = String(kpi.label || kpi.nome || '').toLowerCase();
              if (kpi.agregacao === 'count' || /registro|linha|contagem/i.test(nome)) {
                valor = metricasRocada.registros;
              } else if (/área|area|m²|m2/i.test(nome)) {
                valor = metricasRocada.areaM2;
              } else if (/equipe/i.test(nome)) {
                valor = metricasRocada.equipes;
              } else if (/operador/i.test(nome)) {
                valor = metricasRocada.operadores;
              } else if (/equipamento/i.test(nome)) {
                valor = metricasRocada.equipamentos;
              } else if (/bairro/i.test(nome)) {
                valor = metricasRocada.bairros;
              } else if (/faturamento|receita/i.test(nome) && (
                Number(kpiValoresFixos.VALOR_M2 || 0) > 0
                || Number(kpiValoresFixos.VALOR_M2_MANUAL || 0) > 0
                || Number(kpiValoresFixos.VALOR_M2_MECANIZADA || 0) > 0
              )) {
                valor = calcularFaturamentoRocadaPorAreas(
                  {
                    manual: metricasRocada.areaManualM2,
                    mecanizada: metricasRocada.areaMecanizadaM2,
                    desconhecido: metricasRocada.areaDesconhecidaM2,
                  },
                  kpiValoresFixos,
                );
              } else {
                valor = 0;
              }
            }

            return {
              id: kpi.id,
              nome: kpi.label || kpi.nome,
              valor: Math.round(valor * 100) / 100,
              formatado: formatarValor(valor, kpi.formato || 'numero'),
              formato: kpi.formato || 'numero',
              origem: kpi._origem,
            };
          } catch (err: any) {
            return {
              id: kpi.id, nome: kpi.label || kpi.nome,
              valor: null, formatado: '-',
              formato: kpi.formato || 'numero',
              origem: kpi._origem,
              erro: err.message,
            };
          }
        });

        const faturamentoRocada = calcularFaturamentoRocadaPorAreas(
          {
            manual: metricasRocada.areaManualM2,
            mecanizada: metricasRocada.areaMecanizadaM2,
            desconhecido: metricasRocada.areaDesconhecidaM2,
          },
          valoresFixos,
        );

        const responseRocada = {
          kpis: resultadosKpisRocada,
          metrica_executiva: {
            viagens: metricasRocada.registros,
            qtdColetores: metricasRocada.operadores,
            pesoTotalTon: 0,
            kmTotal: 0,
            horasProdutivas: 0,
            horasMediaRotas: 0,
            faturamento: Math.round(faturamentoRocada * 100) / 100,
            fatPorTipo: {},
            tonKm: 0,
            prodColetor: 0,
            kmMedioViagem: 0,
            tonMediaColeta: 0,
            receitaKm: 0,
            receitaHora: 0,
            temValor: Number(valoresFixos.VALOR_M2 || 0) > 0,
            areaM2: metricasRocada.areaM2,
            registros: metricasRocada.registros,
            equipes: metricasRocada.equipes,
            operadores: metricasRocada.operadores,
            equipamentos: metricasRocada.equipamentos,
            bairros: metricasRocada.bairros,
          },
          modo: 'rocada-sql',
        };
        setCache(cacheKey, responseRocada);
        return res.json(responseRocada);
      }

      // ═══════════════════════════════════════════════════════════
      // 5b. COLETA — KPIs via SQL (sem materializar 20k–600k linhas)
      //     Fallback in-memory só para fórmulas custom não reconhecidas.
      // ═══════════════════════════════════════════════════════════
      const ehColeta = servico.tipo === TipoServico.COLETA_CAMINHAO || servico.tipo === 'coleta_caminhao';
      const temFiltroExtraColeta = !!(
        req.query.placa || req.query.regional || req.query.tipoCaminhao || req.query.uploadId
        || Object.keys(req.query).some((k) => k.startsWith('filtro_'))
      );

      if (ehColeta && !temFiltroExtraColeta) {
        const metricasColeta = await getMetricasColetaSql(id, {
          dataInicio: req.query.dataInicio as string | undefined,
          dataFim: req.query.dataFim as string | undefined,
        }, valoresFixos);

        if (metricasColeta.registros === 0) {
          const periodoDados = await PlanilhaService.getPeriodoDadosPorServico(id);
          const emptyResponse = {
            kpis: todosKpis.map((k: any) => ({
              id: k.id, nome: k.label || k.nome,
              valor: null, formatado: '-',
              formato: k.formato || 'numero', origem: k._origem,
            })),
            metrica_executiva: {
              ...metricaExecutivaDeColetaSql(metricasColeta, temValor),
            },
            periodoDados,
            modo: 'coleta-sql',
          };
          setCache(cacheKey, emptyResponse);
          return res.json(emptyResponse);
        }

        const colunasServico = (servico.padraoPlanilha?.colunas || []).map((c: any) => c.nome);
        const naoResolvidos: any[] = [];
        const resultadosKpisColeta = todosKpis.map((kpi: any) => {
          try {
            let expressao = resolverExpressaoKpiViagensRealizadas(kpi, kpi.expressao || '');
            expressao = resolverExpressaoKpiContadorViagens(kpi, expressao);
            expressao = resolverExpressaoKpiColetoresEquipe(kpi, expressao);
            const expressaoResolvida = resolvePlaceholdersNaFormula(expressao, { colunasServico });
            if (expressaoResolvida !== expressao) expressao = expressaoResolvida;

            const kpiValoresFixos = { ...valoresFixos };
            if (kpi.valoresFixos && typeof kpi.valoresFixos === 'object') {
              for (const [key, value] of Object.entries(kpi.valoresFixos)) {
                if (value !== null && value !== undefined && Number(value) > 0) {
                  kpiValoresFixos[key] = Number(value);
                }
              }
            }

            let valor = resolverKpiColetaSql(expressao, metricasColeta, kpiValoresFixos);
            if (valor === null) {
              const nome = String(kpi.label || kpi.nome || '').toLowerCase();
              if (/viagem|viagens/i.test(nome)) valor = metricasColeta.viagens;
              else if (/peso|ton/i.test(nome) && !/km|hora|viagem/i.test(nome)) valor = metricasColeta.pesoTotalTon;
              else if (/^km|quilometr/i.test(nome) && !/ton|receita/i.test(nome)) valor = metricasColeta.kmTotal;
              else if (/motorista/i.test(nome)) valor = metricasColeta.motoristas;
              else if (/placa|coletor|caminh/i.test(nome)) valor = metricasColeta.placas;
              else if (/faturamento|receita/i.test(nome)) valor = metricasColeta.faturamento;
              else if (/hora/i.test(nome)) valor = metricasColeta.horasProdutivas;
              else {
                naoResolvidos.push(kpi);
                valor = 0;
              }
            }

            return {
              id: kpi.id,
              nome: kpi.label || kpi.nome,
              valor: Math.round(valor * 100) / 100,
              formatado: formatarValor(valor, kpi.formato || 'numero'),
              formato: kpi.formato || 'numero',
              origem: kpi._origem,
            };
          } catch (err: any) {
            return {
              id: kpi.id, nome: kpi.label || kpi.nome,
              valor: null, formatado: '-',
              formato: kpi.formato || 'numero',
              origem: kpi._origem,
              erro: err.message,
            };
          }
        });

        // Fallback in-memory só para KPIs custom não reconhecidos
        if (naoResolvidos.length > 0) {
          try {
            const dados = await obterDadosServicoComCache(id);
            const dadosFiltrados = this.aplicarFiltros(dados || [], {
              dataInicio: req.query.dataInicio as string | undefined,
              dataFim: req.query.dataFim as string | undefined,
            });
            if (dadosFiltrados?.length) {
              const dadosNorm = normalizarDados(dadosFiltrados);
              const truncado = (dados?.length || 0) >= LIMITE_DADOS_MAX;
              for (const kpi of naoResolvidos) {
                const idx = resultadosKpisColeta.findIndex((r) => r.id === kpi.id);
                if (idx < 0) continue;
                try {
                  let expressao = resolverExpressaoKpiViagensRealizadas(kpi, kpi.expressao || '');
                  expressao = resolverExpressaoKpiContadorViagens(kpi, expressao);
                  expressao = resolverExpressaoKpiColetoresEquipe(kpi, expressao);
                  expressao = resolvePlaceholdersNaFormula(expressao, { colunasServico });
                  const kpiValoresFixos = { ...valoresFixos };
                  if (kpi.valoresFixos && typeof kpi.valoresFixos === 'object') {
                    for (const [key, value] of Object.entries(kpi.valoresFixos)) {
                      if (value !== null && value !== undefined && Number(value) > 0) {
                        kpiValoresFixos[key] = Number(value);
                      }
                    }
                  }
                  const resultado = calcularExpressao(expressao, { dados: dadosNorm, valoresFixos: kpiValoresFixos });
                  const valor = Math.round(resultado.valor * 100) / 100;
                  resultadosKpisColeta[idx] = {
                    ...resultadosKpisColeta[idx],
                    valor,
                    formatado: formatarValor(valor, kpi.formato || 'numero'),
                    ...(truncado ? { aviso: 'calculado com amostra truncada' } : {}),
                  };
                } catch { /* mantém 0 */ }
              }
            }
          } catch (e) {
            console.warn('[kpi-valores] fallback in-memory falhou:', (e as any)?.message);
          }
        }

        const responseColeta = {
          kpis: resultadosKpisColeta,
          metrica_executiva: metricaExecutivaDeColetaSql(metricasColeta, temValor),
          modo: 'coleta-sql',
        };
        setCache(cacheKey, responseColeta);
        return res.json(responseColeta);
      }

      // ═══════════════════════════════════════════════════════════
      // 5. CARREGAR DADOS COMPLETOS + APLICAR FILTROS (fonte única)
      // ═══════════════════════════════════════════════════════════
      const filtros: any = {
        dataInicio: req.query.dataInicio as string | undefined,
        dataFim: req.query.dataFim as string | undefined,
        placa: req.query.placa as string | undefined,
        regional: req.query.regional as string | undefined,
        tipoCaminhao: req.query.tipoCaminhao as string | undefined,
        uploadId: req.query.uploadId ? parseInt(req.query.uploadId as string) : undefined,
      };
      const filtrosDinamicos: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.query)) {
        if (key.startsWith('filtro_') && typeof value === 'string' && value.trim()) {
          filtrosDinamicos[key.replace('filtro_', '')] = value.trim();
        }
      }
      if (Object.keys(filtrosDinamicos).length > 0) filtros.filtrosDinamicos = filtrosDinamicos;

      const dados = await obterDadosServicoComCache(id);
      const dadosFiltrados = this.aplicarFiltros(dados || [], filtros);

      if (!dadosFiltrados || dadosFiltrados.length === 0) {
        const periodoDados = await PlanilhaService.getPeriodoDadosPorServico(id);
        const temDadosForaPeriodo = (dados?.length ?? 0) > 0 && !!periodoDados;
        const emptyResponse = {
          kpis: todosKpis.map((k: any) => ({
            id: k.id, nome: k.label || k.nome,
            valor: null, formatado: '-',
            formato: k.formato || 'numero', origem: k._origem,
          })),
          metrica_executiva: {
            viagens: 0, qtdColetores: 0, pesoTotalTon: 0, kmTotal: 0,
            horasProdutivas: 0, horasMediaRotas: 0, faturamento: 0, fatPorTipo: {},
            tonKm: 0, prodColetor: 0, kmMedioViagem: 0, tonMediaColeta: 0,
            receitaKm: 0, receitaHora: 0, temValor: false,
          },
          periodoDados,
          avisoPeriodo: temDadosForaPeriodo
            ? `Nenhum registro no período filtrado. Dados disponíveis: ${periodoDados!.dataInicio.split('-').reverse().join('/')} a ${periodoDados!.dataFim.split('-').reverse().join('/')}.`
            : undefined,
        };
        setCache(cacheKey, emptyResponse);
        return res.json(emptyResponse);
      }

      const dadosNorm = normalizarDados(dadosFiltrados);
      const metricas = calcularMetricaExecutivaDeDados(dadosNorm, valoresFixos, id, cfgFat);
      const colunasDetectadas = metricas.colunasDetectadas;
      const {
        viagens, qtdColetores: coletoresAtivos, pesoTotalTon, kmTotal,
        horasProdutivas: horasProdutivasFinal, faturamento, fatPorTipo,
        tonKm, prodColetor, kmMedioViagem, tonMediaColeta, receitaKm, receitaHora,
      } = metricas;

      const colunasServico = (servico.padraoPlanilha?.colunas || []).map((c: any) => c.nome);

      // ═══════════════════════════════════════════════════════════
      // 7. CALCULAR CADA KPI (placeholders via PlaceholderResolver)
      // ═══════════════════════════════════════════════════════════
      const cacheValoresFormula = new Map<string, number>();
      const resultadosKpis = todosKpis.map((kpi: any) => {
        try {
          let expressao = resolverExpressaoKpiViagensRealizadas(kpi, kpi.expressao || '');
          expressao = resolverExpressaoKpiContadorViagens(kpi, expressao);
          expressao = resolverExpressaoKpiColetoresEquipe(kpi, expressao);
          const expressaoResolvida = resolvePlaceholdersNaFormula(expressao, { colunasServico });
          if (expressaoResolvida !== expressao) expressao = expressaoResolvida;

          let valor: number;

          if (expressao.trim() && dadosNorm.length > 0) {
            const kpiValoresFixos = { ...valoresFixos };
            if (kpi.valoresFixos && typeof kpi.valoresFixos === 'object') {
              for (const [key, value] of Object.entries(kpi.valoresFixos)) {
                if (value !== null && value !== undefined && Number(value) > 0) {
                  kpiValoresFixos[key] = Number(value);
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
                  .map((v: any) => String(v).trim())
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
            id: kpi.id,
            nome: kpi.label || kpi.nome,
            valor: valor !== null ? Math.round(valor * 100) / 100 : null,
            formatado: valor !== null ? formatarValor(valor, kpi.formato || 'numero') : '-',
            formato: kpi.formato || 'numero',
            origem: kpi._origem,
          };
        } catch (err: any) {
          return {
            id: kpi.id, nome: kpi.label || kpi.nome,
            valor: null, formatado: '-',
            formato: kpi.formato || 'numero',
            origem: kpi._origem,
            erro: err.message,
          };
        }
      });

      // ═══════════════════════════════════════════════════════════
      // 9. CONFIG RESUMO (métricas já calculadas dos dados filtrados)
      // ═══════════════════════════════════════════════════════════
      const colPeso = colunasDetectadas.colPeso || '';
      const colKm = colunasDetectadas.colKm || '';
      const colPlaca = colunasDetectadas.colPlaca || '';
      const colNroColetores = colunasDetectadas.colNroColetores || '';
      const divisorProdColetor = metricas.prodColetor > 0 && pesoTotalTon > 0
        ? (colNroColetores ? dadosNorm.reduce((s, d) => s + (Number(encontrarValorColuna(d, colNroColetores)) || 0), 0) : coletoresAtivos)
        : 0;

      const configResumoBase = servico.configDashboard?.configResumo || contract?.configResumo || null;
      const colunasEncontradasResumo: Record<string, { encontrada: boolean; colunaUsada: string; precisaColuna: string[] }> = {
        viagens: { encontrada: true, colunaUsada: '', precisaColuna: [] },
        qtdColetores: { encontrada: colPlaca !== '', colunaUsada: colPlaca, precisaColuna: ['PLACA', 'CAMINHAO'] },
        pesoTotalTon: { encontrada: colPeso !== '', colunaUsada: colPeso, precisaColuna: ['PESO TOTAL'] },
        kmTotal: { encontrada: colKm !== '', colunaUsada: colKm, precisaColuna: ['KM TOTAL'] },
        horasProdutivas: { encontrada: horasProdutivasFinal > 0, colunaUsada: '', precisaColuna: ['HORA SAIDA BASE', 'HORA CHEGADA BASE', 'HORAS FORA UNIDADE'] },
        faturamento: { encontrada: colPeso !== '' && temValor, colunaUsada: colPeso, precisaColuna: ['PESO TOTAL'] },
        tonKm: { encontrada: colPeso !== '' && colKm !== '', colunaUsada: colPeso + '/' + colKm, precisaColuna: ['PESO TOTAL', 'KM TOTAL'] },
        prodColetor: {
          encontrada: colPeso !== '' && divisorProdColetor > 0,
          colunaUsada: colNroColetores !== '' ? colNroColetores : colPlaca,
          precisaColuna: colNroColetores !== '' ? ['PESO TOTAL', 'Nº DE COLETORES'] : ['PESO TOTAL', 'PLACA'],
        },
        kmMedioViagem: { encontrada: colKm !== '', colunaUsada: colKm, precisaColuna: ['KM TOTAL'] },
        tonMediaColeta: { encontrada: colPeso !== '', colunaUsada: colPeso, precisaColuna: ['PESO TOTAL'] },
        receitaKm: { encontrada: colPeso !== '' && colKm !== '' && temValor, colunaUsada: colPeso + '/' + colKm, precisaColuna: ['PESO TOTAL', 'KM TOTAL'] },
        receitaHora: { encontrada: colPeso !== '' && horasProdutivasFinal > 0 && temValor, colunaUsada: colPeso, precisaColuna: ['PESO TOTAL', 'HORA SAIDA BASE', 'HORA CHEGADA BASE'] },
      };

      const configResumoFinal = configResumoBase
        ? { ...configResumoBase, colunasEncontradas: colunasEncontradasResumo }
        : {
            metricasAtivas: Object.entries(colunasEncontradasResumo).filter(([_, v]) => v.encontrada).map(([k]) => k),
            ordem: Object.keys(colunasEncontradasResumo),
            colunasEncontradas: colunasEncontradasResumo,
          };

      const response = {
        kpis: resultadosKpis,
        metrica_executiva: {
          viagens,
          qtdColetores: coletoresAtivos,
          pesoTotalTon,
          kmTotal: Math.round(kmTotal * 100) / 100,
          horasProdutivas: horasProdutivasFinal,
          horasMediaRotas: viagens > 0 ? Math.round((horasProdutivasFinal / viagens) * 100) / 100 : 0,
          faturamento,
          fatPorTipo,
          tonKm,
          prodColetor,
          kmMedioViagem,
          tonMediaColeta,
          receitaKm,
          receitaHora,
          temValor,
        },
        configResumo: configResumoFinal,
      };

      setCache(cacheKey, response);
      return res.json(response);
    } catch (error: any) {
      console.error('Erro ao calcular kpi-valores:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao calcular valores dos KPIs' });
    }
  }

  /**
   * Calcula KPIs de um serviço (reutilizado na comparação por tipo)
   */
  private async calcularKpisParaComparacao(
    contractId: string,
    servico: Servico,
    contract: Contract | null,
    query: Record<string, any>,
    limiteKpis?: number,
    pularAnalisePeso = false,
  ): Promise<{
    id: string;
    nome: string;
    tipo: string;
    totalRegistros: number;
    periodo?: PeriodoCicloContrato;
    kpis: Array<{ nome: string; chave: string; valor: number | null; formatado: string; formato: string }>;
    analisePeso?: AnalisePesoColeta | null;
  }> {
    const cfgFat = servico.configFaturamento;
    const valoresFixos = buildValoresFixosFaturamento(contract, cfgFat?.ativo ? cfgFat : null);

    const kpisContrato: any[] = (contract?.kpisConfig || [])
      .filter((k: any) => k.ativo !== false)
      .map((k: any) => ({ ...k, _origem: 'contrato' }));
    const kpisServico: any[] = (servico.configDashboard?.kpis || [])
      .filter((k: any) => k.ativo !== false)
      .map((k: any) => ({ ...k, _origem: 'servico' }));
    let { kpis: todosKpis } = deduplicarKpisLista([...kpisContrato, ...kpisServico]);

    if (todosKpis.length === 0 && servico.tipo === 'coleta_caminhao') {
      const padrao = buildConfigDashboardPadraoColeta();
      todosKpis = padrao.kpis || [];
    }

    // ⭐ Migração automática: KPIs de Faturamento que usam VALOR_TRUCK diretamente
    for (const kpi of todosKpis) {
      const expr = kpi.expressao || '';
      if (
        /SUM\s*\(\s*PESO\s+TOTAL\s*\)\s*\/\s*1000\s*\*\s*VALOR_TRUCK/i.test(expr) ||
        /SUM\s*\(\s*PESO\s*\)\s*\/\s*1000\s*\*\s*VALOR_TRUCK/i.test(expr)
      ) {
        kpi.expressao = 'FATURAMENTO_EST(PESO TOTAL, TIPO CAMINHAO)';
      }
    }

    if (limiteKpis && limiteKpis > 0 && todosKpis.length > limiteKpis) {
      todosKpis = todosKpis.slice(0, limiteKpis);
    }

    const { filtros: periodoFiltros, periodo } = resolverFiltrosPeriodoQuery(
      query,
      contract?.diaInicioCiclo,
      contractId,
    );

    const filtros: any = {
      dataInicio: periodoFiltros.dataInicio,
      dataFim: periodoFiltros.dataFim,
      placa: query.placa as string | undefined,
      regional: query.regional as string | undefined,
      tipoCaminhao: query.tipoCaminhao as string | undefined,
      uploadId: query.uploadId ? parseInt(query.uploadId as string) : undefined,
    };
    const filtrosDinamicos: Record<string, string> = {};
    for (const [key, value] of Object.entries(query)) {
      if (key.startsWith('filtro_') && typeof value === 'string' && value.trim()) {
        filtrosDinamicos[key.replace('filtro_', '')] = value.trim();
      }
    }
    if (Object.keys(filtrosDinamicos).length > 0) filtros.filtrosDinamicos = filtrosDinamicos;

    const temFiltroExtra = !!(filtros.placa || filtros.regional || filtros.tipoCaminhao || filtros.uploadId
      || (filtros.filtrosDinamicos && Object.keys(filtros.filtrosDinamicos).length));
    const ehRocadaCmp = servico.tipo === TipoServico.ROCADEIRA || servico.tipo === 'rocadeira';
    const ehColetaCmp = servico.tipo === TipoServico.COLETA_CAMINHAO || servico.tipo === 'coleta_caminhao';
    const colunasServico = (servico.padraoPlanilha?.colunas || []).map((c: any) => c.nome);

    // Caminho SQL rápido (sem filtros extras) — escala 600k+
    if (!temFiltroExtra && (ehRocadaCmp || ehColetaCmp)) {
      if (ehRocadaCmp) {
        const metricasRocada = await getMetricasRocadaSql(servico.id, {
          dataInicio: filtros.dataInicio,
          dataFim: filtros.dataFim,
        });
        const kpis = todosKpis.map((kpi: any) => {
          try {
            let expressao = resolvePlaceholdersNaFormula(kpi.expressao || '', { colunasServico });
            let valor = resolverKpiRocadaSql(expressao, metricasRocada, valoresFixos);
            if (valor === null) valor = 0;
            return {
              nome: kpi.label || kpi.nome,
              chave: chaveComparacaoKpi(kpi),
              valor: Math.round(valor * 100) / 100,
              formatado: formatarValor(valor, kpi.formato || 'numero'),
              formato: kpi.formato || 'numero',
            };
          } catch {
            return {
              nome: kpi.label || kpi.nome,
              chave: chaveComparacaoKpi(kpi),
              valor: null,
              formatado: '-',
              formato: kpi.formato || 'numero',
            };
          }
        });
        return {
          id: servico.id,
          nome: servico.nome,
          tipo: servico.tipo,
          totalRegistros: metricasRocada.registros,
          periodo,
          analisePeso: null,
          kpis,
        };
      }

      const metricasColeta = await getMetricasColetaSql(servico.id, {
        dataInicio: filtros.dataInicio,
        dataFim: filtros.dataFim,
      }, valoresFixos);
      const kpis = todosKpis.map((kpi: any) => {
        try {
          let expressao = resolverExpressaoKpiViagensRealizadas(kpi, kpi.expressao || '');
          expressao = resolverExpressaoKpiContadorViagens(kpi, expressao);
          expressao = resolverExpressaoKpiColetoresEquipe(kpi, expressao);
          expressao = resolvePlaceholdersNaFormula(expressao, { colunasServico });
          let valor = resolverKpiColetaSql(expressao, metricasColeta, valoresFixos);
          if (valor === null) {
            const nome = String(kpi.label || kpi.nome || '').toLowerCase();
            if (/viagem/i.test(nome)) valor = metricasColeta.viagens;
            else if (/peso|ton/i.test(nome)) valor = metricasColeta.pesoTotalTon;
            else if (/faturamento|receita/i.test(nome)) valor = metricasColeta.faturamento;
            else valor = 0;
          }
          return {
            nome: kpi.label || kpi.nome,
            chave: chaveComparacaoKpi(kpi),
            valor: Math.round(valor * 100) / 100,
            formatado: formatarValor(valor, kpi.formato || 'numero'),
            formato: kpi.formato || 'numero',
          };
        } catch {
          return {
            nome: kpi.label || kpi.nome,
            chave: chaveComparacaoKpi(kpi),
            valor: null,
            formatado: '-',
            formato: kpi.formato || 'numero',
          };
        }
      });

      // KPIs via SQL; análise de peso ainda precisa das linhas (faixas PESO 1–4, frota, cenário).
      let analisePesoSql: AnalisePesoColeta | null = null;
      if (!pularAnalisePeso) {
        try {
          const dadosBrutos = await obterDadosServicoComCache(servico.id);
          const dadosFiltradosSql = this.aplicarFiltros(dadosBrutos || [], filtros);
          if (dadosFiltradosSql?.length) {
            const dadosNormSql = normalizarDados(dadosFiltradosSql);
            const limitesContratoSql = resolverLimitesDoContrato(contract?.configOperacional);
            analisePesoSql = analisarPesoColeta(dadosNormSql, servico.id, {
              colunaTipoCaminhao: cfgFat?.colunaTipoCaminhao
                || detectarTodasColunas(dadosNormSql, servico.id).colTipo
                || undefined,
              limitesPeso: limitesContratoSql.peso,
              limitesVolume: limitesContratoSql.volume,
              densidadeOtima: normalizarDensidadeResiduoKgL(
                contract?.configOperacional?.densidadeResiduoKgL,
              ),
              densidadeKgL: contract?.configOperacional?.densidadeKgL || null,
              densidadeKgLPorPlaca: contract?.configOperacional?.densidadeKgLPorPlaca || null,
            });
          }
        } catch (errAnalise: any) {
          console.warn('[calcularKpisParaComparacao] analisePeso (SQL path):', errAnalise?.message || errAnalise);
        }
      }

      return {
        id: servico.id,
        nome: servico.nome,
        tipo: servico.tipo,
        totalRegistros: metricasColeta.registros,
        periodo,
        analisePeso: analisePesoSql,
        kpis,
      };
    }

    const dados = await obterDadosServicoComCache(servico.id);
    const dadosFiltrados = this.aplicarFiltros(dados || [], filtros);

    if (!dadosFiltrados?.length) {
      return {
        id: servico.id,
        nome: servico.nome,
        tipo: servico.tipo,
        totalRegistros: 0,
        periodo,
        analisePeso: null,
        kpis: todosKpis.map((k: any) => ({
          nome: k.label || k.nome,
          chave: chaveComparacaoKpi(k),
          valor: null,
          formatado: '-',
          formato: k.formato || 'numero',
        })),
      };
    }

    const dadosNorm = normalizarDados(dadosFiltrados);
    const metricas = calcularMetricaExecutivaDeDados(dadosNorm, valoresFixos, servico.id, cfgFat);
    const { viagens } = metricas;

    const resultadosKpis = todosKpis.map((kpi: any) => {
      try {
        let expressao = resolverExpressaoKpiViagensRealizadas(kpi, kpi.expressao || '');
        expressao = resolverExpressaoKpiContadorViagens(kpi, expressao);
        expressao = resolverExpressaoKpiColetoresEquipe(kpi, expressao);
        const expressaoResolvida = resolvePlaceholdersNaFormula(expressao, { colunasServico });
        if (expressaoResolvida !== expressao) expressao = expressaoResolvida;

        let valor: number;

        if (expressao.trim() && dadosNorm.length > 0) {
          const kpiValoresFixos = { ...valoresFixos };
          if (kpi.valoresFixos && typeof kpi.valoresFixos === 'object') {
            for (const [key, value] of Object.entries(kpi.valoresFixos)) {
              if (value !== null && value !== undefined && Number(value) > 0) {
                kpiValoresFixos[key] = Number(value);
              }
            }
          }
          const resultado = calcularExpressao(expressao, { dados: dadosNorm, valoresFixos: kpiValoresFixos });
          valor = Math.round(resultado.valor * 100) / 100;
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
          nome: kpi.label || kpi.nome,
          chave: chaveComparacaoKpi(kpi),
          valor: valor !== null ? Math.round(valor * 100) / 100 : null,
          formatado: valor !== null ? formatarValor(valor, kpi.formato || 'numero') : '-',
          formato: kpi.formato || 'numero',
        };
      } catch {
        return {
          nome: kpi.label || kpi.nome,
          chave: chaveComparacaoKpi(kpi),
          valor: null,
          formatado: '-',
          formato: kpi.formato || 'numero',
        };
      }
    });

    const limitesContrato = resolverLimitesDoContrato(contract?.configOperacional);
    const analisePeso = !pularAnalisePeso && servico.tipo === 'coleta_caminhao'
      ? analisarPesoColeta(dadosNorm, servico.id, {
          colunaTipoCaminhao: cfgFat?.colunaTipoCaminhao
            || detectarTodasColunas(dadosNorm, servico.id).colTipo
            || undefined,
          limitesPeso: limitesContrato.peso,
          limitesVolume: limitesContrato.volume,
          densidadeOtima: normalizarDensidadeResiduoKgL(
            contract?.configOperacional?.densidadeResiduoKgL,
          ),
          densidadeKgL: contract?.configOperacional?.densidadeKgL || null,
          densidadeKgLPorPlaca: contract?.configOperacional?.densidadeKgLPorPlaca || null,
        })
      : null;

    return {
      id: servico.id,
      nome: servico.nome,
      tipo: servico.tipo,
      totalRegistros: dadosFiltrados.length,
      periodo,
      analisePeso,
      kpis: resultadosKpis,
    };
  }

  /**
   * GET /api/contracts/:contractId/servicos/comparar-por-tipo?tipoServico=coleta_caminhao
   * Compara KPIs entre serviços do mesmo tipo dentro de um contrato
   */
  async getCompararKpisPorTipo(req: Request, res: Response): Promise<any> {
    try {
      const contractId = req.params.contractId as string;
      const tipoServico = req.query.tipoServico as string | undefined;

      if (!tipoServico) {
        return res.status(400).json({ error: 'tipoServico é obrigatório' });
      }
      if (!TIPOS_SERVICO_VALORES.includes(tipoServico)) {
        return res.status(400).json({ error: 'Tipo de serviço inválido' });
      }

      const [contract, servicos] = await Promise.all([
        this.contractRepo.findOne({ where: { id: contractId } }),
        this.repository.find({
          where: { contract_id: contractId, tipo: tipoServico },
          order: { nome: 'ASC' },
        }),
      ]);

      if (!contract) {
        return res.status(404).json({ error: 'Contrato não encontrado' });
      }

      // Inclui volumeL/pesoMaximoKg na chave — senão CAIXA MÉDIA fica stale após salvar limites
      const cacheKey = `comparar-tipo:${contractId}:${tipoServico}:${fingerprintLimitesContrato(contract.configOperacional)}:${JSON.stringify(req.query)}`;
      const cached = getCache<any>(cacheKey);
      if (cached) return res.json(cached);

      const servicosComDados: Servico[] = [];
      const contagens = await PlanilhaService.getContagemRegistrosPorServicos(servicos.map(s => s.id));
      for (const s of servicos) {
        const total = contagens.get(s.id)?.validos ?? contagens.get(s.id)?.total ?? 0;
        if (total > 0) servicosComDados.push(s);
      }

      if (servicosComDados.length === 0) {
        return res.json({
          escopo: 'contrato',
          contratoId: contract.id,
          contratoNome: contract.numeroContrato,
          tipoServico,
          tipoServicoLabel: TIPOS_SERVICO_META[tipoServico]?.label || tipoServico,
          servicos: [],
          kpiLinhas: [],
          insights: [],
          resumo: { totalServicos: 0, totalContratos: 1, totalKpis: 0, kpisComVariacao: 0 },
          mensagem: 'Nenhum serviço deste tipo com dados no contrato',
        });
      }

      const resultados = await mapComLimite(
        servicosComDados,
        ENDPOINTS_PESADOS_CONCURRENCY,
        async s => {
          try {
            const r = await this.calcularKpisParaComparacao(contractId, s, contract, req.query as Record<string, any>);
            return {
              ...r,
              contratoId: contract.id,
              contratoNome: contract.numeroContrato || '-',
            };
          } catch (errServico: any) {
            console.error(
              `[comparar-por-tipo] falhou em "${s.nome}" (${s.id}):`,
              errServico?.message || errServico,
            );
            return {
              id: s.id,
              nome: s.nome,
              tipo: s.tipo,
              totalRegistros: 0,
              periodo: undefined,
              analisePeso: null,
              kpis: [],
              contratoId: contract.id,
              contratoNome: contract.numeroContrato || '-',
            };
          }
        },
      );

      const matriz = this.montarMatrizComparacaoKpis(resultados, {
        incluirAnalisePeso: tipoServico === 'coleta_caminhao',
      });
      const periodo = resultados[0]?.periodo;

      const response = {
        escopo: 'contrato',
        contratoId: contract.id,
        contratoNome: contract.numeroContrato,
        diaInicioCiclo: contract.diaInicioCiclo ?? 1,
        periodo,
        tipoServico,
        tipoServicoLabel: TIPOS_SERVICO_META[tipoServico]?.label || tipoServico,
        ...matriz,
      };

      setCache(cacheKey, response);
      return res.json(response);
    } catch (error: any) {
      console.error('Erro ao comparar KPIs por tipo:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao comparar KPIs por tipo de serviço' });
    }
  }

  /**
   * Monta matriz KPI × serviço com métricas analíticas (min, max, média, variação %)
   */
  private montarMatrizComparacaoKpis(
    resultados: Array<{
      id: string;
      nome: string;
      tipo: string;
      contratoId: string;
      contratoNome: string;
      totalRegistros: number;
      periodo?: PeriodoCicloContrato;
      analisePeso?: AnalisePesoColeta | null;
      kpis: Array<{ nome: string; chave: string; valor: number | null; formatado: string; formato: string }>;
    }>,
    opts?: { incluirAnalisePeso?: boolean },
  ) {
    const kpiOrdem: string[] = [];
    const kpiMeta = new Map<string, { nome: string; formato: string }>();
    const kpiPorServico = new Map<string, Map<string, { valor: number | null; formatado: string; formato: string }>>();

    for (const resultado of resultados) {
      const mapa = new Map<string, { valor: number | null; formatado: string; formato: string }>();
      for (const kpi of resultado.kpis) {
        const chave = kpi.chave || chaveComparacaoKpi({ nome: kpi.nome, label: kpi.nome });
        const existente = mapa.get(chave);
        // Preferir célula com valor numérico quando a mesma chave aparece 2x no serviço
        if (
          !existente ||
          (existente.valor === null && kpi.valor !== null && kpi.valor !== undefined)
        ) {
          mapa.set(chave, { valor: kpi.valor, formatado: kpi.formatado, formato: kpi.formato });
        }
        if (!kpiMeta.has(chave)) {
          kpiMeta.set(chave, { nome: kpi.nome, formato: kpi.formato });
          kpiOrdem.push(chave);
        } else if (kpi.valor !== null && kpi.valor !== undefined && !isNaN(kpi.valor)) {
          const meta = kpiMeta.get(chave)!;
          if (!meta.nome || meta.nome === '-') {
            meta.nome = kpi.nome;
          }
        }
      }
      kpiPorServico.set(resultado.id, mapa);
    }

    const kpiLinhas = kpiOrdem.map(chave => {
      const meta = kpiMeta.get(chave)!;
      const valores: Record<string, { valor: number | null; formatado: string; formato: string }> = {};
      const nums: Array<{ servicoId: string; valor: number }> = [];

      for (const servico of resultados) {
        const celula = kpiPorServico.get(servico.id)?.get(chave);
        valores[servico.id] = celula || { valor: null, formatado: '-', formato: meta.formato };
        if (celula?.valor !== null && celula?.valor !== undefined && !isNaN(celula.valor)) {
          nums.push({ servicoId: servico.id, valor: celula.valor });
        }
      }

      let analise: {
        min: number | null;
        max: number | null;
        media: number | null;
        amplitude: number | null;
        amplitudePct: number | null;
        melhorId: string | null;
        piorId: string | null;
        variacoes: Record<string, { pctVsMelhor: number | null; pctVsMedia: number | null }>;
      } = {
        min: null, max: null, media: null, amplitude: null, amplitudePct: null,
        melhorId: null, piorId: null, variacoes: {},
      };

      if (nums.length >= 2) {
        const valoresNum = nums.map(n => n.valor);
        const min = Math.min(...valoresNum);
        const max = Math.max(...valoresNum);
        const media = valoresNum.reduce((a, b) => a + b, 0) / valoresNum.length;
        const melhorId = nums.find(n => n.valor === max)?.servicoId || null;
        const piorId = nums.find(n => n.valor === min)?.servicoId || null;
        const amplitude = max - min;
        const amplitudePct = media !== 0 ? Math.round((amplitude / Math.abs(media)) * 10000) / 100 : null;

        const variacoes: Record<string, { pctVsMelhor: number | null; pctVsMedia: number | null }> = {};
        for (const n of nums) {
          variacoes[n.servicoId] = {
            pctVsMelhor: max !== 0 ? Math.round(((n.valor - max) / Math.abs(max)) * 10000) / 100 : null,
            pctVsMedia: media !== 0 ? Math.round(((n.valor - media) / Math.abs(media)) * 10000) / 100 : null,
          };
        }

        analise = { min, max, media: Math.round(media * 100) / 100, amplitude, amplitudePct, melhorId, piorId, variacoes };
      }

      return { chave, nome: meta.nome, formato: meta.formato, valores, analise };
    });

    kpiLinhas.sort((a, b) => {
      const aNums = Object.values(a.valores).filter(v => v.valor !== null && v.valor !== undefined).length;
      const bNums = Object.values(b.valores).filter(v => v.valor !== null && v.valor !== undefined).length;
      const aComp = aNums >= 2 ? 1 : 0;
      const bComp = bNums >= 2 ? 1 : 0;
      if (bComp !== aComp) return bComp - aComp;
      const aAmp = a.analise?.amplitudePct ?? 0;
      const bAmp = b.analise?.amplitudePct ?? 0;
      if (bAmp !== aAmp) return bAmp - aAmp;
      return a.nome.localeCompare(b.nome, 'pt-BR');
    });

    const incluirPeso = opts?.incluirAnalisePeso === true
      && resultados.some(r => r.analisePeso);
    const kpiLinhasOnly = kpiLinhas;

    const insights = kpiLinhasOnly
      .filter(l => !l.chave.startsWith('peso:') && l.analise.amplitudePct !== null && l.analise.amplitudePct > 0)
      .sort((a, b) => (b.analise.amplitudePct || 0) - (a.analise.amplitudePct || 0))
      .slice(0, 6)
      .map(l => {
        const melhor = resultados.find(r => r.id === l.analise.melhorId);
        const pior = resultados.find(r => r.id === l.analise.piorId);
        return {
          kpi: l.nome,
          amplitudePct: l.analise.amplitudePct,
          melhorServico: melhor?.nome,
          melhorContrato: melhor?.contratoNome,
          piorServico: pior?.nome,
          piorContrato: pior?.contratoNome,
          melhorValor: l.analise.melhorId ? l.valores[l.analise.melhorId]?.formatado : '-',
          piorValor: l.analise.piorId ? l.valores[l.analise.piorId]?.formatado : '-',
        };
      });

    return {
      servicos: resultados.map(r => ({
        id: r.id,
        nome: r.nome,
        tipo: r.tipo,
        contratoId: r.contratoId,
        contratoNome: r.contratoNome,
        totalRegistros: r.totalRegistros,
        periodo: r.periodo,
        analisePeso: r.analisePeso ?? null,
      })),
      kpiLinhas: kpiLinhasOnly,
      insights,
      resumo: {
        totalServicos: resultados.length,
        totalContratos: new Set(resultados.map(r => r.contratoId)).size,
        totalKpis: kpiLinhasOnly.length,
        kpisComVariacao: insights.length,
        temAnalisePeso: incluirPeso,
      },
    };
  }

  /**
   * GET /api/dashboard/servicos-por-tipo?tipoServico=coleta_caminhao
   * Lista serviços de um tipo em todos os contratos (para seleção na comparação)
   */
  async listarServicosPorTipoGlobal(req: Request, res: Response): Promise<any> {
    try {
      const tipoServico = req.query.tipoServico as string | undefined;
      if (!tipoServico) {
        return res.status(400).json({ error: 'tipoServico é obrigatório' });
      }

      const partes = ehHubDeContratos(req.usuario)
        ? await emCadaContrato(() => this.montarServicosPorTipo(tipoServico))
        : [await this.montarServicosPorTipo(tipoServico)];

      const lista = partes.flatMap((p) => p.lista);
      const tiposDisponiveis = [...new Set(partes.flatMap((p) => p.tipos))].sort();

      return res.json({
        tipoServico,
        tipoServicoLabel: TIPOS_SERVICO_META[tipoServico]?.label || tipoServico,
        servicos: lista,
        tiposDisponiveis: tiposDisponiveis.map(t => ({
          tipo: t,
          label: TIPOS_SERVICO_META[t]?.label || t,
        })),
      });
    } catch (error: any) {
      console.error('Erro ao listar servicos por tipo:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao listar serviços por tipo' });
    }
  }

  /** Serviços de um tipo, com contagem, no banco atualmente ativo. */
  private async montarServicosPorTipo(tipoServico: string): Promise<{
    lista: any[];
    tipos: string[];
  }> {
    const servicos = await this.repository.find({
      where: { tipo: tipoServico },
      order: { nome: 'ASC' },
    });

    const contractIds = [...new Set(servicos.map(s => s.contract_id))];
    const contracts = contractIds.length
      ? await this.contractRepo.find({ where: { id: In(contractIds) } })
      : [];
    const contractMap = new Map(contracts.map(c => [c.id, c]));

    const lista: any[] = [];
    for (const s of servicos) {
      const total = await PlanilhaService.getTotalRegistrosPorServico(s.id);
      if (total === 0) continue;
      const contract = contractMap.get(s.contract_id);
      lista.push({
        id: s.id,
        nome: s.nome,
        tipo: s.tipo,
        contratoId: s.contract_id,
        contratoNome: contract?.numeroContrato || '-',
        totalRegistros: total,
        temKpis: !!(s.configDashboard?.kpis?.length),
      });
    }

    const tipos = [...new Set(
      (await this.repository.find({ select: ['tipo'] }))
        .map(s => s.tipo)
        .filter(Boolean),
    )];

    return { lista, tipos };
  }

  /**
   * GET /api/dashboard/comparar-por-tipo?tipoServico=coleta_caminhao&servicoIds=id1,id2
   * Compara KPIs entre serviços do mesmo tipo — inclusive entre contratos diferentes
   * perfil=tv → payload leve (sem análise de peso, poucos KPIs) para wallboard
   */
  async getCompararKpisGlobal(req: Request, res: Response): Promise<any> {
    try {
      const tipoServico = req.query.tipoServico as string | undefined;
      const servicoIdsParam = req.query.servicoIds as string | undefined;
      const perfilTv = String(req.query.perfil || '').toLowerCase() === 'tv';
      const limiteKpisTv = perfilTv ? 8 : undefined;

      if (!tipoServico) {
        return res.status(400).json({ error: 'tipoServico é obrigatório' });
      }
      if (!TIPOS_SERVICO_VALORES.includes(tipoServico)) {
        return res.status(400).json({ error: 'Tipo de serviço inválido' });
      }

      const servicoIds = servicoIdsParam
        ? servicoIdsParam.split(',').map(s => s.trim()).filter(Boolean)
        : [];

      const hub = ehHubDeContratos(req.usuario);

      // Passada leve: quantos serviços existem e qual a impressão dos limites (chave de cache)
      const inventarios = hub
        ? await emCadaContrato(() => this.inventarioComparacao(tipoServico, servicoIds))
        : [await this.inventarioComparacao(tipoServico, servicoIds)];

      const totalServicos = inventarios.reduce((s, i) => s + i.nServicos, 0);
      if (servicoIds.length > 0 && totalServicos < 2) {
        return res.status(400).json({ error: 'Selecione pelo menos 2 serviços do mesmo tipo para comparar' });
      }

      const limitesFp = inventarios.flatMap(i => i.limitesFp).sort().join('|');
      const cacheKey = `comparar-global:${escopoCacheTenant()}:${tipoServico}:${servicoIds.join('|')}:${limitesFp}:${JSON.stringify(req.query)}`;
      const cached = getCache<any>(cacheKey);
      if (cached) return res.json(cached);

      const resultados = hub
        ? (await emCadaContrato(() => this.resultadosComparacao(
            tipoServico, servicoIds, req.query as Record<string, any>, limiteKpisTv, perfilTv,
          ))).flat()
        : await this.resultadosComparacao(
            tipoServico, servicoIds, req.query as Record<string, any>, limiteKpisTv, perfilTv,
          );

      if (resultados.length < 2) {
        return res.json({
          escopo: 'global',
          tipoServico,
          tipoServicoLabel: TIPOS_SERVICO_META[tipoServico]?.label || tipoServico,
          perfil: perfilTv ? 'tv' : undefined,
          servicos: [],
          kpiLinhas: [],
          insights: [],
          resumo: { totalServicos: 0, totalContratos: 0, totalKpis: 0, kpisComVariacao: 0 },
          mensagem: 'Selecione pelo menos 2 serviços do mesmo tipo com dados importados',
        });
      }

      const matriz = this.montarMatrizComparacaoKpis(resultados, {
        incluirAnalisePeso: !perfilTv && tipoServico === 'coleta_caminhao',
      });
      const periodosUnicos = new Map(
        resultados
          .filter(r => r.periodo)
          .map(r => [`${r.periodo!.dataInicio}|${r.periodo!.dataFim}`, r.periodo!]),
      );

      const response = {
        escopo: 'global',
        tipoServico,
        perfil: perfilTv ? 'tv' : undefined,
        mesReferencia: req.query.mesReferencia ? parseInt(String(req.query.mesReferencia), 10) : undefined,
        anoReferencia: req.query.anoReferencia ? parseInt(String(req.query.anoReferencia), 10) : undefined,
        periodosDistintos: periodosUnicos.size > 1,
        periodo: periodosUnicos.size === 1 ? [...periodosUnicos.values()][0] : undefined,
        tipoServicoLabel: TIPOS_SERVICO_META[tipoServico]?.label || tipoServico,
        ...matriz,
      };

      setCache(cacheKey, response);
      return res.json(response);
    } catch (error: any) {
      console.error('Erro ao comparar KPIs global:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao comparar KPIs entre serviços' });
    }
  }

  /** Passada leve no banco ativo: quantos serviços e a impressão dos limites dos contratos. */
  private async inventarioComparacao(
    tipoServico: string,
    servicoIds: string[],
  ): Promise<{ nServicos: number; limitesFp: string[] }> {
    const servicos = await this.repository.find({
      where: servicoIds.length > 0
        ? { id: In(servicoIds), tipo: tipoServico }
        : { tipo: tipoServico },
      select: ['id', 'contract_id'],
    });
    const contractIds = [...new Set(servicos.map(s => s.contract_id))];
    const contracts = contractIds.length
      ? await this.contractRepo.find({ where: { id: In(contractIds) } })
      : [];
    return {
      nServicos: servicos.length,
      limitesFp: contracts.map(c => `${c.id}:${fingerprintLimitesContrato(c.configOperacional)}`),
    };
  }

  /** KPIs de comparação dos serviços com dados no banco ativo. */
  private async resultadosComparacao(
    tipoServico: string,
    servicoIds: string[],
    query: Record<string, any>,
    limiteKpisTv: number | undefined,
    perfilTv: boolean,
  ): Promise<any[]> {
    const servicos = await this.repository.find({
      where: servicoIds.length > 0
        ? { id: In(servicoIds), tipo: tipoServico }
        : { tipo: tipoServico },
      order: { nome: 'ASC' },
    });
    if (servicos.length === 0) return [];

    const contractIds = [...new Set(servicos.map(s => s.contract_id))];
    const contracts = contractIds.length
      ? await this.contractRepo.find({ where: { id: In(contractIds) } })
      : [];
    const contractMap = new Map(contracts.map(c => [c.id, c]));

    const contagens = await PlanilhaService.getContagemRegistrosPorServicos(servicos.map(s => s.id));
    const servicosComDados = servicos.filter((s) => {
      const c = contagens.get(s.id);
      return (c?.validos ?? c?.total ?? 0) > 0;
    });
    if (servicosComDados.length === 0) return [];

    return mapComLimite(
      servicosComDados,
      ENDPOINTS_PESADOS_CONCURRENCY,
      async s => {
        const contract = contractMap.get(s.contract_id) || null;
        try {
          const r = await this.calcularKpisParaComparacao(
            s.contract_id,
            s,
            contract,
            query,
            limiteKpisTv,
            perfilTv,
          );
          return {
            ...r,
            contratoId: s.contract_id,
            contratoNome: contract?.numeroContrato || '-',
          };
        } catch (errServico: any) {
          console.error(
            `[comparar-por-tipo] falhou em "${s.nome}" (${s.id}):`,
            errServico?.message || errServico,
          );
          return {
            id: s.id,
            nome: s.nome,
            tipo: s.tipo,
            totalRegistros: 0,
            periodo: undefined,
            analisePeso: null,
            kpis: [],
            contratoId: s.contract_id,
            contratoNome: contract?.numeroContrato || '-',
          };
        }
      },
    );
  }

  /**
   * GET /api/dashboard/qualidade-ideal-3d?tipoServico=coleta_caminhao&servicoIds=...&dataInicio&dataFim
   * Pontos agregados (dia × rota) para scatter 3D no TV Mode.
   */
  async getQualidadeIdeal3d(req: Request, res: Response): Promise<any> {
    try {
      const tipoServico = String(req.query.tipoServico || TipoServico.COLETA_CAMINHAO);
      if (tipoServico !== TipoServico.COLETA_CAMINHAO && tipoServico !== 'coleta_caminhao') {
        return res.status(400).json({ error: 'Disponível apenas para coleta_caminhao' });
      }

      const servicoIds = String(req.query.servicoIds || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const dataInicio = String(req.query.dataInicio || '');
      const dataFim = String(req.query.dataFim || '');

      if (!servicoIds.length) {
        return res.status(400).json({ error: 'servicoIds é obrigatório' });
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dataInicio) || !/^\d{4}-\d{2}-\d{2}$/.test(dataFim)) {
        return res.status(400).json({ error: 'dataInicio e dataFim (yyyy-MM-dd) são obrigatórios' });
      }

      const cacheKey = [
        'qualidade-3d', escopoCacheTenant(), servicoIds.join('|'), dataInicio, dataFim,
      ].join(':');
      const cached = getCache<any>(cacheKey);
      if (cached) return res.json(cached);

      const { agregarQualidadeIdeal3d } = await import('../services/qualidadeIdeal3dService');
      const result = ehHubDeContratos(req.usuario)
        ? await this.qualidade3dEmTodosOsContratos(servicoIds, dataInicio, dataFim)
        : await agregarQualidadeIdeal3d({ servicoIds, dataInicio, dataFim });
      const response = {
        tipoServico: 'coleta_caminhao',
        tipoServicoLabel: TIPOS_SERVICO_META.coleta_caminhao?.label || 'Coleta com caminhão',
        ...result,
      };
      setCache(cacheKey, response);
      return res.json(response);
    } catch (error: any) {
      console.error('Erro qualidade-ideal-3d:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao agregar qualidade vs ideal 3D' });
    }
  }

  /**
   * GET /api/dashboard/evolucao-operacional?servicoIds=...&dataInicio&dataFim
   * Séries diárias: peso ideal + tempo TOCO/TRUCADO/MINI + velocidade + km/t + HR/t.
   */
  async getEvolucaoOperacional(req: Request, res: Response): Promise<any> {
    try {
      const tipoServico = String(req.query.tipoServico || TipoServico.COLETA_CAMINHAO);
      if (tipoServico !== TipoServico.COLETA_CAMINHAO && tipoServico !== 'coleta_caminhao') {
        return res.status(400).json({ error: 'Disponível apenas para coleta_caminhao' });
      }

      const servicoIds = String(req.query.servicoIds || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const dataInicio = String(req.query.dataInicio || '');
      const dataFim = String(req.query.dataFim || '');

      if (!servicoIds.length) {
        return res.status(400).json({ error: 'servicoIds é obrigatório' });
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dataInicio) || !/^\d{4}-\d{2}-\d{2}$/.test(dataFim)) {
        return res.status(400).json({ error: 'dataInicio e dataFim (yyyy-MM-dd) são obrigatórios' });
      }

      const cacheKey = [
        'evolucao-operacional', escopoCacheTenant(), servicoIds.join('|'), dataInicio, dataFim,
      ].join(':');
      const cached = getCache<any>(cacheKey);
      if (cached) return res.json(cached);

      const { agregarEvolucaoOperacional } = await import('../services/evolucaoOperacionalService');
      const result = ehHubDeContratos(req.usuario)
        ? await this.evolucaoEmTodosOsContratos(servicoIds, dataInicio, dataFim)
        : await agregarEvolucaoOperacional({ servicoIds, dataInicio, dataFim });
      const response = {
        tipoServico: 'coleta_caminhao',
        tipoServicoLabel: TIPOS_SERVICO_META.coleta_caminhao?.label || 'Coleta com caminhão',
        ...result,
      };
      setCache(cacheKey, response);
      return res.json(response);
    } catch (error: any) {
      console.error('Erro evolucao-operacional:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao agregar evolução operacional' });
    }
  }

  /** Junta os pontos 3D vindos do banco de cada contrato. */
  private async qualidade3dEmTodosOsContratos(
    servicoIds: string[],
    dataInicio: string,
    dataFim: string,
  ) {
    const { agregarQualidadeIdeal3d } = await import('../services/qualidadeIdeal3dService');
    const partes = await emCadaContratoComServicos(servicoIds, (ids) =>
      agregarQualidadeIdeal3d({ servicoIds: ids, dataInicio, dataFim }),
    );
    return {
      dataInicio,
      dataFim,
      totalPontos: partes.reduce((s, p) => s + p.totalPontos, 0),
      totalViagens: partes.reduce((s, p) => s + p.totalViagens, 0),
      rotas: [...new Set(partes.flatMap((p) => p.rotas))].sort(),
      dias: unirDias(partes.map((p) => p.dias)),
      pontos: partes.flatMap((p) => p.pontos),
    };
  }

  /** Junta as séries de evolução vindas do banco de cada contrato. */
  private async evolucaoEmTodosOsContratos(
    servicoIds: string[],
    dataInicio: string,
    dataFim: string,
  ) {
    const { agregarEvolucaoOperacional } = await import('../services/evolucaoOperacionalService');
    const partes = await emCadaContratoComServicos(servicoIds, (ids) =>
      agregarEvolucaoOperacional({ servicoIds: ids, dataInicio, dataFim }),
    );
    const base = partes[0];
    return {
      ...(base || {}),
      dataInicio,
      dataFim,
      dias: unirDias(partes.map((p) => p.dias)),
      series: partes.flatMap((p) => p.series),
    };
  }

  /**
   * GET /api/contracts/:contractId/servicos/:id/kpi-exec-metrics
   * Retorna metricas executivas (tonelagem, KM, horas, faturamento, receita/km, etc.)
   * Calculadas pelo backend usando FormulaEngine
   */
  async getExecMetrics(req: Request, res: Response): Promise<any> {
    try {
      const id = req.params.id as string;
      const contractId = req.params.contractId as string;

      const filtros: any = {
        dataInicio: req.query.dataInicio as string | undefined,
        dataFim: req.query.dataFim as string | undefined,
        placa: req.query.placa as string | undefined,
        regional: req.query.regional as string | undefined,
        tipoCaminhao: req.query.tipoCaminhao as string | undefined,
        uploadId: req.query.uploadId ? parseInt(req.query.uploadId as string) : undefined,
      };
      const filtrosDinamicos: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.query)) {
        if (key.startsWith('filtro_') && typeof value === 'string' && value.trim()) {
          filtrosDinamicos[key.replace('filtro_', '')] = value.trim();
        }
      }
      if (Object.keys(filtrosDinamicos).length > 0) filtros.filtrosDinamicos = filtrosDinamicos;

      const [servicoEC, contract] = await Promise.all([
        this.repository.findOne({ where: { id } }),
        this.contractRepo.findOne({ where: { id: contractId } }),
      ]);

      const cfgFat = servicoEC?.configFaturamento;
      const valoresFixos = buildValoresFixosFaturamento(contract, cfgFat?.ativo ? cfgFat : null);
      const temValor = Object.keys(valoresFixos).length > 0;
      const temFiltroExtra = !!(filtros.placa || filtros.regional || filtros.tipoCaminhao || filtros.uploadId
        || Object.keys(filtrosDinamicos).length);
      const ehColeta = servicoEC?.tipo === TipoServico.COLETA_CAMINHAO || servicoEC?.tipo === 'coleta_caminhao';
      const ehRocada = servicoEC?.tipo === TipoServico.ROCADEIRA || servicoEC?.tipo === 'rocadeira';

      if (!temFiltroExtra && ehColeta) {
        const m = await getMetricasColetaSql(id, {
          dataInicio: filtros.dataInicio,
          dataFim: filtros.dataFim,
        }, valoresFixos);
        return res.json({
          ...metricaExecutivaDeColetaSql(m, temValor),
          coletoresList: [],
          modo: 'coleta-sql',
        });
      }
      if (!temFiltroExtra && ehRocada) {
        const m = await getMetricasRocadaSql(id, {
          dataInicio: filtros.dataInicio,
          dataFim: filtros.dataFim,
        });
        const fat = calcularFaturamentoRocadaPorAreas(
          {
            manual: m.areaManualM2,
            mecanizada: m.areaMecanizadaM2,
            desconhecido: m.areaDesconhecidaM2,
          },
          valoresFixos,
        );
        return res.json({
          viagens: m.registros, qtdColetores: m.operadores, pesoTotalTon: 0, kmTotal: 0,
          horasProdutivas: 0, horasMediaRotas: 0, faturamento: Math.round(fat * 100) / 100,
          fatPorTipo: {}, tonKm: 0, prodColetor: 0, kmMedioViagem: 0, tonMediaColeta: 0,
          receitaKm: 0, receitaHora: 0, temValor: fat > 0 || Number(valoresFixos.VALOR_M2 || 0) > 0
            || Number(valoresFixos.VALOR_M2_MANUAL || 0) > 0
            || Number(valoresFixos.VALOR_M2_MECANIZADA || 0) > 0,
          coletoresList: [], areaM2: m.areaM2, modo: 'rocada-sql',
        });
      }

      const dados = await obterDadosServicoComCache(id, LIMITE_DADOS_MAX);
      const dadosFiltrados = this.aplicarFiltros(dados || [], filtros);

      if (!dadosFiltrados || dadosFiltrados.length === 0) {
        return res.json({
          viagens: 0, qtdColetores: 0, pesoTotalTon: 0, kmTotal: 0,
          horasProdutivas: 0, faturamento: 0, fatPorTipo: {},
          tonKm: 0, prodColetor: 0, kmMedioViagem: 0, tonMediaColeta: 0,
          receitaKm: 0, receitaHora: 0, temValor: false, coletoresList: [],
        });
      }

      const dadosNorm = normalizarDados(dadosFiltrados);
      const metricas = calcularMetricaExecutivaDeDados(dadosNorm, valoresFixos, id, cfgFat);

      const colPlaca = metricas.colunasDetectadas.colPlaca;
      const coletoresList = Array.from(new Set(
        dadosNorm
          .map(d => encontrarValorColuna(d, colPlaca))
          .filter(v => v !== undefined && v !== null && v !== '')
          .map(v => String(v).trim()),
      )).sort();

      return res.json({
        viagens: metricas.viagens,
        qtdColetores: metricas.qtdColetores,
        pesoTotalTon: metricas.pesoTotalTon,
        kmTotal: metricas.kmTotal,
        horasProdutivas: metricas.horasProdutivas,
        horasMediaRotas: metricas.viagens > 0
          ? Math.round((metricas.horasProdutivas / metricas.viagens) * 100) / 100
          : 0,
        faturamento: metricas.faturamento,
        fatPorTipo: metricas.fatPorTipo,
        tonKm: metricas.tonKm,
        prodColetor: metricas.prodColetor,
        kmMedioViagem: metricas.kmMedioViagem,
        tonMediaColeta: metricas.tonMediaColeta,
        receitaKm: metricas.receitaKm,
        receitaHora: metricas.receitaHora,
        temValor: metricas.temValor,
        coletoresList,
      });
    } catch (error: any) {
      console.error('Erro ao calcular exec metrics:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao calcular metricas executivas' });
    }
  }

  /**
   * POST /api/contracts/:contractId/servicos/:id/kpi-calculate
   * Calcula multiplos KPIs de uma vez no backend com suporte a debug
   * Body: { kpis: [{ expressao?, agregacao?, coluna?, formato?, valoresFixos? }], debug?: boolean }
   */
  async calculateKpis(req: Request, res: Response): Promise<any> {
    try {
      const id = req.params.id as string;
      const contractId = req.params.contractId as string;
      const { kpis: kpisBody, debug = false } = req.body;

      if (!kpisBody || !Array.isArray(kpisBody) || kpisBody.length === 0) {
        return res.status(400).json({ error: 'Lista de KPIs e obrigatoria' });
      }

      const dados = await obterDadosServicoComCache(id, LIMITE_DADOS_MAX);
      const [contract, servico] = await Promise.all([
        this.contractRepo.findOne({ where: { id: contractId } }),
        this.repository.findOne({ where: { id } }),
      ]);

      if (!dados || dados.length === 0) {
        return res.json({
          resultados: kpisBody.map(() => ({ valor: null, formatado: null, erro: 'Nenhum dado disponivel' })),
          totalRegistros: 0,
        });
      }

      const valoresFixosContrato = buildValoresFixosFaturamento(contract, servico?.configFaturamento);

      const dadosNorm = normalizarDados(dados);

      const resultados = kpisBody.map((kpi: any) => {
        try {
          // Merge valores fixos
          const todosValoresFixos = { ...valoresFixosContrato, ...(kpi.valoresFixos || {}) };

          let expressaoKpi = resolverExpressaoKpiViagensRealizadas(kpi, kpi.expressao || '');
          expressaoKpi = resolverExpressaoKpiContadorViagens(kpi, expressaoKpi);
          expressaoKpi = resolverExpressaoKpiColetoresEquipe(kpi, expressaoKpi);
          if (expressaoKpi && expressaoKpi.trim()) {
            // KPI com formula > usa FormulaEngine completo
            const resultado = calcularExpressao(expressaoKpi, {
              dados: dadosNorm,
              valoresFixos: todosValoresFixos,
              debug: debug,
            });

            return {
              valor: Math.round(resultado.valor * 100) / 100,
              formatado: resultado.valor !== 0
                ? formatarValor(resultado.valor, kpi.formato || 'numero')
                : '0',
              ...(debug ? { debug: resultado.debug } : {}),
            };
          }

          // KPI com agregacao simples
          const coluna = kpi.coluna || kpi.nome || '';
          if (!coluna) {
            return { valor: null, formatado: null, erro: 'Coluna nao especificada' };
          }

          const valores = dadosNorm
            .map(d => Number(encontrarValorColuna(d, coluna)))
            .filter(n => !isNaN(n));

          if (valores.length === 0) {
            return { valor: 0, formatado: '0' };
          }

          let valorBase = 0;
          switch (kpi.agregacao) {
            case 'sum': valorBase = valores.reduce((a: number, b: number) => a + b, 0); break;
            case 'avg': valorBase = valores.reduce((a: number, b: number) => a + b, 0) / valores.length; break;
            case 'min': valorBase = Math.min(...valores); break;
            case 'max': valorBase = Math.max(...valores); break;
            case 'count': valorBase = valores.length; break;
            default: valorBase = valores.reduce((a: number, b: number) => a + b, 0);
          }

          return {
            valor: Math.round(valorBase * 100) / 100,
            formatado: formatarValor(valorBase, kpi.formato || 'numero'),
          };
        } catch (err: any) {
          return { valor: null, formatado: null, erro: err.message || 'Erro no calculo' };
        }
      });

      return res.json({ resultados, totalRegistros: dados.length });
    } catch (error: any) {
      console.error('Erro ao calcular KPIs batch:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao calcular KPIs' });
    }
  }

  /**
   * Aplica filtros nos dados brutos antes do cálculo de KPIs
   */
  private aplicarFiltros(dados: Record<string, any>[], filtros: {
    dataInicio?: string;
    dataFim?: string;
    placa?: string;
    regional?: string;
    tipoCaminhao?: string;
    uploadId?: number;
    filtrosDinamicos?: Record<string, string>;
  }): Record<string, any>[] {
    let resultados = [...dados];

    const obterDataLinha = (d: Record<string, any>): Date | null => {
      const candidatosPrioritarios = ['dataSaida', 'DATA SAIDA', 'DATA_SAIDA', 'DATA SAÍDA', 'DATA'];
      for (const nome of candidatosPrioritarios) {
        const val = d[nome] ?? encontrarValorColuna(d, nome);
        if (val !== null && val !== undefined && val !== '') {
          const parsed = parseDataPlanilha(val);
          if (parsed) return parsed;
          const data = val instanceof Date ? val : new Date(val);
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
            const data = val instanceof Date ? val : new Date(val);
            if (!isNaN(data.getTime())) return data;
          }
        }
      }
      return null;
    };

    if (filtros.dataInicio) {
      const inicio = new Date(filtros.dataInicio);
      resultados = resultados.filter(d => {
        const data = obterDataLinha(d);
        return data !== null && data >= inicio;
      });
    }

    if (filtros.dataFim) {
      const fim = new Date(filtros.dataFim);
      fim.setHours(23, 59, 59, 999);
      resultados = resultados.filter(d => {
        const data = obterDataLinha(d);
        return data !== null && data <= fim;
      });
    }

    if (filtros.placa) {
      resultados = resultados.filter(d => {
        for (const chave of Object.keys(d)) {
          const chaveNorm = normalizarChaveColuna(chave);
          if (chaveNorm.includes('PLACA') || chaveNorm.includes('VEICULO')) {
            if (valorCorrespondeFiltro(d[chave], filtros.placa!)) return true;
          }
        }
        return false;
      });
    }

    if (filtros.regional) {
      resultados = resultados.filter(d => {
        for (const chave of Object.keys(d)) {
          const chaveNorm = normalizarChaveColuna(chave);
          if (chaveNorm.includes('REGIONAL') || chaveNorm.includes('REGIAO')) {
            if (valorCorrespondeFiltro(d[chave], filtros.regional!)) return true;
          }
        }
        return false;
      });
    }

    if (filtros.tipoCaminhao) {
      resultados = resultados.filter(d => {
        for (const chave of Object.keys(d)) {
          const chaveNorm = normalizarChaveColuna(chave);
          if (chaveNorm.includes('TIPO') && chaveNorm.includes('CAMINHAO')) {
            if (valorCorrespondeFiltro(d[chave], filtros.tipoCaminhao!)) return true;
          }
        }
        return false;
      });
    }

    if (filtros.filtrosDinamicos && Object.keys(filtros.filtrosDinamicos).length > 0) {
      for (const [nomeColuna, valorFiltro] of Object.entries(filtros.filtrosDinamicos)) {
        if (!valorFiltro) continue;
        resultados = resultados.filter(d => {
          let valorDado: any = d[nomeColuna];
          if (valorDado === undefined || valorDado === null) {
            const nomeColunaNorm = normalizarChaveColuna(nomeColuna);
            for (const [k, v] of Object.entries(d)) {
              if (normalizarChaveColuna(k) === nomeColunaNorm) {
                valorDado = v;
                break;
              }
            }
          }
          if (valorDado === undefined || valorDado === null || valorDado === '') return false;
          return valorCorrespondeFiltro(valorDado, valorFiltro);
        });
      }
    }

    return resultados;
  }

  /**
   * GET /api/dashboard/diagnostico-servicos
   * Audita todos os serviços e explica por que o dashboard pode estar vazio.
   */
  async getDiagnosticoTodosServicos(req: Request, res: Response): Promise<any> {
    try {
      const cacheKey = `diagnostico-servicos:${escopoCacheTenant()}`;
      const cached = getCache<any>(cacheKey);
      if (cached) return res.json(cached);

      const partes = ehHubDeContratos(req.usuario)
        ? await emCadaContrato(() => this.montarDiagnosticoServicos())
        : [await this.montarDiagnosticoServicos()];
      const itens = partes.flat();

      const response = {
        total: itens.length,
        resumo: {
          ok: itens.filter(i => i.status === 'ok').length,
          alerta: itens.filter(i => i.status === 'alerta').length,
          parcial: itens.filter(i => i.status === 'parcial').length,
          vazio: itens.filter(i => i.status === 'vazio').length,
        },
        servicos: itens,
      };
      setCache(cacheKey, response);
      return res.json(response);
    } catch (error: any) {
      console.error('Erro no diagnostico-servicos:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao gerar diagnóstico dos dashboards' });
    }
  }

  /** Diagnóstico dos serviços do banco ativo. */
  private async montarDiagnosticoServicos(): Promise<any[]> {
    try {
      const [contratos, todosServicos] = await Promise.all([
        this.contractRepo.find({ order: { numeroContrato: 'ASC' } }),
        this.repository.find({ order: { nome: 'ASC' } }),
      ]);
      const contractMap = new Map(contratos.map(c => [c.id, c]));
      const servicos = todosServicos.filter(s => contractMap.has(s.contract_id));
      const ids = servicos.map(s => s.id);

      const [contagens, ultimosUploads, uploadsPorServico] = await Promise.all([
        ids.length ? PlanilhaService.getContagemRegistrosPorServicos(ids) : Promise.resolve(new Map()),
        ids.length ? PlanilhaService.getUltimosUploadsPorServicos(ids) : Promise.resolve(new Map()),
        ids.length
          ? this.uploadRepo.find({ where: { servico_id: In(ids) }, select: ['id', 'servico_id', 'nomeArquivo', 'linhasImportadas', 'criadoEm', 'urlDownload'] })
          : Promise.resolve([]),
      ]);

      const uploadsMap = new Map<string, PlanilhaUpload[]>();
      for (const u of uploadsPorServico) {
        if (!u.servico_id) continue;
        const lista = uploadsMap.get(u.servico_id) || [];
        lista.push(u);
        uploadsMap.set(u.servico_id, lista);
      }

      const itens = await mapComLimite(servicos, ENDPOINTS_PESADOS_CONCURRENCY, async (servico) => {
        const contract = contractMap.get(servico.contract_id)!;
        const cont = contagens.get(servico.id) || { total: 0, validos: 0 };
        const nColunas = servico.padraoPlanilha?.colunas?.length ?? 0;
        const kpisCfg = (servico.configDashboard?.kpis || []).filter((k: any) => k.ativo !== false);
        const grafCfg = (servico.configDashboard?.graficos || []).filter((g: any) => g.ativo !== false);
        const uploads = uploadsMap.get(servico.id) || [];
        const motivos: string[] = [];
        const acoes: string[] = [];

        if (uploads.length === 0) {
          motivos.push('Nenhum upload vinculado a este serviço (servico_id ausente no envio da planilha).');
          acoes.push('Faça upload pela aba Dados do serviço, não pelo contrato genérico.');
        }
        if (cont.total === 0 && uploads.length > 0) {
          motivos.push('Upload existe mas nenhum registro foi importado (planilha vazia ou erro na importação).');
        }
        if (cont.total > 0 && cont.validos === 0) {
          motivos.push('Registros importados, mas nenhum passou na validação (data, KM Total e Peso Total obrigatórios).');
          acoes.push('Revise o relatório de qualidade / inconsistências de viagens.');
        }
        if (nColunas === 0 && cont.total > 0) {
          motivos.push('Dados no banco, mas padrão de colunas (padraoPlanilha) não foi salvo — Visão Geral pode ocultar o serviço.');
          acoes.push('Abra o serviço uma vez ou reenvie a planilha pelo fluxo do serviço.');
        }
        if (kpisCfg.length === 0 && servico.tipo !== TipoServico.COLETA_CAMINHAO) {
          motivos.push('Nenhum KPI ativo na configuração do dashboard.');
          acoes.push('Aplique o Modelo Executivo ou configure indicadores.');
        }

        let viagensKpi: string | null = null;
        let kpisComValor = 0;
        if (cont.validos > 0) {
          try {
            const kpiResp = await this.calcularKpisParaComparacao(contract.id, servico, contract, {}, 20);
            kpisComValor = kpiResp.kpis.filter(k => k.valor != null && k.valor > 0).length;
            viagensKpi = kpiResp.kpis.find(k => /viagens/i.test(k.nome))?.formatado ?? null;
            if (kpisComValor === 0) {
              motivos.push('Dados válidos existem, mas fórmulas dos KPIs não retornaram valores (colunas não encontradas).');
              acoes.push('Reaplique gráficos/KPIs padrão ou re-resolva placeholders na configuração.');
            }
          } catch {
            motivos.push('Erro ao calcular KPIs para diagnóstico.');
          }
        }

        const status = motivos.length === 0 && cont.validos > 0 && kpisComValor > 0
          ? 'ok'
          : cont.validos > 0 && kpisComValor > 0
            ? 'alerta'
            : cont.total > 0
              ? 'parcial'
              : 'vazio';

        return {
          contratoId: contract.id,
          contratoNome: contract.numeroContrato,
          servicoId: servico.id,
          servicoNome: servico.nome,
          tipo: servico.tipo,
          status,
          uploads: uploads.length,
          colunasDetectadas: nColunas,
          registrosTotal: cont.total,
          registrosValidos: cont.validos,
          kpisAtivos: kpisCfg.length,
          graficosAtivos: grafCfg.length,
          kpisComValor,
          viagensKpi,
          ultimoUpload: ultimosUploads.get(servico.id)?.toISOString() ?? null,
          motivos,
          acoes,
        };
      });

      return itens;
    } catch (error: any) {
      console.error('Erro no diagnóstico do banco ativo:', error?.message || error);
      return [];
    }
  }

  /**
   * GET /api/dashboard/kpis-consolidado
   * Calcula KPIs reais por serviço (mesma engine de kpi-valores / comparar por tipo)
   */
  async getKpisConsolidado(req: Request, res: Response): Promise<any> {
    try {
      const modo = (req.query.modo as string) || 'completo';
      const cacheKey = `kpis-consolidado:${escopoCacheTenant()}:${modo}:${JSON.stringify(req.query)}`;
      const cached = getCache<any>(cacheKey);
      if (cached) return res.json(cached);

      const partes = ehHubDeContratos(req.usuario)
        ? await emCadaContrato(() => this.montarKpisConsolidado(modo, req.query as Record<string, any>))
        : [await this.montarKpisConsolidado(modo, req.query as Record<string, any>)];

      const response = {
        servicos: partes.flat(),
        modo: modo === 'resumo' ? 'resumo' : 'completo',
      };
      setCache(cacheKey, response);
      return res.json(response);
    } catch (error: any) {
      console.error('Erro ao buscar kpis-consolidado:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao carregar dados consolidados' });
    }
  }

  /** KPIs consolidados dos serviços do banco ativo. */
  private async montarKpisConsolidado(
    modo: string,
    query: Record<string, any>,
  ): Promise<any[]> {
    try {
      const [contratos, todosServicos] = await Promise.all([
        this.contractRepo.find({ order: { numeroContrato: 'ASC' } }),
        this.repository.find({ order: { nome: 'ASC' } }),
      ]);

      const contractMap = new Map(contratos.map(c => [c.id, c]));
      const servicosDoContrato = todosServicos.filter(s => contractMap.has(s.contract_id));
      const todosIds = servicosDoContrato.map(s => s.id);
      const [contagens, ultimosUploads] = todosIds.length > 0
        ? await Promise.all([
            PlanilhaService.getContagemRegistrosPorServicos(todosIds),
            PlanilhaService.getUltimosUploadsPorServicos(todosIds),
          ])
        : [new Map<string, { total: number; validos: number }>(), new Map<string, Date>()];

      // Inclui serviços com colunas detectadas OU com registros importados (evita sumir da Visão Geral)
      const servicosElegiveis = servicosDoContrato.filter(s => {
        const temColunas = (s.padraoPlanilha?.colunas?.length ?? 0) > 0;
        const temRegistros = (contagens.get(s.id)?.total ?? 0) > 0;
        return temColunas || temRegistros;
      });

      if (servicosElegiveis.length === 0) return [];

      const servicosComDados = servicosElegiveis.filter(s => (contagens.get(s.id)?.validos ?? contagens.get(s.id)?.total ?? 0) > 0);

      const montarItemBase = (servico: Servico) => {
        const contract = contractMap.get(servico.contract_id)!;
        const cont = contagens.get(servico.id) || { total: 0, validos: 0 };
        const ultimo = ultimosUploads.get(servico.id);
        return {
          id: servico.id,
          servicoNome: servico.nome,
          tipoServico: servico.tipo || 'geral',
          contratoId: contract.id,
          contratoNome: contract.numeroContrato,
          totalRegistros: cont.validos || cont.total,
          ultimoUpload: ultimo ? ultimo.toISOString() : null,
          temConfigDashboard: !!(
            servico.configDashboard?.kpis?.length ||
            servico.tipo === 'coleta_caminhao'
          ),
        };
      };

      if (modo === 'resumo') {
        return servicosComDados.map(s => ({
          ...montarItemBase(s),
          kpis: [],
        }));
      }

      const limiteKpis = parseInt(process.env.KPIS_CONSOLIDADO_LIMITE || '8', 10);
      const concorrencia = KPIS_CONSOLIDADO_CONCURRENCY;

      const resultados = await mapComLimite(servicosComDados, concorrencia, async servico => {
        const contract = contractMap.get(servico.contract_id)!;
        const base = montarItemBase(servico);
        const kpiCalc = await this.calcularKpisParaComparacao(
          contract.id,
          servico,
          contract,
          query,
          limiteKpis,
        );
        const kpis = kpiCalc.kpis.map(k => ({
          id: k.chave,
          nome: k.nome,
          valor: k.valor,
          formatado: k.formatado,
          formato: k.formato,
          origem: 'servico' as const,
        }));
        return {
          ...base,
          kpis,
          totalRegistros: kpiCalc.totalRegistros || base.totalRegistros,
          temConfigDashboard: !!(servico.configDashboard?.kpis?.length || kpis.length),
        };
      });

      return resultados;
    } catch (error: any) {
      console.error('Erro ao montar kpis-consolidado do banco ativo:', error?.message || error);
      return [];
    }
  }

  /**
   * POST /api/contracts/:contractId/servicos/:id/grafico-agregado
   * ⚡ Agrega dados para um gráfico (usa cache compartilhado de dados)
   */
  async getGraficoAgregado(req: Request, res: Response): Promise<any> {
    try {
      const id = req.params.id as string;
      const { eixoX, eixoY, tipo = 'barra', filtros: filtrosBody, topN = 10 } = req.body;

      if (!eixoX) {
        return res.status(400).json({ error: 'eixoX é obrigatório' });
      }

      const cacheKey = `grafico:${id}:${JSON.stringify({ eixoX, eixoY, tipo, topN, filtros: filtrosBody })}`;
      const cached = getCache<any>(cacheKey);
      if (cached) return res.json(cached);

      if (tipo !== 'pizza' && !eixoY) {
        return res.status(400).json({ error: 'eixoY é obrigatório para gráficos de barra/linha' });
      }

      const filtrosSql = {
        dataInicio: (filtrosBody as any)?.dataInicio as string | undefined,
        dataFim: (filtrosBody as any)?.dataFim as string | undefined,
      };
      const temFiltroExtraGraf = !!(
        (filtrosBody as any)?.placa
        || (filtrosBody as any)?.regional
        || (filtrosBody as any)?.tipoCaminhao
        || (filtrosBody as any)?.filtrosDinamicos
      );

      if (!temFiltroExtraGraf) {
        const sqlGraf = await agregarGraficoColetaSql(
          id,
          { eixoX, eixoY, tipo, topN },
          filtrosSql,
        );
        if (sqlGraf) {
          const response = { ...sqlGraf, modo: 'sql' };
          setCache(cacheKey, response);
          return res.json(response);
        }
      }

      const servico = await this.repository.findOne({ where: { id }, select: ['padraoPlanilha'] as any });
      const colunasPadrao: { nome: string; tipo: string }[] = servico?.padraoPlanilha?.colunas || [];

      const dados = await obterDadosServicoComCache(id);
      if (!dados.length) {
        return res.json({ dados: [], total: 0, mensagem: 'Nenhum dado disponível' });
      }

      let dadosFiltrados = dados;
      if (filtrosBody) {
        dadosFiltrados = this.aplicarFiltros(dados, {
          dataInicio: (filtrosBody as any).dataInicio,
          dataFim: (filtrosBody as any).dataFim,
          placa: (filtrosBody as any).placa,
          regional: (filtrosBody as any).regional,
          tipoCaminhao: (filtrosBody as any).tipoCaminhao,
          filtrosDinamicos: (filtrosBody as any).filtrosDinamicos,
        });
      }

      const resultado = agregarDadosGrafico(dadosFiltrados, { eixoX, eixoY, tipo, topN }, colunasPadrao);
      const response = {
        dados: resultado.dados,
        total: resultado.total,
        processados: resultado.processados,
      };
      setCache(cacheKey, response);
      return res.json(response);
    } catch (error: any) {
      console.error('Erro no getGraficoAgregado:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao agregar dados do gráfico' });
    }
  }

  /**
   * POST /api/contracts/:contractId/servicos/:id/graficos-agregados
   * ⚡ Agrega TODOS os gráficos em uma única leitura do banco (ideal para Docker/máquinas fracas)
   */
  async getGraficosAgregadosBatch(req: Request, res: Response): Promise<any> {
    try {
      const id = req.params.id as string;
      const { graficos, filtros: filtrosBody } = req.body as {
        graficos?: Array<GraficoAgregacaoInput & { idx?: number }>;
        filtros?: Record<string, unknown>;
      };

      if (!graficos?.length) {
        return res.status(400).json({ error: 'Lista de gráficos é obrigatória' });
      }

      const cacheKey = `graficos-batch:${id}:${JSON.stringify({ graficos, filtros: filtrosBody })}`;
      const cached = getCache<any>(cacheKey);
      if (cached) return res.json(cached);

      const filtrosSql = {
        dataInicio: (filtrosBody as any)?.dataInicio as string | undefined,
        dataFim: (filtrosBody as any)?.dataFim as string | undefined,
      };
      const temFiltroExtraBatch = !!(
        (filtrosBody as any)?.placa
        || (filtrosBody as any)?.regional
        || (filtrosBody as any)?.tipoCaminhao
        || (filtrosBody as any)?.filtrosDinamicos
      );

      const graficosComTopN = graficos.map(g => ({
        ...g,
        topN: g.topN ?? (g.tipo === 'pizza' ? 8 : 10),
      }));

      // Tenta SQL por gráfico; se todos resolverem, evita materializar 20k linhas
      if (!temFiltroExtraBatch) {
        const sqlResults = await Promise.all(
          graficosComTopN.map(async (g, i) => {
            const r = await agregarGraficoColetaSql(
              id,
              { eixoX: g.eixoX, eixoY: g.eixoY, tipo: g.tipo, topN: g.topN },
              filtrosSql,
            );
            return r ? { idx: g.idx ?? i, dados: r.dados, modo: 'sql' as const } : null;
          }),
        );
        if (sqlResults.every((r) => r != null)) {
          const response = { graficos: sqlResults, total: 0, modo: 'sql' };
          setCache(cacheKey, response);
          return res.json(response);
        }
      }

      const servico = await this.repository.findOne({ where: { id }, select: ['padraoPlanilha'] as any });
      const colunasPadrao: { nome: string; tipo: string }[] = servico?.padraoPlanilha?.colunas || [];

      const dados = await obterDadosServicoComCache(id);
      if (!dados.length) {
        return res.json({
          graficos: graficos.map((g, i) => ({ idx: g.idx ?? i, dados: [] })),
          total: 0,
        });
      }

      let dadosFiltrados = dados;
      if (filtrosBody) {
        dadosFiltrados = this.aplicarFiltros(dados, {
          dataInicio: (filtrosBody as any).dataInicio,
          dataFim: (filtrosBody as any).dataFim,
          placa: (filtrosBody as any).placa,
          regional: (filtrosBody as any).regional,
          tipoCaminhao: (filtrosBody as any).tipoCaminhao,
          filtrosDinamicos: (filtrosBody as any).filtrosDinamicos,
        });
      }

      const resultados = agregarGraficosEmLote(dadosFiltrados, graficosComTopN, colunasPadrao);
      const response = { graficos: resultados, total: dadosFiltrados.length };
      setCache(cacheKey, response);
      return res.json(response);
    } catch (error: any) {
      console.error('Erro no getGraficosAgregadosBatch:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao agregar gráficos em lote' });
    }
  }
async getModeloExecutivo(req: Request, res: Response): Promise<any> {
    try {
      const id = req.params.id as string;
      const contractId = req.params.contractId as string;

      const [servico, contract] = await Promise.all([
        this.repository.findOne({ where: { id } }),
        this.contractRepo.findOne({ where: { id: contractId } }),
      ]);

      if (!servico) {
        return res.status(404).json({ error: 'Serviço não encontrado' });
      }

      const valoresContrato: Record<string, number | null> = {};
      if (contract) {
        valoresContrato['VALOR_TONELADA'] = contract.valorTonelada ? Number(contract.valorTonelada) : null;
        valoresContrato['VALOR_MINI'] = contract.valorMini ? Number(contract.valorMini) : null;
        valoresContrato['VALOR_TRUCK'] = contract.valorTruck ? Number(contract.valorTruck) : null;
        valoresContrato['VALOR_TOCO'] = contract.valorToco ? Number(contract.valorToco) : null;
        valoresContrato['VALOR_BASCULANTE'] = contract.valorBasculante
          ? Number(contract.valorBasculante)
          : null;
      }

      const kpisAtuais = servico.configDashboard?.kpis || [];

      return res.json({
        modelo: MODELO_EXECUTIVO_KPIS,
        valoresContrato,
        kpisExistentes: kpisAtuais,
        contratoNome: contract?.numeroContrato || '',
        servicoNome: servico.nome,
        temModeloAplicado: servico.configDashboard?.modeloExecutivoAplicado === true,
      });
    } catch (error: any) {
      console.error('Erro ao carregar modelo executivo:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao carregar modelo executivo' });
    }
  }

  /**
   * POST /api/contracts/:contractId/servicos/:id/aplicar-modelo-executivo
   * Aplica todas as fórmulas do Modelo Executivo no configDashboard do serviço.
   */
  async aplicarModeloExecutivo(req: Request, res: Response): Promise<any> {
    try {
      const id = req.params.id as string;
      const contractId = req.params.contractId as string;
      const { substituir = false } = req.body || {};

      const [servico, contract] = await Promise.all([
        this.repository.findOne({ where: { id } }),
        this.contractRepo.findOne({ where: { id: contractId } }),
      ]);

      if (!servico) {
        return res.status(404).json({ error: 'Serviço não encontrado' });
      }

      const valoresFixos: Record<string, number> = {};
      if (contract?.valorTonelada) valoresFixos['VALOR_TONELADA'] = Number(contract.valorTonelada);
      if (contract?.valorMini) valoresFixos['VALOR_MINI'] = Number(contract.valorMini);
      if (contract?.valorTruck) valoresFixos['VALOR_TRUCK'] = Number(contract.valorTruck);
      if (contract?.valorToco) valoresFixos['VALOR_TOCO'] = Number(contract.valorToco);
      if (contract?.valorBasculante) valoresFixos['VALOR_BASCULANTE'] = Number(contract.valorBasculante);

      const colunas = servico.padraoPlanilha?.colunas || [];
      const colunasNomes = colunas.map((c: any) => c.nome);
      
      const novosKpis: any[] = [];
      for (const grupo of MODELO_EXECUTIVO_KPIS) {
        for (const kpi of grupo.indicadores) {
          const formula = substituirColunasNaFormula(kpi.formula, colunasNomes);
          const colunasUsadas = extrairNomesColunas(formula);

          const novoKpi = {
            nome: kpi.nome,
            label: kpi.label,
            expressao: formula,
            agregacao: 'sum' as const,
            formato: kpi.formato,
            ativo: true,
            descricao: kpi.descricao,
            unidade: kpi.unidade,
            cor: kpi.cor,
            categoria: grupo.nome,
            colunasUsadas: colunasUsadas.filter(Boolean),
            valoresFixos,
            automatico: false,
            modeloExecutivo: true,
            visivelNoExecutivo: true,
            metricaKey: `modelo_${kpi.nome.toLowerCase().replace(/\s+/g, '_')}`,
            meta: null,
            alerta: null,
          };

          novosKpis.push(novoKpi);
        }
      }

      let kpisFinais: any[];
      if (substituir) {
        kpisFinais = novosKpis;
      } else {
        const kpisExistentes: any[] = servico.configDashboard?.kpis || [];
        const nomesExistentes = new Set(kpisExistentes.map((k: any) => k.nome));
        const kpisParaAdicionar = novosKpis.filter(k => !nomesExistentes.has(k.nome));
        kpisFinais = deduplicarKpisLista([...kpisExistentes, ...kpisParaAdicionar], { manterInativos: true }).kpis;
      }

      servico.configDashboard = {
        ...(servico.configDashboard || {}),
        kpis: kpisFinais,
        modeloExecutivoAplicado: true,
        modeloExecutivoAplicadoEm: new Date().toISOString(),
        graficos: servico.configDashboard?.graficos || [],
      };

      await this.repository.save(servico);

      return res.json({
        message: `Modelo Executivo aplicado! ${novosKpis.length} indicadores configurados.`,
        totalKpis: kpisFinais.length,
        novosKpis: novosKpis.length,
        kpis: kpisFinais,
        valoresFixos,
      });
    } catch (error: any) {
      console.error('Erro ao aplicar modelo executivo:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao aplicar modelo executivo: ' + (error?.message || '') });
    }
  }

  /**
   * DELETE /api/contracts/:contractId/servicos/:id
   * Exclui um serviço
   */
    /**
   * POST /api/contracts/:contractId/servicos/:id/aplicar-graficos-padrao
   * Aplica graficos padrao com base no tipo de servico e colunas.
   * NAO mexe nos KPIs existentes.
   */
  async aplicarGraficosPadrao(req: Request, res: Response): Promise<any> {
    try {
      const id = req.params.id as string;
      const contractId = req.params.contractId as string;
      const { substituir = false } = req.body || {};
      const servico = await this.repository.findOne({ where: { id } });
      if (!servico) return res.status(404).json({ error: 'Servico nao encontrado' });
      if (!servico.padraoPlanilha?.colunas || servico.padraoPlanilha.colunas.length === 0)
        return res.status(400).json({ error: 'Nenhuma planilha vinculada.' });

      const dadosBrutos = await PlanilhaService.getDadosBrutosPorServico(id, 500);
      const analise = await AutoIndicatorService.analisar(
        id, contractId,
        servico.padraoPlanilha.colunas.map((c: any) => ({
          nome: c.nome, tipo: c.tipo as ColunaInfo['tipo'],
          valoresUnicos: c.valoresUnicos || 0, amostras: c.amostras || [], nulos: c.nulos || 0,
        })),
        dadosBrutos
      );

      const graficosSugeridos = AutoIndicatorService.converterParaGraficoConfig(analise.graficosSugeridos);
      if (graficosSugeridos.length === 0)
        return res.json({ message: 'Nenhum grafico gerado.', graficos: [], totalGraficos: 0 });

      let graficosFinais;
      if (substituir) {
        graficosFinais = graficosSugeridos;
      } else {
        const existentes = servico.configDashboard?.graficos || [];
        const titulos = new Set(existentes.map((g:any) => g.titulo?.toLowerCase().trim()));
        graficosFinais = [...existentes, ...graficosSugeridos.filter((g:any) => !titulos.has(g.titulo?.toLowerCase().trim()))];
      }

      const kpisExistentes = servico.configDashboard?.kpis || [];
      servico.configDashboard = { ...(servico.configDashboard || {}), kpis: kpisExistentes, graficos: graficosFinais, graficosPadraoAplicadosEm: new Date().toISOString(), graficosPadraoTotal: graficosFinais.length };
      await this.repository.save(servico);
      return res.json({ message: graficosFinais.length + ' grafico(s) padrao aplicado(s)!', graficos: graficosFinais, totalGraficos: graficosFinais.length, novosGraficos: graficosSugeridos.length, kpisPreservados: kpisExistentes.length, tipoServico: servico.tipo, colunasDetectadas: analise.colunas.length });
    } catch (error: any) {
      console.error('Erro:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao aplicar graficos: ' + (error?.message || '') });
    }
  }

  /**
   * GET /api/contracts/:contractId/servicos/:id/graficos-padrao-lista
   * Retorna os graficos padrao disponiveis para o tipo de servico do servico
   */
  async getGraficosPadraoLista(req: Request, res: Response): Promise<any> {
    try {
      const id = req.params.id as string;
      const servico = await this.repository.findOne({ where: { id } });
      if (!servico) return res.status(404).json({ error: "Servico nao encontrado" });
      const tipo = servico.tipo || TipoServico.COLETA_CAMINHAO;
      const colunas = servico.padraoPlanilha?.colunas || [];
      const colunasNomes = colunas.map((c: any) => c.nome);
      const graficos = gerarConfigGraficosPadrao(tipo, colunasNomes);
      return res.json({
        tipo,
        colunas: colunasNomes,
        totalGraficos: graficos.length,
        graficos,
        nome: servico.nome,
      });
    } catch (error: any) {
      console.error("Erro ao listar graficos padrao:", error?.message || error);
      return res.status(500).json({ error: "Erro ao listar graficos padrao" });
    }
  }

  /**
   * POST /api/contracts/:contractId/servicos/:id/re-resolver-graficos
   * ⭐ Re-resolve placeholders dos gráficos existentes com base nas colunas atuais.
   * Útil quando o usuário fez upload de planilha e quer atualizar os gráficos
   * que foram criados com placeholders (antes do upload).
   * 
   * Body (opcional):
   *   { substituirTitulos?: boolean } — se true, atualiza títulos usando colunas reais
   * 
   * Response: { message, graficos, resolvidos, totalAntes, totalDepois }
   */
  async reResolverGraficosPlaceholder(req: Request, res: Response): Promise<any> {
    try {
      const id = req.params.id as string;
      const { substituirTitulos } = req.body || {};

      const servico = await this.repository.findOne({ where: { id } });
      if (!servico) {
        return res.status(404).json({ error: 'Serviço não encontrado' });
      }

      if (!servico.padraoPlanilha?.colunas || servico.padraoPlanilha.colunas.length === 0) {
        return res.json({
          message: 'Nenhuma coluna disponível. Faça upload de planilha primeiro.',
          graficos: [],
          resolvidos: 0,
        });
      }

      const config = servico.configDashboard || {};
      const graficosAtuais = config.graficos || [];
      const colunasNomes = servico.padraoPlanilha.colunas.map((c: any) => c.nome);

      if (graficosAtuais.length === 0) {
        // Se não tem gráficos, gerar do padrão
        const novosGraficos = gerarConfigGraficosPadrao(servico.tipo || 'coleta_caminhao', colunasNomes);
        servico.configDashboard = {
          ...config,
          graficos: novosGraficos,
          reResolvidoEm: new Date().toISOString(),
        };
        await this.repository.save(servico);
        return res.json({
          message: `${novosGraficos.length} gráfico(s) gerado(s) do padrão!`,
          graficos: novosGraficos,
          resolvidos: novosGraficos.length,
          totalAntes: 0,
          totalDepois: novosGraficos.length,
        });
      }

      // Re-resolver placeholders
      const graficosReResolvidos = reResolverGraficos(graficosAtuais, colunasNomes);
      
      // Opcional: atualizar títulos que ainda têm placeholders
      if (substituirTitulos) {
        for (const g of graficosReResolvidos) {
          if (g.placeholderNaoResolvido === false && g.eixoX) {
            // Tenta substituir placeholder no título
            for (const ph of (g.placeholdersOriginais?.eixoX || [])) {
              if (g.titulo && g.titulo.includes(ph)) {
                g.titulo = g.titulo.replace(ph, g.eixoX);
              }
            }
          }
        }
      }

      const qtdResolvidos = graficosReResolvidos.filter(
        (g: any) => g.placeholderNaoResolvido === false && g.reResolvido === true
      ).length;

      servico.configDashboard = {
        ...config,
        graficos: graficosReResolvidos,
        reResolvidoEm: new Date().toISOString(),
        reResolvido: true,
      };

      await this.repository.save(servico);

      return res.json({
        message: `${qtdResolvidos} gráfico(s) re-resolvido(s) com sucesso!`,
        graficos: graficosReResolvidos,
        resolvidos: qtdResolvidos,
        totalAntes: graficosAtuais.length,
        totalDepois: graficosReResolvidos.length,
      });
    } catch (error: any) {
      console.error('Erro ao re-resolver gráficos:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao re-resolver gráficos: ' + (error?.message || '') });
    }
  }

  async excluir(req: Request, res: Response): Promise<any> {
    try {
      const id = req.params.id as string;
      const contractId = req.params.contractId as string | undefined;

      const servico = await this.repository.findOne({ where: { id } });
      if (!servico) {
        return res.status(404).json({ error: 'Serviço não encontrado' });
      }

      // Limpa planilhas + coleta_dados + arquivos do storage antes de remover o serviço
      const limpeza = await PlanilhaService.excluirTodosDadosDoServico(id);

      // Remove mapeamentos WhatsApp ligados ao serviço
      await AppDataSource.getRepository(WhatsappGrupoMapa).delete({ servicoId: id });
      try {
        await removerRoteamentoPorServico(id);
      } catch {
        /* controle multi-tenant indisponível */
      }

      await this.repository.remove(servico);

      invalidarCacheDadosServico(id);
      invalidarCacheDashboardServico(id);
      try {
        const { dashboardCache } = await import('../services/DashboardCacheManager');
        dashboardCache.invalidar(id);
      } catch { /* ignore */ }

      if (contractId || servico.contract_id) {
        invalidarCacheSaudeContratos(contractId || servico.contract_id);
      }

      return res.json({
        message: 'Serviço excluído com sucesso',
        uploadsRemovidos: limpeza.uploadsRemovidos,
        registrosRemovidos: limpeza.registrosRemovidos,
      });
    } catch (error) {
      console.error('Erro ao excluir serviço:', error);
      return res.status(500).json({ error: 'Erro ao excluir serviço' });
    }
  }

  /**
   * GET /api/contracts/:contractId/servicos/:id/kpi-operacional-motoristas
   */
  async getKpiOperacionalMotoristas(req: Request, res: Response): Promise<any> {
    try {
      const id = req.params.id as string;
      const contractId = req.params.contractId as string;

      let filtrosDinamicos: Record<string, string> | undefined;
      if (req.query.filtrosDinamicos) {
        try {
          const parsed = JSON.parse(String(req.query.filtrosDinamicos));
          if (parsed && typeof parsed === 'object') filtrosDinamicos = parsed;
        } catch { /* ignora JSON inválido */ }
      }

      const filtros = {
        dataInicio: req.query.dataInicio as string | undefined,
        dataFim: req.query.dataFim as string | undefined,
        placa: req.query.placa as string | undefined,
        tipoCaminhao: req.query.tipoCaminhao as string | undefined,
        filtrosDinamicos,
      };

      const emptyRankings = {
        motoristas: { melhores: [], piores: [] },
        coletores: { melhores: [], piores: [] },
        rotas: { melhores: [], piores: [] },
      };

      const temFiltroExtra = !!(filtros.placa || filtros.tipoCaminhao
        || (filtros.filtrosDinamicos && Object.keys(filtros.filtrosDinamicos).length));

      // Caminho SQL (escala 600k+) quando não há filtros extras
      if (!temFiltroExtra) {
        const sqlRank = await rankingsColetaComCache(id, {
          dataInicio: filtros.dataInicio,
          dataFim: filtros.dataFim,
        });
        return res.json(sqlRank);
      }

      const dados = await obterDadosServicoComCache(id, LIMITE_DADOS_MAX);
      if (!dados || dados.length === 0) {
        return res.json({
          motoristas: [],
          coletores: [],
          rotas: [],
          rankings: emptyRankings,
          metadados: { totalViagens: 0, totalTonelagem: 0, totalKm: 0 },
        });
      }

      const dadosFiltrados = this.aplicarFiltros(dados || [], filtros);
      if (!dadosFiltrados || dadosFiltrados.length === 0) {
        return res.json({
          motoristas: [],
          coletores: [],
          rotas: [],
          rankings: emptyRankings,
          metadados: { totalViagens: 0, totalTonelagem: 0, totalKm: 0 },
        });
      }

      const dadosNorm = normalizarDados(dadosFiltrados);

      const colMotorista = detectarColuna(dadosNorm, [
        'MOTORISTA', 'NOME MOTORISTA', 'NOME_MOTORISTA', 'MOTORISTA NOME',
        'MOT', 'NOME', 'OPERADOR', 'FUNCIONARIO', 'FUNCIONÁRIO', 'COLETOR', 'COLETORA',
      ]);
      const colPlaca = detectarColuna(dadosNorm, ['PLACA', 'CAMINHAO', 'VEICULO', 'COLETOR', 'placa']);
      const colPeso = detectarColuna(dadosNorm, ['PESO TOTAL', 'PESO', 'PESOTOTAL', 'PESO_TOTAL', 'pesoTotal']);
      const colKm = detectarColuna(dadosNorm, ['KM TOTAL', 'KM', 'KMTOTAL', 'KM_TOTAL', 'kmTotal', 'QUILOMETRO', 'DISTANCIA']);
      const colHora = detectarColuna(dadosNorm, ['HORAS FORA UNIDADE', 'HORAS_FORA_UNIDADE', 'horasForaUnidade', 'TEMPO FORA', 'HORAS', 'HORAS PRODUTIVAS', 'tempoForaUnidade', 'HORA SAIDA', 'HORA SÁIDA BASE', 'HORASAIDABASE', 'HORA CHEGADA BASE', 'HORACHEGADABASE']);
      const colHoraSaida = detectarColuna(dadosNorm, ['HORA SAIDA', 'HORASAIDA', 'HORA_SAIDA', 'horaSaida', 'HORA SÁIDA BASE', 'HORASAIDABASE', 'HORA SAIDA BASE', 'HR SAIDA BASE']);
      const colHoraChegada = detectarColuna(dadosNorm, ['HORA CHEGADA', 'HORACHEGADA', 'HORA_CHEGADA', 'horaChegada', 'HORA CHEGADA BASE', 'HORACHEGADABASE', 'HR CHEGA BASE']);
      const colRota = detectarColunaRankingRotas(dadosNorm);

      const temMotorista = colMotorista !== colPlaca;

      const motoristaMap = new Map<string, {
        motorista: string;
        placas: Set<string>;
        viagens: number;
        pesoTotal: number;
        kmTotal: number;
        horas: number;
      }>();

      for (const d of dadosNorm) {
        let chaveMotorista = '';
        if (temMotorista) {
          chaveMotorista = String(encontrarValorColuna(d, colMotorista) || '').trim();
        }
        if (!chaveMotorista) {
          chaveMotorista = String(encontrarValorColuna(d, colPlaca) || 'N/D').trim();
        }
        if (!chaveMotorista || chaveMotorista === 'N/D') continue;

        if (!motoristaMap.has(chaveMotorista)) {
          motoristaMap.set(chaveMotorista, {
            motorista: chaveMotorista,
            placas: new Set(),
            viagens: 0,
            pesoTotal: 0,
            kmTotal: 0,
            horas: 0,
          });
        }
        const entry = motoristaMap.get(chaveMotorista)!;

        const placaVal = String(encontrarValorColuna(d, colPlaca) || '').trim();
        if (placaVal) entry.placas.add(placaVal);

        entry.viagens += contarViagensPorRotaRegistro(d);
        entry.pesoTotal += Number(encontrarValorColuna(d, colPeso)) || 0;
        entry.kmTotal += Number(encontrarValorColuna(d, colKm)) || 0;

        let horas = Number(encontrarValorColuna(d, colHora)) || 0;
        if (horas > 0 && horas < 100) entry.horas += horas;
        else if (horas >= 100) entry.horas += horas * 24;
        else {
          const saida = Number(encontrarValorColuna(d, colHoraSaida)) || 0;
          const chegada = Number(encontrarValorColuna(d, colHoraChegada)) || 0;
          if (saida > 0 && chegada > 0) {
            // CORRIGIDO: detecta virada de dia quando chegada < saida
            let diff = 0;
            if (saida < 1 && chegada < 1) {
              if (chegada < saida) {
                diff = (chegada + 1 - saida) * 24;
              } else {
                diff = (chegada - saida) * 24;
              }
            } else {
              if (chegada < saida) {
                diff = chegada + 24 - saida;
              } else {
                diff = chegada - saida;
              }
            }
            if (diff > 0 && diff < 100) entry.horas += diff;
          }
        }
      }

      const motoristas: any[] = Array.from(motoristaMap.entries())
        .map(([nome, data]) => {
          const tonelagem = data.pesoTotal / 1000;
          const tonPorViagem = data.viagens > 0 ? tonelagem / data.viagens : 0;
          const kmPorViagem = data.viagens > 0 ? data.kmTotal / data.viagens : 0;
          const tonPorKm = data.kmTotal > 0 ? tonelagem / data.kmTotal : 0;
          const tonPorHora = data.horas > 0 ? tonelagem / data.horas : 0;

          return {
            motorista: nome,
            placa: Array.from(data.placas).join(', '),
            viagens: data.viagens,
            tonelagem: Math.round(tonelagem * 100) / 100,
            kmTotal: Math.round(data.kmTotal * 100) / 100,
            horasProdutivas: Math.round(data.horas * 100) / 100,
            tonPorViagem: Math.round(tonPorViagem * 100) / 100,
            kmPorViagem: Math.round(kmPorViagem * 100) / 100,
            tonPorKm: Math.round(tonPorKm * 10000) / 10000,
            tonPorHora: Math.round(tonPorHora * 100) / 100,
          };
        })
        .sort((a, b) => b.tonelagem - a.tonelagem);

      const temRota = colRota !== '';
      let rotas: any[] = [];

      if (temRota) {
        const rotaMap = new Map<string, {
          rota: string;
          viagens: number;
          pesoTotal: number;
          kmTotal: number;
        }>();

        for (const d of dadosNorm) {
          const chaveRota = String(encontrarValorColuna(d, colRota) || 'N/D').trim();
          if (!chaveRota || chaveRota === 'N/D') continue;

          if (!rotaMap.has(chaveRota)) {
            rotaMap.set(chaveRota, {
              rota: chaveRota,
              viagens: 0,
              pesoTotal: 0,
              kmTotal: 0,
            });
          }
          const entry = rotaMap.get(chaveRota)!;
          entry.viagens += contarViagensPorRotaRegistro(d);
          entry.pesoTotal += Number(encontrarValorColuna(d, colPeso)) || 0;
          entry.kmTotal += Number(encontrarValorColuna(d, colKm)) || 0;
        }

        rotas = Array.from(rotaMap.entries())
          .map(([nome, data]) => {
            const tonelagem = data.pesoTotal / 1000;
            const tonPorViagem = data.viagens > 0 ? tonelagem / data.viagens : 0;
            return {
              rota: nome,
              viagens: data.viagens,
              tonelagem: Math.round(tonelagem * 100) / 100,
              kmTotal: Math.round(data.kmTotal * 100) / 100,
              tonPorViagem: Math.round(tonPorViagem * 100) / 100,
            };
          })
          .sort((a, b) => b.tonelagem - a.tonelagem);
      }

      const coletores = agregarRankingColetores(
        dadosNorm,
        colPeso,
        colKm,
        contarViagensPorRotaRegistro,
      );

      const rankings = {
        motoristas: separarMelhoresPiores(motoristas, (m) => m.tonelagem),
        coletores: separarMelhoresPiores(coletores, (c) => c.tonelagem),
        rotas: separarMelhoresPiores(rotas, (r) => r.tonelagem),
      };

      const totalViagens = contarViagensValidadas(dadosNorm);
      const totalTonelagem = dadosNorm.reduce((s, d) => s + (Number(encontrarValorColuna(d, colPeso)) || 0), 0) / 1000;
      const totalKm = dadosNorm.reduce((s, d) => s + (Number(encontrarValorColuna(d, colKm)) || 0), 0);

      return res.json({
        motoristas,
        coletores,
        rotas,
        rankings,
        metadados: {
          totalViagens,
          totalTonelagem: Math.round(totalTonelagem * 100) / 100,
          totalKm: Math.round(totalKm * 100) / 100,
          temMotorista,
          temRota,
          temColetores: coletores.length > 0,
          colunaRota: colRota || null,
          colunaRotaLabel: colRota ? labelColunaRankingRotas(colRota) : null,
        },
      });
    } catch (error: any) {
      console.error('[getKpiOperacionalMotoristas] Erro:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao carregar KPIs operacionais por motorista' });
    }
  }


  /**
   * GET /api/contracts/:contractId/servicos/:id/config-faturamento
   * Retorna a config de faturamento do servico
   */
  async getConfigFaturamento(req: Request, res: Response): Promise<any> {
    try {
      const id = req.params.id as string;
      const servico = await this.repository.findOne({ where: { id } });
      if (!servico) return res.status(404).json({ error: 'Servico nao encontrado' });

      return res.json({
        configFaturamento: servico.configFaturamento || {
          tipoCobranca: 'tonelada',
          valorUnitario: null,
          unidade: 'ton',
          colunaQuantidade: '',
          valoresDeReceita: {
            TRUCK: null,
            TOCO: null,
            MINI: null,
            BASCULANTE: null,
            km_linear: null,
            m2: null,
            por_arvore: null,
          },
          moeda: 'BRL',
          ativo: false,
        },
      });
    } catch (error: any) {
      console.error('Erro ao buscar config faturamento:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao carregar configuracao de faturamento' });
    }
  }

  /**
   * PUT /api/contracts/:contractId/servicos/:id/config-faturamento
   * Salva a config de faturamento do servico
   * Body: { configFaturamento }
   */
  async salvarConfigFaturamento(req: Request, res: Response): Promise<any> {
    try {
      const id = req.params.id as string;
      const { configFaturamento } = req.body;

      const servico = await this.repository.findOne({ where: { id } });
      if (!servico) return res.status(404).json({ error: 'Servico nao encontrado' });

      servico.configFaturamento = configFaturamento || {};
      await this.repository.save(servico);

      return res.json({
        message: 'Configuracao de faturamento salva com sucesso',
        configFaturamento: servico.configFaturamento,
      });
    } catch (error: any) {
      console.error('Erro ao salvar config faturamento:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao salvar configuracao de faturamento' });
    }
  }

  /**
   * GET /api/contracts/:contractId/servicos/:id/resumo-ciclo-por-dia
   * Agregação SQL por dia (rotas + viagens) — fonte confiável para a tabela do ciclo.
   */
  async getResumoCicloPorDia(req: Request, res: Response): Promise<any> {
    try {
      const id = req.params.id as string;
      const servico = await this.repository.findOne({ where: { id } });
      if (!servico) {
        return res.status(404).json({ error: 'Servico nao encontrado' });
      }

      const dataInicio = req.query.dataInicio as string | undefined;
      const dataFim = req.query.dataFim as string | undefined;
      if (!dataInicio || !dataFim) {
        return res.status(400).json({ error: 'dataInicio e dataFim sao obrigatorios' });
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dataInicio) || !/^\d{4}-\d{2}-\d{2}$/.test(dataFim)) {
        return res.status(400).json({ error: 'Datas invalidas. Use YYYY-MM-DD.' });
      }

      const cacheKey = ['resumo-ciclo-dia', id, dataInicio, dataFim].join(':');
      const cached = getCache<any>(cacheKey);
      if (cached) return res.json(cached);

      const dias = await PlanilhaService.getMetricasPorDia(id, dataInicio, dataFim);
      const totais = dias.reduce(
        (acc, d) => ({
          rotas: acc.rotas + d.rotas,
          viagens: acc.viagens + d.viagens,
          pesoTotalKg: acc.pesoTotalKg + d.pesoTotalKg,
          pesoTotalTon: acc.pesoTotalTon + d.pesoTotalTon,
          kmTotal: acc.kmTotal + d.kmTotal,
          areaM2: acc.areaM2 + d.areaM2,
          metroLinear: acc.metroLinear + d.metroLinear,
          kmLinear: acc.kmLinear + d.kmLinear,
          qtdArvore: acc.qtdArvore + d.qtdArvore,
          quantitativo: acc.quantitativo + d.quantitativo,
        }),
        {
          rotas: 0,
          viagens: 0,
          pesoTotalKg: 0,
          pesoTotalTon: 0,
          kmTotal: 0,
          areaM2: 0,
          metroLinear: 0,
          kmLinear: 0,
          qtdArvore: 0,
          quantitativo: 0,
        },
      );

      const response = {
        dias,
        totais,
        dataInicio,
        dataFim,
        tipoServico: servico.tipo || null,
      };
      setCache(cacheKey, response);
      return res.json(response);
    } catch (error: any) {
      console.error('Erro ao buscar resumo ciclo por dia:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao buscar resumo do ciclo por dia' });
    }
  }

  /**
   * GET /api/contracts/:contractId/servicos/:id/verificacao-viagens
   * Compara contagem da planilha vs KPIs do dashboard (linhas, contador, fallback).
   */
  async getVerificacaoViagens(req: Request, res: Response): Promise<any> {
    try {
      const id = req.params.id as string;
      const servico = await this.repository.findOne({ where: { id } });
      if (!servico) {
        return res.status(404).json({ error: 'Servico nao encontrado' });
      }

      // Roçada não usa contagem de viagens/placa/peso
      if (servico.tipo === TipoServico.ROCADEIRA || servico.tipo === 'rocadeira') {
        const contagem = await PlanilhaService.getContagemRegistrosPorServico(id);
        return res.json({
          aplicavel: false,
          tipoServico: servico.tipo,
          linhasImportadas: contagem.total,
          totalRegistrosBanco: contagem.total,
          registrosValidosBanco: contagem.validos,
          registrosInvalidosBanco: contagem.total - contagem.validos,
          temDivergencia: false,
        });
      }

      const filtros = {
        dataInicio: req.query.dataInicio as string | undefined,
        dataFim: req.query.dataFim as string | undefined,
        placa: req.query.placa as string | undefined,
        regional: req.query.regional as string | undefined,
        tipoCaminhao: req.query.tipoCaminhao as string | undefined,
        uploadId: req.query.uploadId ? parseInt(req.query.uploadId as string, 10) : undefined,
      };

      const dados = await obterDadosServicoComCache(id, LIMITE_DADOS_MAX);
      const dadosFiltrados = this.aplicarFiltros(dados || [], filtros);
      const verificacao = verificarContagemViagens(dadosFiltrados, {
        dataInicio: filtros.dataInicio,
        dataFim: filtros.dataFim,
      });

      const contagem = await PlanilhaService.getContagemRegistrosPorServico(id);

      return res.json({
        ...verificacao,
        aplicavel: true,
        totalRegistrosBanco: contagem.total,
        registrosValidosBanco: contagem.validos,
        registrosInvalidosBanco: contagem.total - contagem.validos,
        truncado: contagem.validos > dadosFiltrados.length,
      });
    } catch (error: any) {
      console.error('Erro na verificacao de viagens:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao verificar contagem de viagens' });
    }
  }

  /**
   * GET /api/contracts/:contractId/servicos/:id/inconsistencias-viagens
   * Resumo de viagens que não entram no dashboard por dados incompletos/inconsistentes.
   */
  async getInconsistenciasViagens(req: Request, res: Response): Promise<any> {
    try {
      const id = req.params.id as string;
      const servico = await this.repository.findOne({ where: { id } });
      if (!servico) {
        return res.status(404).json({ error: 'Servico nao encontrado' });
      }

      // Roçada: nunca revalidar com regras de viagem (invalidaria m² sem placa/KM/peso)
      if (servico.tipo === TipoServico.ROCADEIRA || servico.tipo === 'rocadeira') {
        const contagem = await PlanilhaService.getContagemRegistrosPorServico(id);
        return res.json({
          aplicavel: false,
          tipoServico: servico.tipo,
          totalViagens: contagem.total,
          viagensValidas: contagem.validos,
          viagensInconsistentes: Math.max(0, contagem.total - contagem.validos),
          percentualValido: contagem.total > 0
            ? Math.round((contagem.validos / contagem.total) * 1000) / 10
            : 100,
          impactoDashboard: 'Serviço de roçada: validação de viagem (placa/KM/peso) não se aplica.',
          resumoPorMotivo: [],
          amostra: [],
        });
      }

      // Default: não revalidar (evita scan completo em 600k). Use revalidar=1 só pós-upload.
      const revalidar = req.query.revalidar === '1';
      const resumo = await ValidacaoViagemService.getResumoInconsistencias(id, revalidar);
      return res.json({ ...resumo, aplicavel: true });
    } catch (error: any) {
      console.error('Erro ao buscar inconsistencias de viagens:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao buscar inconsistencias de viagens' });
    }
  }

  /**
   * GET /api/contracts/:contractId/servicos/:id/relatorio-sobrecarga-peso
   * Viagens/rotas com peso acima do limite por tipo de caminhão (Mini, Truck, Toco).
   */
  async getRelatorioSobrecargaPeso(req: Request, res: Response): Promise<any> {
    try {
      const id = req.params.id as string;
      const servico = await this.repository.findOne({ where: { id } });
      if (!servico) {
        return res.status(404).json({ error: 'Servico nao encontrado' });
      }

      let filtrosDinamicos: Record<string, string> | undefined;
      if (req.query.filtrosDinamicos) {
        try {
          const parsed = JSON.parse(String(req.query.filtrosDinamicos));
          if (parsed && typeof parsed === 'object') filtrosDinamicos = parsed;
        } catch { /* ignora */ }
      }

      const filtros = {
        dataInicio: req.query.dataInicio as string | undefined,
        dataFim: req.query.dataFim as string | undefined,
        placa: req.query.placa as string | undefined,
        tipoCaminhao: req.query.tipoCaminhao as string | undefined,
        filtrosDinamicos,
      };

      const contractId = req.params.contractId as string | undefined;
      const contract = contractId
        ? await AppDataSource.getRepository(Contract).findOne({ where: { id: contractId } })
        : null;
      const limitesContrato = extrairOverridesLimites(contract?.configOperacional?.pesoMaximoKg);

      const limitesOverrides: Partial<LimitesPesoKg> = {
        ...limitesContrato,
        ...extrairLimitesDeConfig(servico.configFaturamento),
      };
      const mini = req.query.pesoMaxMini ? parseInt(String(req.query.pesoMaxMini), 10) : NaN;
      const toco = req.query.pesoMaxToco ? parseInt(String(req.query.pesoMaxToco), 10) : NaN;
      const basculante = req.query.pesoMaxBasculante
        ? parseInt(String(req.query.pesoMaxBasculante), 10)
        : NaN;
      const truck = req.query.pesoMaxTruck ? parseInt(String(req.query.pesoMaxTruck), 10) : NaN;
      if (!Number.isNaN(mini) && mini > 0) limitesOverrides.MINI = mini;
      if (!Number.isNaN(toco) && toco > 0) limitesOverrides.TOCO = toco;
      if (!Number.isNaN(basculante) && basculante > 0) limitesOverrides.BASCULANTE = basculante;
      if (!Number.isNaN(truck) && truck > 0) limitesOverrides.TRUCK = truck;

      const dados = await obterDadosServicoComCache(id, LIMITE_DADOS_MAX);
      const dadosFiltrados = this.aplicarFiltros(dados || [], filtros);

      const relatorio = gerarRelatorioSobrecargaPeso(dadosFiltrados, limitesOverrides);
      return res.json(relatorio);
    } catch (error: any) {
      console.error('Erro ao gerar relatorio sobrecarga peso:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao gerar relatorio de sobrecarga de peso' });
    }
  }

  /**
   * GET /api/contracts/:contractId/servicos/:id/ciclos-fechados
   */
  async listarCiclosFechados(req: Request, res: Response): Promise<any> {
    try {
      const id = req.params.id as string;
      const servico = await this.repository.findOne({ where: { id } });
      if (!servico) {
        return res.status(404).json({ error: 'Servico nao encontrado' });
      }
      const ciclos = await listarCiclosFechados(id);
      return res.json({ ciclos });
    } catch (error: any) {
      console.error('Erro ao listar ciclos fechados:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao listar ciclos fechados' });
    }
  }

  /**
   * GET /api/contracts/:contractId/servicos/:id/ciclos/status?mesReferencia=&anoReferencia=
   */
  async getStatusCiclo(req: Request, res: Response): Promise<any> {
    try {
      const id = req.params.id as string;
      const mes = parseInt(String(req.query.mesReferencia), 10);
      const ano = parseInt(String(req.query.anoReferencia), 10);
      if (!mes || !ano || mes < 1 || mes > 12 || ano < 2000) {
        return res.status(400).json({ error: 'mesReferencia e anoReferencia sao obrigatorios' });
      }
      const fechado = await cicloEstaFechado(id, mes, ano);
      return res.json({ mesReferencia: mes, anoReferencia: ano, fechado });
    } catch (error: any) {
      console.error('Erro ao consultar status do ciclo:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao consultar status do ciclo' });
    }
  }

  /**
   * POST /api/contracts/:contractId/servicos/:id/ciclos/fechar
   * Body: { mesReferencia, anoReferencia }
   */
  async fecharCiclo(req: Request, res: Response): Promise<any> {
    try {
      const contractId = req.params.contractId as string;
      const id = req.params.id as string;
      const mesReferencia = parseInt(String(req.body?.mesReferencia), 10);
      const anoReferencia = parseInt(String(req.body?.anoReferencia), 10);

      if (!mesReferencia || !anoReferencia || mesReferencia < 1 || mesReferencia > 12 || anoReferencia < 2000) {
        return res.status(400).json({ error: 'mesReferencia e anoReferencia sao obrigatorios' });
      }

      const servico = await this.repository.findOne({ where: { id, contract_id: contractId } });
      if (!servico) {
        return res.status(404).json({ error: 'Servico nao encontrado' });
      }

      const resultado = await fecharCicloServico({
        servicoId: id,
        contractId,
        mesReferencia,
        anoReferencia,
      });

      invalidarCacheDadosServico(id);
      invalidarCacheDashboardServico(id);

      return res.json({
        message: `Ciclo ${resultado.ciclo.label} fechado com sucesso`,
        ciclo: resultado.ciclo,
        uploadIds: resultado.uploadIds,
        totalRegistros: resultado.totalRegistros,
        backupPlanilha: resultado.backupPlanilha,
      });
    } catch (error: any) {
      const msg = error?.message || 'Erro ao fechar ciclo';
      if (msg.includes('já está fechado') || msg.includes('Nenhuma planilha')) {
        return res.status(400).json({ error: msg });
      }
      console.error('Erro ao fechar ciclo:', msg);
      return res.status(500).json({ error: msg });
    }
  }

  /**
   * POST /api/contracts/:contractId/servicos/:id/ciclos/reabrir
   * Body: { mesReferencia, anoReferencia }
   */
  async reabrirCiclo(req: Request, res: Response): Promise<any> {
    try {
      const contractId = req.params.contractId as string;
      const id = req.params.id as string;
      const mesReferencia = parseInt(String(req.body?.mesReferencia), 10);
      const anoReferencia = parseInt(String(req.body?.anoReferencia), 10);

      if (!mesReferencia || !anoReferencia || mesReferencia < 1 || mesReferencia > 12 || anoReferencia < 2000) {
        return res.status(400).json({ error: 'mesReferencia e anoReferencia sao obrigatorios' });
      }

      const servico = await this.repository.findOne({ where: { id, contract_id: contractId } });
      if (!servico) {
        return res.status(404).json({ error: 'Servico nao encontrado' });
      }

      const resultado = await reabrirCicloServico({
        servicoId: id,
        contractId,
        mesReferencia,
        anoReferencia,
      });

      invalidarCacheDadosServico(id);
      invalidarCacheDashboardServico(id);

      return res.json({
        message: `Ciclo ${resultado.ciclo.label} reaberto com sucesso`,
        ciclo: resultado.ciclo,
        uploadIds: resultado.uploadIds,
      });
    } catch (error: any) {
      const msg = error?.message || 'Erro ao reabrir ciclo';
      if (msg.includes('não está fechado') || msg.includes('Nenhuma planilha')) {
        return res.status(400).json({ error: msg });
      }
      console.error('Erro ao reabrir ciclo:', msg);
      return res.status(500).json({ error: msg });
    }
  }
}
