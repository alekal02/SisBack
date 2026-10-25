/* ============================================================
   FICHA DA ROTA NO CICLO

   O estudo de rotas existente olha um dia isolado. Aqui a rota
   passa a ter histórico dentro do ciclo, o que revela dois
   problemas que o relatório diário não mostra:

   - rota INSTÁVEL: mesma rota com KM muito diferente dia a dia
     (execução fora do trajeto ou erro de apontamento);
   - rota em DEGRADAÇÃO: tonelada por viagem caindo ao longo
     do ciclo, mesmo que cada dia isolado pareça aceitável.

   Usa mediana em vez de média, porque um único dia atípico
   distorce a média e esconde o comportamento normal da rota.
   ============================================================ */

import AppDataSource from '../database/data-source';
import { ColetaData } from '../entities/ColetaData';
import { PlanilhaUpload } from '../entities/PlanilhaUpload';
import { aplicarFiltroViagensValidasDashboard } from './validacaoViagemService';
import { contarViagensPorRotaRegistro, obterPesoTotalRegistro } from './viagensPorRotaService';
import { calcularHorasNasRotasRegistro } from './horasProdutivasService';

/** Coeficiente de variação do KM diário acima disto = rota instável (%). */
export const CV_KM_INSTAVEL = 30;
/** Coeficiente de variação da tonelada por viagem acima disto = carga irregular (%). */
export const CV_TON_INSTAVEL = 25;
/** Variação mínima entre metades do ciclo para virar tendência (%). */
export const TENDENCIA_MIN_PCT = 8;
/** Dias com operação mínimos para calcular tendência. */
export const MIN_DIAS_TENDENCIA = 4;
/** Teto de registros lidos por consulta. */
const MAX_REGISTROS = 25000;

export type DirecaoTendencia = 'melhorando' | 'estavel' | 'piorando';

export interface DiaRotaCiclo {
  data: string;
  viagens: number;
  toneladas: number;
  km: number;
  horasProdutivas: number;
  /** Toneladas por viagem no dia. */
  tonPorViagem: number | null;
}

export interface TendenciaRotaCiclo {
  direcao: DirecaoTendencia;
  /** Variação da mediana de ton/viagem entre a 1ª e a 2ª metade do ciclo (%). */
  variacaoPct: number;
  primeiraMetade: number;
  segundaMetade: number;
}

export interface FichaRotaCiclo {
  rota: string;
  tipoPredominante: string | null;
  diasComOperacao: number;
  viagens: number;
  toneladas: number;
  km: number;
  horasProdutivas: number;

  /** Comportamento normal da rota (mediana dos dias). */
  medianaViagensDia: number | null;
  medianaTonDia: number | null;
  medianaKmDia: number | null;
  medianaTonPorViagem: number | null;

  /** Dispersão dia a dia — quanto a rota se repete. */
  cvKmDia: number | null;
  cvTonPorViagem: number | null;
  kmDiaMin: number | null;
  kmDiaMax: number | null;

  tendencia: TendenciaRotaCiclo | null;
  /** KM diário disperso demais para a rota ser considerada repetível. */
  instavelKm: boolean;
  /** Carga por viagem oscilando demais. */
  instavelCarga: boolean;
  alertas: string[];

  porDia: DiaRotaCiclo[];
}

export interface FichaRotasCicloResult {
  rotas: FichaRotaCiclo[];
  resumo: {
    rotas: number;
    rotasInstaveis: number;
    rotasPiorando: number;
    rotasMelhorando: number;
    diasPeriodo: number | null;
    registros: number;
    truncado: boolean;
  };
  dataInicio: string | null;
  dataFim: string | null;
}

function arred(n: number, casas = 2): number {
  const f = 10 ** casas;
  return Math.round(n * f) / f;
}

/** Mediana de uma lista (ignora vazios). */
export function mediana(valores: number[]): number | null {
  const lista = valores.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!lista.length) return null;
  const meio = Math.floor(lista.length / 2);
  return lista.length % 2 === 1
    ? lista[meio]
    : arred((lista[meio - 1] + lista[meio]) / 2);
}

/**
 * Coeficiente de variação (desvio-padrão ÷ média × 100).
 * Mede repetibilidade: 10% = rota previsível, 60% = rota diferente todo dia.
 */
export function coeficienteVariacao(valores: number[]): number | null {
  const lista = valores.filter((v) => Number.isFinite(v) && v > 0);
  if (lista.length < 2) return null;
  const media = lista.reduce((s, v) => s + v, 0) / lista.length;
  if (media <= 0) return null;
  const variancia = lista.reduce((s, v) => s + (v - media) ** 2, 0) / lista.length;
  return arred((Math.sqrt(variancia) / media) * 100, 1);
}

/** Tendência de ton/viagem comparando a primeira e a segunda metade dos dias. */
export function calcularTendencia(dias: DiaRotaCiclo[]): TendenciaRotaCiclo | null {
  const comCarga = dias.filter((d) => d.tonPorViagem != null && d.tonPorViagem > 0);
  if (comCarga.length < MIN_DIAS_TENDENCIA) return null;

  const corte = Math.floor(comCarga.length / 2);
  const primeira = mediana(comCarga.slice(0, corte).map((d) => d.tonPorViagem as number));
  const segunda = mediana(comCarga.slice(comCarga.length - corte).map((d) => d.tonPorViagem as number));
  if (primeira == null || segunda == null || primeira <= 0) return null;

  const variacaoPct = arred(((segunda - primeira) / primeira) * 100, 1);
  const direcao: DirecaoTendencia = variacaoPct >= TENDENCIA_MIN_PCT
    ? 'melhorando'
    : variacaoPct <= -TENDENCIA_MIN_PCT
      ? 'piorando'
      : 'estavel';

  return { direcao, variacaoPct, primeiraMetade: primeira, segundaMetade: segunda };
}

export interface RegistroRotaDia {
  data: string;
  rota: string;
  viagens: number;
  toneladas: number;
  km: number;
  horasProdutivas: number;
  tipo?: string | null;
}

function fmt(n: number, casas = 1): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

function montarAlertas(f: FichaRotaCiclo, diasPeriodo: number | null): string[] {
  const alertas: string[] = [];

  if (f.instavelKm && f.cvKmDia != null && f.medianaKmDia != null) {
    alertas.push(
      `KM diário varia ${fmt(f.cvKmDia, 0)}% em torno de ${fmt(f.medianaKmDia, 0)} km`
      + `${f.kmDiaMin != null && f.kmDiaMax != null
        ? ` (de ${fmt(f.kmDiaMin, 0)} a ${fmt(f.kmDiaMax, 0)} km)`
        : ''}`
      + ' — trajeto ou apontamento inconsistente.',
    );
  }

  if (f.instavelCarga && f.cvTonPorViagem != null && f.medianaTonPorViagem != null) {
    alertas.push(
      `Carga por viagem oscila ${fmt(f.cvTonPorViagem, 0)}% `
      + `em torno de ${fmt(f.medianaTonPorViagem, 2)} t.`,
    );
  }

  if (f.tendencia?.direcao === 'piorando') {
    alertas.push(
      `Tonelada por viagem caiu ${fmt(Math.abs(f.tendencia.variacaoPct), 0)}% `
      + `da primeira para a segunda metade do ciclo `
      + `(${fmt(f.tendencia.primeiraMetade, 2)} → ${fmt(f.tendencia.segundaMetade, 2)} t).`,
    );
  }

  if (diasPeriodo && diasPeriodo > 0 && f.diasComOperacao > 0) {
    const cobertura = (f.diasComOperacao / diasPeriodo) * 100;
    if (cobertura < 50) {
      alertas.push(
        `Rota operou em ${f.diasComOperacao} de ${diasPeriodo} dias do período `
        + `(${fmt(cobertura, 0)}%).`,
      );
    }
  }

  return alertas;
}

/** Monta a ficha de cada rota a partir dos registros já normalizados. */
export function montarFichasRotaCiclo(
  registros: RegistroRotaDia[],
  opts: { diasPeriodo?: number | null } = {},
): FichaRotaCiclo[] {
  const porRota = new Map<string, {
    dias: Map<string, DiaRotaCiclo>;
    tipoCounts: Map<string, number>;
  }>();

  for (const reg of registros || []) {
    const rota = (reg.rota || '').trim() || 'Não informado';
    const data = reg.data;
    if (!data) continue;

    let acc = porRota.get(rota);
    if (!acc) {
      acc = { dias: new Map(), tipoCounts: new Map() };
      porRota.set(rota, acc);
    }

    let dia = acc.dias.get(data);
    if (!dia) {
      dia = { data, viagens: 0, toneladas: 0, km: 0, horasProdutivas: 0, tonPorViagem: null };
      acc.dias.set(data, dia);
    }
    dia.viagens += reg.viagens;
    dia.toneladas += reg.toneladas;
    dia.km += reg.km;
    dia.horasProdutivas += reg.horasProdutivas;

    const tipo = (reg.tipo || '').trim();
    if (tipo) acc.tipoCounts.set(tipo, (acc.tipoCounts.get(tipo) || 0) + reg.viagens);
  }

  const fichas: FichaRotaCiclo[] = [];

  for (const [rota, acc] of porRota) {
    const porDia = [...acc.dias.values()]
      .sort((a, b) => a.data.localeCompare(b.data))
      .map((d) => ({
        data: d.data,
        viagens: d.viagens,
        toneladas: arred(d.toneladas),
        km: arred(d.km),
        horasProdutivas: arred(d.horasProdutivas),
        tonPorViagem: d.viagens > 0 ? arred(d.toneladas / d.viagens) : null,
      }));

    if (!porDia.length) continue;

    const kmDias = porDia.map((d) => d.km).filter((v) => v > 0);
    const tonViagemDias = porDia
      .map((d) => d.tonPorViagem)
      .filter((v): v is number => v != null && v > 0);

    let tipoPredominante: string | null = null;
    let melhor = -1;
    for (const [tipo, n] of acc.tipoCounts) {
      if (n > melhor) {
        melhor = n;
        tipoPredominante = tipo;
      }
    }

    const cvKmDia = coeficienteVariacao(kmDias);
    const cvTonPorViagem = coeficienteVariacao(tonViagemDias);

    const ficha: FichaRotaCiclo = {
      rota,
      tipoPredominante,
      diasComOperacao: porDia.length,
      viagens: porDia.reduce((s, d) => s + d.viagens, 0),
      toneladas: arred(porDia.reduce((s, d) => s + d.toneladas, 0)),
      km: arred(porDia.reduce((s, d) => s + d.km, 0)),
      horasProdutivas: arred(porDia.reduce((s, d) => s + d.horasProdutivas, 0)),

      medianaViagensDia: mediana(porDia.map((d) => d.viagens)),
      medianaTonDia: mediana(porDia.map((d) => d.toneladas)),
      medianaKmDia: mediana(kmDias),
      medianaTonPorViagem: mediana(tonViagemDias),

      cvKmDia,
      cvTonPorViagem,
      kmDiaMin: kmDias.length ? Math.min(...kmDias) : null,
      kmDiaMax: kmDias.length ? Math.max(...kmDias) : null,

      tendencia: calcularTendencia(porDia),
      instavelKm: cvKmDia != null && cvKmDia > CV_KM_INSTAVEL && kmDias.length >= 3,
      instavelCarga: cvTonPorViagem != null
        && cvTonPorViagem > CV_TON_INSTAVEL
        && tonViagemDias.length >= 3,
      alertas: [],

      porDia,
    };

    ficha.alertas = montarAlertas(ficha, opts.diasPeriodo ?? null);
    fichas.push(ficha);
  }

  return fichas.sort((a, b) => b.toneladas - a.toneladas || b.viagens - a.viagens);
}

function toIsoDate(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function diffDiasInclusivo(inicio: string, fim: string): number {
  const a = Date.parse(`${inicio}T00:00:00Z`);
  const b = Date.parse(`${fim}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

/** Ficha de todas as rotas no período (ciclo), direto do banco. */
export async function getFichaRotasCiclo(
  servicoId: string,
  opts: { dataInicio?: string; dataFim?: string } = {},
): Promise<FichaRotasCicloResult> {
  const dataInicio = opts.dataInicio && /^\d{4}-\d{2}-\d{2}$/.test(opts.dataInicio)
    ? opts.dataInicio
    : null;
  const dataFim = opts.dataFim && /^\d{4}-\d{2}-\d{2}$/.test(opts.dataFim) ? opts.dataFim : null;

  const vazio: FichaRotasCicloResult = {
    rotas: [],
    resumo: {
      rotas: 0,
      rotasInstaveis: 0,
      rotasPiorando: 0,
      rotasMelhorando: 0,
      diasPeriodo: dataInicio && dataFim ? diffDiasInclusivo(dataInicio, dataFim) : null,
      registros: 0,
      truncado: false,
    },
    dataInicio,
    dataFim,
  };

  const uploads = await AppDataSource.getRepository(PlanilhaUpload).find({
    where: { servico_id: servicoId },
    select: ['id'],
  });
  const uploadIds = uploads.map((u) => u.id);
  if (!uploadIds.length) return vazio;

  const qb = AppDataSource.getRepository(ColetaData).createQueryBuilder('c')
    .where('c.planilhaUploadId IN (:...uploadIds)', { uploadIds });
  aplicarFiltroViagensValidasDashboard(qb, 'c');
  if (dataInicio) qb.andWhere('c.dataSaida >= :inicio', { inicio: `${dataInicio}T00:00:00.000Z` });
  if (dataFim) qb.andWhere('c.dataSaida <= :fim', { fim: `${dataFim}T23:59:59.999Z` });

  const registros = await qb
    .select([
      'c.id', 'c.dataSaida', 'c.distrito', 'c.regional', 'c.tipoCaminhao',
      'c.kmTotal', 'c.pesoTotal', 'c.peso1', 'c.peso2', 'c.peso3', 'c.peso4',
      'c.viagensPorRota', 'c.numeroViagens', 'c.dados',
    ])
    .orderBy('c.dataSaida', 'ASC')
    .take(MAX_REGISTROS + 1)
    .getMany();

  const truncado = registros.length > MAX_REGISTROS;
  const lista = truncado ? registros.slice(0, MAX_REGISTROS) : registros;
  if (!lista.length) return vazio;

  const normalizados: RegistroRotaDia[] = [];
  for (const reg of lista) {
    const data = toIsoDate(reg.dataSaida);
    if (!data) continue;
    const obj = {
      ...reg,
      ...(reg.dados && typeof reg.dados === 'object' ? reg.dados : {}),
      dados: reg.dados,
    };
    normalizados.push({
      data,
      rota: (reg.distrito || reg.regional || 'Não informado').trim() || 'Não informado',
      viagens: contarViagensPorRotaRegistro(reg),
      toneladas: obterPesoTotalRegistro(reg) / 1000,
      km: Number(reg.kmTotal) || 0,
      horasProdutivas: calcularHorasNasRotasRegistro(obj),
      tipo: reg.tipoCaminhao || null,
    });
  }

  const diasPeriodo = dataInicio && dataFim
    ? diffDiasInclusivo(dataInicio, dataFim)
    : null;
  const rotas = montarFichasRotaCiclo(normalizados, { diasPeriodo });

  return {
    rotas,
    resumo: {
      rotas: rotas.length,
      rotasInstaveis: rotas.filter((r) => r.instavelKm || r.instavelCarga).length,
      rotasPiorando: rotas.filter((r) => r.tendencia?.direcao === 'piorando').length,
      rotasMelhorando: rotas.filter((r) => r.tendencia?.direcao === 'melhorando').length,
      diasPeriodo,
      registros: lista.length,
      truncado,
    },
    dataInicio: dataInicio || toIsoDate(lista[0]?.dataSaida),
    dataFim: dataFim || toIsoDate(lista[lista.length - 1]?.dataSaida),
  };
}
