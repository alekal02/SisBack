import { encontrarValorColuna } from './FormulaEngine';
import { colunaEhPlaca, normalizarPlaca } from '../utils/normalizarPlaca';
import { detectarTodasColunas } from './metricaExecutivaService';
import { parseDataPlanilha } from '../utils/formatarDataPlanilha';
import { dateUtcParaIso } from '../utils/dateColumnTransformer';
import {
  TIPOS_CAMINHAO_ORDEM,
  criarContagemZeraTipos,
  normalizarTipoCaminhaoPeso,
  resolverLimitesPesoKg,
  resolverLimitesVolumeL,
  type LimitesPesoKg,
  type LimitesVolumeL,
  type TipoCaminhaoPeso,
} from '../config/pesoMaximoCaminhao';
import {
  contarViagensPorRotaRegistro,
  extrairPesosViagemRegistro,
  obterPesoTotalRegistro,
  sumarizarViagensPorRota,
} from './viagensPorRotaService';
import { detectarColunaRankingRotas } from './rankingOperacionalService';

/** Densidade do resíduo (kg/L) — referência gerencial para peso ideal da caixa média */
export const DENSIDADE_OTIMA_PADRAO = 0.55;

/** Normaliza densidade do contrato (kg/L). Aceita 0,01–5; inválido → undefined. */
export function normalizarDensidadeResiduoKgL(raw: unknown): number | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined;
  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.').trim());
  if (!Number.isFinite(n) || n <= 0 || n > 5) return undefined;
  return Math.round(n * 1000) / 1000;
}

/** Normaliza mapa de densidades por tipo (kg/L). */
export function normalizarMapaDensidadesKgL(
  raw: unknown,
): Partial<Record<TipoCaminhaoPeso, number>> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const out: Partial<Record<TipoCaminhaoPeso, number>> = {};
  for (const t of TIPOS_CAMINHAO_ORDEM) {
    const n = normalizarDensidadeResiduoKgL(obj[t]);
    if (n != null) out[t] = n;
  }
  return Object.keys(out).length ? out : {};
}

/** Normaliza mapa de densidades por placa (kg/L). Chaves = placas normalizadas. */
export function normalizarMapaDensidadesPorPlaca(
  raw: unknown,
): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const placa = normalizarPlaca(String(k || ''));
    const dens = normalizarDensidadeResiduoKgL(v);
    if (placa && dens != null) out[placa] = dens;
  }
  return out;
}

export interface FaixaPesoAnalise {
  label: string;
  quantidade: number;
  pct: number;
}

/**
 * Qualidade da viagem vs peso ideal do tipo (volume × densidade).
 *   < 50%            → Péssimo
 *   50% – < 90%      → Ruim
 *   90% – 110%       → Ótimo
 *   > 110%           → Excedido
 */
export const PCT_FAIXA_PESSIMO = 50;
export const PCT_FAIXA_RUIM_MAX = 90;
export const PCT_FAIXA_OTIMO_MAX = 110;

const FAIXAS_PESO: Array<{
  id: 'pessimo' | 'ruim' | 'otimo' | 'excedido';
  label: string;
}> = [
  { id: 'pessimo', label: 'PÉSSIMO (< 50% do ideal)' },
  { id: 'ruim', label: 'RUIM (50–90% do ideal)' },
  { id: 'otimo', label: 'ÓTIMO (90–110% do ideal)' },
  { id: 'excedido', label: 'EXCEDIDO (> 110% do ideal)' },
];

export function classificarFaixaVsIdeal(pctIdeal: number): (typeof FAIXAS_PESO)[number]['id'] {
  if (pctIdeal < PCT_FAIXA_PESSIMO) return 'pessimo';
  if (pctIdeal < PCT_FAIXA_RUIM_MAX) return 'ruim';
  if (pctIdeal <= PCT_FAIXA_OTIMO_MAX) return 'otimo';
  return 'excedido';
}

function idxFaixaPorId(id: (typeof FAIXAS_PESO)[number]['id']): number {
  return FAIXAS_PESO.findIndex((f) => f.id === id);
}

function pesoIdealDoTipo(
  tipo: TipoCaminhaoPeso,
  volumes: LimitesVolumeL,
  densidades: Record<TipoCaminhaoPeso, number>,
): number {
  const vol = volumes[tipo];
  const dens = densidades[tipo];
  if (!(vol > 0) || !(dens > 0)) return 0;
  return Math.round(vol * dens * 100) / 100;
}

/** Extremo de peso de uma viagem individual (campo pesoMedioKg = peso da viagem em kg). */
export interface RotaPesoExtremo {
  nome: string;
  pesoMedioKg: number;
  viagens: number;
}

/** Operação de um dia do ciclo (viagens + peso). */
export interface AnalisePesoDia {
  data: string;
  viagens: number;
  rotas: number;
  pesoTotalKg: number;
  pesoMedioKg: number;
}

/**
 * Rastro de origem do tipo de caminhão. A planilha manda; a dedução por peso
 * é só o último recurso, e o relatório precisa dizer quando ela foi usada.
 */
export interface FrotaTipoDeduzido {
  /** Placas cujo tipo o sistema deduziu pelo peso, sem a planilha declarar. */
  placas: number;
  porTipo: Record<TipoCaminhaoPeso, number>;
  placasLista: string[];
  /** Placas com tipo lido da coluna TIPO DE CAMINHÃO. */
  placasDeclaradas: number;
  /** Placas sem tipo e sem peso — ficam fora da contagem por tipo. */
  placasSemTipo: number;
}

export interface AnalisePesoColeta {
  numeroViagens: number;
  pesoMedioKg: number;
  /** Viagem de menor peso no período (nome = rota da viagem, quando houver) */
  rotaMinima: RotaPesoExtremo | null;
  /** Viagem de maior peso no período (nome = rota da viagem, quando houver) */
  rotaMaxima: RotaPesoExtremo | null;
  faixas: FaixaPesoAnalise[];
  /** Placas únicas por tipo (MINI + TOCO + BASCULANTE + TRUCK = soma) */
  tiposCaminhao: { MINI: number; TOCO: number; BASCULANTE: number; TRUCK: number; soma: number };
  /** Total de placas distintas no período */
  caminhoesUnicos: number;
  /** Quanto da contagem por tipo veio da planilha e quanto foi deduzido. */
  frotaTipoDeduzido: FrotaTipoDeduzido;
  /** Viagens classificadas nas faixas usando tipo deduzido pelo peso. */
  viagensTipoDeduzido: number;
  /** Caixa média da frota em litros (média ponderada dos volumes por tipo) */
  caixaMediaKg: number;
  densidadeOtima: number;
  mediaIdealKg: number;
  perdaTon: number;
  /** Série diária do ciclo — viagens e peso médio/total */
  porDia?: AnalisePesoDia[];
}

const COLUNAS_TIPO_CAMINHAO = [
  'TIPO DE CAMINHÃO',
  'TIPO DE CAMINHAO',
  'TIPO CAMINHAO',
  'TIPO_CAMINHAO',
  'TIPO VEICULO',
  'TIPO VEÍCULO',
];

const COLUNAS_PLACA = ['PLACA', 'VEICULO', 'VEÍCULO', 'VEICULO', 'CARRO'];

function fmtNum(v: number, dec = 2): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fmtPct(v: number): string {
  return `${Math.round(v).toLocaleString('pt-BR')}%`;
}

function inferirTipoPorPeso(peso: number, limites: LimitesPesoKg): TipoCaminhaoPeso {
  if (peso <= limites.MINI * 1.15) return 'MINI';
  if (peso <= limites.TOCO * 1.15) return 'TOCO';
  if (peso <= limites.BASCULANTE * 1.15) return 'BASCULANTE';
  return 'TRUCK';
}

function registroUnificado(reg: Record<string, unknown>): Record<string, unknown> {
  const raw: Record<string, unknown> = { ...reg };
  const dados = reg.dados;
  if (dados && typeof dados === 'object' && !Array.isArray(dados)) {
    for (const [k, v] of Object.entries(dados as Record<string, unknown>)) {
      if (v !== null && v !== undefined && v !== '') raw[k] = v;
    }
  }
  return raw;
}

function ehColunaTipoExplicita(col: string): boolean {
  const n = col
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '');
  if (!n.includes('TIPO')) return false;
  return (
    n.includes('TIPOCAMINHAO') ||
    n.includes('TIPODECAMINHAO') ||
    n.includes('TIPOVEICULO')
  );
}

/** Tipo de caminhão — nunca usa coluna genérica CAMINHAO (pode ser placa). */
function obterTipoCaminhaoRegistro(
  reg: Record<string, unknown>,
  colTipoOverride?: string,
): TipoCaminhaoPeso | null {
  const tipado = (reg as { tipoCaminhao?: string | null }).tipoCaminhao;
  if (tipado) {
    const t = normalizarTipoCaminhaoPeso(String(tipado));
    if (t) return t;
  }

  const raw = registroUnificado(reg);
  const cols = colTipoOverride?.trim()
    ? [colTipoOverride.trim()]
    : COLUNAS_TIPO_CAMINHAO;

  for (const col of cols) {
    if (!colTipoOverride && !ehColunaTipoExplicita(col)) continue;
    const v = encontrarValorColuna(raw, col);
    const t = normalizarTipoCaminhaoPeso(String(v ?? ''));
    if (t) return t;
  }

  return null;
}

/** Placa — prioriza campo tipado e coluna PLACA (não confunde com tipo). */
function obterPlacaRegistro(reg: Record<string, unknown>, colPlacaDetectada?: string): string {
  const tipada = (reg as { placa?: string | null }).placa;
  if (tipada) {
    const p = normalizarPlaca(String(tipada));
    if (p) return p;
  }

  const raw = registroUnificado(reg);
  for (const col of COLUNAS_PLACA) {
    const v = encontrarValorColuna(raw, col);
    if (v) {
      const p = normalizarPlaca(String(v));
      if (p) return p;
    }
  }

  if (colPlacaDetectada && !ehColunaTipoExplicita(colPlacaDetectada)) {
    const v = encontrarValorColuna(raw, colPlacaDetectada);
    if (v) {
      const p = normalizarPlaca(String(v));
      if (p) return p;
    }
  }

  return '';
}

export type OrigemTipoPlaca = 'planilha' | 'deduzido';

/**
 * Tipo dominante da placa. Prioriza o tipo declarado na planilha; só quando a
 * planilha não declara nada é que o tipo é deduzido pelo peso máximo da placa.
 * A origem volta junto para o relatório poder sinalizar o que foi dedução.
 */
function resolverTipoPlaca(
  placa: string,
  votosExplicitos: Map<string, Map<TipoCaminhaoPeso, number>>,
  maxPesoPorPlaca: Map<string, number>,
  limites: LimitesPesoKg,
): { tipo: TipoCaminhaoPeso; origem: OrigemTipoPlaca } | null {
  const m = votosExplicitos.get(placa);
  if (m && m.size > 0) {
    let best: TipoCaminhaoPeso | null = null;
    let bestN = 0;
    for (const [t, n] of m) {
      if (n > bestN) {
        bestN = n;
        best = t;
      }
    }
    if (best) return { tipo: best, origem: 'planilha' };
  }

  const pesoMax = maxPesoPorPlaca.get(placa) || 0;
  if (pesoMax <= 0) return null;
  return { tipo: inferirTipoPorPeso(pesoMax, limites), origem: 'deduzido' };
}

/**
 * Conta placas únicas por tipo de caminhão (coluna TIPO DE CAMINHÃO / tipoCaminhao).
 * Caixa média usa o volume (L) de cada tipo × quantidade de placas daquele tipo.
 */
export function contarFrotaPorTipoCaminhao(
  dados: Record<string, unknown>[],
  colPlaca: string,
  colTipo: string,
  colPeso: string,
  limites: LimitesPesoKg,
): {
  tiposCaminhao: { MINI: number; TOCO: number; BASCULANTE: number; TRUCK: number; soma: number };
  placasPorTipo: Record<TipoCaminhaoPeso, string[]>;
  caminhoesUnicos: number;
  tipoDeduzido: FrotaTipoDeduzido;
} {
  const placasPorTipo: Record<TipoCaminhaoPeso, Set<string>> = {
    MINI: new Set(),
    TOCO: new Set(),
    BASCULANTE: new Set(),
    TRUCK: new Set(),
  };
  const deduzidasPorTipo = criarContagemZeraTipos();
  const placasDeduzidas: string[] = [];
  let placasDeclaradas = 0;
  const votosExplicitos = new Map<string, Map<TipoCaminhaoPeso, number>>();
  const maxPesoPorPlaca = new Map<string, number>();
  const placasUnicas = new Set<string>();

  for (const reg of dados) {
    const placa = obterPlacaRegistro(reg, colPlaca);
    if (!placa) continue;
    placasUnicas.add(placa);

    const pesosViagem = extrairPesosViagemRegistro(reg, colPeso);
    const pesoTotal = obterPesoTotalRegistro(reg, colPeso);
    const refPeso = pesosViagem.length ? Math.max(...pesosViagem) : pesoTotal;
    if (refPeso > 0) {
      maxPesoPorPlaca.set(placa, Math.max(maxPesoPorPlaca.get(placa) || 0, refPeso));
    }

    const tipoDeclarado = obterTipoCaminhaoRegistro(reg, colTipo || undefined);
    if (!tipoDeclarado) continue;

    if (!votosExplicitos.has(placa)) votosExplicitos.set(placa, new Map());
    const votos = votosExplicitos.get(placa)!;
    votos.set(tipoDeclarado, (votos.get(tipoDeclarado) || 0) + 1);
  }

  for (const placa of placasUnicas) {
    const resolvido = resolverTipoPlaca(placa, votosExplicitos, maxPesoPorPlaca, limites);
    if (!resolvido) continue;
    placasPorTipo[resolvido.tipo].add(placa);
    if (resolvido.origem === 'deduzido') {
      deduzidasPorTipo[resolvido.tipo] += 1;
      placasDeduzidas.push(placa);
    } else {
      placasDeclaradas += 1;
    }
  }

  const tiposCaminhao = {
    MINI: placasPorTipo.MINI.size,
    TOCO: placasPorTipo.TOCO.size,
    BASCULANTE: placasPorTipo.BASCULANTE.size,
    TRUCK: placasPorTipo.TRUCK.size,
    soma:
      placasPorTipo.MINI.size
      + placasPorTipo.TOCO.size
      + placasPorTipo.BASCULANTE.size
      + placasPorTipo.TRUCK.size,
  };

  return {
    tiposCaminhao,
    placasPorTipo: {
      MINI: [...placasPorTipo.MINI],
      TOCO: [...placasPorTipo.TOCO],
      BASCULANTE: [...placasPorTipo.BASCULANTE],
      TRUCK: [...placasPorTipo.TRUCK],
    },
    caminhoesUnicos: placasUnicas.size,
    tipoDeduzido: {
      placas: placasDeduzidas.length,
      porTipo: deduzidasPorTipo,
      placasLista: placasDeduzidas.sort(),
      placasDeclaradas,
      placasSemTipo: placasUnicas.size - placasDeclaradas - placasDeduzidas.length,
    },
  };
}

/**
 * Caixa média (L) = Σ(volume tipo × quantidade) / Σ(quantidade).
 * Ex.: (6.000×5 + 15.000×17 + 19.000×6) / 28 = 14.250 L
 */
export function calcularCaixaMediaPorFrota(
  frota: { MINI: number; TOCO: number; BASCULANTE?: number; TRUCK: number },
  volumes: LimitesVolumeL,
): number {
  const basculante = frota.BASCULANTE ?? 0;
  const total = frota.MINI + frota.TOCO + basculante + frota.TRUCK;
  if (total <= 0) return 0;
  return (
    frota.MINI * volumes.MINI
    + frota.TOCO * volumes.TOCO
    + basculante * volumes.BASCULANTE
    + frota.TRUCK * volumes.TRUCK
  ) / total;
}

/** Peso ideal (kg) = caixa média (L) × densidade do resíduo (kg/L). Ex.: 14.250 × 0,55 = 7.837,50 kg. */
export function calcularMediaIdealKg(caixaMediaL: number, densidadeResiduoKgL: number): number {
  if (caixaMediaL <= 0 || densidadeResiduoKgL <= 0) return 0;
  return Math.round(caixaMediaL * densidadeResiduoKgL * 100) / 100;
}

/**
 * Peso ideal da frota com densidade por tipo:
 * média ponderada de (volume[tipo] × dens[tipo]) pela contagem da frota.
 *
 * Com `placasPorTipo` e `densPorPlaca`, cada caminhão entra com a sua própria
 * densidade — um veículo com densidade diferente do tipo não é mais diluído.
 */
export function calcularMediaIdealKgPorTipo(
  frota: { MINI: number; TOCO: number; BASCULANTE?: number; TRUCK: number },
  volumes: LimitesVolumeL,
  densidades: Record<TipoCaminhaoPeso, number>,
  opts?: {
    placasPorTipo?: Record<TipoCaminhaoPeso, string[]> | null;
    densPorPlaca?: Record<string, number> | null;
  },
): { mediaIdealKg: number; densidadeMedia: number } {
  const basculante = frota.BASCULANTE ?? 0;
  const total = frota.MINI + frota.TOCO + basculante + frota.TRUCK;
  if (total <= 0) return { mediaIdealKg: 0, densidadeMedia: DENSIDADE_OTIMA_PADRAO };

  const densEfetiva = { ...densidades };
  const placasPorTipo = opts?.placasPorTipo;
  const densPorPlaca = opts?.densPorPlaca;
  if (placasPorTipo && densPorPlaca && Object.keys(densPorPlaca).length > 0) {
    for (const tipo of TIPOS_CAMINHAO_ORDEM) {
      const placas = placasPorTipo[tipo];
      if (!placas?.length) continue;
      const soma = placas.reduce(
        (s, placa) => s + (densPorPlaca[normalizarPlaca(placa)] ?? densidades[tipo]),
        0,
      );
      densEfetiva[tipo] = soma / placas.length;
    }
  }

  const somaIdeal =
    frota.MINI * volumes.MINI * densEfetiva.MINI
    + frota.TOCO * volumes.TOCO * densEfetiva.TOCO
    + basculante * volumes.BASCULANTE * densEfetiva.BASCULANTE
    + frota.TRUCK * volumes.TRUCK * densEfetiva.TRUCK;
  const somaDens =
    frota.MINI * densEfetiva.MINI
    + frota.TOCO * densEfetiva.TOCO
    + basculante * densEfetiva.BASCULANTE
    + frota.TRUCK * densEfetiva.TRUCK;
  return {
    mediaIdealKg: Math.round((somaIdeal / total) * 100) / 100,
    densidadeMedia: Math.round((somaDens / total) * 1000) / 1000,
  };
}

const VALORES_IGNORADOS_ROTA = new Set(['', '-', '--', 'N/D', 'ND', 'N/A', 'NA', '0', 'NULL', 'NONE']);

function obterNomeRotaRegistro(reg: Record<string, unknown>, colRota: string): string {
  if (!colRota) return '';
  const v = String(encontrarValorColuna(registroUnificado(reg), colRota) || '').trim();
  if (!v || VALORES_IGNORADOS_ROTA.has(v.toUpperCase())) return '';
  if (/^\d{5,}$/.test(v)) return '';
  return v;
}

/**
 * Menor e maior peso de viagem individual no ciclo.
 * Usa SOMENTE PESO 1–4 da planilha (nunca PESO TOTAL da rota).
 * `nome` guarda a rota da viagem (tooltip), não um agregado da rota.
 */
function calcularExtremosViagens(
  dados: Record<string, unknown>[],
  _colPeso: string,
  colRota: string,
): { rotaMinima: RotaPesoExtremo | null; rotaMaxima: RotaPesoExtremo | null } {
  let rotaMinima: RotaPesoExtremo | null = null;
  let rotaMaxima: RotaPesoExtremo | null = null;

  for (const reg of dados) {
    // Respeita CONTADOR DE VIAGENS — ignora PESO 2–4 extras na mesma linha
    const pesosViagem = extrairPesosViagemRegistro(reg, _colPeso);
    if (pesosViagem.length === 0) continue;

    const nomeRota = obterNomeRotaRegistro(reg, colRota) || '—';

    for (const peso of pesosViagem) {
      if (!(peso > 0)) continue;
      const pesoKg = Math.round(peso * 100) / 100;
      const item: RotaPesoExtremo = {
        nome: nomeRota,
        pesoMedioKg: pesoKg,
        viagens: 1,
      };
      if (!rotaMinima || pesoKg < rotaMinima.pesoMedioKg) rotaMinima = item;
      if (!rotaMaxima || pesoKg > rotaMaxima.pesoMedioKg) rotaMaxima = item;
    }
  }

  return { rotaMinima, rotaMaxima };
}

function formatarPesoExtremoRota(r: RotaPesoExtremo | null): string {
  if (!r) return '—';
  return fmtNum(r.pesoMedioKg, 2);
}

function registrarFaixaVsIdeal(
  faixaContagem: number[],
  peso: number,
  tipo: TipoCaminhaoPeso | null,
  volumes: LimitesVolumeL,
  densidades: Record<TipoCaminhaoPeso, number>,
  limites: LimitesPesoKg,
  densPlaca?: number | null,
): { status: 'classificado' | 'sem_ideal' | 'ignorado'; tipoDeduzido: boolean } {
  if (!(peso > 0)) return { status: 'ignorado', tipoDeduzido: false };
  const tipoDeduzido = tipo == null;
  const tipoEfetivo = tipo ?? inferirTipoPorPeso(peso, limites);
  const dens = (densPlaca != null && densPlaca > 0) ? densPlaca : densidades[tipoEfetivo];
  const vol = volumes[tipoEfetivo];
  const ideal = (vol > 0 && dens > 0) ? Math.round(vol * dens * 100) / 100 : 0;
  if (!(ideal > 0)) return { status: 'sem_ideal', tipoDeduzido };
  const pctIdeal = (peso / ideal) * 100;
  const idx = idxFaixaPorId(classificarFaixaVsIdeal(pctIdeal));
  if (idx >= 0) faixaContagem[idx]++;
  return { status: 'classificado', tipoDeduzido };
}

function isoDataRegistro(reg: Record<string, unknown>, colData: string): string | null {
  const raw = colData
    ? (reg[colData] ?? encontrarValorColuna(reg, colData))
    : (reg.dataSaida ?? reg['DATA SAIDA'] ?? reg['DATA']);
  const parsed = parseDataPlanilha(raw);
  if (!parsed || isNaN(parsed.getTime())) return null;
  return dateUtcParaIso(parsed);
}

export function agruparPesoPorDia(
  dados: Record<string, unknown>[],
  colData: string,
  colPeso: string,
): AnalisePesoDia[] {
  const mapa = new Map<string, { viagens: number; pesoTotalKg: number; rotas: number }>();
  for (const reg of dados) {
    const iso = isoDataRegistro(reg, colData);
    if (!iso) continue;
    const viagens = contarViagensPorRotaRegistro(reg);
    const pesoTotal = obterPesoTotalRegistro(reg, colPeso);
    if (viagens <= 0 && !(pesoTotal > 0)) continue;
    const atual = mapa.get(iso) || { viagens: 0, pesoTotalKg: 0, rotas: 0 };
    atual.viagens += viagens > 0 ? viagens : 0;
    atual.pesoTotalKg += pesoTotal > 0 ? pesoTotal : 0;
    atual.rotas += 1;
    mapa.set(iso, atual);
  }
  return [...mapa.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([data, v]) => ({
      data,
      viagens: v.viagens,
      rotas: v.rotas,
      pesoTotalKg: Math.round(v.pesoTotalKg * 100) / 100,
      pesoMedioKg: v.viagens > 0 ? Math.round((v.pesoTotalKg / v.viagens) * 100) / 100 : 0,
    }));
}

/**
 * Análise de peso por viagem — métricas gerenciais alinhadas à planilha:
 * - Viagens: VIAGENS_POR_ROTA() (soma CONTADOR DE VIAGENS)
 * - Peso médio: SUM(PESO TOTAL) / VIAGENS_POR_ROTA()
 * - Faixas: qualidade vs peso ideal do tipo (volume × densidade)
 * - Mín/Máx: menor e maior peso de viagem individual no ciclo
 * - Caixa média: frota por TIPO DE CAMINHÃO × volume (L) de cada tipo
 */
export function analisarPesoColeta(
  dados: Record<string, unknown>[],
  servicoId: string,
  opts?: {
    densidadeOtima?: number;
    densidadeKgL?: Partial<Record<TipoCaminhaoPeso, number>> | null;
    densidadeKgLPorPlaca?: Record<string, number> | null;
    limitesPeso?: Partial<LimitesPesoKg>;
    limitesVolume?: Partial<LimitesVolumeL>;
    colunaTipoCaminhao?: string;
  },
): AnalisePesoColeta | null {
  if (!dados?.length) return null;

  const cols = detectarTodasColunas(dados, servicoId);
  const colPeso = cols.colPeso;
  if (!colPeso) return null;

  const limites = resolverLimitesPesoKg(opts?.limitesPeso);
  const volumes = resolverLimitesVolumeL(opts?.limitesVolume);
  const densGlobal = normalizarDensidadeResiduoKgL(opts?.densidadeOtima) ?? DENSIDADE_OTIMA_PADRAO;
  const densidades: Record<TipoCaminhaoPeso, number> = {
    MINI: normalizarDensidadeResiduoKgL(opts?.densidadeKgL?.MINI) ?? densGlobal,
    TOCO: normalizarDensidadeResiduoKgL(opts?.densidadeKgL?.TOCO) ?? densGlobal,
    BASCULANTE: normalizarDensidadeResiduoKgL(opts?.densidadeKgL?.BASCULANTE) ?? densGlobal,
    TRUCK: normalizarDensidadeResiduoKgL(opts?.densidadeKgL?.TRUCK) ?? densGlobal,
  };
  const densPorPlaca = normalizarMapaDensidadesPorPlaca(opts?.densidadeKgLPorPlaca);
  const colTipo = opts?.colunaTipoCaminhao?.trim() || cols.colTipo || '';

  let totalPesoKg = 0;
  let viagensTipoDeduzido = 0;
  const faixaContagem = FAIXAS_PESO.map(() => 0);

  const colRota = detectarColunaRankingRotas(dados);

  for (const reg of dados) {
    const pesoTotal = obterPesoTotalRegistro(reg, colPeso);
    const viagensReg = contarViagensPorRotaRegistro(reg);
    // Faixas: PESO 1–4 limitado ao CONTADOR DE VIAGENS (não conta peso extra da linha)
    const pesosViagem = extrairPesosViagemRegistro(reg, colPeso);

    if (viagensReg <= 0 && pesoTotal <= 0 && pesosViagem.length === 0) continue;

    if (pesoTotal > 0) totalPesoKg += pesoTotal;

    const tipoReg = obterTipoCaminhaoRegistro(reg, colTipo || undefined);
    const placaReg = normalizarPlaca(
      String(
        (cols.colPlaca ? encontrarValorColuna(reg, cols.colPlaca) : null)
        ?? (reg as any).placa
        ?? (reg as any).PLACA
        ?? '',
      ),
    );
    const densPlaca = placaReg ? densPorPlaca[placaReg] : undefined;
    for (const p of pesosViagem) {
      const r = registrarFaixaVsIdeal(
        faixaContagem, p, tipoReg, volumes, densidades, limites, densPlaca,
      );
      if (r.status === 'classificado' && r.tipoDeduzido) viagensTipoDeduzido += 1;
    }
  }

  const totalViagens = sumarizarViagensPorRota(dados);
  if (totalViagens <= 0) return null;

  const pesoMedioKg = totalPesoKg > 0 ? totalPesoKg / totalViagens : 0;
  const { rotaMinima, rotaMaxima } = calcularExtremosViagens(dados, colPeso, colRota);

  const { tiposCaminhao, placasPorTipo, caminhoesUnicos, tipoDeduzido } = contarFrotaPorTipoCaminhao(
    dados,
    cols.colPlaca,
    colTipo,
    colPeso,
    limites,
  );

  const caixaMediaKg = Math.round(calcularCaixaMediaPorFrota(tiposCaminhao, volumes) * 100) / 100;
  const { mediaIdealKg, densidadeMedia } = calcularMediaIdealKgPorTipo(
    tiposCaminhao,
    volumes,
    densidades,
    { placasPorTipo, densPorPlaca },
  );
  const densidadeOtima = densidadeMedia;
  const perdaTon = ((pesoMedioKg - mediaIdealKg) * totalViagens) / 1000;

  const totalClassificados = faixaContagem.reduce((a, b) => a + b, 0);
  const faixas: FaixaPesoAnalise[] = FAIXAS_PESO.map((f, i) => ({
    label: f.label,
    quantidade: faixaContagem[i],
    pct: totalClassificados > 0 ? (faixaContagem[i] / totalClassificados) * 100 : 0,
  }));

  const porDia = agruparPesoPorDia(dados, cols.colData || '', colPeso);

  return {
    numeroViagens: totalViagens,
    pesoMedioKg: Math.round(pesoMedioKg * 100) / 100,
    rotaMinima,
    rotaMaxima,
    faixas,
    tiposCaminhao,
    caminhoesUnicos,
    frotaTipoDeduzido: tipoDeduzido,
    viagensTipoDeduzido,
    caixaMediaKg,
    densidadeOtima,
    mediaIdealKg,
    perdaTon: Math.round(perdaTon * 100) / 100,
    porDia,
  };
}

export interface LinhaComparacaoAnalisePeso {
  chave: string;
  nome: string;
  secao: 'operacao' | 'faixa' | 'frota' | 'cenario';
  formato: string;
  valores: Record<string, { valor: number | null; formatado: string; formato: string }>;
  analise?: {
    min: number | null;
    max: number | null;
    media: number | null;
    amplitude: number | null;
    amplitudePct: number | null;
    melhorId: string | null;
    piorId: string | null;
    variacoes: Record<string, { pctVsMelhor: number | null; pctVsMedia: number | null }>;
  };
}

function celula(valor: number | null, formatado: string, formato = 'numero') {
  return { valor, formatado, formato };
}

function montarAnaliseLinha(
  valores: Record<string, { valor: number | null; formatado: string; formato: string }>,
  servicoIds: string[],
) {
  const nums = servicoIds
    .map((id) => ({ id, valor: valores[id]?.valor }))
    .filter((x): x is { id: string; valor: number } => x.valor !== null && !isNaN(x.valor));

  if (nums.length < 2) {
    return {
      min: null, max: null, media: null, amplitude: null, amplitudePct: null,
      melhorId: null, piorId: null, variacoes: {} as Record<string, { pctVsMelhor: number | null; pctVsMedia: number | null }>,
    };
  }

  const vals = nums.map((n) => n.valor);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const media = vals.reduce((a, b) => a + b, 0) / vals.length;
  const melhorId = nums.find((n) => n.valor === max)?.id || null;
  const piorId = nums.find((n) => n.valor === min)?.id || null;
  const variacoes: Record<string, { pctVsMelhor: number | null; pctVsMedia: number | null }> = {};
  for (const n of nums) {
    variacoes[n.id] = {
      pctVsMelhor: max !== 0 ? Math.round(((n.valor - max) / Math.abs(max)) * 10000) / 100 : null,
      pctVsMedia: media !== 0 ? Math.round(((n.valor - media) / Math.abs(media)) * 10000) / 100 : null,
    };
  }
  return {
    min, max, media: Math.round(media * 100) / 100,
    amplitude: max - min,
    amplitudePct: media !== 0 ? Math.round(((max - min) / Math.abs(media)) * 10000) / 100 : null,
    melhorId, piorId, variacoes,
  };
}

/** Converte análises por serviço em linhas do comparativo (mesmo formato da matriz KPI). */
export function montarLinhasComparacaoAnalisePeso(
  analises: Map<string, AnalisePesoColeta | null>,
  servicoIds: string[],
): LinhaComparacaoAnalisePeso[] {
  const get = (id: string) => analises.get(id);

  const defs: Array<{
    chave: string;
    nome: string;
    secao: LinhaComparacaoAnalisePeso['secao'];
    fmt: (a: AnalisePesoColeta) => { valor: number | null; formatado: string; formato?: string };
  }> = [
    {
      chave: 'peso:num_viagens',
      nome: 'Número de viagens',
      secao: 'operacao',
      fmt: (a) => ({ valor: a.numeroViagens, formatado: fmtNum(a.numeroViagens, 0), formato: 'numero' }),
    },
    {
      chave: 'peso:peso_medio',
      nome: 'Peso médio',
      secao: 'operacao',
      fmt: (a) => ({ valor: a.pesoMedioKg, formatado: fmtNum(a.pesoMedioKg, 2), formato: 'numero' }),
    },
    {
      chave: 'peso:minimo',
      nome: 'Mínimo',
      secao: 'operacao',
      fmt: (a) => ({
        valor: a.rotaMinima?.pesoMedioKg ?? null,
        formatado: formatarPesoExtremoRota(a.rotaMinima),
        formato: 'numero',
      }),
    },
    {
      chave: 'peso:maximo',
      nome: 'Máximo',
      secao: 'operacao',
      fmt: (a) => ({
        valor: a.rotaMaxima?.pesoMedioKg ?? null,
        formatado: formatarPesoExtremoRota(a.rotaMaxima),
        formato: 'numero',
      }),
    },
  ];

  for (let i = 0; i < FAIXAS_PESO.length; i++) {
    const label = FAIXAS_PESO[i].label;
    defs.push({
      chave: `peso:faixa:${i}`,
      nome: label,
      secao: 'faixa',
      fmt: (a) => {
        const f = a.faixas[i];
        return {
          valor: f.quantidade,
          formatado: `${fmtNum(f.quantidade, 0)} (${fmtPct(f.pct)})`,
          formato: 'texto',
        };
      },
    });
  }

  defs.push(
    {
      chave: 'peso:tipo:mini',
      nome: 'MINI',
      secao: 'frota',
      fmt: (a) => ({ valor: a.tiposCaminhao.MINI, formatado: fmtNum(a.tiposCaminhao.MINI, 0), formato: 'numero' }),
    },
    {
      chave: 'peso:tipo:toco',
      nome: 'TOCO',
      secao: 'frota',
      fmt: (a) => ({ valor: a.tiposCaminhao.TOCO, formatado: fmtNum(a.tiposCaminhao.TOCO, 0), formato: 'numero' }),
    },
    {
      chave: 'peso:tipo:basculante',
      nome: 'BASCULANTE',
      secao: 'frota',
      fmt: (a) => ({
        valor: a.tiposCaminhao.BASCULANTE,
        formatado: fmtNum(a.tiposCaminhao.BASCULANTE, 0),
        formato: 'numero',
      }),
    },
    {
      chave: 'peso:tipo:truck',
      nome: 'TRUCK',
      secao: 'frota',
      fmt: (a) => ({ valor: a.tiposCaminhao.TRUCK, formatado: fmtNum(a.tiposCaminhao.TRUCK, 0), formato: 'numero' }),
    },
    {
      chave: 'peso:tipo:soma',
      nome: 'SOMA',
      secao: 'frota',
      fmt: (a) => ({ valor: a.tiposCaminhao.soma, formatado: fmtNum(a.tiposCaminhao.soma, 0), formato: 'numero' }),
    },
    {
      chave: 'peso:caminhoes_unicos',
      nome: 'Caminhões (placas únicas)',
      secao: 'frota',
      fmt: (a) => ({ valor: a.caminhoesUnicos, formatado: fmtNum(a.caminhoesUnicos, 0), formato: 'numero' }),
    },
    {
      chave: 'peso:caixa_media',
      nome: 'Caixa média (L)',
      secao: 'cenario',
      fmt: (a) => ({ valor: a.caixaMediaKg, formatado: fmtNum(a.caixaMediaKg, 2), formato: 'numero' }),
    },
    {
      chave: 'peso:densidade_otima',
      nome: 'Densidade do resíduo (kg/L)',
      secao: 'cenario',
      fmt: (a) => ({ valor: a.densidadeOtima, formatado: fmtNum(a.densidadeOtima, 2), formato: 'numero' }),
    },
    {
      chave: 'peso:media_ideal',
      nome: 'Peso ideal (kg)',
      secao: 'cenario',
      fmt: (a) => {
        const valor = calcularMediaIdealKg(a.caixaMediaKg, a.densidadeOtima);
        return { valor, formatado: fmtNum(valor, 2), formato: 'numero' };
      },
    },
    {
      chave: 'peso:cenario',
      nome: 'Cenário',
      secao: 'cenario',
      fmt: (a) => ({
        valor: a.perdaTon,
        formatado: a.perdaTon < 0 ? 'PERDA' : a.perdaTon > 0 ? 'SUPERÁVIT' : 'NEUTRO',
        formato: 'texto',
      }),
    },
    {
      chave: 'peso:perda_ton',
      nome: 'Resultado',
      secao: 'cenario',
      fmt: (a) => {
        const abs = fmtNum(Math.abs(a.perdaTon), 2);
        const sinal = a.perdaTon < 0 ? '- ' : a.perdaTon > 0 ? '+ ' : '';
        return {
          valor: a.perdaTon,
          formatado: `${sinal}${abs} TON`,
          formato: 'texto',
        };
      },
    },
  );

  return defs.map((def) => {
    const valores: Record<string, { valor: number | null; formatado: string; formato: string }> = {};
    let formatoLinha = 'numero';
    for (const sid of servicoIds) {
      const a = get(sid);
      if (!a) {
        valores[sid] = celula(null, '—');
      } else {
        const c = def.fmt(a);
        formatoLinha = c.formato || 'numero';
        valores[sid] = celula(c.valor, c.formatado, formatoLinha);
      }
    }
    const analise = montarAnaliseLinha(valores, servicoIds);
    return {
      chave: def.chave,
      nome: def.nome,
      secao: def.secao,
      formato: formatoLinha,
      valores,
      analise,
    };
  });
}
