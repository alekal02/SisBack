import { ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { Repository } from 'typeorm';
import AppDataSource from '../database/data-source';
import { ColetaData } from '../entities/ColetaData';
import { PlanilhaUpload } from '../entities/PlanilhaUpload';
import { Servico } from '../entities/Servico';
import { aplicarViagensPorRota, MAX_VIAGENS_POR_REGISTRO } from './viagensPorRotaService';
import { formatarDataSaida, parseDataPlanilha } from '../utils/formatarDataPlanilha';
import { colunaEhPlaca, normalizarPlaca, normalizarPlacaOuNull } from '../utils/normalizarPlaca';
import { linhaSemDadosOperacionaisMinimos } from '../utils/validarPlacaBr';
import { encontrarValorColuna, parseNumeroBr } from './FormulaEngine';
import { invalidarCacheDadosServico } from './servicoDadosCache';
import { COLUNAS_HODOMETRO } from '../config/modeloColetaCaminhao';

export interface ResultadoValidacaoViagem {
  validoDashboard: boolean;
  /** Sem placa, KM Total e Peso Total — linha descartada silenciosamente na importação */
  descartada?: boolean;
  motivos: string[];
  kmEfetivo: number | null;
  pesoEfetivo: number | null;
  /** Ajustes automáticos aplicados antes da validação final */
  correcoes?: string[];
}

/** KM acima deste limite não entra no dashboard (viagem atípica / erro de planilha) */
export const MAX_KM_DASHBOARD = 300;

/**
 * Hodômetro absoluto típico fica bem acima disso.
 * Distâncias operacionais por segmento/rota ficam ≤ MAX_KM_DASHBOARD.
 */
export const MIN_HODOMETRO_ABSOLUTO = 1000;

/** Hodômetro de base/rota costuma ser > 1000; distância operacional fica abaixo de MAX_KM_DASHBOARD */
function kmDistanciaPlausivel(km: number): boolean {
  return !isNaN(km) && km > 0 && km <= MAX_KM_DASHBOARD;
}

/** Valor parece leitura absoluta de hodômetro (não distância da viagem). */
function pareceHodometroAbsoluto(km: number): boolean {
  return !isNaN(km) && km >= MIN_HODOMETRO_ABSOLUTO;
}

/** Lê KM só com nome de coluna exato (evita fuzzy "KMROTA01" ⊃ "ID"). */
function lerKmColunaExata(raw: Record<string, unknown>, ...nomes: string[]): number {
  for (const nome of nomes) {
    const alvo = nome.trim().toUpperCase();
    for (const [key, val] of Object.entries(raw)) {
      if (key.trim().toUpperCase() !== alvo) continue;
      const km = parseNumeroBr(val);
      if (!isNaN(km) && km > 0) return km;
    }
  }
  return NaN;
}

/**
 * "ROTA 1" e "ROTA 01" (e "KMROTA1") viram o mesmo rótulo.
 * A comparação continua exata: "KM ROTA 01" não casa com "KM CHEGADA ROTA 01".
 */
function canonicoColunaKm(chave: string): string {
  return chave
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/\bKMROTA\s*0*(\d+)\b/g, (_m, n: string) => `KM ROTA ${String(Number(n)).padStart(2, '0')}`)
    .replace(/\bROTA\s+0*(\d+)\b/g, (_m, n: string) => `ROTA ${String(Number(n)).padStart(2, '0')}`);
}

function lerKmCanonico(raw: Record<string, unknown>, ...alvos: string[]): number {
  const esperados = new Set(alvos.map(canonicoColunaKm));
  for (const [key, val] of Object.entries(raw)) {
    if (!esperados.has(canonicoColunaKm(key))) continue;
    const km = parseNumeroBr(val);
    if (!isNaN(km) && km > 0) return km;
  }
  return NaN;
}

function rotuloRota(indice: number): string {
  return String(indice).padStart(2, '0');
}

/** Normaliza rótulo da célula da planilha para comparação exata (sem fuzzy). */
function rotuloCelulaPlanilha(chave: string): string {
  return chave.replace(/[\r\n]+/g, ' ').trim().toUpperCase().replace(/\s+/g, ' ');
}

/** Lê peso só da coluna da planilha em `dados` — nunca do id da linha nem de campo tipado. */
function lerPesoCelulaExata(dados: unknown, ...nomes: string[]): number | null {
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) return null;
  const raw = dados as Record<string, unknown>;
  const alvos = nomes.map((n) => rotuloCelulaPlanilha(n));
  for (const [key, val] of Object.entries(raw)) {
    if (val === null || val === undefined || val === '') continue;
    if (!alvos.includes(rotuloCelulaPlanilha(key))) continue;
    const n = parseNumeroBr(val);
    if (!isNaN(n) && n > 0) return n;
  }
  return null;
}

/**
 * Recoloca PESO 1–5 e PESO TOTAL a partir das células da planilha.
 * Revalidação com id persistido copiava o id para PESO 2–5 e somava no total.
 */
function restaurarPesosCelulasPlanilha(coleta: ColetaData): void {
  const dados = coleta.dados;
  const p1 = lerPesoCelulaExata(dados, 'PESO 1', 'PESO1');
  const p2 = lerPesoCelulaExata(dados, 'PESO 2', 'PESO2');
  const p3 = lerPesoCelulaExata(dados, 'PESO 3', 'PESO3');
  const p4 = lerPesoCelulaExata(dados, 'PESO 4', 'PESO4');
  const p5 = lerPesoCelulaExata(dados, 'PESO 5', 'PESO5');
  const totalCelula = lerPesoCelulaExata(dados, 'PESO TOTAL', 'PESOTOTAL');
  const somaParciais = (p1 || 0) + (p2 || 0) + (p3 || 0) + (p4 || 0) + (p5 || 0);
  const temCelulaParcial = p1 !== null || p2 !== null || p3 !== null || p4 !== null || p5 !== null;

  if (temCelulaParcial) {
    coleta.peso1 = p1;
    coleta.peso2 = p2;
    coleta.peso3 = p3;
    coleta.peso4 = p4;
    coleta.peso5 = p5;
  } else if (coleta.id != null) {
    for (const campo of ['peso1', 'peso2', 'peso3', 'peso4', 'peso5'] as const) {
      if (coleta[campo] === coleta.id) (coleta as unknown as Record<string, unknown>)[campo] = null;
    }
  }

  if (somaParciais > 0 && totalCelula !== null && totalCelula > somaParciais * 1.02 + 1) {
    coleta.pesoTotal = Math.round(somaParciais * 100) / 100;
    sincronizarAliasesNumericos(coleta, ['PESO TOTAL', 'PESOTOTAL'], coleta.pesoTotal);
  } else if (totalCelula !== null) {
    coleta.pesoTotal = totalCelula;
  } else if (somaParciais > 0 && (coleta.pesoTotal == null || coleta.pesoTotal <= 0)) {
    coleta.pesoTotal = Math.round(somaParciais * 100) / 100;
  }
}

export type ProblemaHodometro = {
  trecho: string;
  saida: number;
  chegada: number;
  motivo: string;
};

export type ResultadoSanitizacaoKm = {
  kmCorrigido: number | null;
  problemas: ProblemaHodometro[];
  /** true se KM da viagem foi zerado/corrigido por falha de hodômetro */
  kmInvalidadoPorHodometro: boolean;
  ajustes: string[];
};

/** Critérios obrigatórios para viagem entrar no dashboard */
export const REGRAS_VIAGEM_DASHBOARD = [
  'Data de saída preenchida e válida',
  'KM Total preenchido (coluna KM TOTAL > 0), ou KM zerado por hodômetro inconsistente com peso válido',
  'Peso Total > 0, ou retorno à base sem pesagem (placa + motorista + KM ok, peso zerado)',
  `KM Total até ${MAX_KM_DASHBOARD} km (hodômetro igual/parado, salto absurdo ou chegada < saída → KM zerado; peso/viagens entram)`,
  'Sem valores negativos efetivos em KM ou peso (fórmulas Excel com -1 em coluna ociosa são limpas e não derrubam a viagem)',
  'Horas no formato HH:MM (use ":", não ";")',
  'Trecho com horário e PESO N vazio: a viagem sobe no dashboard como “sem pesagem”; o peso dessa faixa não soma',
] as const;

const CAMPOS_KM = ['kmTotal', 'kmSaida', 'kmChegada', 'kmRota1', 'kmRota2', 'kmRota3', 'kmRota4'] as const;
const CAMPOS_PESO = ['pesoTotal', 'peso1', 'peso2', 'peso3', 'peso4', 'peso5'] as const;

function normalizarChave(s: string): string {
  return s.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
}

function registroUnificado(coleta: Partial<ColetaData>): Record<string, any> {
  const raw: Record<string, any> = { ...(coleta as Record<string, any>) };
  if (coleta.dados && typeof coleta.dados === 'object') {
    for (const [k, v] of Object.entries(coleta.dados)) {
      if (v !== null && v !== undefined && v !== '') {
        raw[k] = v;
      }
    }
  }
  return raw;
}

/** Postgres/TypeORM pode devolver dataSaida como string — normaliza para Date */
function normalizarDataSaida(val: Date | string | null | undefined): Date | null {
  if (val === null || val === undefined || val === '') return null;
  if (val instanceof Date && !isNaN(val.getTime())) return val;
  const parsed = parseDataPlanilha(val);
  if (parsed && !isNaN(parsed.getTime())) return parsed;
  return null;
}

/** Preenche campos tipados a partir de coleta.dados (planilhas com nomes de coluna variados) */
export function enriquecerCamposColeta(coleta: ColetaData): void {
  const raw = registroUnificado(coleta);
  const temAlertaHodometro = viagemComAlertaHodometro(coleta);

  // KM: só match exato — encontrarValorColuna é fuzzy e "KMTOTAL"/"KMROTA01" contêm "ID"
  // Nunca restaurar KM se a viagem foi zerada por hodômetro inconsistente.
  if (
    !temAlertaHodometro
    && (coleta.kmTotal === null || coleta.kmTotal === undefined || coleta.kmTotal <= 0)
  ) {
    const km = lerKmColunaExata(raw, 'KM TOTAL', 'KMTOTAL');
    if (kmDistanciaPlausivel(km)) coleta.kmTotal = km;
  }

  restaurarPesosCelulasPlanilha(coleta);

  if (coleta.pesoTotal === null || coleta.pesoTotal === undefined || coleta.pesoTotal <= 0) {
    const peso = lerPesoCelulaExata(coleta.dados, 'PESO TOTAL', 'PESOTOTAL');
    if (peso !== null) coleta.pesoTotal = peso;
  }

  if (!coleta.regional?.trim()) {
    const r = encontrarValorColuna(raw, 'REGIONAL') ?? encontrarValorColuna(raw, 'REGIAO');
    if (r) coleta.regional = String(r).trim();
  }

  if (!coleta.distrito?.trim()) {
    const d =
      encontrarValorColuna(raw, 'DISTRITO') ??
      encontrarValorColuna(raw, 'SETOR') ??
      encontrarValorColuna(raw, 'BAIRRO');
    if (d) coleta.distrito = String(d).trim();
  }

  if (!coleta.placa?.trim()) {
    const p = encontrarValorColuna(raw, 'PLACA');
    if (p) coleta.placa = String(p).trim();
  }

  if (!coleta.motorista?.trim()) {
    const m = encontrarValorColuna(raw, 'MOTORISTA') ?? encontrarValorColuna(raw, 'OPERADOR');
    if (m) coleta.motorista = String(m).trim();
  }

  const dataRaw =
    encontrarValorColuna(raw, 'DATA SAIDA') ??
    encontrarValorColuna(raw, 'DATA SAÍDA') ??
    encontrarValorColuna(raw, 'DATA DE SAIDA') ??
    encontrarValorColuna(raw, 'DATA');
  const parsedPlanilha = parseDataPlanilha(dataRaw);
  if (parsedPlanilha) {
    coleta.dataSaida = parsedPlanilha;
  } else {
    const dataAtual = normalizarDataSaida(coleta.dataSaida);
    if (dataAtual) coleta.dataSaida = dataAtual;
  }

  if (coleta.kmSaida === null || coleta.kmSaida === undefined) {
    const km = lerKmColunaExata(
      raw,
      'KM SAIDA BASE',
      'KM SAÍDA BASE',
      ' KM SAIDA BASE ',
      'KM SAIDA',
      'KM SAÍDA',
    );
    if (!isNaN(km) && km > 0) coleta.kmSaida = km;
  }

  if (coleta.kmChegada === null || coleta.kmChegada === undefined) {
    const km = lerKmColunaExata(raw, 'KM CHEGADA BASE', ' KM CHEGADA BASE ', 'KM CHEGADA');
    if (!isNaN(km) && km > 0) coleta.kmChegada = km;
  }

  for (let i = 1; i <= 4; i++) {
    const kmField = `kmRota${i}` as keyof ColetaData;
    if (coleta[kmField] === null || coleta[kmField] === undefined) {
      const km = lerKmCanonico(raw, `KM ROTA ${rotuloRota(i)}`);
      if (kmDistanciaPlausivel(km)) (coleta as any)[kmField] = km;
    }
  }

  sincronizarPlacaNormalizada(coleta);
}

/** Unifica placa com/sem hífen — evita contar o mesmo veículo duas vezes. */
function sincronizarPlacaNormalizada(coleta: ColetaData): void {
  const raw = registroUnificado(coleta);
  const bruta = coleta.placa?.trim() || String(encontrarValorColuna(raw, 'PLACA') || '').trim();
  coleta.placa = normalizarPlacaOuNull(bruta);

  if (!coleta.placa || !coleta.dados || typeof coleta.dados !== 'object') return;

  const dados = coleta.dados as Record<string, unknown>;
  for (const chave of Object.keys(dados)) {
    if (colunaEhPlaca(chave)) {
      dados[chave] = coleta.placa;
    }
  }
}

function somaPositiva(valores: (number | null | undefined)[]): number {
  let total = 0;
  for (const v of valores) {
    const n = Number(v);
    if (!isNaN(n) && n > 0) total += n;
  }
  return total;
}

function ehChaveKmOuPeso(chave: string): boolean {
  const norm = normalizarChave(chave);
  return norm.includes('KM') || norm.includes('PESO');
}

/**
 * Zera negativos também em `dados` (colunas cruas da planilha).
 * Sem isso, um KM ROTA 04 = -1 (fórmula Excel) derrubava a linha inteira
 * mesmo com PESO TOTAL válido — e as toneladas sumiam do ciclo.
 */
function sanitizarNegativosEmDados(coleta: ColetaData): boolean {
  if (!coleta.dados || typeof coleta.dados !== 'object' || Array.isArray(coleta.dados)) {
    return false;
  }
  let limpou = false;
  const dados = coleta.dados as Record<string, unknown>;
  for (const [chave, valor] of Object.entries(dados)) {
    if (!ehChaveKmOuPeso(chave)) continue;
    const n = parseNumeroBr(valor);
    if (!isNaN(n) && n < 0) {
      dados[chave] = null;
      limpou = true;
    }
  }
  return limpou;
}

/**
 * Remove valores negativos que distorcem KPIs (fórmulas Excel com erro).
 */
export function sanitizarViagem(coleta: ColetaData): boolean {
  let limpou = sanitizarNegativosEmDados(coleta);

  for (const campo of CAMPOS_KM) {
    const valor = coleta[campo];
    if (valor !== null && valor !== undefined && valor < 0) {
      (coleta as any)[campo] = null;
      limpou = true;
    }
  }

  for (const campo of CAMPOS_PESO) {
    const valor = coleta[campo];
    if (valor !== null && valor !== undefined && valor < 0) {
      (coleta as any)[campo] = null;
      limpou = true;
    }
  }

  if (coleta.numeroViagens !== null && coleta.numeroViagens !== undefined && coleta.numeroViagens < 0) {
    coleta.numeroViagens = null;
    limpou = true;
  }

  if (
    coleta.viagensPorRota !== null &&
    coleta.viagensPorRota !== undefined &&
    (coleta.viagensPorRota < 0 || coleta.viagensPorRota > MAX_VIAGENS_POR_REGISTRO)
  ) {
    coleta.viagensPorRota = null;
    limpou = true;
  }

  if (coleta.horasForaUnidade !== null && coleta.horasForaUnidade !== undefined && coleta.horasForaUnidade < 0) {
    coleta.horasForaUnidade = null;
    limpou = true;
  }

  if (coleta.tempoForaUnidade !== null && coleta.tempoForaUnidade !== undefined && coleta.tempoForaUnidade < 0) {
    coleta.tempoForaUnidade = null;
    limpou = true;
  }

  return limpou;
}

/** KM Total explícito (coluna KM TOTAL) — critério principal do dashboard */
function obterKmTotalPrincipal(coleta: Partial<ColetaData>): number | null {
  if (coleta.kmTotal !== null && coleta.kmTotal !== undefined && !isNaN(coleta.kmTotal)) {
    if (kmDistanciaPlausivel(coleta.kmTotal)) return coleta.kmTotal;
  }
  const raw = registroUnificado(coleta);
  const kmCol = lerKmColunaExata(raw, 'KM TOTAL', 'KMTOTAL');
  if (kmDistanciaPlausivel(kmCol)) return kmCol;
  return null;
}

/** Peso Total explícito (coluna PESO TOTAL) — critério principal do dashboard */
function obterPesoTotalPrincipal(coleta: Partial<ColetaData>): number | null {
  if (coleta.pesoTotal !== null && coleta.pesoTotal !== undefined && !isNaN(coleta.pesoTotal)) {
    return coleta.pesoTotal;
  }
  const raw = registroUnificado(coleta);
  const pesoCol = parseNumeroBr(encontrarValorColuna(raw, 'PESO TOTAL'));
  if (!isNaN(pesoCol)) return pesoCol;
  return null;
}

function obterDataSaidaPrincipal(coleta: Partial<ColetaData>): Date | null {
  const normalizada = normalizarDataSaida(coleta.dataSaida);
  if (normalizada) return normalizada;
  const raw = registroUnificado(coleta);
  const dataRaw =
    encontrarValorColuna(raw, 'DATA SAIDA') ??
    encontrarValorColuna(raw, 'DATA SAÍDA') ??
    encontrarValorColuna(raw, 'DATA DE SAIDA') ??
    encontrarValorColuna(raw, 'DATA');
  return parseDataPlanilha(dataRaw);
}

/** KM efetivo com fallbacks (relatórios / diagnóstico — não usado para validar dashboard) */
function calcularKmEfetivo(coleta: Partial<ColetaData>): number | null {
  const principal = obterKmTotalPrincipal(coleta);
  if (principal !== null && principal > 0) return principal;

  const raw = registroUnificado(coleta);
  if (
    coleta.kmSaida !== null && coleta.kmSaida !== undefined &&
    coleta.kmChegada !== null && coleta.kmChegada !== undefined &&
    coleta.kmChegada >= coleta.kmSaida
  ) {
    const diff = coleta.kmChegada - coleta.kmSaida;
    if (kmDistanciaPlausivel(diff)) return diff;
  }

  let kmSaida = coleta.kmSaida ?? NaN;
  let kmChegada = coleta.kmChegada ?? NaN;
  if (isNaN(kmSaida)) {
    kmSaida = lerKmColunaExata(
      raw,
      'KM SAIDA BASE',
      'KM SAÍDA BASE',
      ' KM SAIDA BASE ',
      'KM SAIDA',
      'KM SAÍDA',
    );
  }
  if (isNaN(kmChegada)) {
    kmChegada = lerKmColunaExata(raw, 'KM CHEGADA BASE', ' KM CHEGADA BASE ', 'KM CHEGADA');
  }
  if (!isNaN(kmSaida) && !isNaN(kmChegada) && kmChegada >= kmSaida) {
    const diff = kmChegada - kmSaida;
    if (kmDistanciaPlausivel(diff)) return diff;
  }

  const rotas: number[] = [];
  for (let i = 1; i <= 4; i++) {
    const tipado = (coleta as any)[`kmRota${i}`];
    if (tipado !== null && tipado !== undefined && kmDistanciaPlausivel(Number(tipado))) {
      rotas.push(Number(tipado));
      continue;
    }
    const km = lerKmCanonico(raw, `KM ROTA ${rotuloRota(i)}`);
    if (kmDistanciaPlausivel(km)) rotas.push(km);
  }
  const somaRotas = somaPositiva(rotas);
  return somaRotas > 0 ? somaRotas : null;
}

function calcularPesoEfetivo(coleta: Partial<ColetaData>): number | null {
  const principal = obterPesoTotalPrincipal(coleta);
  if (principal !== null && principal > 0) return principal;

  const raw = registroUnificado(coleta);
  const pesosParciais: number[] = [];
  for (let i = 1; i <= 5; i++) {
    const tipado = (coleta as any)[`peso${i}`];
    if (tipado !== null && tipado !== undefined && Number(tipado) > 0) {
      pesosParciais.push(Number(tipado));
      continue;
    }
    const p = parseNumeroBr(encontrarValorColuna(raw, `PESO ${i}`));
    if (!isNaN(p) && p > 0) pesosParciais.push(p);
  }
  const soma = somaPositiva(pesosParciais);
  return soma > 0 ? soma : null;
}

function isColunaHora(chave: string): boolean {
  const norm = normalizarChave(chave);
  return norm.includes('HORA') || norm.startsWith('HR');
}

/** Horas em texto devem usar ":" (ex: 08:30), não ";" */
function validarCamposHora(coleta: Partial<ColetaData>): string[] {
  const motivos: string[] = [];
  const raw = registroUnificado(coleta);

  for (const [chave, valor] of Object.entries(raw)) {
    if (!isColunaHora(chave)) continue;
    if (valor === null || valor === undefined || valor === '') continue;

    const s = String(valor).trim();

    if (s.includes(';')) {
      motivos.push(`Hora inválida em "${chave.trim()}": use ":" (ex: 08:30), não ";"`);
    }
  }

  return motivos;
}

function temValorNegativoOriginal(coleta: Partial<ColetaData>): string[] {
  const motivos: string[] = [];
  for (const campo of CAMPOS_KM) {
    const v = coleta[campo];
    if (v !== null && v !== undefined && v < 0) {
      motivos.push(`KM negativo em ${campo}`);
    }
  }
  for (const campo of CAMPOS_PESO) {
    const v = coleta[campo];
    if (v !== null && v !== undefined && v < 0) {
      motivos.push(`Peso negativo em ${campo}`);
    }
  }

  const raw = registroUnificado(coleta);
  for (const [chave, valor] of Object.entries(raw)) {
    if (valor === null || valor === undefined || valor === '') continue;
    const norm = normalizarChave(chave);
    if (!norm.includes('KM') && !norm.includes('PESO')) continue;
    const n = parseNumeroBr(valor);
    if (!isNaN(n) && n < 0) {
      motivos.push(`Valor negativo em "${chave.trim()}"`);
    }
  }

  return [...new Set(motivos)];
}

function obterMotoristaPrincipal(coleta: Partial<ColetaData>): string | null {
  const tipado = coleta.motorista?.trim();
  if (tipado) return tipado;
  const raw = registroUnificado(coleta);
  const col = String(encontrarValorColuna(raw, 'MOTORISTA') ?? '').trim();
  return col || null;
}

function obterPlacaPrincipal(coleta: Partial<ColetaData>): string | null {
  const bruta = coleta.placa?.trim()
    || String(encontrarValorColuna(registroUnificado(coleta), 'PLACA') ?? '').trim();
  return normalizarPlacaOuNull(bruta);
}

/** Peso zerado/ausente — sem carga (retorno à base sem pesagem). Rejeita se houver peso negativo ou parcial positivo. */
function semPesagemEfetiva(coleta: Partial<ColetaData>): boolean {
  const raw = registroUnificado(coleta);
  const principal = obterPesoTotalPrincipal(coleta);

  if (principal !== null && !isNaN(principal)) {
    if (principal < 0) return false;
    if (principal > 0) return false;
  }

  for (let i = 1; i <= 5; i++) {
    const tipado = (coleta as Record<string, unknown>)[`peso${i}`];
    if (tipado !== null && tipado !== undefined && tipado !== '') {
      const n = Number(tipado);
      if (!isNaN(n)) {
        if (n < 0) return false;
        if (n > 0) return false;
      }
    }
    const p = parseNumeroBr(encontrarValorColuna(raw, `PESO ${i}`));
    if (!isNaN(p)) {
      if (p < 0) return false;
      if (p > 0) return false;
    }
  }

  return true;
}

/**
 * Caminhão voltou à base sem pesar/descarregar — rota operacional completa, só peso zerado.
 */
function rotaRetornoBaseSemPesagem(coleta: Partial<ColetaData>): boolean {
  if (!obterDataSaidaPrincipal(coleta)) return false;
  if (!obterPlacaPrincipal(coleta)) return false;
  if (!obterMotoristaPrincipal(coleta)) return false;

  const km = obterKmTotalPrincipal(coleta);
  if (km === null || km === undefined || isNaN(km) || km <= 0) return false;

  return semPesagemEfetiva(coleta);
}

function kmAcimaDoLimite(coleta: Partial<ColetaData>, kmEfetivo: number | null): string | null {
  const raw = registroUnificado(coleta);
  const kmCol = lerKmColunaExata(raw, 'KM TOTAL', 'KMTOTAL');
  const kmTipado = coleta.kmTotal;

  const candidatos = [kmEfetivo, kmTipado, !isNaN(kmCol) ? kmCol : null].filter(
    (v): v is number => v !== null && v !== undefined && !isNaN(v),
  );

  for (const km of candidatos) {
    if (km > MAX_KM_DASHBOARD) {
      return `KM Total acima de ${MAX_KM_DASHBOARD} km (excluído do dashboard)`;
    }
  }
  return null;
}

function viagemComAlertaHodometro(coleta: Partial<ColetaData> | Record<string, unknown>): boolean {
  const raw = coleta as Record<string, unknown>;
  // Objeto plano (converterColetasParaBrutos) expõe o alerta no topo
  const topo = raw._alertaKmHodometro;
  if (topo != null && String(topo).trim()) return true;

  const dados = raw.dados;
  if (dados && typeof dados === 'object' && !Array.isArray(dados)) {
    const alerta = (dados as Record<string, unknown>)._alertaKmHodometro;
    if (alerta != null && String(alerta).trim()) return true;
  }
  return false;
}

/**
 * Valida se a viagem pode alimentar o dashboard.
 * Critérios principais: Data de saída + KM Total + Peso Total (ou retorno à base sem pesagem).
 *
 * Exceção: hodômetro quebrado → KM pode ficar 0 e a viagem ainda entra (peso/viagens).
 */
export function validarViagemParaDashboard(coleta: Partial<ColetaData>): ResultadoValidacaoViagem {
  const motivos: string[] = [
    ...temValorNegativoOriginal(coleta),
    ...validarCamposHora(coleta),
  ];

  const dataSaida = obterDataSaidaPrincipal(coleta);
  if (!dataSaida) {
    motivos.push('Data de saída ausente ou inválida');
  }

  const alertaHodometro = viagemComAlertaHodometro(coleta);
  const kmPrincipal = obterKmTotalPrincipal(coleta);
  if (!alertaHodometro) {
    if (kmPrincipal === null || kmPrincipal === undefined || isNaN(kmPrincipal)) {
      motivos.push('KM Total ausente');
    } else if (kmPrincipal <= 0) {
      motivos.push('KM Total zerado ou negativo (verifique fórmulas da planilha)');
    }
  }

  const retornoSemPesagem = rotaRetornoBaseSemPesagem(coleta);
  const pesoPrincipal = obterPesoTotalPrincipal(coleta);

  if (pesoPrincipal !== null && !isNaN(pesoPrincipal) && pesoPrincipal < 0) {
    motivos.push('Peso Total negativo (verifique fórmulas da planilha)');
  } else if (!retornoSemPesagem) {
    if (pesoPrincipal === null || pesoPrincipal === undefined || isNaN(pesoPrincipal)) {
      motivos.push('Peso Total ausente');
    } else if (pesoPrincipal <= 0) {
      motivos.push('Peso Total zerado ou negativo (verifique fórmulas da planilha)');
    }
  }

  // Com alerta de hodômetro: não bloqueia por KM alto — já foi zerado na sanitização
  if (!alertaHodometro) {
    const kmAlto = kmAcimaDoLimite(
      coleta,
      kmPrincipal !== null && kmPrincipal > 0 ? kmPrincipal : null,
    );
    if (kmAlto) motivos.push(kmAlto);
  }

  const kmEfetivo = kmPrincipal !== null && kmPrincipal > 0 ? kmPrincipal : null;
  const pesoEfetivo = pesoPrincipal !== null && pesoPrincipal > 0
    ? pesoPrincipal
    : (retornoSemPesagem ? 0 : null);

  const validoDashboard = motivos.length === 0;
  return { validoDashboard, motivos, kmEfetivo, pesoEfetivo };
}

/** Exportado para relatórios de diagnóstico (KM derivado de rotas/hodômetro) */
export { calcularKmEfetivo, calcularPesoEfetivo };

export interface ResultadoCorrecaoViagem {
  corrigido: boolean;
  ajustes: string[];
}

const ALIAS_KM_TOTAL = ['KM TOTAL', 'KMTOTAL'];
const ALIAS_PESO_TOTAL = ['PESO TOTAL', 'PESOTOTAL'];

function sincronizarValorCampo(coleta: ColetaData, chaveOriginal: string, valor: unknown): void {
  (coleta as unknown as Record<string, unknown>)[chaveOriginal] = valor;
  if (coleta.dados && typeof coleta.dados === 'object') {
    (coleta.dados as Record<string, unknown>)[chaveOriginal] = valor;
    const trimmed = chaveOriginal.trim();
    if (trimmed !== chaveOriginal) {
      (coleta.dados as Record<string, unknown>)[trimmed] = valor;
    }
  }
}

function sincronizarAliasesNumericos(coleta: ColetaData, aliases: string[], valor: number): void {
  const raw = registroUnificado(coleta);
  for (const alias of aliases) {
    const alvo = normalizarChave(alias);
    for (const chave of Object.keys(raw)) {
      if (normalizarChave(chave) === alvo) {
        sincronizarValorCampo(coleta, chave, valor);
      }
    }
  }
}

function diagnosticarSegmentoHodometro(
  trecho: string,
  saida: number,
  chegada: number,
): { km: number | null; problema: ProblemaHodometro | null } {
  if (isNaN(saida) || isNaN(chegada) || saida <= 0 || chegada <= 0) {
    return { km: null, problema: null };
  }
  if (chegada < saida) {
    const [origem, destino] = trecho.split('→').map((s) => s.trim());
    const colOrigem = rotuloColunaHodometro(origem || 'ponto anterior');
    const colDestino = rotuloColunaHodometro(destino || 'ponto seguinte');
    return {
      km: null,
      problema: {
        trecho,
        saida,
        chegada,
        motivo:
          `${colDestino} (${chegada.toLocaleString('pt-BR')}) está menor que ${colOrigem} (${saida.toLocaleString('pt-BR')}). `
          + `Tratamento: essa leitura foi descartada e o KM foi recalculado pelos trechos válidos `
          + `(em geral saída base → chegada base).`,
      },
    };
  }
  const diff = chegada - saida;
  // Diff 0 = parado no ponto (ex.: descarga) — não é distância nem falha isolada
  if (diff === 0) return { km: null, problema: null };
  if (!kmDistanciaPlausivel(diff)) {
    const [origem, destino] = trecho.split('→').map((s) => s.trim());
    return {
      km: null,
      problema: {
        trecho,
        saida,
        chegada,
        motivo:
          `Salto absurdo de hodômetro entre ${rotuloColunaHodometro(origem || 'origem')} (${saida.toLocaleString('pt-BR')}) `
          + `e ${rotuloColunaHodometro(destino || 'destino')} (${chegada.toLocaleString('pt-BR')}): `
          + `${Math.round(diff).toLocaleString('pt-BR')} km (máx. ${MAX_KM_DASHBOARD} km). `
          + `Tratamento: esse trecho foi ignorado no cálculo do KM.`,
      },
    };
  }
  return { km: diff, problema: null };
}

/** Nomes de coluna da planilha para o relatório de saúde (linguagem do operador). */
function rotuloColunaHodometro(labelPonto: string): string {
  const l = labelPonto.trim();
  const mapa: Record<string, string> = {
    'Saída base': 'KM SAÍDA BASE',
    'Chegada base': 'KM CHEGADA BASE',
    'Chegada Rota 01': 'KM CHEGADA ROTA 01',
    'Saída Rota 01': 'KM SAÍDA ROTA 01',
    'Chegada Rota 02': 'KM CHEGADA ROTA 02',
    'Saída Rota 02': 'KM SAÍDA ROTA 02',
    'Chegada Rota 03': 'KM CHEGADA ROTA 03',
    'Saída Rota 03': 'KM SAÍDA ROTA 03',
    'Chegada Rota 04': 'KM CHEGADA ROTA 04',
    'Saída Rota 04': 'KM SAÍDA ROTA 04',
  };
  return mapa[l] || l;
}

function garantirDadosColeta(coleta: ColetaData): Record<string, unknown> {
  if (!coleta.dados || typeof coleta.dados !== 'object') {
    coleta.dados = {};
  }
  return coleta.dados as Record<string, unknown>;
}

/**
 * Soma KM a partir da sequência real do hodômetro:
 * Saída base → cada rota em ordem cronológica → Chegada base.
 * Dentro da rota, a leitura menor vem antes. Quando a saída é menor ou igual
 * à chegada (trecho normal, "ROTA 1" ou "ROTA 01"), a saída entra antes da chegada.
 * Quando a planilha padrão tem chegada menor que a saída, a chegada continua antes,
 * e uma saída que volta ainda é descartada.
 * - Diff 0 (parado no ponto): ok, sem km
 * - Leitura que volta: descarta esse ponto e religa a cadeia
 * - Salto absurdo: ignora a distância daquele trecho, mantém o ponto como âncora
 */
function analisarHodometroColeta(coleta: Partial<ColetaData>): {
  segmentosValidos: number[];
  problemas: ProblemaHodometro[];
} {
  const raw = registroUnificado(coleta);
  const segmentosValidos: number[] = [];
  const problemas: ProblemaHodometro[] = [];

  // Preferência: KM de rota já tipado/distância operacional
  const tipados: number[] = [];
  for (let i = 1; i <= 4; i++) {
    const tipado = (coleta as Record<string, unknown>)[`kmRota${i}`];
    if (tipado !== null && tipado !== undefined && kmDistanciaPlausivel(Number(tipado))) {
      tipados.push(Number(tipado));
    }
  }

  type PontoHodometro = { label: string; km: number };
  const pontos: PontoHodometro[] = [];

  const kmSaidaBase = lerKmColunaExata(
    raw,
    COLUNAS_HODOMETRO.saidaBase.trim(),
    'KM SAIDA BASE',
    'KM SAÍDA BASE',
  );
  if (!isNaN(kmSaidaBase) && kmSaidaBase > 0) {
    pontos.push({ label: 'Saída base', km: kmSaidaBase });
  }

  for (let i = 1; i <= 4; i++) {
    const n = rotuloRota(i);
    const kmChegadaRota = lerKmCanonico(raw, `KM CHEGADA ROTA ${n}`);
    const kmSaidaRota = lerKmCanonico(raw, `KM SAIDA ROTA ${n}`);
    const temChegada = !isNaN(kmChegadaRota) && kmChegadaRota > 0;
    const temSaida = !isNaN(kmSaidaRota) && kmSaidaRota > 0;
    const chegada = { label: `Chegada Rota ${n}`, km: kmChegadaRota };
    const saida = { label: `Saída Rota ${n}`, km: kmSaidaRota };
    if (temSaida && temChegada && kmSaidaRota <= kmChegadaRota) {
      pontos.push(saida, chegada);
    } else {
      if (temChegada) pontos.push(chegada);
      if (temSaida) pontos.push(saida);
    }
  }

  const kmChegadaBase = lerKmColunaExata(
    raw,
    COLUNAS_HODOMETRO.chegadaBase.trim(),
    'KM CHEGADA BASE',
  );
  if (!isNaN(kmChegadaBase) && kmChegadaBase > 0) {
    pontos.push({ label: 'Chegada base', km: kmChegadaBase });
  }

  // Caminha a cadeia descartando leituras que "voltam" (erro de digitação típico)
  if (pontos.length > 0) {
    const pontosValidos: PontoHodometro[] = [pontos[0]];
    for (let i = 1; i < pontos.length; i++) {
      const prev = pontosValidos[pontosValidos.length - 1];
      const curr = pontos[i];
      const diag = diagnosticarSegmentoHodometro(`${prev.label} → ${curr.label}`, prev.km, curr.km);

      if (diag.problema && curr.km < prev.km) {
        // Leitura inválida: descarta o ponto atual e tenta o próximo contra o mesmo prev
        problemas.push(diag.problema);
        continue;
      }

      if (diag.problema) {
        // Salto absurdo: não soma km, mas mantém o ponto como âncora
        problemas.push(diag.problema);
        pontosValidos.push(curr);
        continue;
      }

      if (diag.km != null) {
        segmentosValidos.push(diag.km);
      }
      // diff 0 ou trecho válido: avança a âncora
      pontosValidos.push(curr);
    }
  }

  // Fallback só com match exato — encontrarValorColuna é fuzzy e pode
  // confundir "KM ROTA 01" com o campo "id" (substring "ID" em "KMROTA01").
  if (segmentosValidos.length === 0) {
    for (let i = 1; i <= 4; i++) {
      const km = lerKmCanonico(raw, `KM ROTA ${rotuloRota(i)}`);
      if (kmDistanciaPlausivel(km)) {
        segmentosValidos.push(km);
      }
    }
  }

  // Se há KM tipado de rota e a cadeia não rendeu segmentos, usa tipados
  if (tipados.length > 0 && segmentosValidos.length === 0) {
    segmentosValidos.push(...tipados);
  } else if (tipados.length > 0 && problemas.length === 0) {
    // Cadeia ok: preferir tipados quando disponíveis
    segmentosValidos.length = 0;
    segmentosValidos.push(...tipados);
  }

  // Viagem inteira com hodômetro parado (KM inicial = KM final) e sem km útil
  if (
    segmentosValidos.length === 0
    && !isNaN(kmSaidaBase)
    && !isNaN(kmChegadaBase)
    && kmSaidaBase > 0
    && kmChegadaBase > 0
    && kmSaidaBase === kmChegadaBase
  ) {
    problemas.push({
      trecho: 'Viagem',
      saida: kmSaidaBase,
      chegada: kmChegadaBase,
      motivo: `Hodômetro parado/igual na viagem: saída base = chegada base (${kmSaidaBase})`,
    });
  }

  // Preferência operacional: se saída/chegada base formam distância plausível,
  // e a soma dos segmentos divergiu por leituras intermediárias problemáticas,
  // a distância real da viagem é chegada base − saída base.
  if (
    !isNaN(kmSaidaBase)
    && !isNaN(kmChegadaBase)
    && kmChegadaBase > kmSaidaBase
    && kmDistanciaPlausivel(kmChegadaBase - kmSaidaBase)
    && problemas.length > 0
  ) {
    const kmBaseABase = Math.round((kmChegadaBase - kmSaidaBase) * 100) / 100;
    const somaSeg = somaPositiva(segmentosValidos);
    if (Math.abs(somaSeg - kmBaseABase) > 0.01) {
      segmentosValidos.length = 0;
      segmentosValidos.push(kmBaseABase);
    }
  }

  return { segmentosValidos, problemas };
}

function somarKmRotasColeta(coleta: Partial<ColetaData>): number {
  return somaPositiva(analisarHodometroColeta(coleta).segmentosValidos);
}

/**
 * Corrige KM TOTAL quando hodômetro quebra (igual, chegada < saída ou salto absurdo).
 * - Usa só segmentos plausíveis da sequência
 * - Se KM TOTAL parece hodômetro absoluto ou > máx., substitui/zera
 * - Sem KM confiável + peso válido → KM 0 com alerta (viagem permanece no dashboard)
 */
export function sanitizarKmHodometro(coleta: ColetaData): ResultadoSanitizacaoKm {
  const ajustes: string[] = [];
  const { segmentosValidos, problemas } = analisarHodometroColeta(coleta);
  const kmDosSegmentos = somaPositiva(segmentosValidos);

  const raw = registroUnificado(coleta);
  const kmPlanilhaBruto = lerKmColunaExata(raw, 'KM TOTAL', 'KMTOTAL');
  const kmTipadoBruto = coleta.kmTotal != null && !isNaN(Number(coleta.kmTotal))
    ? Number(coleta.kmTotal)
    : NaN;
  const kmBruto = !isNaN(kmTipadoBruto) && kmTipadoBruto > 0
    ? kmTipadoBruto
    : (!isNaN(kmPlanilhaBruto) && kmPlanilhaBruto > 0 ? kmPlanilhaBruto : NaN);

  const kmBrutoInvalido = !isNaN(kmBruto) && (
    kmBruto > MAX_KM_DASHBOARD
    || pareceHodometroAbsoluto(kmBruto)
    || kmBruto < 0
  );

  let kmCorrigido: number | null = null;
  let kmInvalidadoPorHodometro = false;

  const zerarKmPorHodometro = (detalhe: string) => {
    kmCorrigido = 0;
    kmInvalidadoPorHodometro = true;
    coleta.kmTotal = 0;
    sincronizarAliasesNumericos(coleta, ALIAS_KM_TOTAL, 0);
    const msg = `KM zerado por hodômetro inconsistente (${detalhe}). Peso/viagens mantidos.`;
    ajustes.push(msg);
    garantirDadosColeta(coleta)._alertaKmHodometro = msg;
  };

  if (kmDosSegmentos > 0 && kmDistanciaPlausivel(kmDosSegmentos)) {
    const kmAlvo = Math.round(kmDosSegmentos * 100) / 100;
    const kmJaConfere = !isNaN(kmBruto) && Math.abs(kmBruto - kmAlvo) <= 0.01;
    const precisaCorrigir = isNaN(kmBruto) || kmBruto <= 0 || kmBrutoInvalido || !kmJaConfere;
    const motivoPrincipal = problemas[0]?.motivo;

    if (precisaCorrigir) {
      kmCorrigido = kmAlvo;
      coleta.kmTotal = kmCorrigido;
      sincronizarAliasesNumericos(coleta, ALIAS_KM_TOTAL, kmCorrigido);
      const msg = motivoPrincipal
        ? `KM Total corrigido para ${kmAlvo} km. Motivo: ${motivoPrincipal}`
        : `KM Total corrigido para ${kmAlvo} km a partir dos trechos válidos do hodômetro`;
      ajustes.push(msg);
      if (problemas.length > 0) {
        garantirDadosColeta(coleta)._alertaKmHodometro = msg;
      }
    } else {
      // KM TOTAL já bate — ainda assim explica no relatório se houve leitura descartada
      kmCorrigido = kmDistanciaPlausivel(kmBruto) ? kmBruto : kmAlvo;
      if (motivoPrincipal) {
        const msg =
          `KM TOTAL mantido (${kmAlvo} km). Motivo do tratamento: ${motivoPrincipal}`;
        ajustes.push(msg);
        garantirDadosColeta(coleta)._alertaKmHodometro = msg;
      }
    }
  } else if (kmBrutoInvalido || problemas.length > 0) {
    const detalhe = problemas[0]?.motivo
      || (!isNaN(kmBruto) ? `KM TOTAL=${kmBruto} inválido/hodômetro` : 'sem trechos válidos');
    zerarKmPorHodometro(detalhe);
  } else if (kmDistanciaPlausivel(kmBruto)) {
    kmCorrigido = kmBruto;
  } else {
    // KM ausente/zerado e sem trechos confiáveis — típico de hodômetro parado/igual.
    // Com peso (ou retorno sem pesagem já resolvido depois), mantém a viagem na operação.
    const peso = obterPesoTotalPrincipal(coleta);
    const temPeso = peso != null && !isNaN(peso) && peso > 0;
    if (temPeso) {
      zerarKmPorHodometro('KM inicial=final ou sem leituras válidas');
    }
  }

  return { kmCorrigido, problemas, kmInvalidadoPorHodometro, ajustes };
}

function somarPesosParciaisColeta(coleta: Partial<ColetaData>): number {
  const raw = registroUnificado(coleta);
  const pesos: number[] = [];
  for (let i = 1; i <= 5; i++) {
    const tipado = (coleta as Record<string, unknown>)[`peso${i}`];
    if (tipado !== null && tipado !== undefined && Number(tipado) > 0) {
      pesos.push(Number(tipado));
      continue;
    }
    const p = parseNumeroBr(encontrarValorColuna(raw, `PESO ${i}`));
    if (!isNaN(p) && p > 0) pesos.push(p);
  }
  return somaPositiva(pesos);
}

function calcularKmDerivadoImportacao(coleta: Partial<ColetaData>): number | null {
  const somaRotas = somarKmRotasColeta(coleta);
  if (somaRotas > 0) return somaRotas;
  return calcularKmEfetivo(coleta);
}

function calcularPesoDerivadoImportacao(coleta: Partial<ColetaData>): number | null {
  const somaParciais = somarPesosParciaisColeta(coleta);
  if (somaParciais > 0) return somaParciais;
  return calcularPesoEfetivo(coleta);
}

/** Corrige horas com ";" → ":" nos campos de hora da planilha */
function corrigirHorasRegistro(coleta: ColetaData, ajustes: string[]): void {
  const raw = registroUnificado(coleta);
  for (const [chave, valor] of Object.entries(raw)) {
    if (!isColunaHora(chave)) continue;
    if (typeof valor !== 'string' || !valor.includes(';')) continue;
    const corrigido = valor.replace(/;/g, ':');
    sincronizarValorCampo(coleta, chave, corrigido);
    ajustes.push(`Hora corrigida em "${chave.trim()}" (; → :)`);
  }
}

/**
 * Completa KM Total, Peso Total e horas a partir de rotas/hodômetro/pesos parciais
 * quando o operador corrigiu a planilha mas fórmulas ou colunas ainda estão vazias.
 */
export function corrigirViagemAutomatica(coleta: ColetaData): ResultadoCorrecaoViagem {
  const ajustes: string[] = [];

  enriquecerCamposColeta(coleta);
  corrigirHorasRegistro(coleta, ajustes);

  // Prioridade: sanitizar hodômetro quebrado (chegada < saída / salto absurdo)
  const sanKm = sanitizarKmHodometro(coleta);
  ajustes.push(...sanKm.ajustes);

  const kmAtual = obterKmTotalPrincipal(coleta);
  const kmDerivado = calcularKmDerivadoImportacao(coleta);
  if (
    !sanKm.kmInvalidadoPorHodometro
    && kmDerivado !== null
    && kmDerivado > 0
    && kmDerivado <= MAX_KM_DASHBOARD
  ) {
    const deveUsarKmDerivado = kmAtual === null || kmAtual === undefined || isNaN(kmAtual)
      || kmAtual <= 0
      || kmDerivado > kmAtual + 0.01;
    if (deveUsarKmDerivado) {
      coleta.kmTotal = Math.round(kmDerivado * 100) / 100;
      sincronizarAliasesNumericos(coleta, ALIAS_KM_TOTAL, coleta.kmTotal);
      ajustes.push(
        kmAtual && kmAtual > 0
          ? 'KM Total atualizado a partir de hodômetro ou KM das rotas'
          : 'KM Total preenchido a partir de hodômetro ou KM das rotas',
      );
    }
  }

  restaurarPesosCelulasPlanilha(coleta);
  const pesoAtual = obterPesoTotalPrincipal(coleta);
  const pesoDerivado = calcularPesoDerivadoImportacao(coleta);
  // Só preenche PESO TOTAL vazio. Nunca substitui o valor da planilha pela soma
  // de PESO 1–5 (isso inflava o ciclo: PESO 2–5 vazios viravam o id da linha).
  if ((pesoAtual === null || pesoAtual === undefined || isNaN(pesoAtual) || pesoAtual <= 0)
    && pesoDerivado !== null && pesoDerivado > 0) {
    coleta.pesoTotal = Math.round(pesoDerivado * 100) / 100;
    sincronizarAliasesNumericos(coleta, ALIAS_PESO_TOTAL, coleta.pesoTotal);
    ajustes.push('Peso Total preenchido a partir dos pesos parciais da rota');
  }

  return { corrigido: ajustes.length > 0, ajustes };
}

/** Linha sem placa, KM Total e Peso Total — não importa nem entra no relatório de inconsistências */
export function linhaSemDadosOperacionaisImportaveis(coleta: Partial<ColetaData>): boolean {
  const raw = registroUnificado(coleta);
  const placaRaw = coleta.placa ?? String(encontrarValorColuna(raw, 'PLACA') ?? '');
  const km = obterKmTotalPrincipal(coleta);
  const peso = obterPesoTotalPrincipal(coleta);
  return linhaSemDadosOperacionaisMinimos(placaRaw, km, peso);
}

/**
 * Sanitiza e marca validade da viagem para o dashboard.
 */
export function prepararViagemParaImportacao(coleta: ColetaData): ResultadoValidacaoViagem {
  enriquecerCamposColeta(coleta);

  if (linhaSemDadosOperacionaisImportaveis(coleta)) {
    coleta.validoDashboard = false;
    coleta.motivosInconsistencia = null;
    return {
      validoDashboard: false,
      descartada: true,
      motivos: [],
      kmEfetivo: null,
      pesoEfetivo: null,
    };
  }

  sanitizarViagem(coleta);
  const { ajustes: correcoes } = corrigirViagemAutomatica(coleta);
  aplicarViagensPorRota(coleta);
  const resultado = validarViagemParaDashboard(coleta);
  if (resultado.validoDashboard && resultado.pesoEfetivo === 0) {
    coleta.pesoTotal = 0;
  }
  coleta.validoDashboard = resultado.validoDashboard;
  coleta.motivosInconsistencia = resultado.motivos.length > 0 ? resultado.motivos : null;
  return { ...resultado, correcoes: correcoes.length > 0 ? correcoes : undefined };
}

export function aplicarFiltroViagensValidasDashboard<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  alias = 'c'
): SelectQueryBuilder<T> {
  return qb.andWhere(`${alias}.validoDashboard = :validoDashboard`, {
    validoDashboard: true,
  });
}

export interface ResumoInconsistenciasViagem {
  totalViagens: number;
  viagensValidas: number;
  viagensInconsistentes: number;
  percentualValido: number;
  impactoDashboard: string;
  resumoPorMotivo: { motivo: string; quantidade: number }[];
  amostra: {
    id: number;
    data: string | null;
    placa: string | null;
    motorista: string | null;
    kmTotal: number | null;
    pesoTotal: number | null;
    motivos: string[];
  }[];
}

export class ValidacaoViagemService {
  private get coletaRepo(): Repository<ColetaData> {
    return AppDataSource.getRepository(ColetaData);
  }

  private get uploadRepo(): Repository<PlanilhaUpload> {
    return AppDataSource.getRepository(PlanilhaUpload);
  }

  private async getUploadIdsPorServico(servicoId: string): Promise<number[]> {
    const uploads = await this.uploadRepo.find({
      where: { servico_id: servicoId },
      select: ['id'],
    });
    return uploads.map(u => u.id);
  }

  /**
   * Revalida todas as viagens de um serviço (útil para dados importados antes desta feature).
   */
  async revalidarViagensServico(servicoId: string): Promise<{ atualizadas: number; inconsistentes: number }> {
    // Serviços sem viagem (roçada etc.) não devem passar pela regra de placa/KM/peso
    const servico = await AppDataSource.getRepository(Servico).findOne({
      where: { id: servicoId },
      select: ['id', 'tipo'],
    });
    if (servico?.tipo === 'rocadeira') {
      return { atualizadas: 0, inconsistentes: 0 };
    }

    const uploadIds = await this.getUploadIdsPorServico(servicoId);
    if (uploadIds.length === 0) return { atualizadas: 0, inconsistentes: 0 };

    const BATCH = 500;
    let offset = 0;
    let atualizadas = 0;
    let inconsistentes = 0;

    while (true) {
      const batch = await this.coletaRepo.createQueryBuilder('c')
        .where('c.planilhaUploadId IN (:...uploadIds)', { uploadIds })
        .orderBy('c.id', 'ASC')
        .skip(offset)
        .take(BATCH)
        .getMany();

      if (batch.length === 0) break;

      for (const coleta of batch) {
        const r = prepararViagemParaImportacao(coleta);
        atualizadas++;
        if (!r.validoDashboard) inconsistentes++;
      }

      await this.coletaRepo.save(batch);
      offset += BATCH;
      if (batch.length < BATCH) break;
    }

    invalidarCacheDadosServico(servicoId);
    void import('./coletaTotaisDiaService').then((m) => m.recalcularTotaisDiaServicoSilencioso(servicoId));
    return { atualizadas, inconsistentes };
  }

  async getResumoInconsistencias(servicoId: string, revalidar = true): Promise<ResumoInconsistenciasViagem> {
    if (revalidar) {
      await this.revalidarViagensServico(servicoId);
    }

    const uploadIds = await this.getUploadIdsPorServico(servicoId);
    if (uploadIds.length === 0) {
      return {
        totalViagens: 0,
        viagensValidas: 0,
        viagensInconsistentes: 0,
        percentualValido: 100,
        impactoDashboard: 'Nenhum dado importado.',
        resumoPorMotivo: [],
        amostra: [],
      };
    }

    const totalViagens = await this.coletaRepo.createQueryBuilder('c')
      .where('c.planilhaUploadId IN (:...uploadIds)', { uploadIds })
      .getCount();

    const viagensInconsistentes = await this.coletaRepo.createQueryBuilder('c')
      .where('c.planilhaUploadId IN (:...uploadIds)', { uploadIds })
      .andWhere('c.validoDashboard = :valido', { valido: false })
      .getCount();

    const viagensValidas = totalViagens - viagensInconsistentes;
    const percentualValido = totalViagens > 0
      ? Math.round((viagensValidas / totalViagens) * 1000) / 10
      : 100;

    const inconsistentes = await this.coletaRepo.createQueryBuilder('c')
      .where('c.planilhaUploadId IN (:...uploadIds)', { uploadIds })
      .andWhere('c.validoDashboard = :valido', { valido: false })
      .orderBy('c.dataSaida', 'DESC')
      .take(100)
      .getMany();

    const contagemMotivos = new Map<string, number>();
    for (const v of inconsistentes) {
      for (const m of v.motivosInconsistencia || []) {
        contagemMotivos.set(m, (contagemMotivos.get(m) || 0) + 1);
      }
    }

    const resumoPorMotivo = Array.from(contagemMotivos.entries())
      .map(([motivo, quantidade]) => ({ motivo, quantidade }))
      .sort((a, b) => b.quantidade - a.quantidade);

    const impactoDashboard = viagensInconsistentes > 0
      ? `${viagensInconsistentes} viagem(ns) com dados incompletos ou inconsistentes estão no banco (importação antiga) e foram excluídas do dashboard. Reimporte a planilha para removê-las — linhas inválidas não são mais salvas.`
      : 'Todas as viagens importadas estão válidas para o dashboard.';

    return {
      totalViagens,
      viagensValidas,
      viagensInconsistentes,
      percentualValido,
      impactoDashboard,
      resumoPorMotivo,
      amostra: inconsistentes.slice(0, 20).map(v => ({
        id: v.id,
        data: formatarDataSaida(v.dataSaida),
        placa: v.placa,
        motorista: v.motorista,
        kmTotal: v.kmTotal,
        pesoTotal: v.pesoTotal,
        motivos: v.motivosInconsistencia || [],
      })),
    };
  }
}

export default new ValidacaoViagemService();
