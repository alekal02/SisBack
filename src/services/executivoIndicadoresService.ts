import AppDataSource from '../database/data-source';
import { Servico } from '../entities/Servico';
import { Contract } from '../entities/Contract';
import { ColetaData } from '../entities/ColetaData';
import { normalizarDados, encontrarValorColuna } from './FormulaEngine';
import { buildValoresFixosFaturamento } from './configFaturamentoValores';
import { obterDadosServicoComCache } from './servicoDadosCache';
import { LIMITE_DADOS_MAX } from '../config/limitesRecursos';
import { aplicarFiltrosPeriodoServico } from './servicoDadosFiltroService';
import {
  calcularCicloMensalContrato,
  inferirMesReferenciaAtual,
  deslocarMesReferencia,
} from '../utils/periodoCicloContrato';
import {
  calcularMetricaExecutivaDeDados,
  agregarMetricasExecutivas,
  detectarTodasColunas,
  MetricaExecutivaCalc,
} from './metricaExecutivaService';
import {
  prepararKpisServico,
  calcularKpisAtivos,
  mesclarKpisCalculados,
  ajustarKpisContagemDistintaConsolidada,
  ajustarKpisColetorConsolidada,
  ajustarKpisFaturamentoCicloConsolidada,
  coletarDefsKpisFaturamentoCiclo,
  KpiCalculadoResultado,
} from './kpiCalculoServicoService';
import { parseDataPlanilha } from '../utils/formatarDataPlanilha';

export interface IndicadoresExecutivoUnificado {
  dadosAtuais: ColetaData[];
  dadosAnteriores: ColetaData[];
  metricasAtual: MetricaExecutivaCalc;
  metricasAnterior: MetricaExecutivaCalc;
  valoresFixos: Record<string, number>;
  temValor: boolean;
  kpisCalculados: KpiCalculadoResultado[];
  totalRegistrosAtual: number;
  totalRegistrosAnterior: number;
}

function adaptarDadosNormParaColetaData(
  dadosNorm: Record<string, unknown>[],
  colunas: Record<string, string>,
): ColetaData[] {
  const colPeso = colunas.colPeso;
  const colKm = colunas.colKm;
  const colPlaca = colunas.colPlaca;
  const colTipo = colunas.colTipo;
  const colData = colunas.colData;

  return dadosNorm.map((row, idx) => {
    const dataVal = colData
      ? encontrarValorColuna(row, colData)
      : (row.dataSaida ?? encontrarValorColuna(row, 'DATA SAIDA'));
    let dataSaida: Date | null = null;
    if (dataVal) {
      dataSaida = parseDataPlanilha(dataVal) || (dataVal instanceof Date ? dataVal : new Date(dataVal as string));
      if (isNaN(dataSaida.getTime())) dataSaida = null;
    }

    const entidade = new ColetaData();
    entidade.id = idx;
    entidade.dataSaida = dataSaida as Date;
    entidade.pesoTotal = Number(encontrarValorColuna(row, colPeso)) || 0;
    entidade.kmTotal = Number(encontrarValorColuna(row, colKm)) || 0;
    entidade.placa = String(encontrarValorColuna(row, colPlaca) || '');
    entidade.tipoCaminhao = String(encontrarValorColuna(row, colTipo) || '');
    entidade.dados = row as Record<string, any>;
    entidade.validoDashboard = row.validoDashboard === true || row._validoDashboard === true;
    entidade.numeroViagens = Number(row.numeroViagens ?? row.viagensPorRota ?? 1) || 1;
    return entidade;
  });
}

async function processarServicoPeriodo(
  servico: Servico,
  contract: Contract | null,
  inicio: Date,
  fim: Date,
): Promise<{
  metricas: MetricaExecutivaCalc;
  dadosNorm: Record<string, unknown>[];
  valoresFixos: Record<string, number>;
  kpis: KpiCalculadoResultado[];
  coletores: Set<string>;
}> {
  const cfgFat = servico.configFaturamento;
  const valoresFixos = buildValoresFixosFaturamento(contract, cfgFat?.ativo ? cfgFat : null);
  const dadosBrutos = await obterDadosServicoComCache(servico.id, LIMITE_DADOS_MAX);
  const dadosFiltrados = aplicarFiltrosPeriodoServico(dadosBrutos || [], inicio, fim);
  const dadosNorm = normalizarDados(dadosFiltrados);
  const metricas = calcularMetricaExecutivaDeDados(dadosNorm, valoresFixos, servico.id, cfgFat);
  const todosKpis = prepararKpisServico(servico, contract);
  const colunasServico = (servico.padraoPlanilha?.colunas || []).map((c: any) => c.nome);
  const kpis = calcularKpisAtivos(dadosNorm, valoresFixos, todosKpis, metricas.viagens, colunasServico);

  const coletores = new Set<string>();
  const colPlaca = metricas.colunasDetectadas.colPlaca;
  for (const d of dadosNorm) {
    const v = encontrarValorColuna(d, colPlaca);
    if (v !== undefined && v !== null && v !== '') coletores.add(String(v).trim());
  }

  return { metricas, dadosNorm, valoresFixos, kpis, coletores };
}

async function carregarDadosNormCicloConsolidado(
  servicos: Servico[],
  contractsCache: Map<string, Contract | null>,
  mesReferencia?: number,
  anoReferencia?: number,
): Promise<Record<string, unknown>[]> {
  const partes: Record<string, unknown>[][] = [];

  for (const servico of servicos) {
    const contract = contractsCache.get(servico.contract_id) ?? null;
    const dia = contract?.diaInicioCiclo ?? 1;
    let mes: number;
    let ano: number;
    if (mesReferencia && anoReferencia) {
      mes = mesReferencia;
      ano = anoReferencia;
    } else {
      ({ mes, ano } = inferirMesReferenciaAtual(dia));
    }
    const ciclo = calcularCicloMensalContrato(ano, mes, dia);
    const inicio = new Date(`${ciclo.dataInicio}T00:00:00`);
    const fim = new Date(`${ciclo.dataFim}T23:59:59.999`);
    const brutos = await obterDadosServicoComCache(servico.id, LIMITE_DADOS_MAX);
    const filtrados = aplicarFiltrosPeriodoServico(brutos || [], inicio, fim);
    partes.push(normalizarDados(filtrados));
  }

  return partes.flat();
}

function resolverDatasPeriodoServico(
  contract: Contract | null,
  opts: {
    modoCiclo?: boolean;
    mesReferenciaCiclo?: number;
    anoReferenciaCiclo?: number;
    inicio: Date;
    fim: Date;
    inicioAnterior: Date;
    fimAnterior: Date;
  },
): { inicio: Date; fim: Date; inicioAnterior: Date; fimAnterior: Date } {
  if (!opts.modoCiclo) {
    return {
      inicio: opts.inicio,
      fim: opts.fim,
      inicioAnterior: opts.inicioAnterior,
      fimAnterior: opts.fimAnterior,
    };
  }

  const dia = contract?.diaInicioCiclo ?? 1;
  let mes: number;
  let ano: number;
  if (opts.mesReferenciaCiclo && opts.anoReferenciaCiclo) {
    mes = opts.mesReferenciaCiclo;
    ano = opts.anoReferenciaCiclo;
  } else {
    ({ mes, ano } = inferirMesReferenciaAtual(dia));
  }

  const ciclo = calcularCicloMensalContrato(ano, mes, dia);
  const { mes: mesAnt, ano: anoAnt } = deslocarMesReferencia(mes, ano, -1);
  const cicloAnt = calcularCicloMensalContrato(anoAnt, mesAnt, dia);

  return {
    inicio: new Date(`${ciclo.dataInicio}T00:00:00`),
    fim: new Date(`${ciclo.dataFim}T23:59:59.999`),
    inicioAnterior: new Date(`${cicloAnt.dataInicio}T00:00:00`),
    fimAnterior: new Date(`${cicloAnt.dataFim}T23:59:59.999`),
  };
}

function obterPeriodoCicloConsolidado(
  servicos: Servico[],
  contractsCache: Map<string, Contract | null>,
  mesReferencia?: number,
  anoReferencia?: number,
): { dataInicio: string; dataFim: string } | null {
  if (!servicos.length) return null;

  let dataInicio = '9999-12-31';
  let dataFim = '0000-01-01';

  for (const servico of servicos) {
    const contract = contractsCache.get(servico.contract_id) ?? null;
    const dia = contract?.diaInicioCiclo ?? 1;
    let mes: number;
    let ano: number;
    if (mesReferencia && anoReferencia) {
      mes = mesReferencia;
      ano = anoReferencia;
    } else {
      ({ mes, ano } = inferirMesReferenciaAtual(dia));
    }
    const ciclo = calcularCicloMensalContrato(ano, mes, dia);
    if (ciclo.dataInicio < dataInicio) dataInicio = ciclo.dataInicio;
    if (ciclo.dataFim > dataFim) dataFim = ciclo.dataFim;
  }

  return { dataInicio, dataFim };
}

export async function calcularIndicadoresExecutivoUnificado(opts: {
  contractId?: string;
  servicoId?: string;
  inicio: Date;
  fim: Date;
  inicioAnterior: Date;
  fimAnterior: Date;
  modoCiclo?: boolean;
  mesReferenciaCiclo?: number;
  anoReferenciaCiclo?: number;
}): Promise<IndicadoresExecutivoUnificado> {
  const servicoRepo = AppDataSource.getRepository(Servico);
  const contractRepo = AppDataSource.getRepository(Contract);

  let servicos: Servico[] = [];
  if (opts.servicoId) {
    const s = await servicoRepo.findOne({ where: { id: opts.servicoId } });
    if (s) servicos = [s];
  } else if (opts.contractId) {
    servicos = await servicoRepo.find({
      where: { contract_id: opts.contractId },
      order: { nome: 'ASC' },
    });
  } else {
    servicos = await servicoRepo.find({ order: { nome: 'ASC' } });
  }

  const contractsCache = new Map<string, Contract | null>();
  const resultadosAtual: Awaited<ReturnType<typeof processarServicoPeriodo>>[] = [];
  const resultadosAnterior: Awaited<ReturnType<typeof processarServicoPeriodo>>[] = [];

  for (const servico of servicos) {
    let contract = contractsCache.get(servico.contract_id);
    if (contract === undefined) {
      contract = await contractRepo.findOne({ where: { id: servico.contract_id } });
      contractsCache.set(servico.contract_id, contract);
    }

    const datas = resolverDatasPeriodoServico(contract, opts);

    const [atual, anterior] = await Promise.all([
      processarServicoPeriodo(servico, contract, datas.inicio, datas.fim),
      processarServicoPeriodo(servico, contract, datas.inicioAnterior, datas.fimAnterior),
    ]);
    resultadosAtual.push(atual);
    resultadosAnterior.push(anterior);
  }

  const coletoresAtual = new Set<string>();
  const coletoresAnterior = new Set<string>();
  for (const r of resultadosAtual) r.coletores.forEach(c => coletoresAtual.add(c));
  for (const r of resultadosAnterior) r.coletores.forEach(c => coletoresAnterior.add(c));

  const metricasAtual = agregarMetricasExecutivas(
    resultadosAtual.map(r => r.metricas),
    coletoresAtual.size,
  );
  const metricasAnterior = agregarMetricasExecutivas(
    resultadosAnterior.map(r => r.metricas),
    coletoresAnterior.size,
  );

  const valoresFixos: Record<string, number> = {};
  for (const r of resultadosAtual) {
    Object.assign(valoresFixos, r.valoresFixos);
  }
  const temValor = resultadosAtual.some(r => r.metricas.temValor);

  let kpisCalculados = ajustarKpisColetorConsolidada(
    ajustarKpisContagemDistintaConsolidada(
      mesclarKpisCalculados(resultadosAtual.map(r => r.kpis)),
      resultadosAtual.flatMap(r => r.dadosNorm),
    ),
    resultadosAtual.flatMap(r => r.dadosNorm),
    {
      pesoTotalTon: metricasAtual.pesoTotalTon,
      qtdColetores: metricasAtual.qtdColetores,
    },
  );

  const dadosNormCicloAtual = resultadosAtual.flatMap(r => r.dadosNorm);
  const colunasUniao = [
    ...new Set(
      servicos.flatMap(s => (s.padraoPlanilha?.colunas || []).map((c: { nome: string }) => c.nome)),
    ),
  ];
  const periodoCiclo = opts.modoCiclo
    ? obterPeriodoCicloConsolidado(servicos, contractsCache, opts.mesReferenciaCiclo, opts.anoReferenciaCiclo)
    : null;
  const dadosNormFaturamento = opts.modoCiclo
    ? dadosNormCicloAtual
    : await carregarDadosNormCicloConsolidado(
      servicos,
      contractsCache,
      opts.mesReferenciaCiclo,
      opts.anoReferenciaCiclo,
    );
  const periodoFaturamento = periodoCiclo ?? obterPeriodoCicloConsolidado(
    servicos,
    contractsCache,
    opts.mesReferenciaCiclo,
    opts.anoReferenciaCiclo,
  );

  if (dadosNormFaturamento.length > 0 && periodoFaturamento) {
    const defsFaturamentoCiclo = coletarDefsKpisFaturamentoCiclo(servicos, contractsCache);
    kpisCalculados = ajustarKpisFaturamentoCicloConsolidada(
      kpisCalculados,
      dadosNormFaturamento,
      valoresFixos,
      defsFaturamentoCiclo,
      colunasUniao,
      periodoFaturamento,
    );
  }

  const dadosNormAtual = dadosNormCicloAtual;
  const dadosNormAnterior = resultadosAnterior.flatMap(r => r.dadosNorm);
  const colunas = detectarTodasColunas(
    dadosNormAtual.length > 0 ? dadosNormAtual : dadosNormAnterior,
    servicos[0]?.id || 'executivo',
  );

  return {
    dadosAtuais: adaptarDadosNormParaColetaData(dadosNormAtual, colunas),
    dadosAnteriores: adaptarDadosNormParaColetaData(dadosNormAnterior, colunas),
    metricasAtual,
    metricasAnterior,
    valoresFixos,
    temValor,
    kpisCalculados,
    totalRegistrosAtual: dadosNormAtual.length,
    totalRegistrosAnterior: dadosNormAnterior.length,
  };
}
