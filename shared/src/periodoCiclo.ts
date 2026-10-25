export interface PeriodoCicloContrato {
  mesReferencia: number;
  anoReferencia: number;
  diaInicioCiclo: number;
  dataInicio: string;
  dataFim: string;
  label: string;
}

export interface PeriodoContratoQuery {
  mes?: number;
  ano?: number;
  dataInicio?: string;
  dataFim?: string;
}

export interface QuinzenaPeriodo {
  numero: 1 | 2;
  dataInicio: string;
  dataFim: string;
  label: string;
}

export function isIsoDate(s?: string): boolean {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function formatarDataBr(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toISODate(ano: number, mes: number, dia: number): string {
  return `${ano}-${pad2(mes)}-${pad2(dia)}`;
}

export function normalizarDiaInicioCiclo(dia?: number | null): number {
  if (dia == null || Number.isNaN(Number(dia))) return 1;
  return Math.min(28, Math.max(1, Math.floor(Number(dia))));
}

export function inferirMesReferenciaAtual(
  diaInicioCiclo: number = 1,
  hoje: Date = new Date(),
): { ano: number; mes: number } {
  const d = normalizarDiaInicioCiclo(diaInicioCiclo);
  let mes = hoje.getMonth() + 1;
  let ano = hoje.getFullYear();

  if (d > 1 && hoje.getDate() >= d) {
    mes += 1;
    if (mes > 12) {
      mes = 1;
      ano += 1;
    }
  }

  return { ano, mes };
}

/** Mês de referência do ciclo que contém a data informada (yyyy-MM-dd). */
export function inferirMesReferenciaDeData(
  dataIso: string,
  diaInicioCiclo: number = 1,
): { ano: number; mes: number } {
  const d = normalizarDiaInicioCiclo(diaInicioCiclo);
  const [anoStr, mesStr, diaStr] = dataIso.split('-');
  const ano = parseInt(anoStr, 10);
  const mes = parseInt(mesStr, 10);
  const dia = parseInt(diaStr, 10);
  if (!ano || !mes || !dia) return inferirMesReferenciaAtual(diaInicioCiclo);

  if (d === 1) return { ano, mes };

  if (dia >= d) {
    let mesRef = mes + 1;
    let anoRef = ano;
    if (mesRef > 12) {
      mesRef = 1;
      anoRef += 1;
    }
    return { ano: anoRef, mes: mesRef };
  }

  return { ano, mes };
}

export function calcularCicloMensalContrato(
  anoReferencia: number,
  mesReferencia: number,
  diaInicioCiclo: number = 1,
): PeriodoCicloContrato {
  const d = normalizarDiaInicioCiclo(diaInicioCiclo);

  let dataInicio: string;
  let dataFim: string;

  if (d === 1) {
    const ultimoDia = new Date(anoReferencia, mesReferencia, 0).getDate();
    dataInicio = toISODate(anoReferencia, mesReferencia, 1);
    dataFim = toISODate(anoReferencia, mesReferencia, ultimoDia);
  } else {
    const mesAnt = mesReferencia === 1 ? 12 : mesReferencia - 1;
    const anoAnt = mesReferencia === 1 ? anoReferencia - 1 : anoReferencia;
    dataInicio = toISODate(anoAnt, mesAnt, d);
    dataFim = toISODate(anoReferencia, mesReferencia, d - 1);
  }

  const nomeMes = new Date(anoReferencia, mesReferencia - 1, 1).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
  });

  const label = d === 1
    ? nomeMes
    : `${nomeMes} (${formatarDataBr(dataInicio)} a ${formatarDataBr(dataFim)})`;

  return {
    mesReferencia,
    anoReferencia,
    diaInicioCiclo: d,
    dataInicio,
    dataFim,
    label,
  };
}

export function deslocarMesReferencia(
  mes: number,
  ano: number,
  delta: number,
): { mes: number; ano: number } {
  let m = mes + delta;
  let y = ano;
  while (m < 1) {
    m += 12;
    y -= 1;
  }
  while (m > 12) {
    m -= 12;
    y += 1;
  }
  return { mes: m, ano: y };
}

/** Inferência a partir de várias datas — usa a data mais recente. */
export function inferirCicloReferenciaDeDatas(
  datasIso: string[],
  diaInicioCiclo: number = 1,
): { mesReferencia: number; anoReferencia: number } | null {
  const validas = datasIso.filter(isIsoDate).sort();
  if (validas.length === 0) return null;
  const ref = inferirMesReferenciaDeData(validas[validas.length - 1], diaInicioCiclo);
  return { mesReferencia: ref.mes, anoReferencia: ref.ano };
}

/**
 * Ciclo da planilha = o da data mais recente. Datas de outro ciclo
 * (Excel cumulativo com o mês anterior) ficam de fora — não importam
 * e não devem ser apagadas do histórico.
 */
export function restringirDatasAoCicloDaDataMaisRecente(
  datasIso: string[],
  diaInicioCiclo: number = 1,
): {
  datas: string[];
  ciclo: PeriodoCicloContrato | null;
  ignoradas: string[];
} {
  const validas = [...new Set(datasIso.filter(isIsoDate))].sort();
  if (validas.length === 0) {
    return { datas: [], ciclo: null, ignoradas: [] };
  }
  const ref = inferirCicloReferenciaDeDatas(validas, diaInicioCiclo);
  if (!ref) {
    return { datas: validas, ciclo: null, ignoradas: [] };
  }
  const ciclo = calcularCicloMensalContrato(ref.anoReferencia, ref.mesReferencia, diaInicioCiclo);
  const datas = validas.filter((d) => d >= ciclo.dataInicio && d <= ciclo.dataFim);
  const ignoradas = validas.filter((d) => d < ciclo.dataInicio || d > ciclo.dataFim);
  return { datas, ciclo, ignoradas };
}

/**
 * Dias só no sistema que a planilha nova pode apagar: apenas buracos DENTRO
 * do intervalo coberto pelo arquivo. Datas anteriores (ciclo já fechado /
 * histórico) nunca entram — senão o upload do ciclo seguinte apaga o anterior.
 */
export function limitarDiasAusentesAoPeriodoDaPlanilha(
  datasSistema: string[],
  datasPlanilha: string[],
): string[] {
  const planilha = datasPlanilha.filter(isIsoDate).sort();
  if (planilha.length === 0) return [];
  const min = planilha[0];
  const max = planilha[planilha.length - 1];
  const noArquivo = new Set(planilha);
  return [...new Set(datasSistema.filter(isIsoDate))]
    .filter((d) => d >= min && d <= max && !noArquivo.has(d))
    .sort();
}

export function mesInputParaReferencia(value: string): { mes: number; ano: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  const ano = parseInt(match[1], 10);
  const mes = parseInt(match[2], 10);
  if (mes < 1 || mes > 12 || ano < 2000) return null;
  return { mes, ano };
}

export function referenciaParaMesInput(ano: number, mes: number): string {
  return `${ano}-${pad2(mes)}`;
}

/** Lista todas as datas ISO (inclusive) entre dataInicio e dataFim */
export function listarDatasIntervalo(dataInicio: string, dataFim: string): string[] {
  const datas: string[] = [];
  const atual = new Date(`${dataInicio}T12:00:00`);
  const fim = new Date(`${dataFim}T12:00:00`);
  if (isNaN(atual.getTime()) || isNaN(fim.getTime()) || atual > fim) return datas;

  while (atual <= fim) {
    const y = atual.getFullYear();
    const m = String(atual.getMonth() + 1).padStart(2, '0');
    const d = String(atual.getDate()).padStart(2, '0');
    datas.push(`${y}-${m}-${d}`);
    atual.setDate(atual.getDate() + 1);
  }
  return datas;
}

/** Data local yyyy-MM-dd (não usa UTC — evita virar o dia anterior no Brasil). */
export function isoHojeLocal(hoje: Date = new Date()): string {
  return toISODate(hoje.getFullYear(), hoje.getMonth() + 1, hoje.getDate());
}

export interface PeriodoRecortadoCiclo {
  dataInicio: string;
  dataFim: string;
  diasDecorridos: number;
  emAndamento: boolean;
}

/**
 * Recorta o ciclo até a data de referência (hoje, por padrão).
 * Ex.: ciclo 25/07–24/08, hoje 21/08 → 25/07–21/08 (28 dias decorridos).
 */
export function recortarPeriodoAteReferencia(
  dataInicio: string,
  dataFim: string,
  referenciaIso?: string,
): PeriodoRecortadoCiclo {
  const ref = referenciaIso && isIsoDate(referenciaIso) ? referenciaIso : isoHojeLocal();
  if (!isIsoDate(dataInicio) || !isIsoDate(dataFim)) {
    return { dataInicio, dataFim, diasDecorridos: 0, emAndamento: false };
  }
  if (ref < dataInicio) {
    return { dataInicio, dataFim: dataInicio, diasDecorridos: 0, emAndamento: true };
  }
  if (ref >= dataFim) {
    return {
      dataInicio,
      dataFim,
      diasDecorridos: listarDatasIntervalo(dataInicio, dataFim).length,
      emAndamento: false,
    };
  }
  return {
    dataInicio,
    dataFim: ref,
    diasDecorridos: listarDatasIntervalo(dataInicio, ref).length,
    emAndamento: true,
  };
}

/** Primeiros N dias de um período (para comparar o mesmo recorte do ciclo atual). */
export function primeirosNDiasPeriodo(
  dataInicio: string,
  dataFim: string,
  n: number,
): { dataInicio: string; dataFim: string } {
  const dias = listarDatasIntervalo(dataInicio, dataFim);
  if (dias.length === 0 || n <= 0) {
    return { dataInicio, dataFim: dataInicio };
  }
  const idx = Math.min(n, dias.length) - 1;
  return { dataInicio: dias[0], dataFim: dias[idx] };
}

export interface JanelasComparativoCiclo {
  atual: PeriodoCicloContrato;
  anterior: PeriodoCicloContrato;
  emAndamento: boolean;
  diasDecorridos: number;
  diasCicloCompleto: number;
}

/**
 * Ciclo atual até hoje × mesmos N primeiros dias do ciclo anterior.
 * Evita comparar 26 dias em andamento com o ciclo anterior inteiro (31 dias).
 */
export function montarJanelasComparativoCiclo(
  cicloAtualCompleto: PeriodoCicloContrato,
  referenciaIso?: string,
): JanelasComparativoCiclo {
  const recorte = recortarPeriodoAteReferencia(
    cicloAtualCompleto.dataInicio,
    cicloAtualCompleto.dataFim,
    referenciaIso,
  );
  const diasCicloCompleto = listarDatasIntervalo(
    cicloAtualCompleto.dataInicio,
    cicloAtualCompleto.dataFim,
  ).length;
  const prev = deslocarMesReferencia(
    cicloAtualCompleto.mesReferencia,
    cicloAtualCompleto.anoReferencia,
    -1,
  );
  const anteriorCompleto = calcularCicloMensalContrato(
    prev.ano,
    prev.mes,
    cicloAtualCompleto.diaInicioCiclo,
  );
  const janelaAnt = primeirosNDiasPeriodo(
    anteriorCompleto.dataInicio,
    anteriorCompleto.dataFim,
    recorte.diasDecorridos,
  );

  const n = recorte.diasDecorridos;
  const plural = n === 1 ? '' : 's';
  const atualLabel = recorte.emAndamento
    ? `${cicloAtualCompleto.label} — ${n} dia${plural} decorrido${plural} até ${formatarDataBr(recorte.dataFim)}`
    : cicloAtualCompleto.label;
  const anteriorLabel = recorte.emAndamento
    ? `${anteriorCompleto.label} — primeiros ${n} dia${plural} (mesmo recorte do ciclo atual)`
    : anteriorCompleto.label;

  return {
    atual: {
      ...cicloAtualCompleto,
      dataInicio: recorte.dataInicio,
      dataFim: recorte.dataFim,
      label: atualLabel,
    },
    anterior: {
      ...anteriorCompleto,
      dataInicio: janelaAnt.dataInicio,
      dataFim: janelaAnt.dataFim,
      label: anteriorLabel,
    },
    emAndamento: recorte.emAndamento,
    diasDecorridos: recorte.diasDecorridos,
    diasCicloCompleto,
  };
}

/**
 * Divide o período do ciclo em quinzenas (15 + restante).
 * Ex.: ciclo de 30 dias → 1ª = dias 1–15, 2ª = dias 16–30.
 */
export function calcularQuinzenasDoPeriodo(
  dataInicio: string,
  dataFim: string,
): { primeira: QuinzenaPeriodo; segunda: QuinzenaPeriodo | null } {
  const dias = listarDatasIntervalo(dataInicio, dataFim);
  if (dias.length === 0) {
    return {
      primeira: {
        numero: 1,
        dataInicio,
        dataFim,
        label: `1ª quinzena (${formatarDataBr(dataInicio)} a ${formatarDataBr(dataFim)})`,
      },
      segunda: null,
    };
  }

  const q1FimIdx = Math.min(14, dias.length - 1);
  const primeira: QuinzenaPeriodo = {
    numero: 1,
    dataInicio: dias[0],
    dataFim: dias[q1FimIdx],
    label: `1ª quinzena (${formatarDataBr(dias[0])} a ${formatarDataBr(dias[q1FimIdx])})`,
  };

  if (q1FimIdx >= dias.length - 1) {
    return { primeira, segunda: null };
  }

  const segunda: QuinzenaPeriodo = {
    numero: 2,
    dataInicio: dias[q1FimIdx + 1],
    dataFim: dias[dias.length - 1],
    label: `2ª quinzena (${formatarDataBr(dias[q1FimIdx + 1])} a ${formatarDataBr(dias[dias.length - 1])})`,
  };
  return { primeira, segunda };
}
