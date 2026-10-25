/**
 * Agregações SQL de coleta — escala para 600k+/mês sem materializar linhas.
 */
import AppDataSource from '../database/data-source';
import { ColetaData } from '../entities/ColetaData';
import { PlanilhaUpload } from '../entities/PlanilhaUpload';
import { Servico } from '../entities/Servico';
import { Contract } from '../entities/Contract';
import { normalizarTipoCaminhaoPeso } from '../config/pesoMaximoCaminhao';
import { aplicarFiltroViagensValidasDashboard } from './validacaoViagemService';
import { separarMelhoresPiores } from './rankingOperacionalService';
import {
  sqlSumViagens,
  sqlSumPesoEfetivoKg,
  sqlExprPesoEfetivoKg,
  sqlExprViagensLinha,
  contarViagensPorRotaRegistro,
} from './viagensPorRotaService';
import { decomporJornadaRegistro, type JornadaDecomposta } from './jornadaTrechosService';
import { calcularPesoIdealViagem, densidadeOptsToInput } from './relatorioDia/escalaIdealPeso';
import { montarViagensPesoDoRegistro, type ViagemPesoRotaItem } from './viagemPesoRotaService';
import {
  classificarTempoPorTipo,
  tempoParaEncherPorMedia,
  tipoParaTempoEncher,
} from './evolucaoOperacionalMetricas';

export interface MetricasColetaSql {
  registros: number;
  viagens: number;
  pesoTotalKg: number;
  pesoTotalTon: number;
  kmTotal: number;
  horasProdutivas: number;
  placas: number;
  motoristas: number;
  regionais: number;
  distritos: number;
  somaColetores: number;
  faturamento: number;
  fatPorTipo: Record<string, number>;
}

export interface LinhaRankingColeta {
  chave: string;
  label: string;
  viagens: number;
  tonelagem: number;
  kmTotal: number;
  horasProdutivas: number;
  tonPorViagem: number;
  kmPorViagem: number;
  placa?: string;
  /** Tipo predominante do grupo (placa/motorista) — para eficiência vs ideal. */
  tipoCaminhao?: string;
}

export interface AgregacaoColetaResult {
  resumo: MetricasColetaSql;
  porMotorista: LinhaRankingColeta[];
  porPlaca: LinhaRankingColeta[];
  porDistrito: LinhaRankingColeta[];
  dataInicio: string | null;
  dataFim: string | null;
}

async function getUploadIds(servicoId: string): Promise<number[]> {
  const rows = await AppDataSource.getRepository(PlanilhaUpload).find({
    where: { servico_id: servicoId },
    select: ['id'],
  });
  return rows.map((u) => u.id);
}

function toIsoDate(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parsePeriodo(opts: { dataInicio?: string; dataFim?: string; data?: string }) {
  const dataUnica = opts.data && /^\d{4}-\d{2}-\d{2}$/.test(opts.data) ? opts.data : null;
  const dataInicio = dataUnica
    || (opts.dataInicio && /^\d{4}-\d{2}-\d{2}$/.test(opts.dataInicio) ? opts.dataInicio : null);
  const dataFim = dataUnica
    || (opts.dataFim && /^\d{4}-\d{2}-\d{2}$/.test(opts.dataFim) ? opts.dataFim : null);
  return { dataInicio, dataFim };
}

function baseQb(
  uploadIds: number[],
  dataInicio: string | null,
  dataFim: string | null,
  alias = 'c',
) {
  const repo = AppDataSource.getRepository(ColetaData);
  const qb = repo.createQueryBuilder(alias)
    .where(`${alias}.planilhaUploadId IN (:...uploadIds)`, { uploadIds });
  aplicarFiltroViagensValidasDashboard(qb, alias);
  // dataSaida costuma ser meio-dia UTC — usar janela completa do dia
  if (dataInicio) qb.andWhere(`${alias}.dataSaida >= :inicio`, { inicio: `${dataInicio}T00:00:00.000Z` });
  if (dataFim) qb.andWhere(`${alias}.dataSaida <= :fim`, { fim: `${dataFim}T23:59:59.999Z` });
  return qb;
}

/**
 * Expressão SQL: tarifa R$/ton por tipo de caminhão.
 * `exprTipo` permite aplicar a mesma regra sobre a coluna já projetada por uma
 * subconsulta, em vez de reler a tabela.
 */
function sqlTarifaPorTipo(
  valoresFixos: Record<string, number>,
  exprTipo = `c."tipoCaminhao"`,
): string {
  const truck = Number(valoresFixos.VALOR_TRUCK || valoresFixos.VALOR_TONELADA || 0);
  const toco = Number(valoresFixos.VALOR_TOCO || valoresFixos.VALOR_TONELADA || 0);
  const mini = Number(valoresFixos.VALOR_MINI || valoresFixos.VALOR_TONELADA || 0);
  const basc = Number(valoresFixos.VALOR_BASCULANTE || valoresFixos.VALOR_TONELADA || 0);
  const fallback = Number(valoresFixos.VALOR_TONELADA || truck || 0);
  const tipo = `UPPER(TRIM(COALESCE(${exprTipo}, '')))`;
  return `
    CASE
      WHEN ${tipo} LIKE '%MINI%' THEN ${mini}
      WHEN ${tipo} LIKE '%TOCO%' THEN ${toco}
      WHEN ${tipo} LIKE '%BASC%' THEN ${basc}
      WHEN ${tipo} LIKE '%TRUCK%' THEN ${truck}
      ELSE ${fallback}
    END
  `;
}

/**
 * Tipo predominante = o que mais aparece ordenado por viagens da linha.
 * Peso e nome entram como critério de desempate: só as viagens deixavam o
 * rótulo à mercê da ordem em que o banco devolveu as linhas, e ele mudava de
 * um relatório para o outro sem nada ter mudado nos dados.
 */
const SQL_TIPO_PREDOMINANTE =
  `(ARRAY_AGG(NULLIF(TRIM(c."tipoCaminhao"), '') ORDER BY COALESCE(c."viagensPorRota", 0) DESC NULLS LAST, `
  + `COALESCE(c."pesoTotal", 0) DESC, NULLIF(TRIM(c."tipoCaminhao"), '') ASC))[1]`;

function mapRanking(rows: any[]): LinhaRankingColeta[] {
  return rows.map((r) => {
    const label = String(r.label || 'Não informado').trim() || 'Não informado';
    const viagens = Number(r.viagens || 0);
    const pesoKg = Number(r.peso_kg || 0);
    const tonelagem = round2(pesoKg / 1000);
    const kmTotal = round2(Number(r.km_total || 0));
    const horas = round2(Number(r.horas || 0));
    const tipoRaw = r.tipo_caminhao != null ? String(r.tipo_caminhao).trim() : '';
    return {
      chave: label,
      label,
      viagens,
      tonelagem,
      kmTotal,
      horasProdutivas: horas,
      tonPorViagem: viagens > 0 ? round2(tonelagem / viagens) : 0,
      kmPorViagem: viagens > 0 ? round2(kmTotal / viagens) : 0,
      placa: r.placa ? String(r.placa) : undefined,
      tipoCaminhao: tipoRaw || undefined,
    };
  });
}

/**
 * Resumo do período em duas consultas paralelas.
 *
 * Antes era uma consulta só, e ela pagava dois preços altos: os quatro
 * COUNT(DISTINCT) na mesma passada das somas, e a expressão de peso efetivo
 * (que lê o JSONB da planilha) calculada duas vezes por linha — uma para o peso
 * e outra para o faturamento. Aqui a linha é projetada uma vez numa subconsulta,
 * o total e o valor por tipo saem juntos via GROUPING SETS, e a contagem de
 * placas/motoristas/rotas roda em paralelo.
 */
export async function getMetricasColetaSql(
  servicoId: string,
  opts: { dataInicio?: string; dataFim?: string; data?: string; ignorarTotais?: boolean } = {},
  valoresFixos: Record<string, number> = {},
  uploadIdsConhecidos?: number[],
): Promise<MetricasColetaSql> {
  const { dataInicio, dataFim } = parsePeriodo(opts);
  const temTarifa = Object.keys(valoresFixos).length > 0;
  if (!opts.ignorarTotais && !temTarifa && dataInicio && dataInicio === dataFim) {
    const { lerTotaisDia } = await import('./coletaTotaisDiaService');
    const salvo = await lerTotaisDia(servicoId, dataInicio);
    if (salvo && salvo.registros > 0) return salvo;
  }

  const uploadIds = uploadIdsConhecidos ?? await getUploadIds(servicoId);
  const vazio: MetricasColetaSql = {
    registros: 0, viagens: 0, pesoTotalKg: 0, pesoTotalTon: 0, kmTotal: 0,
    horasProdutivas: 0, placas: 0, motoristas: 0, regionais: 0, distritos: 0,
    somaColetores: 0, faturamento: 0, fatPorTipo: {},
  };
  if (!uploadIds.length) return vazio;

  const tarifa = sqlTarifaPorTipo(valoresFixos, 't.tipo_bruto');

  const porLinha = baseQb(uploadIds, dataInicio, dataFim)
    .select([
      `${sqlExprPesoEfetivoKg('c')} AS peso_kg`,
      `${sqlExprViagensLinha('c')} AS viagens`,
      'COALESCE(c."kmTotal", 0) AS km',
      `CASE WHEN c."horasForaUnidade" BETWEEN 0 AND 24 THEN c."horasForaUnidade" ELSE 0 END AS horas`,
      'COALESCE(c."numeroColetores", 0) AS coletores',
      `c."tipoCaminhao" AS tipo_bruto`,
    ]);

  const somasEPorTipo = AppDataSource.createQueryBuilder()
    .select([
      'GROUPING(t.tipo_bruto) AS eh_total',
      `COALESCE(NULLIF(TRIM(t.tipo_bruto), ''), 'Não informado') AS tipo`,
      'COUNT(*)::int AS registros',
      'COALESCE(SUM(t.viagens), 0) AS viagens',
      'COALESCE(SUM(t.peso_kg), 0) AS peso_kg',
      'COALESCE(SUM(t.km), 0) AS km_total',
      'COALESCE(SUM(t.horas), 0) AS horas',
      'COALESCE(SUM(t.coletores), 0) AS soma_coletores',
      `COALESCE(SUM(t.peso_kg / 1000.0 * (${tarifa})), 0) AS faturamento`,
    ])
    .from(`(${porLinha.getQuery()})`, 't')
    .setParameters(porLinha.getParameters())
    .groupBy(`GROUPING SETS ((COALESCE(NULLIF(TRIM(t.tipo_bruto), ''), 'Não informado'), t.tipo_bruto), ())`)
    .getRawMany();

  const distintos = baseQb(uploadIds, dataInicio, dataFim)
    .select([
      `COUNT(DISTINCT NULLIF(TRIM(c.placa), ''))::int AS placas`,
      `COUNT(DISTINCT NULLIF(TRIM(c.motorista), ''))::int AS motoristas`,
      `COUNT(DISTINCT NULLIF(TRIM(c.regional), ''))::int AS regionais`,
      `COUNT(DISTINCT NULLIF(TRIM(c.distrito), ''))::int AS distritos`,
    ])
    .getRawOne();

  const [linhas, contagens] = await Promise.all([somasEPorTipo, distintos]);

  const total = linhas.find((l) => Number(l.eh_total) === 1);
  const fatPorTipo: Record<string, number> = {};
  for (const r of linhas) {
    if (Number(r.eh_total) === 1) continue;
    const t = String(r.tipo || 'Não informado');
    fatPorTipo[t] = round2((fatPorTipo[t] || 0) + Number(r.faturamento || 0));
  }

  const pesoKg = Number(total?.peso_kg || 0);
  return {
    registros: Number(total?.registros || 0),
    viagens: Number(total?.viagens || 0),
    pesoTotalKg: pesoKg,
    pesoTotalTon: round2(pesoKg / 1000),
    kmTotal: round2(Number(total?.km_total || 0)),
    horasProdutivas: round2(Number(total?.horas || 0)),
    placas: Number(contagens?.placas || 0),
    motoristas: Number(contagens?.motoristas || 0),
    regionais: Number(contagens?.regionais || 0),
    distritos: Number(contagens?.distritos || 0),
    somaColetores: Number(total?.soma_coletores || 0),
    faturamento: round2(Number(total?.faturamento || 0)),
    fatPorTipo,
  };
}

export async function getAgregacaoColeta(
  servicoId: string,
  opts: {
    dataInicio?: string;
    dataFim?: string;
    data?: string;
    topN?: number;
    valoresFixos?: Record<string, number>;
  } = {},
): Promise<AgregacaoColetaResult> {
  const uploadIds = await getUploadIds(servicoId);
  const { dataInicio, dataFim } = parsePeriodo(opts);
  const topN = Math.min(Math.max(opts.topN || 50, 5), 200);
  const valoresFixos = opts.valoresFixos || {};

  const resumo = await getMetricasColetaSql(servicoId, opts, valoresFixos, uploadIds);
  const vazio: AgregacaoColetaResult = {
    resumo,
    porMotorista: [],
    porPlaca: [],
    porDistrito: [],
    dataInicio: dataInicio,
    dataFim: dataFim,
  };
  if (!uploadIds.length || resumo.registros === 0) return vazio;

  const labelMotorista = `COALESCE(NULLIF(TRIM(c.motorista), ''), 'Não informado')`;
  const labelPlaca = `COALESCE(NULLIF(TRIM(c.placa), ''), 'Não informado')`;
  const labelDistrito = `COALESCE(NULLIF(TRIM(c.distrito), ''), NULLIF(TRIM(c.regional), ''), 'Não informado')`;

  const selectGrupo = (labelExpr: string) => [
    `${labelExpr} AS label`,
    `${sqlSumViagens('c')} AS viagens`,
    `${sqlSumPesoEfetivoKg('c')} AS peso_kg`,
    'COALESCE(SUM(COALESCE(c."kmTotal", 0)), 0) AS km_total',
    `COALESCE(SUM(CASE WHEN c."horasForaUnidade" BETWEEN 0 AND 24 THEN c."horasForaUnidade" ELSE 0 END), 0) AS horas`,
  ];

  const [porMotorista, porPlaca, porDistrito, bounds] = await Promise.all([
    baseQb(uploadIds, dataInicio, dataFim)
      .select([
        ...selectGrupo(labelMotorista),
        `STRING_AGG(DISTINCT NULLIF(TRIM(c.placa), ''), ', ') AS placa`,
        `${SQL_TIPO_PREDOMINANTE} AS tipo_caminhao`,
      ])
      .groupBy(labelMotorista)
      .orderBy('peso_kg', 'DESC')
      .limit(topN)
      .getRawMany(),
    baseQb(uploadIds, dataInicio, dataFim)
      .select([...selectGrupo(labelPlaca), `${SQL_TIPO_PREDOMINANTE} AS tipo_caminhao`])
      .groupBy(labelPlaca)
      .orderBy('peso_kg', 'DESC')
      .limit(topN)
      .getRawMany(),
    baseQb(uploadIds, dataInicio, dataFim)
      .select([...selectGrupo(labelDistrito), `${SQL_TIPO_PREDOMINANTE} AS tipo_caminhao`])
      .groupBy(labelDistrito)
      .orderBy('peso_kg', 'DESC')
      .limit(topN)
      .getRawMany(),
    baseQb(uploadIds, dataInicio, dataFim)
      .select(['MIN(c.dataSaida) AS min_d', 'MAX(c.dataSaida) AS max_d'])
      .getRawOne(),
  ]);

  return {
    resumo,
    porMotorista: mapRanking(porMotorista),
    porPlaca: mapRanking(porPlaca),
    porDistrito: mapRanking(porDistrito),
    dataInicio: dataInicio || toIsoDate(bounds?.min_d),
    dataFim: dataFim || toIsoDate(bounds?.max_d),
  };
}

export interface LinhaMapeamentoOperacional {
  rota: string;
  motorista: string;
  placa: string;
  tipoCaminhao: string | null;
  dias: number;
  viagens: number;
  tonelagem: number;
  kmTotal: number;
  /** Jornada base → base (fora da unidade) */
  horasTotais: number;
  /** Tempo dentro das rotas (chegada→saída) */
  horasProdutivas: number;
  /** Tempo fora das rotas (deslocamento / ociosidade) */
  horasImprodutivas: number;
  horasPorViagem: number;
  horasProdutivasPorViagem: number;
  kmPorViagem: number;
  tonPorHora: number;
  /** % do tempo total que foi produtivo (0–100) */
  percentualProdutivo: number;
  /** Base → primeira rota */
  horasDeslocamentoInicial: number;
  /** Saída de uma rota → chegada na próxima (inclui descarga/aterro) */
  horasEntreRotas: number;
  /** Saída da última rota → base */
  horasRetornoFinal: number;
  /** Improdutiva que a planilha não permitiu atribuir a um trecho */
  horasImprodutivasNaoDetalhadas: number;
  /** KM rodado dentro das rotas */
  kmProdutivo: number;
  /** KM rodado fora das rotas (deslocamento) */
  kmImprodutivo: number;
  kmDeslocamentoInicial: number;
  kmEntreRotas: number;
  kmRetornoFinal: number;
}

/** Onde a hora e o KM improdutivos foram gastos, por placa / motorista / rota. */
export interface TrechosJornadaDimensao {
  chave: string;
  viagens: number;
  horasTotais: number;
  horasProdutivas: number;
  horasImprodutivas: number;
  horasDeslocamentoInicial: number;
  horasEntreRotas: number;
  horasRetornoFinal: number;
  horasImprodutivasNaoDetalhadas: number;
  kmTotal: number;
  kmProdutivo: number;
  kmImprodutivo: number;
  kmDeslocamentoInicial: number;
  kmEntreRotas: number;
  kmRetornoFinal: number;
  percentualProdutivo: number;
  horasImprodutivasPorViagem: number | null;
  kmImprodutivoPorViagem: number | null;
}

export interface MapeamentoOperacionalResult {
  resumo: {
    linhas: number;
    truncado: boolean;
    rotas: number;
    motoristas: number;
    placas: number;
    viagens: number;
    kmTotal: number;
    horasTotais: number;
    horasProdutivas: number;
    horasImprodutivas: number;
    percentualProdutivo: number;
    tonelagem: number;
    horasDeslocamentoInicial: number;
    horasEntreRotas: number;
    horasRetornoFinal: number;
    horasImprodutivasNaoDetalhadas: number;
    kmProdutivo: number;
    kmImprodutivo: number;
    kmDeslocamentoInicial: number;
    kmEntreRotas: number;
    kmRetornoFinal: number;
    /** Registros com horário suficiente para detalhar os trechos */
    registrosComTrecho: number;
    registros: number;
  };
  /** Ranking de improdutividade por dimensão (maior hora improdutiva primeiro) */
  trechosPorPlaca: TrechosJornadaDimensao[];
  trechosPorMotorista: TrechosJornadaDimensao[];
  trechosPorRota: TrechosJornadaDimensao[];
  /** Cruzamento rota × motorista × placa, ordenado por horas produtivas desc */
  linhas: LinhaMapeamentoOperacional[];
  /**
   * Top rotas pela melhor produtividade para encher o peso ideal
   * (menor tempo equivalente = melhor). Campo legado `topRotasLentas`.
   */
  topRotasLentas: TopRotaProdutividadeEncher[];
  /** PESO 1–4 com hora produtiva da viagem (trecho ou rateio da rota). */
  viagensPesoRota: ViagemPesoRotaItem[];
  dataInicio: string | null;
  dataFim: string | null;
}

export interface TopRotaProdutividadeEncher {
  rota: string;
  viagens: number;
  horasTotais: number;
  horasProdutivas: number;
  horasImprodutivas: number;
  horasPorViagem: number;
  kmTotal: number;
  tipoPredominante: string | null;
  pesoKg: number;
  pesoMedioKg: number;
  pesoIdealKg: number | null;
  pctIdeal: number | null;
  /** HR produtiva da média da viagem até 100% da caixa (menor = melhor). */
  tempoEqEncher: number | null;
  /** true = kg médio já atingiu o ideal (tempo real); false = estimado pela média. */
  atingiuIdeal: boolean;
  estimado: boolean;
  tonPorHora: number;
  faixa: 'bom' | 'regular' | 'ruim' | null;
}

const MAPEAMENTO_MAX_LINHAS = 5000;
const MAPEAMENTO_MAX_REGISTROS = 25000;
/** Tamanho dos rankings de improdutividade por dimensão. */
const MAPEAMENTO_MAX_RANKING_TRECHOS = 30;

type AccTrechos = {
  viagens: number;
  horasTotais: number;
  horasProdutivas: number;
  horasImprodutivas: number;
  horasDeslocamentoInicial: number;
  horasEntreRotas: number;
  horasRetornoFinal: number;
  horasImprodutivasNaoDetalhadas: number;
  kmTotal: number;
  kmProdutivo: number;
  kmImprodutivo: number;
  kmDeslocamentoInicial: number;
  kmEntreRotas: number;
  kmRetornoFinal: number;
};

function novoAccTrechos(): AccTrechos {
  return {
    viagens: 0,
    horasTotais: 0,
    horasProdutivas: 0,
    horasImprodutivas: 0,
    horasDeslocamentoInicial: 0,
    horasEntreRotas: 0,
    horasRetornoFinal: 0,
    horasImprodutivasNaoDetalhadas: 0,
    kmTotal: 0,
    kmProdutivo: 0,
    kmImprodutivo: 0,
    kmDeslocamentoInicial: 0,
    kmEntreRotas: 0,
    kmRetornoFinal: 0,
  };
}

function somarTrechos(acc: AccTrechos, j: JornadaDecomposta, viagens: number): void {
  acc.viagens += viagens;
  acc.horasTotais += j.horasTotais;
  acc.horasProdutivas += j.horasProdutivas;
  acc.horasImprodutivas += j.horasImprodutivas;
  acc.horasDeslocamentoInicial += j.horasDeslocamentoInicial;
  acc.horasEntreRotas += j.horasEntreRotas;
  acc.horasRetornoFinal += j.horasRetornoFinal;
  acc.horasImprodutivasNaoDetalhadas += j.horasImprodutivasNaoDetalhadas;
  acc.kmTotal += j.kmTotal;
  acc.kmProdutivo += j.kmProdutivo;
  acc.kmImprodutivo += j.kmImprodutivo;
  acc.kmDeslocamentoInicial += j.kmDeslocamentoInicial;
  acc.kmEntreRotas += j.kmEntreRotas;
  acc.kmRetornoFinal += j.kmRetornoFinal;
}

function acumularEmMapa(
  mapa: Map<string, AccTrechos>,
  chave: string,
  j: JornadaDecomposta,
  viagens: number,
): void {
  let acc = mapa.get(chave);
  if (!acc) {
    acc = novoAccTrechos();
    mapa.set(chave, acc);
  }
  somarTrechos(acc, j, viagens);
}

function finalizarTrechos(chave: string, acc: AccTrechos): TrechosJornadaDimensao {
  return {
    chave,
    viagens: acc.viagens,
    horasTotais: round2(acc.horasTotais),
    horasProdutivas: round2(acc.horasProdutivas),
    horasImprodutivas: round2(acc.horasImprodutivas),
    horasDeslocamentoInicial: round2(acc.horasDeslocamentoInicial),
    horasEntreRotas: round2(acc.horasEntreRotas),
    horasRetornoFinal: round2(acc.horasRetornoFinal),
    horasImprodutivasNaoDetalhadas: round2(acc.horasImprodutivasNaoDetalhadas),
    kmTotal: round2(acc.kmTotal),
    kmProdutivo: round2(acc.kmProdutivo),
    kmImprodutivo: round2(acc.kmImprodutivo),
    kmDeslocamentoInicial: round2(acc.kmDeslocamentoInicial),
    kmEntreRotas: round2(acc.kmEntreRotas),
    kmRetornoFinal: round2(acc.kmRetornoFinal),
    percentualProdutivo: acc.horasTotais > 0
      ? round2((acc.horasProdutivas / acc.horasTotais) * 100)
      : 0,
    horasImprodutivasPorViagem: acc.viagens > 0
      ? round2(acc.horasImprodutivas / acc.viagens)
      : null,
    kmImprodutivoPorViagem: acc.viagens > 0 ? round2(acc.kmImprodutivo / acc.viagens) : null,
  };
}

function rankearTrechos(mapa: Map<string, AccTrechos>): TrechosJornadaDimensao[] {
  return [...mapa.entries()]
    .map(([chave, acc]) => finalizarTrechos(chave, acc))
    .filter((d) => d.horasImprodutivas > 0 || d.kmImprodutivo > 0)
    .sort((a, b) => b.horasImprodutivas - a.horasImprodutivas)
    .slice(0, MAPEAMENTO_MAX_RANKING_TRECHOS);
}

/**
 * Mapeamento operacional do ciclo: rota × motorista × placa com tempo e km.
 * Horas produtivas = dentro da rota; improdutivas = fora da unidade − produtivas.
 */
export async function getMapeamentoOperacional(
  servicoId: string,
  opts: { dataInicio?: string; dataFim?: string; data?: string } = {},
): Promise<MapeamentoOperacionalResult> {
  const uploadIds = await getUploadIds(servicoId);
  const { dataInicio, dataFim } = parsePeriodo(opts);
  const vazio: MapeamentoOperacionalResult = {
    resumo: {
      linhas: 0, truncado: false, rotas: 0, motoristas: 0, placas: 0,
      viagens: 0, kmTotal: 0, horasTotais: 0, horasProdutivas: 0,
      horasImprodutivas: 0, percentualProdutivo: 0, tonelagem: 0,
      horasDeslocamentoInicial: 0, horasEntreRotas: 0, horasRetornoFinal: 0,
      horasImprodutivasNaoDetalhadas: 0, kmProdutivo: 0, kmImprodutivo: 0,
      kmDeslocamentoInicial: 0, kmEntreRotas: 0, kmRetornoFinal: 0,
      registrosComTrecho: 0, registros: 0,
    },
    trechosPorPlaca: [],
    trechosPorMotorista: [],
    trechosPorRota: [],
    linhas: [],
    topRotasLentas: [],
    viagensPesoRota: [],
    dataInicio: dataInicio || null,
    dataFim: dataFim || null,
  };
  if (!uploadIds.length) return vazio;

  const servico = await AppDataSource.getRepository(Servico).findOne({
    where: { id: servicoId },
    select: ['id', 'contract_id'],
  });
  const contrato = servico
    ? await AppDataSource.getRepository(Contract).findOne({ where: { id: servico.contract_id } })
    : null;
  const cfgOp = contrato?.configOperacional;
  const densInput = densidadeOptsToInput({
    densidadeResiduoKgL: cfgOp?.densidadeResiduoKgL ?? null,
    densidadeKgL: cfgOp?.densidadeKgL || null,
  });

  const registros = await baseQb(uploadIds, dataInicio, dataFim)
    .select([
      'c.id',
      'c.dataSaida',
      'c.distrito',
      'c.regional',
      'c.motorista',
      'c.placa',
      'c.tipoCaminhao',
      'c.kmTotal',
      'c.pesoTotal',
      'c.horaSaida',
      'c.horaChegada',
      'c.horasForaUnidade',
      'c.tempoForaUnidade',
      'c.viagensPorRota',
      'c.numeroViagens',
      'c.peso1',
      'c.peso2',
      'c.peso3',
      'c.peso4',
      'c.kmRota1',
      'c.kmRota2',
      'c.kmRota3',
      'c.kmRota4',
      'c.horaRota1',
      'c.horaRota2',
      'c.horaRota3',
      'c.horaRota4',
      'c.dados',
    ])
    .orderBy('c.dataSaida', 'ASC')
    .take(MAPEAMENTO_MAX_REGISTROS + 1)
    .getMany();

  const truncadoRegistros = registros.length > MAPEAMENTO_MAX_REGISTROS;
  const lista = truncadoRegistros ? registros.slice(0, MAPEAMENTO_MAX_REGISTROS) : registros;
  if (!lista.length) return vazio;

  type Acc = {
    rota: string;
    motorista: string;
    placa: string;
    tipoCounts: Map<string, number>;
    dias: Set<string>;
    viagens: number;
    pesoKg: number;
    kmTotal: number;
    horasTotais: number;
    horasProdutivas: number;
    horasImprodutivas: number;
    trechos: AccTrechos;
  };

  const mapa = new Map<string, Acc>();
  const trechosPlaca = new Map<string, AccTrechos>();
  const trechosMotorista = new Map<string, AccTrechos>();
  const trechosRota = new Map<string, AccTrechos>();
  const trechosGeral = novoAccTrechos();
  let registrosComTrecho = 0;
  const porRota = new Map<string, {
    viagens: number;
    kmTotal: number;
    horasTotais: number;
    horasProdutivas: number;
    horasImprodutivas: number;
    pesoKg: number;
    tipoCounts: Map<string, number>;
  }>();

  let sumViagens = 0;
  let sumKm = 0;
  let sumPeso = 0;
  let sumTotais = 0;
  let sumProd = 0;
  let sumImprod = 0;
  const setRotas = new Set<string>();
  const setMotoristas = new Set<string>();
  const setPlacas = new Set<string>();
  const viagensPesoRota: ViagemPesoRotaItem[] = [];

  for (const reg of lista) {
    const rota = (reg.distrito || reg.regional || 'Não informado').trim() || 'Não informado';
    const motorista = (reg.motorista || 'Não informado').trim() || 'Não informado';
    const placa = (reg.placa || 'Não informado').trim() || 'Não informado';
    const chave = `${rota}\0${motorista}\0${placa}`;

    const obj = {
      ...reg,
      ...(reg.dados && typeof reg.dados === 'object' ? reg.dados : {}),
      horaSaida: reg.horaSaida,
      horaChegada: reg.horaChegada,
      horasForaUnidade: reg.horasForaUnidade,
      tempoForaUnidade: reg.tempoForaUnidade,
      dados: reg.dados,
    };
    const jornada = decomporJornadaRegistro(obj);
    const viagens = contarViagensPorRotaRegistro(obj);
    const km = Number(reg.kmTotal) || 0;
    const peso = Number(reg.pesoTotal) || 0;
    const dia = toIsoDate(reg.dataSaida);

    somarTrechos(trechosGeral, jornada, viagens);
    acumularEmMapa(trechosPlaca, placa, jornada, viagens);
    acumularEmMapa(trechosMotorista, motorista, jornada, viagens);
    acumularEmMapa(trechosRota, rota, jornada, viagens);
    if (jornada.trechos.length > 0) registrosComTrecho++;

    let acc = mapa.get(chave);
    if (!acc) {
      acc = {
        rota,
        motorista,
        placa,
        tipoCounts: new Map(),
        dias: new Set(),
        viagens: 0,
        pesoKg: 0,
        kmTotal: 0,
        horasTotais: 0,
        horasProdutivas: 0,
        horasImprodutivas: 0,
        trechos: novoAccTrechos(),
      };
      mapa.set(chave, acc);
    }
    somarTrechos(acc.trechos, jornada, viagens);
    acc.viagens += viagens;
    acc.pesoKg += peso;
    acc.kmTotal += km;
    acc.horasTotais += jornada.horasTotais;
    acc.horasProdutivas += jornada.horasProdutivas;
    acc.horasImprodutivas += jornada.horasImprodutivas;
    if (dia) acc.dias.add(dia);
    const tipo = (reg.tipoCaminhao || '').trim();
    if (tipo) acc.tipoCounts.set(tipo, (acc.tipoCounts.get(tipo) || 0) + viagens);

    let rAcc = porRota.get(rota);
    if (!rAcc) {
      rAcc = {
        viagens: 0, kmTotal: 0, horasTotais: 0, horasProdutivas: 0, horasImprodutivas: 0,
        pesoKg: 0, tipoCounts: new Map(),
      };
      porRota.set(rota, rAcc);
    }
    rAcc.viagens += viagens;
    rAcc.kmTotal += km;
    rAcc.horasTotais += jornada.horasTotais;
    rAcc.horasProdutivas += jornada.horasProdutivas;
    rAcc.horasImprodutivas += jornada.horasImprodutivas;
    rAcc.pesoKg += peso;
    const tipoNorm = normalizarTipoCaminhaoPeso(reg.tipoCaminhao);
    if (tipoNorm) rAcc.tipoCounts.set(tipoNorm, (rAcc.tipoCounts.get(tipoNorm) || 0) + viagens);

    sumViagens += viagens;
    sumKm += km;
    sumPeso += peso;
    sumTotais += jornada.horasTotais;
    sumProd += jornada.horasProdutivas;
    sumImprod += jornada.horasImprodutivas;
    setRotas.add(rota);
    setMotoristas.add(motorista);
    setPlacas.add(placa);

    const tipoNormViagem = normalizarTipoCaminhaoPeso(reg.tipoCaminhao);
    const pesoIdealViagem = tipoNormViagem
      ? calcularPesoIdealViagem({
        tipo: tipoNormViagem,
        placa: placa !== 'Não informado' ? placa : null,
        volumeOverrides: cfgOp?.volumeL || null,
        densidade: densInput,
        porPlaca: cfgOp?.densidadeKgLPorPlaca || null,
      }) || null
      : null;
    viagensPesoRota.push(...montarViagensPesoDoRegistro({
      data: dia,
      rota,
      placa,
      motorista,
      tipo: tipoNormViagem,
      pesos: [reg.peso1, reg.peso2, reg.peso3, reg.peso4],
      objHoras: obj,
      pesoIdealKg: pesoIdealViagem && pesoIdealViagem > 0 ? pesoIdealViagem : null,
      nViagens: viagens,
    }));
  }

  const linhasAll: LinhaMapeamentoOperacional[] = Array.from(mapa.values()).map((acc) => {
    let tipoCaminhao: string | null = null;
    let best = -1;
    for (const [t, n] of acc.tipoCounts) {
      if (n > best) {
        best = n;
        tipoCaminhao = t;
      }
    }
    const horasProdutivas = round2(acc.horasProdutivas);
    const horasTotais = round2(acc.horasTotais);
    const horasImprodutivas = round2(acc.horasImprodutivas);
    const tonelagem = round2(acc.pesoKg / 1000);
    const viagens = acc.viagens;
    const kmTotal = round2(acc.kmTotal);
    return {
      rota: acc.rota,
      motorista: acc.motorista,
      placa: acc.placa,
      tipoCaminhao,
      dias: acc.dias.size,
      viagens,
      tonelagem,
      kmTotal,
      horasTotais,
      horasProdutivas,
      horasImprodutivas,
      horasPorViagem: viagens > 0 ? round2(horasTotais / viagens) : 0,
      horasProdutivasPorViagem: viagens > 0 ? round2(horasProdutivas / viagens) : 0,
      kmPorViagem: viagens > 0 ? round2(kmTotal / viagens) : 0,
      tonPorHora: horasProdutivas > 0 ? round2(tonelagem / horasProdutivas) : 0,
      percentualProdutivo: horasTotais > 0 ? round2((horasProdutivas / horasTotais) * 100) : 0,
      horasDeslocamentoInicial: round2(acc.trechos.horasDeslocamentoInicial),
      horasEntreRotas: round2(acc.trechos.horasEntreRotas),
      horasRetornoFinal: round2(acc.trechos.horasRetornoFinal),
      horasImprodutivasNaoDetalhadas: round2(acc.trechos.horasImprodutivasNaoDetalhadas),
      kmProdutivo: round2(acc.trechos.kmProdutivo),
      kmImprodutivo: round2(acc.trechos.kmImprodutivo),
      kmDeslocamentoInicial: round2(acc.trechos.kmDeslocamentoInicial),
      kmEntreRotas: round2(acc.trechos.kmEntreRotas),
      kmRetornoFinal: round2(acc.trechos.kmRetornoFinal),
    };
  });

  linhasAll.sort((a, b) => b.horasProdutivas - a.horasProdutivas || b.viagens - a.viagens);
  const truncadoLinhas = linhasAll.length > MAPEAMENTO_MAX_LINHAS;
  const linhas = truncadoLinhas ? linhasAll.slice(0, MAPEAMENTO_MAX_LINHAS) : linhasAll;

  const rotasMontadas: TopRotaProdutividadeEncher[] = Array.from(porRota.entries())
    .map(([rota, r]) => {
      const horasProdutivas = round2(r.horasProdutivas);
      let tipoPredominante: string | null = null;
      let bestTipo = -1;
      for (const [t, n] of r.tipoCounts) {
        if (n > bestTipo) {
          bestTipo = n;
          tipoPredominante = t;
        }
      }
      const pesoIdealKg = tipoPredominante
        ? calcularPesoIdealViagem({
          tipo: normalizarTipoCaminhaoPeso(tipoPredominante),
          volumeOverrides: cfgOp?.volumeL || null,
          densidade: densInput,
          porPlaca: cfgOp?.densidadeKgLPorPlaca || null,
        }) || null
        : null;
      const pesoIdeal = pesoIdealKg && pesoIdealKg > 0 ? pesoIdealKg : null;
      const pesoMedioKg = r.viagens > 0 ? r.pesoKg / r.viagens : 0;
      const pctIdeal = pesoIdeal && pesoMedioKg > 0
        ? round2((pesoMedioKg / pesoIdeal) * 100)
        : null;
      const calc = pesoIdeal
        ? tempoParaEncherPorMedia({
          horasProd: r.horasProdutivas,
          pesoKg: r.pesoKg,
          pesoIdealKg: pesoIdeal,
          viagens: r.viagens,
        })
        : null;
      const tempoEqEncher = calc?.tempoH ?? null;
      const tipoFaixa = tipoParaTempoEncher(tipoPredominante);
      const faixaRaw = tempoEqEncher != null && tipoFaixa
        ? classificarTempoPorTipo(tempoEqEncher, tipoFaixa)
        : null;
      const faixa: TopRotaProdutividadeEncher['faixa'] =
        faixaRaw === 'bom' || faixaRaw === 'regular' || faixaRaw === 'ruim' ? faixaRaw : null;
      const tonelagem = r.pesoKg / 1000;
      return {
        rota,
        viagens: r.viagens,
        horasTotais: round2(r.horasTotais),
        horasProdutivas,
        horasImprodutivas: round2(r.horasImprodutivas),
        horasPorViagem: r.viagens > 0 ? round2(horasProdutivas / r.viagens) : 0,
        kmTotal: round2(r.kmTotal),
        tipoPredominante,
        pesoKg: round2(r.pesoKg),
        pesoMedioKg: round2(pesoMedioKg),
        pesoIdealKg: pesoIdeal != null ? round2(pesoIdeal) : null,
        pctIdeal,
        tempoEqEncher,
        atingiuIdeal: calc?.atingiuIdeal ?? false,
        estimado: calc?.estimado ?? false,
        tonPorHora: horasProdutivas > 0 ? round2(tonelagem / horasProdutivas) : 0,
        faixa,
      };
    })
    .filter((r) => r.viagens > 0 && r.horasProdutivas > 0);

  const comEncher = rotasMontadas.filter((r) => r.tempoEqEncher != null && r.tempoEqEncher > 0);
  const topRotasLentas = (comEncher.length ? comEncher : rotasMontadas)
    .sort((a, b) => {
      if (comEncher.length) {
        return (a.tempoEqEncher || 99) - (b.tempoEqEncher || 99)
          || (b.tonPorHora - a.tonPorHora);
      }
      return b.horasPorViagem - a.horasPorViagem;
    });

  const horasTotais = round2(sumTotais);
  const horasProdutivas = round2(sumProd);
  const horasImprodutivas = round2(sumImprod);

  return {
    resumo: {
      linhas: linhas.length,
      truncado: truncadoRegistros || truncadoLinhas,
      rotas: setRotas.size,
      motoristas: setMotoristas.size,
      placas: setPlacas.size,
      viagens: sumViagens,
      kmTotal: round2(sumKm),
      horasTotais,
      horasProdutivas,
      horasImprodutivas,
      percentualProdutivo: horasTotais > 0 ? round2((horasProdutivas / horasTotais) * 100) : 0,
      tonelagem: round2(sumPeso / 1000),
      horasDeslocamentoInicial: round2(trechosGeral.horasDeslocamentoInicial),
      horasEntreRotas: round2(trechosGeral.horasEntreRotas),
      horasRetornoFinal: round2(trechosGeral.horasRetornoFinal),
      horasImprodutivasNaoDetalhadas: round2(trechosGeral.horasImprodutivasNaoDetalhadas),
      kmProdutivo: round2(trechosGeral.kmProdutivo),
      kmImprodutivo: round2(trechosGeral.kmImprodutivo),
      kmDeslocamentoInicial: round2(trechosGeral.kmDeslocamentoInicial),
      kmEntreRotas: round2(trechosGeral.kmEntreRotas),
      kmRetornoFinal: round2(trechosGeral.kmRetornoFinal),
      registrosComTrecho,
      registros: lista.length,
    },
    trechosPorPlaca: rankearTrechos(trechosPlaca),
    trechosPorMotorista: rankearTrechos(trechosMotorista),
    trechosPorRota: rankearTrechos(trechosRota),
    linhas,
    topRotasLentas,
    viagensPesoRota,
    dataInicio: dataInicio || toIsoDate(lista[0]?.dataSaida),
    dataFim: dataFim || toIsoDate(lista[lista.length - 1]?.dataSaida),
  };
}

/** Rankings no formato esperado por getKpiOperacionalMotoristas. */
export async function getRankingsColetaSql(
  servicoId: string,
  opts: { dataInicio?: string; dataFim?: string; topN?: number } = {},
) {
  const agg = await getAgregacaoColeta(servicoId, { ...opts, topN: opts.topN || 100 });
  const motoristas = agg.porMotorista.map((m) => ({
    motorista: m.label,
    placa: m.placa || '',
    viagens: m.viagens,
    tonelagem: m.tonelagem,
    kmTotal: m.kmTotal,
    horasProdutivas: m.horasProdutivas,
    tonPorViagem: m.tonPorViagem,
    kmPorViagem: m.kmPorViagem,
    tonPorKm: m.kmTotal > 0 ? round2((m.tonelagem / m.kmTotal) * 10000) / 10000 : 0,
    tonPorHora: m.horasProdutivas > 0 ? round2(m.tonelagem / m.horasProdutivas) : 0,
  }));
  const coletores = agg.porPlaca.map((p) => ({
    placa: p.label,
    viagens: p.viagens,
    tonelagem: p.tonelagem,
    kmTotal: p.kmTotal,
    tonPorViagem: p.tonPorViagem,
  }));
  const rotas = agg.porDistrito.map((r) => ({
    rota: r.label,
    viagens: r.viagens,
    tonelagem: r.tonelagem,
    kmTotal: r.kmTotal,
    tonPorViagem: r.tonPorViagem,
  }));

  return {
    motoristas,
    coletores,
    rotas,
    rankings: {
      motoristas: separarMelhoresPiores(motoristas, (m) => m.tonelagem),
      coletores: separarMelhoresPiores(coletores, (c) => c.tonelagem),
      rotas: separarMelhoresPiores(rotas, (r) => r.tonelagem),
    },
    metadados: {
      totalViagens: agg.resumo.viagens,
      totalTonelagem: agg.resumo.pesoTotalTon,
      totalKm: agg.resumo.kmTotal,
      temMotorista: motoristas.length > 0,
      temRota: rotas.length > 0,
      temColetores: coletores.length > 0,
      colunaRota: 'distrito',
      colunaRotaLabel: 'Distrito / Regional',
      modo: 'coleta-sql',
    },
  };
}

/**
 * Resolve expressão de KPI de coleta via métricas SQL.
 * Retorna null se a fórmula não for reconhecida (fallback in-memory).
 */
export function resolverKpiColetaSql(
  expressao: string,
  metricas: MetricasColetaSql,
  valoresFixos: Record<string, number>,
): number | null {
  const expr = (expressao || '').trim();
  if (!expr) return null;

  const compact = expr.replace(/\s+/g, '').toUpperCase()
    .replace(/PESOTOTAL/g, 'PESO_TOTAL')
    .replace(/KMTOTAL/g, 'KM_TOTAL')
    .replace(/TIPOCAMINHAO|TIPODECAMINHAO/g, 'TIPO_CAMINHAO');

  const m = metricas;

  if (/^VIAGENS_POR_ROTA\(\)$/i.test(compact) || /^VIAGENS_VALIDADAS\(\)$/i.test(compact)) {
    return m.viagens;
  }
  if (/^COUNT\(\*\)$/i.test(compact)) return m.registros;
  if (/^SUM\(PESO_TOTAL\)$/i.test(compact) || /^SUM\(PESO\)$/i.test(compact)) return m.pesoTotalKg;
  if (/^SUM\(PESO_TOTAL\)\/1000$/i.test(compact)) return m.pesoTotalTon;
  if (/^SUM\(KM_TOTAL\)$/i.test(compact) || /^SUM\(KM\)$/i.test(compact)) return m.kmTotal;
  if (/COUNTDISTINCT\(MOTORISTA\)/i.test(compact) && /^COUNTDISTINCT\(MOTORISTA\)$/i.test(compact)) {
    return m.motoristas;
  }
  if (/COUNTDISTINCT\(PLACA\)/i.test(compact) && /^COUNTDISTINCT\(PLACA\)$/i.test(compact)) {
    return m.placas;
  }
  if (/COUNTDISTINCT\(REGIONAL\)/i.test(compact)) return m.regionais;
  if (/COUNTDISTINCT\(DISTRITO\)/i.test(compact)) return m.distritos;

  if (/^FATURAMENTO_EST\(/i.test(compact)) return m.faturamento;

  // SUM(PESO TOTAL)/1000 * VALOR_TRUCK (legado)
  if (/^SUM\(PESO_TOTAL\)\/1000\*VALOR_TRUCK$/i.test(compact)) {
    return m.pesoTotalTon * Number(valoresFixos.VALOR_TRUCK || valoresFixos.VALOR_TONELADA || 0);
  }

  // DIVIDE(a, b) padrões
  const div = (a: number, b: number) => (b > 0 ? a / b : 0);

  if (/^DIVIDE\(SUM\(PESO_TOTAL\),VIAGENS_POR_ROTA\(\)\)$/i.test(compact)) {
    return div(m.pesoTotalKg, m.viagens);
  }
  if (/^DIVIDE\(SUM\(PESO_TOTAL\)\/1000,VIAGENS_POR_ROTA\(\)\)$/i.test(compact)) {
    return div(m.pesoTotalTon, m.viagens);
  }
  if (/^DIVIDE\(SUM\(KM_TOTAL\),VIAGENS_POR_ROTA\(\)\)$/i.test(compact)) {
    return div(m.kmTotal, m.viagens);
  }
  if (/^DIVIDE\(SUM\(PESO_TOTAL\)\/1000,SUM\(KM_TOTAL\)\)$/i.test(compact)) {
    return div(m.pesoTotalTon, m.kmTotal);
  }
  if (/^DIVIDE\(FATURAMENTO_EST\([^)]*\),SUM\(KM_TOTAL\)\)$/i.test(compact)) {
    return div(m.faturamento, m.kmTotal);
  }
  if (/^DIVIDE\(FATURAMENTO_EST\([^)]*\),VIAGENS_POR_ROTA\(\)\)$/i.test(compact)) {
    return div(m.faturamento, m.viagens);
  }
  if (/HORAS_PRODUTIVAS/i.test(compact)) {
    if (/^DIVIDE\(HORAS_PRODUTIVAS\([^)]*\),VIAGENS_POR_ROTA\(\)\)$/i.test(compact)) {
      return div(m.horasProdutivas, m.viagens);
    }
    if (/^DIVIDE\(FATURAMENTO_EST\([^)]*\),HORAS_PRODUTIVAS\([^)]*\)\)$/i.test(compact)) {
      return div(m.faturamento, m.horasProdutivas);
    }
    if (/^HORAS_PRODUTIVAS\(/i.test(compact)) return m.horasProdutivas;
  }

  // DIVIDE(SUM(PESO TOTAL)/1000, COUNT DISTINCT(PLACA|MOTORISTA))
  const divDistinct = compact.match(
    /^DIVIDE\(SUM\(PESO_TOTAL\)\/1000,COUNTDISTINCT\((PLACA|MOTORISTA)\)\)$/i,
  );
  if (divDistinct) {
    const den = divDistinct[1].toUpperCase() === 'PLACA' ? m.placas : m.motoristas;
    return div(m.pesoTotalTon, den);
  }

  return null;
}

export function metricaExecutivaDeColetaSql(m: MetricasColetaSql, temValor: boolean) {
  const div = (a: number, b: number) => (b > 0 ? round2(a / b) : 0);
  return {
    viagens: m.viagens,
    qtdColetores: m.placas,
    pesoTotalTon: m.pesoTotalTon,
    kmTotal: m.kmTotal,
    horasProdutivas: m.horasProdutivas,
    horasMediaRotas: div(m.horasProdutivas, m.viagens),
    faturamento: m.faturamento,
    fatPorTipo: m.fatPorTipo,
    tonKm: div(m.pesoTotalTon, m.kmTotal),
    prodColetor: div(m.pesoTotalTon, m.placas || m.somaColetores),
    kmMedioViagem: div(m.kmTotal, m.viagens),
    tonMediaColeta: div(m.pesoTotalTon, m.viagens),
    receitaKm: div(m.faturamento, m.kmTotal),
    receitaHora: div(m.faturamento, m.horasProdutivas),
    temValor,
  };
}

/** Colunas de entidade mapeáveis para GROUP BY SQL. */
const EIXO_SQL: Record<string, { dim: string }> = {
  DATASAIDA: { dim: 'data' },
  DATADESSAIDA: { dim: 'data' },
  DATA: { dim: 'data' },
  DIA: { dim: 'data' },
  REGIONAL: { dim: 'regional' },
  REGIAO: { dim: 'regional' },
  DISTRITO: { dim: 'distrito' },
  BAIRRO: { dim: 'distrito' },
  PLACA: { dim: 'placa' },
  CAMINHAO: { dim: 'placa' },
  MOTORISTA: { dim: 'motorista' },
  TURNO: { dim: 'turno' },
  TIPOCAMINHAO: { dim: 'tipo' },
};

function normCol(s: string): string {
  return s.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
}

function dimSql(dim: string): string | null {
  switch (dim) {
    case 'data': return `TO_CHAR(c."dataSaida", 'YYYY-MM-DD')`;
    case 'regional': return `COALESCE(NULLIF(TRIM(c.regional), ''), 'N/A')`;
    case 'distrito': return `COALESCE(NULLIF(TRIM(c.distrito), ''), 'N/A')`;
    case 'placa': return `COALESCE(NULLIF(TRIM(c.placa), ''), 'N/A')`;
    case 'motorista': return `COALESCE(NULLIF(TRIM(c.motorista), ''), 'N/A')`;
    case 'turno': return `COALESCE(NULLIF(TRIM(c.turno), ''), 'N/A')`;
    case 'tipo': return `COALESCE(NULLIF(TRIM(c."tipoCaminhao"), ''), 'N/A')`;
    default: return null;
  }
}

function metricaSql(eixoYNorm: string): string {
  if (!eixoYNorm || eixoYNorm === 'COUNT' || eixoYNorm === 'COUNT(*)') return 'COUNT(*)::float';
  if (eixoYNorm.includes('PESO')) return sqlSumPesoEfetivoKg('c');
  if (eixoYNorm.includes('KM')) return 'COALESCE(SUM(COALESCE(c."kmTotal", 0)), 0)';
  if (eixoYNorm.includes('VIAGEM') || eixoYNorm.includes('VIAGENS')) {
    return sqlSumViagens('c');
  }
  if (eixoYNorm.includes('HORA')) {
    return `COALESCE(SUM(CASE WHEN c."horasForaUnidade" BETWEEN 0 AND 24 THEN c."horasForaUnidade" ELSE 0 END), 0)`;
  }
  return 'COUNT(*)::float';
}

/**
 * Agrega gráfico via SQL quando eixo X é coluna de entidade conhecida.
 * Retorna null se precisar fallback in-memory.
 */
export async function agregarGraficoColetaSql(
  servicoId: string,
  input: { eixoX: string; eixoY?: string; tipo?: string; topN?: number },
  filtros?: { dataInicio?: string; dataFim?: string },
): Promise<{ dados: { name: string; value: number }[]; total: number; processados: number } | null> {
  const eixoXNorm = normCol(input.eixoX || '');
  const map = EIXO_SQL[eixoXNorm];
  if (!map) return null;

  const uploadIds = await getUploadIds(servicoId);
  if (!uploadIds.length) return { dados: [], total: 0, processados: 0 };

  const { dataInicio, dataFim } = parsePeriodo(filtros || {});
  const dim = dimSql(map.dim);
  if (!dim) return null;

  const topN = Math.min(Math.max(input.topN || 10, 1), 100);
  const yExpr = input.tipo === 'pizza' ? 'COUNT(*)::float' : metricaSql(normCol(input.eixoY || ''));
  const isData = map.dim === 'data';

  const qb = baseQb(uploadIds, dataInicio, dataFim)
    .select([`${dim} AS name`, `${yExpr} AS value`])
    .groupBy(dim);

  if (isData) {
    qb.orderBy('name', 'ASC');
  } else {
    qb.orderBy('value', 'DESC').limit(topN);
  }

  const rows = await qb.getRawMany();
  const dados = rows.map((r) => ({
    name: String(r.name ?? 'N/A'),
    value: round2(Number(r.value || 0)),
  }));
  const total = dados.reduce((s, d) => s + d.value, 0);
  return { dados, total: round2(total), processados: dados.length };
}
