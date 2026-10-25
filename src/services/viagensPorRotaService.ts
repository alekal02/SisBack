import { ColetaData } from '../entities/ColetaData';
import { encontrarValorColuna, parseNumeroBr } from './FormulaEngine';

/**
 * Modelo operacional da planilha de coleta com caminhão:
 * - Cada LINHA = uma ROTA (ex.: distrito/regional do dia)
 * - Dentro da rota existem até 4 VIAGENS (PESO 1 … PESO 4)
 * - CONTADOR DE VIAGENS = quantas viagens foram feitas na rota (1–4)
 * - VIAGENS_POR_ROTA() = soma do contador em todas as linhas (rotas)
 */

/** Máximo de viagens dentro de uma rota (linha da planilha) */
export const MAX_VIAGENS_DENTRO_ROTA = 4;

/** @deprecated use MAX_VIAGENS_DENTRO_ROTA — mantido para compatibilidade de imports */
export const MAX_VIAGENS_POR_REGISTRO = MAX_VIAGENS_DENTRO_ROTA;

/** Colunas PESO 1–4 = viagens dentro da rota (linha) */
export const COLUNAS_PESO_VIAGEM = [
  { label: 'VIAGEM 1', campo: 'peso1' as const, coluna: 'PESO 1' },
  { label: 'VIAGEM 2', campo: 'peso2' as const, coluna: 'PESO 2' },
  { label: 'VIAGEM 3', campo: 'peso3' as const, coluna: 'PESO 3' },
  { label: 'VIAGEM 4', campo: 'peso4' as const, coluna: 'PESO 4' },
] as const;

/** Colunas da planilha que indicam quantas viagens foram feitas na rota (linha) */
const COLUNAS_CONTADOR_VIAGENS = [
  'CONTADOR DE VIAGENS',
  'CONTADOR VIAGENS',
  'Nº DE VIAGENS',
  'NUMERO DE VIAGENS',
  'NÚMERO DE VIAGENS',
  'NR VIAGENS',
  'NUMERO VIAGENS',
];

/** Slots legados ROTA 01–04 (hodômetro/hora) — não confundir com viagens */
const ROTAS_OPERACIONAIS_LEGADO = [
  {
    kmField: 'kmRota1' as const,
    horaField: 'horaRota1' as const,
    colunasKm: ['KM ROTA 01', 'KM CHEGADA ROTA 01', 'KM SAIDA ROTA 01', 'KM SAÍDA ROTA 01', ' KM CHEGADA ROTA 01 ', ' KM SAÍDA ROTA 01 '],
    colunasHora: ['HORA ROTA 01', 'HORA CHEGADA ROTA 01', 'HORA SAÍDA ROTA 01', 'HORA SAIDA ROTA 01', 'HORA CHEGA ROTA 01'],
  },
  {
    kmField: 'kmRota2' as const,
    horaField: 'horaRota2' as const,
    colunasKm: ['KM ROTA 02', 'KM CHEGADA ROTA 02', 'KM SAIDA ROTA 02', 'KM SAÍDA ROTA 02', ' KM CHEGADA ROTA 02 ', ' KM SAÍDA ROTA 02 '],
    colunasHora: ['HORA ROTA 02', 'HORA CHEGADA ROTA 02', 'HORA SAÍDA ROTA 02', 'HORA SAIDA ROTA 02', 'HORA CHEGA ROTA 02'],
  },
  {
    kmField: 'kmRota3' as const,
    horaField: 'horaRota3' as const,
    colunasKm: ['KM ROTA 03', 'KM CHEGADA ROTA 03', 'KM SAIDA ROTA 03', 'KM SAÍDA ROTA 03', ' KM CHEGADA ROTA 03 ', ' KM SAÍDA ROTA 03 '],
    colunasHora: ['HORA ROTA 03', 'HORA CHEGADA ROTA 03', 'HORA SAÍDA ROTA 03', 'HORA SAIDA ROTA 03', 'HORA CHEGA ROTA 03'],
  },
  {
    kmField: 'kmRota4' as const,
    horaField: 'horaRota4' as const,
    colunasKm: ['KM ROTA 04', 'KM CHEGADA ROTA 04', 'KM SAIDA ROTA 04', 'KM SAÍDA ROTA 04', ' KM CHEGADA ROTA 04 ', ' KM SAÍDA ROTA 04 '],
    colunasHora: ['HORA ROTA 04', 'HORA CHEGADA ROTA 04', 'HORA SAÍDA ROTA 04', 'HORA SAIDA ROTA 04', 'HORA CHEGA ROTA 04'],
  },
];

function contadorPlausivel(n: number): boolean {
  return !isNaN(n) && n > 0 && n <= MAX_VIAGENS_DENTRO_ROTA;
}

function limitarViagens(n: number): number {
  if (isNaN(n) || n <= 0) return 0;
  return Math.min(Math.round(n), MAX_VIAGENS_DENTRO_ROTA);
}

function registroUnificado(registro: Partial<ColetaData> | Record<string, unknown>): Record<string, unknown> {
  const raw: Record<string, unknown> = { ...(registro as Record<string, unknown>) };
  const dados = (registro as Partial<ColetaData>).dados;
  if (dados && typeof dados === 'object' && !Array.isArray(dados)) {
    for (const [k, v] of Object.entries(dados)) {
      if (v !== null && v !== undefined && v !== '') raw[k] = v;
    }
  }
  return raw;
}

function valorPreenchido(val: unknown): boolean {
  if (val === null || val === undefined || val === '') return false;
  const n = parseNumeroBr(val);
  if (!isNaN(n) && n > 0) return true;
  return String(val).trim().length > 0;
}

function registroTemDadosOperacionais(registro: Partial<ColetaData> | Record<string, unknown>): boolean {
  const raw = registro as Record<string, unknown>;
  const peso = parseNumeroBr(encontrarValorColuna(raw, 'PESO TOTAL') ?? raw.pesoTotal);
  const km = parseNumeroBr(encontrarValorColuna(raw, 'KM TOTAL') ?? raw.kmTotal);
  return (!isNaN(peso) && peso > 0) || (!isNaN(km) && km > 0);
}

/**
 * Peso máximo plausível de UMA viagem (kg).
 * Acima disso costuma ser PESO TOTAL da rota ou erro de planilha — não entra em min/máx.
 */
export const MAX_PESO_VIAGEM_KG = 25000;

/** Lê PESO n só por campo tipado ou nome exato da coluna (sem fallback genérico). */
function lerPesoViagemExato(
  registro: Partial<ColetaData> | Record<string, unknown>,
  slot: (typeof COLUNAS_PESO_VIAGEM)[number],
): number | null {
  const raw = registro as Record<string, unknown>;
  const tipado = parseNumeroBr(raw[slot.campo]);
  if (!isNaN(tipado) && tipado > 0) return tipado;

  const unificado = registroUnificado(registro);
  const candidatos = [
    slot.coluna,
    slot.coluna.replace(' ', ''),
    slot.campo,
    slot.campo.toUpperCase(),
  ];
  for (const chave of candidatos) {
    if (unificado[chave] !== undefined && unificado[chave] !== null && unificado[chave] !== '') {
      const n = parseNumeroBr(unificado[chave]);
      if (!isNaN(n) && n > 0) return n;
    }
  }

  // Match normalizado estrito (PESO1 ≡ PESO 1), sem "contains" que pega PESO TOTAL
  const alvo = slot.coluna.replace(/\s+/g, '').toUpperCase();
  for (const [k, v] of Object.entries(unificado)) {
    if (v === null || v === undefined || v === '') continue;
    const kn = String(k).replace(/\s+/g, '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (kn === alvo || kn === slot.campo.toUpperCase()) {
      const n = parseNumeroBr(v);
      if (!isNaN(n) && n > 0) return n;
    }
  }
  return null;
}

/** Peso de uma viagem (PESO n) dentro da rota. */
export function obterPesoViagemRegistro(
  registro: Partial<ColetaData> | Record<string, unknown>,
  slot: (typeof COLUNAS_PESO_VIAGEM)[number],
): number | null {
  const exato = lerPesoViagemExato(registro, slot);
  if (exato !== null) return exato;

  // Fallback legado (encontrarValorColuna) — ainda usado em contagem de viagens
  const p = parseNumeroBr(encontrarValorColuna(registroUnificado(registro), slot.coluna));
  return !isNaN(p) && p > 0 ? p : null;
}

/**
 * Pesos das viagens 1–4 lidos direto da planilha (campos peso1–4 / PESO 1–4).
 * NÃO usa PESO TOTAL nem média — evita MÁXIMO absurdo (ex.: 76.998 kg = total da rota).
 */
export function extrairPesosViagemPlanilhaRegistro(
  registro: Partial<ColetaData> | Record<string, unknown>,
): number[] {
  const individuais: number[] = [];
  for (const slot of COLUNAS_PESO_VIAGEM) {
    const p = lerPesoViagemExato(registro, slot);
    if (p === null) continue;
    if (p > MAX_PESO_VIAGEM_KG) continue; // total/erro — ignora
    individuais.push(p);
  }
  return individuais;
}

/** Quantas viagens (PESO 1–4 preenchidos) existem na rota (linha). */
export function contarViagensPreenchidasPorPesoRegistro(
  registro: Partial<ColetaData> | Record<string, unknown>,
): number {
  let total = 0;
  for (const slot of COLUNAS_PESO_VIAGEM) {
    if (obterPesoViagemRegistro(registro, slot) !== null) total++;
  }
  return total;
}

function pesoCelulaJsonExata(dados: unknown, ...nomes: string[]): number {
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) return 0;
  const raw = dados as Record<string, unknown>;
  const alvos = nomes.map((n) => n.replace(/[\r\n]+/g, ' ').trim().toUpperCase());
  for (const [chave, val] of Object.entries(raw)) {
    if (val === null || val === undefined || val === '') continue;
    const rotulo = chave.replace(/[\r\n]+/g, ' ').trim().toUpperCase();
    if (!alvos.includes(rotulo)) continue;
    const n = parseNumeroBr(val);
    if (!isNaN(n) && n > 0) return n;
  }
  return 0;
}

function somaPesosCelulaJson(registro: Partial<ColetaData> | Record<string, unknown>): number {
  const dados = (registro as Partial<ColetaData>).dados ?? registro;
  let soma = 0;
  for (let i = 1; i <= 5; i++) {
    soma += pesoCelulaJsonExata(dados, `PESO ${i}`, `PESO${i}`);
  }
  return soma;
}

/** PESO TOTAL da rota (linha). */
export function obterPesoTotalRegistro(
  registro: Partial<ColetaData> | Record<string, unknown>,
  colPeso?: string,
): number {
  const dados = (registro as Partial<ColetaData>).dados;
  const somaCelulas = somaPesosCelulaJson(registro);
  const totalJson = pesoCelulaJsonExata(dados ?? registro, 'PESO TOTAL', 'PESOTOTAL');
  if (somaCelulas > 0) {
    if (totalJson > 0 && totalJson <= somaCelulas * 1.02) return totalJson;
    return somaCelulas;
  }
  if (totalJson > 0) return totalJson;

  const raw = registro as Record<string, unknown>;
  const tipado = parseNumeroBr(raw.pesoTotal);
  if (!isNaN(tipado) && tipado > 0) return tipado;

  const unificado = registroUnificado(registro);
  if (colPeso) {
    const p = parseNumeroBr(encontrarValorColuna(unificado, colPeso));
    if (!isNaN(p) && p > 0) return p;
  }

  const pTotal = parseNumeroBr(encontrarValorColuna(unificado, 'PESO TOTAL'));
  if (!isNaN(pTotal) && pTotal > 0) return pTotal;

  let soma = 0;
  for (const slot of COLUNAS_PESO_VIAGEM) {
    const pr = obterPesoViagemRegistro(registro, slot);
    if (pr !== null) soma += pr;
  }
  return soma;
}

/**
 * Pesos individuais de cada viagem dentro da rota (linha).
 * Prioriza PESO 1–4 da planilha. Só usa PESO TOTAL/média se NÃO houver nenhum PESO 1–4
 * (e o total for plausível como viagem única — nunca > MAX_PESO_VIAGEM_KG).
 */
export function extrairPesosViagemRegistro(
  registro: Partial<ColetaData> | Record<string, unknown>,
  colPeso?: string,
): number[] {
  const daPlanilha = extrairPesosViagemPlanilhaRegistro(registro);
  if (daPlanilha.length > 0) {
    const viagens = contarViagensPorRotaRegistro(registro);
    if (viagens > 0) {
      return daPlanilha.slice(0, Math.min(viagens, daPlanilha.length));
    }
    return daPlanilha;
  }

  // Sem PESO 1–4: só aceita total se for plausível como UMA viagem (não total de rota enorme)
  const total = obterPesoTotalRegistro(registro, colPeso);
  if (total > 0 && total <= MAX_PESO_VIAGEM_KG) {
    const viagens = contarViagensPorRotaRegistro(registro);
    const v = viagens > 0 ? limitarViagens(viagens) : 1;
    if (v <= 1) return [total];
    // Várias viagens sem PESO 1–4: não inventa pesos — evita min/máx falso
    return [];
  }

  return [];
}

/**
 * Lê o CONTADOR DE VIAGENS da planilha (viagens feitas na rota / linha).
 */
export function obterContadorViagensRegistro(
  registro: Partial<ColetaData> | Record<string, unknown>,
): number | null {
  // CONTADOR fica no JSON da planilha (`dados`); sem unificar, a gente só via
  // o campo tipado e a 01AD com 2 viagens virava 1.
  const raw = registroUnificado(registro);

  for (const col of COLUNAS_CONTADOR_VIAGENS) {
    const val = encontrarValorColuna(raw, col);
    const n = parseNumeroBr(val);
    if (contadorPlausivel(n)) return Math.round(n);
    if (!isNaN(n) && n > MAX_VIAGENS_DENTRO_ROTA) return MAX_VIAGENS_DENTRO_ROTA;
  }

  const tipado = (registro as Partial<ColetaData>).numeroViagens;
  if (tipado !== null && tipado !== undefined) {
    const n = Number(tipado);
    if (contadorPlausivel(n)) return Math.round(n);
    if (!isNaN(n) && n > MAX_VIAGENS_DENTRO_ROTA) return MAX_VIAGENS_DENTRO_ROTA;
  }

  const vpr = (registro as Partial<ColetaData>).viagensPorRota;
  if (vpr !== null && vpr !== undefined) {
    const n = Number(vpr);
    if (contadorPlausivel(n)) return Math.round(n);
    if (!isNaN(n) && n > MAX_VIAGENS_DENTRO_ROTA) return MAX_VIAGENS_DENTRO_ROTA;
  }

  return null;
}

function rotaOperacionalLegadoTemDados(
  registro: Record<string, unknown>,
  rota: (typeof ROTAS_OPERACIONAIS_LEGADO)[number],
): boolean {
  const kmTipado = registro[rota.kmField];
  const horaTipada = registro[rota.horaField];
  if (kmTipado !== null && kmTipado !== undefined && Number(kmTipado) > 0) return true;
  if (horaTipada !== null && horaTipada !== undefined && valorPreenchido(horaTipada)) return true;

  for (const col of [...rota.colunasKm, ...rota.colunasHora]) {
    if (valorPreenchido(encontrarValorColuna(registro, col))) return true;
  }
  return false;
}

/**
 * Conta slots legados ROTA 01–04 (KM/hora) — uso em KPIs de hodômetro, não para viagens.
 */
export function contarRotasPreenchidasRegistro(
  registro: Partial<ColetaData> | Record<string, unknown>,
): number {
  let total = 0;
  for (const rota of ROTAS_OPERACIONAIS_LEGADO) {
    if (rotaOperacionalLegadoTemDados(registro as Record<string, unknown>, rota)) {
      total++;
    }
  }
  return total;
}

/**
 * Viagens dentro da rota (linha):
 * 1) CONTADOR DE VIAGENS (1–4)
 * 2) quantidade de PESO 1–4 preenchidos
 * 3) 1 se houver peso/KM operacional
 */
export function contarViagensPorRotaRegistro(
  registro: Partial<ColetaData> | Record<string, unknown>,
): number {
  const contador = obterContadorViagensRegistro(registro);
  if (contador !== null && contador > 0) return limitarViagens(contador);

  const porPeso = contarViagensPreenchidasPorPesoRegistro(registro);
  if (porPeso > 0) return porPeso;

  if (registroTemDadosOperacionais(registro)) return 1;

  return 0;
}

/** Soma total de viagens (todas as rotas / linhas). */
export function sumarizarViagensPorRota(
  dados: Array<Partial<ColetaData> | Record<string, unknown>>,
): number {
  return dados.reduce((acc, reg) => acc + contarViagensPorRotaRegistro(reg), 0);
}

/** Linha entra no dashboard (aceita flag da entidade ou do objeto plano convertido) */
export function registroValidoParaDashboard(
  reg: Partial<ColetaData> | Record<string, unknown>,
): boolean {
  const r = reg as Record<string, unknown>;
  if (r.validoDashboard === true || r._validoDashboard === true) return true;
  if (r.validoDashboard === false || r._validoDashboard === false) return false;
  // Dataset já filtrado no SQL sem flag no objeto — considera válido se tem viagem operacional
  return contarViagensPorRotaRegistro(reg) > 0 || registroTemDadosOperacionais(reg);
}

/** Quantidade de rotas (linhas) validadas no dashboard. */
export function contarRotasValidadas(
  dados: Array<Partial<ColetaData> | Record<string, unknown>>,
): number {
  return dados.filter((reg) => registroValidoParaDashboard(reg)).length;
}

/**
 * Viagens em linhas validadas — soma do CONTADOR DE VIAGENS das rotas válidas.
 * Diferente de contarRotasValidadas(), que conta apenas linhas.
 */
export function contarViagensValidadas(
  dados: Array<Partial<ColetaData> | Record<string, unknown>>,
): number {
  const validos = dados.filter((reg) => registroValidoParaDashboard(reg));
  const base = validos.length > 0 ? validos : dados;
  return sumarizarViagensPorRota(base);
}

/** Atualiza o campo persistido na entidade ColetaData */
export function aplicarViagensPorRota(coleta: ColetaData): number {
  const qtd = contarViagensPorRotaRegistro(coleta);
  coleta.viagensPorRota = qtd;
  if (qtd > 0) coleta.numeroViagens = qtd;
  return qtd;
}

/**
 * Expressão SQL por linha: CONTADOR DE VIAGENS fidedigno.
 * Prioridade: viagensPorRota → numeroViagens → JSONB CONTADOR.
 * Sem aspas nas colunas tipadas — o QueryBuilder do TypeORM cita `alias.campo`.
 * NÃO inventa 1 por linha (isso inflava KPIs vs planilha/PDF).
 */
export function sqlExprViagensLinha(alias = 'c'): string {
  const a = alias;
  return `COALESCE(
    NULLIF(${a}.viagensPorRota, 0),
    NULLIF(${a}.numeroViagens, 0),
    NULLIF(${sqlJsonNumero(a, 'CONTADOR DE VIAGENS')}, 0),
    NULLIF(${sqlJsonNumero(a, 'CONTADOR VIAGENS')}, 0),
    NULLIF(${sqlJsonNumero(a, 'Nº DE VIAGENS')}, 0),
    NULLIF(${sqlJsonNumero(a, 'NUMERO DE VIAGENS')}, 0),
    NULLIF(${sqlJsonNumero(a, 'NÚMERO DE VIAGENS')}, 0),
    0
  )`;
}

/** SUM das viagens por rota (contador) — usar em agregações de dashboard/ciclo */
export function sqlSumViagens(alias = 'c'): string {
  return `COALESCE(SUM(${sqlExprViagensLinha(alias)}), 0)`;
}

/**
 * Número da célula JSONB da planilha. Ignora texto/vazio — o ::float cru
 * derrubava o ciclo/comparativo com 500 (invalid input syntax).
 */
export function sqlJsonNumero(alias: string, chave: string): string {
  const k = chave.replace(/'/g, "''");
  const txt = `NULLIF(TRIM(jsonb_extract_path_text(${alias}.dados, '${k}')), '')`;
  return `(CASE WHEN ${txt} ~ '^[+-]?[0-9]+([.][0-9]+)?$' THEN ${txt}::double precision ELSE NULL END)`;
}

/** Soma PESO 1–5 só das células da planilha (JSON), não dos campos tipados. */
function sqlSomaPesosCelulaPlanilha(alias: string): string {
  const partes = ['PESO 1', 'PESO 2', 'PESO 3', 'PESO 4', 'PESO 5']
    .map((k) => `COALESCE(${sqlJsonNumero(alias, k)}, 0)`)
    .join(' + ');
  return `(${partes})`;
}

/**
 * Peso da linha em kg para totais de ciclo/dashboard.
 * Usa as células PESO 1–5 da planilha (o que o Excel soma nas viagens).
 * Se PESO TOTAL da planilha ainda for o original (≈ soma das células), usa ele.
 * Se PESO TOTAL foi inflado na revalidação (id copiado para PESO 2–5), fica com a soma das células.
 * Sem parciais, cai no PESO TOTAL do JSON e por último no peso1 tipado.
 */
export function sqlExprPesoEfetivoKg(alias = 'c'): string {
  const a = alias;
  const somaCelulas = sqlSomaPesosCelulaPlanilha(a);
  const pesoTotalJson = `COALESCE(${sqlJsonNumero(a, 'PESO TOTAL')}, 0)`;
  return `CASE
    WHEN ${somaCelulas} > 0 THEN CASE
      WHEN ${pesoTotalJson} > 0 AND ${pesoTotalJson} <= (${somaCelulas}) * 1.02 THEN ${pesoTotalJson}
      ELSE ${somaCelulas}
    END
    WHEN ${pesoTotalJson} > 0 THEN ${pesoTotalJson}
    WHEN COALESCE(${a}."peso1", 0) > 0 THEN ${a}."peso1"
    ELSE COALESCE(${a}."pesoTotal", 0)
  END`;
}

/** SUM do peso efetivo — total do dia/período, não média. */
export function sqlSumPesoEfetivoKg(alias = 'c'): string {
  return `COALESCE(SUM(${sqlExprPesoEfetivoKg(alias)}), 0)`;
}

/** Data da viagem como yyyy-MM-dd — agrupa o dia civil, sem fuso quebrando o total. */
export function sqlDataIsoDia(alias = 'c'): string {
  return `TO_CHAR(${alias}.dataSaida, 'YYYY-MM-DD')`;
}
