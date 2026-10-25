import { encontrarValorColuna, parseNumeroBr } from './FormulaEngine';
import { COLUNAS_HORAS_ROTAS, COLUNAS_HODOMETRO } from '../config/modeloColetaCaminhao';

/** Distância operacional plausível por trecho de rota (não hodômetro bruto). */
const MAX_KM_TRECHO_ROTA = 300;
/** Fórmula canônica de Receita por Hora (faturamento ÷ horas produtivas totais) */
export const FORMULA_RECEITA_POR_HORA =
  'ROUND(DIVIDE(FATURAMENTO_EST(PESO TOTAL, TIPO DE CAMINHÃO), HORAS_PRODUTIVAS(HORA SAIDA BASE, HORA CHEGADA BASE)), 2)';

function normalizarChave(chave: string): string {
  return chave.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
}

function detectarColuna(dados: Record<string, any>[], candidatos: string[]): string {
  if (!dados?.length) return '';
  const chaves = Object.keys(dados[0]);
  for (const candidato of candidatos) {
    const norm = normalizarChave(candidato);
    for (const chave of chaves) {
      if (normalizarChave(chave) === norm) return chave;
    }
  }
  for (const chave of chaves) {
    const chaveNorm = normalizarChave(chave);
    for (const candidato of candidatos) {
      const norm = normalizarChave(candidato);
      if (chaveNorm.includes(norm) || norm.includes(chaveNorm)) return chave;
    }
  }
  return '';
}

/** Diff entre saída e chegada (horas), com virada de dia — mesma regra de HORAS_PRODUTIVAS(). */
export function diffHorasSaidaChegada(saida: number, chegada: number): number {
  if (saida <= 0 || chegada <= 0) return 0;
  let diff = 0;
  if (saida < 1 && chegada < 1) {
    diff = chegada < saida ? (chegada + 1 - saida) * 24 : (chegada - saida) * 24;
  } else {
    diff = chegada < saida ? chegada + 24 - saida : chegada - saida;
  }
  return diff > 0 && diff < 100 ? Math.round(diff * 100) / 100 : 0;
}

function lerHoraCampo(obj: Record<string, any>, ...candidatos: string[]): number {
  for (const nome of candidatos) {
    const raw = encontrarValorColuna(obj, nome);
    if (raw === undefined || raw === null || raw === '') continue;
    const n = typeof raw === 'number' ? raw : parseNumeroBr(raw);
    if (!isNaN(n) && n > 0) return n;
  }
  return 0;
}

/** Leitura estrita (sem fuzzy contains) — evita confundir HORA SAÍDA ROTA com horaSaida da base. */
export function lerHoraCampoEstrito(obj: Record<string, any>, ...candidatos: string[]): number {
  if (!obj) return 0;
  const fontes: Record<string, any>[] = [];
  if (obj.dados && typeof obj.dados === 'object' && !Array.isArray(obj.dados)) {
    fontes.push(obj.dados);
  }
  fontes.push(obj);

  for (const fonte of fontes) {
    for (const nome of candidatos) {
      if (!nome) continue;
      if (fonte[nome] !== undefined && fonte[nome] !== null && fonte[nome] !== '') {
        const n = typeof fonte[nome] === 'number' ? fonte[nome] : parseNumeroBr(fonte[nome]);
        if (!isNaN(n) && n > 0) return n;
      }
      const alvo = normalizarChave(nome);
      for (const [k, v] of Object.entries(fonte)) {
        if (k === 'dados' || v === undefined || v === null || v === '') continue;
        if (normalizarChave(k) !== alvo) continue;
        const n = typeof v === 'number' ? v : parseNumeroBr(v);
        if (!isNaN(n) && n > 0) return n;
      }
    }
  }
  return 0;
}

/** Hora de chegada na rota N (1–4). 0 quando não informada. */
export function lerHoraChegadaRota(obj: Record<string, any>, n: number): number {
  const par = COLUNAS_HORAS_ROTAS[n - 1];
  if (!par) return 0;
  const candidatos = par.nome === 'Rota 03'
    ? [par.horaChegada, 'HORA CHEGA ROTA 03']
    : [par.horaChegada];
  return lerHoraCampoEstrito(obj, ...candidatos);
}

/** Hora de saída da rota N (1–4). 0 quando não informada. */
export function lerHoraSaidaRota(obj: Record<string, any>, n: number): number {
  const par = COLUNAS_HORAS_ROTAS[n - 1];
  return par ? lerHoraCampoEstrito(obj, par.horaSaida) : 0;
}

/** Hora de saída da base (início da jornada). */
export function lerHoraSaidaBase(obj: Record<string, any>): number {
  return lerHoraCampoEstrito(
    obj,
    'HORA SÁIDA BASE',
    'HORA SAIDA BASE',
    'HORA SÁIDA  BASE',
    'HORA SAIDA  BASE',
  );
}

/** Hora de chegada na base (fim da jornada). */
export function lerHoraChegadaBase(obj: Record<string, any>): number {
  return lerHoraCampoEstrito(obj, 'HORA CHEGADA BASE', 'HORA CHEGA BASE');
}

/** Hodômetro de chegada na rota N (1–4). */
export function lerKmChegadaRota(obj: Record<string, any>, n: number): number {
  const par = COLUNAS_HODOMETRO.rotas[n - 1];
  if (!par) return 0;
  return lerKmCampoEstrito(
    obj,
    par.kmChegada,
    par.kmChegada.trim(),
    `KM CHEGADA ROTA 0${n}`,
    `KM CHEGADA ROTA ${n}`,
  );
}

/** Hodômetro de saída da rota N (1–4). */
export function lerKmSaidaRota(obj: Record<string, any>, n: number): number {
  const par = COLUNAS_HODOMETRO.rotas[n - 1];
  if (!par) return 0;
  return lerKmCampoEstrito(
    obj,
    par.kmSaida,
    par.kmSaida.trim(),
    `KM SAIDA ROTA 0${n}`,
    `KM SAÍDA ROTA 0${n}`,
    `KM SAIDA ROTA ${n}`,
    `KM SAÍDA ROTA ${n}`,
  );
}

/** Hodômetro na saída da base. */
export function lerKmSaidaBase(obj: Record<string, any>): number {
  return lerKmCampoEstrito(
    obj,
    COLUNAS_HODOMETRO.saidaBase,
    COLUNAS_HODOMETRO.saidaBase.trim(),
    'KM SÁIDA BASE',
  );
}

/** Hodômetro na chegada à base. */
export function lerKmChegadaBase(obj: Record<string, any>): number {
  return lerKmCampoEstrito(
    obj,
    COLUNAS_HODOMETRO.chegadaBase,
    COLUNAS_HODOMETRO.chegadaBase.trim(),
    'KM CHEGA BASE',
  );
}

/**
 * Horas produtivas de cada trecho (ROTA 01–04): saída − chegada.
 */
export function calcularHorasPorTrechoRota(obj: Record<string, any>): number[] {
  if (!obj) return COLUNAS_HORAS_ROTAS.map(() => 0);
  return COLUNAS_HORAS_ROTAS.map((_par, i) =>
    diffHorasSaidaChegada(lerHoraChegadaRota(obj, i + 1), lerHoraSaidaRota(obj, i + 1)),
  );
}

/**
 * Horas DENTRO das rotas (produtivas):
 * Σ (HORA SAÍDA ROTA − HORA CHEGADA ROTA) para todas as rotas preenchidas.
 */
export function calcularHorasNasRotasRegistro(obj: Record<string, any>): number {
  const total = calcularHorasPorTrechoRota(obj).reduce((s, h) => s + h, 0);
  return Math.round(total * 100) / 100;
}

export function lerKmCampoEstrito(obj: Record<string, any>, ...candidatos: string[]): number {
  if (!obj) return 0;
  const fontes: Record<string, any>[] = [];
  if (obj.dados && typeof obj.dados === 'object' && !Array.isArray(obj.dados)) {
    fontes.push(obj.dados);
  }
  fontes.push(obj);

  for (const fonte of fontes) {
    for (const nome of candidatos) {
      if (!nome) continue;
      if (fonte[nome] !== undefined && fonte[nome] !== null && fonte[nome] !== '') {
        const n = typeof fonte[nome] === 'number' ? fonte[nome] : parseNumeroBr(fonte[nome]);
        if (!isNaN(n) && n > 0) return n;
      }
      const alvo = normalizarChave(nome);
      for (const [k, v] of Object.entries(fonte)) {
        if (k === 'dados' || v === undefined || v === null || v === '') continue;
        if (normalizarChave(k) !== alvo) continue;
        const n = typeof v === 'number' ? v : parseNumeroBr(v);
        if (!isNaN(n) && n > 0) return n;
      }
    }
  }
  return 0;
}

function kmTrechoPlausivel(km: number): boolean {
  return Number.isFinite(km) && km > 0 && km <= MAX_KM_TRECHO_ROTA;
}

/**
 * KM produtivo DENTRO das rotas (por viagem):
 * Σ (KM SAÍDA ROTA − KM CHEGADA ROTA) em cada rota preenchida.
 * Fallback: kmRota1–4 / "KM ROTA 0N" quando a diferença do hodômetro não é distância.
 */
export function calcularKmNasRotasRegistro(obj: Record<string, any>): number {
  if (!obj) return 0;
  let total = 0;

  for (let i = 0; i < COLUNAS_HODOMETRO.rotas.length; i++) {
    const n = i + 1;
    const chegada = lerKmChegadaRota(obj, n);
    const saida = lerKmSaidaRota(obj, n);

    if (chegada > 0 && saida > 0 && saida >= chegada) {
      const diff = saida - chegada;
      if (kmTrechoPlausivel(diff)) {
        total += diff;
        continue;
      }
      // Hodômetro parado no ponto (diff 0) ou salto absurdo → tenta distância tipada
    }

    const tipado = Number(obj[`kmRota${n}`]);
    if (kmTrechoPlausivel(tipado)) {
      total += tipado;
      continue;
    }

    const kmCol = lerKmCampoEstrito(obj, `KM ROTA 0${n}`, `KM ROTA ${n}`, `KMROTA0${n}`, `KMROTA${n}`);
    if (kmTrechoPlausivel(kmCol)) total += kmCol;
  }

  return Math.round(total * 100) / 100;
}

/**
 * Velocidade de coleta (km/h) = KM produtivo nas rotas ÷ horas produtivas nas rotas.
 */
export function calcularVelocidadeColetaRegistro(obj: Record<string, any>): number | null {
  const km = calcularKmNasRotasRegistro(obj);
  const horas = calcularHorasNasRotasRegistro(obj);
  if (!(km > 0) || !(horas > 0)) return null;
  return Math.round((km / horas) * 100) / 100;
}

/**
 * Total da jornada: HORA CHEGADA BASE − HORA SAÍDA BASE.
 * Lê primeiro as colunas canônicas em `dados` (estrito), porque os campos
 * tipados horaSaida/horaChegada às vezes recebem HORA CHEGADA ROTA no import.
 */
export function calcularHorasTotaisForaUnidadeRegistro(obj: Record<string, any>): number {
  if (!obj) return 0;

  const saidaBase = lerHoraSaidaBase(obj);
  const chegadaBase = lerHoraChegadaBase(obj);
  if (saidaBase > 0 && chegadaBase > 0) {
    return diffHorasSaidaChegada(saidaBase, chegadaBase);
  }

  // Fallback tipado — só se não parecer igual à chegada da rota 01
  const saidaEnt = Number(obj.horaSaida) || 0;
  const chegadaEnt = Number(obj.horaChegada) || 0;
  const chegadaRota01 = lerHoraCampoEstrito(obj, 'HORA CHEGADA ROTA 01');
  const tipadoSuspeito =
    chegadaRota01 > 0
    && chegadaEnt > 0
    && Math.abs(chegadaEnt - chegadaRota01) < 1e-9;

  if (saidaEnt > 0 && chegadaEnt > 0 && !tipadoSuspeito) {
    return diffHorasSaidaChegada(saidaEnt, chegadaEnt);
  }

  return extrairHorasProdutivasRegistro(obj);
}

/**
 * Produtiva = Σ (saída rota − chegada rota)
 * Total = chegada base − saída base
 * Improdutiva = total − produtiva
 */
export function calcularHorasProdutivaImprodutivaRegistro(obj: Record<string, any>): {
  horasTotais: number;
  horasProdutivas: number;
  horasImprodutivas: number;
} {
  const horasTotais = calcularHorasTotaisForaUnidadeRegistro(obj);
  const horasProdutivasRaw = calcularHorasNasRotasRegistro(obj);
  const horasProdutivas = horasTotais > 0
    ? Math.min(horasProdutivasRaw, horasTotais)
    : horasProdutivasRaw;
  const horasImprodutivas = Math.round(Math.max(0, horasTotais - horasProdutivas) * 100) / 100;
  return {
    horasTotais: Math.round(horasTotais * 100) / 100,
    horasProdutivas: Math.round(horasProdutivas * 100) / 100,
    horasImprodutivas,
  };
}

/** Horas de um único registro — jornada base→base (legado "horas produtivas" SQL). */
export function extrairHorasProdutivasRegistro(obj: Record<string, any>): number {
  const horasEntidade = Number(obj.horasForaUnidade) || Number(obj.tempoForaUnidade) || 0;
  if (horasEntidade > 0 && horasEntidade <= 24) {
    return Math.round(horasEntidade * 100) / 100;
  }
  if (horasEntidade > 24 && horasEntidade < 1000) {
    return Math.round((horasEntidade / 60) * 100) / 100;
  }

  const colHoras = [
    'HORAS QUE FICA FORA DA UNIDADE', 'HORAS FORA UNIDADE', 'HORAS_FORA_UNIDADE',
    'horasForaUnidade', 'TEMPO FORA', 'HORAS PRODUTIVAS', 'tempoForaUnidade',
  ];
  for (const col of colHoras) {
    const norm = normalizarChave(col);
    for (const chave of Object.keys(obj)) {
      const chaveNorm = normalizarChave(chave);
      if (chaveNorm.includes(norm) || norm.includes(chaveNorm)) {
        const valor = Number(obj[chave]) || 0;
        if (valor > 0 && valor <= 24) return Math.round(valor * 100) / 100;
      }
    }
  }

  const horaSaidaEnt = Number(obj.horaSaida) || 0;
  const horaChegadaEnt = Number(obj.horaChegada) || 0;
  if (horaSaidaEnt > 0 && horaChegadaEnt > 0) {
    return diffHorasSaidaChegada(horaSaidaEnt, horaChegadaEnt);
  }

  return 0;
}

/**
 * Soma horas fora da unidade — critério de HORAS_PRODUTIVAS(BASE, BASE).
 */
export function calcularHorasProdutivasTotal(dados: Record<string, any>[]): number {
  if (!dados?.length) return 0;

  const colHora = detectarColuna(dados, [
    'HORA SAIDA BASE', 'HORA SÁIDA BASE', 'HORA SAIDA', 'HORA SÁIDA',
    'HORASAIDA', 'HORA_SAIDA', 'horaSaida', 'HR SAIDA BASE', 'HR_SAIDA_BASE', 'SAIDA BASE',
  ]);
  const colHoraChegada = detectarColuna(dados, [
    'HORA CHEGADA BASE', 'HORA CHEGADA', 'HORACHEGADA', 'HORA_CHEGADA', 'horaChegada',
    'HR CHEGA BASE', 'HR_CHEGA_BASE', 'CHEGADA BASE',
  ]);

  if (colHoraChegada && colHora && colHoraChegada !== colHora) {
    let total = 0;
    for (const d of dados) {
      const saida = Number(encontrarValorColuna(d, colHora)) || 0;
      const chegada = Number(encontrarValorColuna(d, colHoraChegada)) || 0;
      total += diffHorasSaidaChegada(saida, chegada);
    }
    if (total > 0) return Math.round(total * 100) / 100;
  }

  let total = 0;
  for (const d of dados) {
    total += extrairHorasProdutivasRegistro(d);
  }

  return Math.round(total * 100) / 100;
}
