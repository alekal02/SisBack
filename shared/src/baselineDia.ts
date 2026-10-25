/* ============================================================
   RÉGUA TEMPORAL DO DIA

   Um dia isolado não diz se foi bom: sábado tem operação
   diferente de terça. As referências certas são:

     1. mediana dos outros dias com o MESMO dia da semana no ciclo;
     2. mediana de todos os dias com operação do ciclo;
     3. dia equivalente do ciclo anterior (mesma ocorrência do dia
        da semana: 3ª terça deste ciclo × 3ª terça do anterior).

   Mediana, e não média, para que um dia atípico não mova a régua.
   ============================================================ */

export const DIAS_SEMANA_CURTO = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'] as const;

/** Variação mínima (%) para o dia ser considerado fora do padrão. */
export const DESVIO_RELEVANTE_PCT = 10;

/** 0 = domingo … 6 = sábado. -1 quando a data é inválida. */
export function diaSemanaIso(iso: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return -1;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

/** Ex.: 1ª qua, 2º sáb — mesma ocorrência do dia da semana nos dois ciclos. */
export function rotuloOcorrenciaDiaSemana(diaSemana: number, ocorrencia: number): string {
  if (diaSemana < 0 || diaSemana > 6 || ocorrencia < 1) return '—';
  const nome = DIAS_SEMANA_CURTO[diaSemana];
  const ord = diaSemana === 0 || diaSemana === 6 ? `${ocorrencia}º` : `${ocorrencia}ª`;
  return `${ord} ${nome}`;
}

export interface ParDiaSemanaCiclo<T extends { data: string }> {
  ordem: number;
  ant: T | null;
  atual: T | null;
  diaSemana: number;
  ocorrencia: number;
}

/**
 * Emparelha a N-ésima segunda do ciclo anterior com a N-ésima segunda do atual
 * (terça com terça, domingo com domingo…). Evita cruzar dia útil com fim de semana
 * quando os ciclos começam em dias diferentes.
 * A ordem segue o calendário do ciclo atual (dias decorridos).
 */
export function alinharPorOcorrenciaDiaSemana<T extends { data: string }>(
  anterior: T[],
  atual: T[],
): ParDiaSemanaCiclo<T>[] {
  const ant = [...(anterior || [])].filter((d) => d?.data).sort((a, b) => a.data.localeCompare(b.data));
  const atu = [...(atual || [])].filter((d) => d?.data).sort((a, b) => a.data.localeCompare(b.data));

  const mapaAnt = new Map<string, T>();
  const contAnt = [0, 0, 0, 0, 0, 0, 0];
  for (const d of ant) {
    const w = diaSemanaIso(d.data);
    if (w < 0) continue;
    contAnt[w] += 1;
    mapaAnt.set(`${w}:${contAnt[w]}`, d);
  }

  const linhas: ParDiaSemanaCiclo<T>[] = [];
  const contAtu = [0, 0, 0, 0, 0, 0, 0];
  for (const d of atu) {
    const w = diaSemanaIso(d.data);
    if (w < 0) continue;
    contAtu[w] += 1;
    linhas.push({
      ordem: linhas.length + 1,
      ant: mapaAnt.get(`${w}:${contAtu[w]}`) ?? null,
      atual: d,
      diaSemana: w,
      ocorrencia: contAtu[w],
    });
  }
  return linhas;
}

/** Métricas mínimas de um dia para montar a régua. */
export interface DiaSerieOperacional {
  data: string;
  viagens: number;
  rotas: number;
  toneladas: number;
  km: number;
  horas: number;
}

export interface ComparativoBaseline {
  referencia: number | null;
  /** Dia − referência. */
  delta: number | null;
  /** Diferença percentual sobre a referência. */
  pct: number | null;
  /** true = dia melhor que a referência, considerando o sentido da métrica. */
  melhor: boolean | null;
}

export interface MetricaBaselineDia {
  id: string;
  label: string;
  sufixo: string;
  casas: number;
  /** Em viagens e toneladas subir é bom; em KM por viagem subir é ruim. */
  melhorQuandoSobe: boolean;
  valor: number | null;
  mesmoDiaSemana: ComparativoBaseline;
  medianaCiclo: ComparativoBaseline;
  cicloAnterior: ComparativoBaseline;
}

export interface BaselineDia {
  dataIso: string;
  /** Ex.: "3ª ter" — posição do dia dentro do ciclo. */
  rotuloOcorrencia: string;
  diasMesmoDiaSemana: number;
  diasCiclo: number;
  temCicloAnterior: boolean;
  metricas: MetricaBaselineDia[];
  /** Frase curta dizendo se o dia fugiu do padrão e onde. */
  leitura: string;
}

interface DefinicaoMetrica {
  id: string;
  label: string;
  sufixo: string;
  casas: number;
  melhorQuandoSobe: boolean;
  ler: (d: DiaSerieOperacional) => number | null;
}

const DEFINICOES: DefinicaoMetrica[] = [
  {
    id: 'viagens',
    label: 'Viagens',
    sufixo: '',
    casas: 0,
    melhorQuandoSobe: true,
    ler: (d) => (d.viagens > 0 ? d.viagens : null),
  },
  {
    id: 'toneladas',
    label: 'Toneladas',
    sufixo: ' t',
    casas: 1,
    melhorQuandoSobe: true,
    ler: (d) => (d.toneladas > 0 ? d.toneladas : null),
  },
  {
    id: 'tonPorViagem',
    label: 'Ton / viagem',
    sufixo: ' t',
    casas: 2,
    melhorQuandoSobe: true,
    ler: (d) => (d.viagens > 0 && d.toneladas > 0 ? d.toneladas / d.viagens : null),
  },
  {
    id: 'rotas',
    label: 'Rotas',
    sufixo: '',
    casas: 0,
    melhorQuandoSobe: true,
    ler: (d) => (d.rotas > 0 ? d.rotas : null),
  },
  {
    id: 'km',
    label: 'KM',
    sufixo: ' km',
    casas: 0,
    melhorQuandoSobe: false,
    ler: (d) => (d.km > 0 ? d.km : null),
  },
  {
    id: 'kmPorViagem',
    label: 'KM / viagem',
    sufixo: ' km',
    casas: 1,
    melhorQuandoSobe: false,
    ler: (d) => (d.viagens > 0 && d.km > 0 ? d.km / d.viagens : null),
  },
  {
    id: 'tonPorHora',
    label: 'Ton / hora',
    sufixo: ' t/h',
    casas: 2,
    melhorQuandoSobe: true,
    ler: (d) => (d.horas > 0 && d.toneladas > 0 ? d.toneladas / d.horas : null),
  },
];

function arred(n: number, casas = 2): number {
  const f = 10 ** casas;
  return Math.round(n * f) / f;
}

/** Mediana de uma lista de números. */
export function medianaSerie(valores: number[]): number | null {
  const lista = (valores || []).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!lista.length) return null;
  const meio = Math.floor(lista.length / 2);
  return lista.length % 2 === 1 ? lista[meio] : arred((lista[meio - 1] + lista[meio]) / 2);
}

function diaTemOperacao(d: DiaSerieOperacional): boolean {
  return d.viagens > 0 || d.toneladas > 0 || d.rotas > 0;
}

const SEM_COMPARACAO: ComparativoBaseline = {
  referencia: null,
  delta: null,
  pct: null,
  melhor: null,
};

function comparar(
  valor: number | null,
  referencia: number | null,
  melhorQuandoSobe: boolean,
): ComparativoBaseline {
  if (valor == null || referencia == null || !Number.isFinite(referencia)) return SEM_COMPARACAO;
  const delta = arred(valor - referencia);
  const pct = referencia !== 0 ? arred((delta / Math.abs(referencia)) * 100, 1) : null;
  return {
    referencia: arred(referencia),
    delta,
    pct,
    melhor: delta === 0 ? null : (delta > 0) === melhorQuandoSobe,
  };
}

/** Escolhe a referência mais específica disponível para a métrica. */
export function referenciaPrincipalBaseline(m: MetricaBaselineDia): {
  comparativo: ComparativoBaseline;
  origem: 'mesmoDiaSemana' | 'medianaCiclo' | 'cicloAnterior';
} | null {
  if (m.mesmoDiaSemana.referencia != null) {
    return { comparativo: m.mesmoDiaSemana, origem: 'mesmoDiaSemana' };
  }
  if (m.medianaCiclo.referencia != null) {
    return { comparativo: m.medianaCiclo, origem: 'medianaCiclo' };
  }
  if (m.cicloAnterior.referencia != null) {
    return { comparativo: m.cicloAnterior, origem: 'cicloAnterior' };
  }
  return null;
}

function fmt(n: number, casas: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

function montarLeituraBaseline(
  metricas: MetricaBaselineDia[],
  diasMesmoDiaSemana: number,
): string {
  const desvios = metricas
    .map((m) => {
      const ref = referenciaPrincipalBaseline(m);
      if (!ref || ref.comparativo.pct == null) return null;
      return { m, pct: ref.comparativo.pct, melhor: ref.comparativo.melhor };
    })
    .filter((x): x is { m: MetricaBaselineDia; pct: number; melhor: boolean | null } =>
      x != null && Math.abs(x.pct) >= DESVIO_RELEVANTE_PCT);

  if (!desvios.length) {
    return diasMesmoDiaSemana > 0
      ? 'Dia dentro do padrão do mesmo dia da semana neste ciclo.'
      : 'Dia dentro do padrão do ciclo.';
  }

  desvios.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  const frases = desvios.slice(0, 3).map((d) =>
    `${d.m.label.toLowerCase()} ${fmt(Math.abs(d.pct), 0)}% ${d.pct > 0 ? 'acima' : 'abaixo'} do normal`);

  const piorou = desvios.some((d) => d.melhor === false);
  return `${piorou ? 'Dia fora do padrão: ' : 'Dia acima do padrão: '}${frases.join(', ')}.`;
}

/**
 * Monta a régua do dia a partir da série do ciclo (e do ciclo anterior, se houver).
 * Retorna null quando o dia não está na série ou não há nenhuma referência.
 */
export function montarBaselineDia<T extends DiaSerieOperacional>(opts: {
  dataIso: string;
  diasCiclo: T[];
  diasCicloAnterior?: T[] | null;
}): BaselineDia | null {
  const { dataIso } = opts;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataIso)) return null;

  const comOperacao = (opts.diasCiclo || []).filter(diaTemOperacao);
  const dia = comOperacao.find((d) => d.data === dataIso);
  if (!dia) return null;

  const semanaDoDia = diaSemanaIso(dataIso);
  const outrosDias = comOperacao.filter((d) => d.data !== dataIso);
  const mesmoDiaSemana = outrosDias.filter((d) => diaSemanaIso(d.data) === semanaDoDia);

  const pares = opts.diasCicloAnterior?.length
    ? alinharPorOcorrenciaDiaSemana(
      opts.diasCicloAnterior.filter(diaTemOperacao),
      comOperacao,
    )
    : [];
  const par = pares.find((p) => p.atual?.data === dataIso);
  const diaAnterior = par?.ant ?? null;
  const ocorrencia = par?.ocorrencia
    ?? mesmoDiaSemana.filter((d) => d.data < dataIso).length + 1;

  const metricas: MetricaBaselineDia[] = DEFINICOES.map((def) => {
    const bruto = def.ler(dia);
    const valor = bruto != null ? arred(bruto, def.casas) : null;
    const valores = (lista: T[]) =>
      lista.map(def.ler).filter((v): v is number => v != null);
    return {
      id: def.id,
      label: def.label,
      sufixo: def.sufixo,
      casas: def.casas,
      melhorQuandoSobe: def.melhorQuandoSobe,
      valor,
      mesmoDiaSemana: comparar(
        valor,
        medianaSerie(valores(mesmoDiaSemana)),
        def.melhorQuandoSobe,
      ),
      medianaCiclo: comparar(valor, medianaSerie(valores(outrosDias)), def.melhorQuandoSobe),
      cicloAnterior: comparar(
        valor,
        diaAnterior ? def.ler(diaAnterior) : null,
        def.melhorQuandoSobe,
      ),
    };
  });

  const temReferencia = metricas.some((m) =>
    m.mesmoDiaSemana.referencia != null
    || m.medianaCiclo.referencia != null
    || m.cicloAnterior.referencia != null);
  if (!temReferencia) return null;

  return {
    dataIso,
    rotuloOcorrencia: rotuloOcorrenciaDiaSemana(semanaDoDia, ocorrencia),
    diasMesmoDiaSemana: mesmoDiaSemana.length,
    diasCiclo: outrosDias.length,
    temCicloAnterior: diaAnterior != null,
    metricas,
    leitura: montarLeituraBaseline(metricas, mesmoDiaSemana.length),
  };
}
