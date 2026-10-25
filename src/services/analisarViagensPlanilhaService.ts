import * as XLSX from 'xlsx';
import { ColetaData } from '../entities/ColetaData';
import { formatarDataPlanilha, parseDataPlanilha } from '../utils/formatarDataPlanilha';
import {
  prepararViagemParaImportacao,
  MAX_KM_DASHBOARD,
  REGRAS_VIAGEM_DASHBOARD,
} from './validacaoViagemService';
import {
  auditarPlacasPlanilha,
  validarPlacaBr,
  type AuditoriaPlacasPlanilha,
} from '../utils/validarPlacaBr';
import { colunaEhPlaca } from '../utils/normalizarPlaca';
import {
  contarViagensPorRotaRegistro,
  obterContadorViagensRegistro,
} from './viagensPorRotaService';
import { montarViagensPesoDoRegistro } from './viagemPesoRotaService';
import { encontrarValorColuna, parseNumeroBr } from './FormulaEngine';
import {
  conferirCadastroOperacional,
  type ConferenciaCadastroOperacional,
} from './conferirCadastroOperacionalService';
import { analisarConferenciaPlanilha, type RelatorioAgenteUpload } from './agenteConferenciaUploadService';
import {
  extrairCadastroOperacional,
  normalizarNomeOperacional,
  type ConfigOperacionalContrato,
} from '../utils/configOperacional';

function normalizarColuna(s: string): string {
  return s.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9\s]/g, '').replace(/\s+/g, '').trim();
}

function encontrarColuna(cabecalho: string[], termos: string[]): number {
  for (const t of termos) {
    const tn = normalizarColuna(t);
    for (let i = 0; i < cabecalho.length; i++) {
      if (normalizarColuna(cabecalho[i]) === tn) return i;
    }
  }
  return -1;
}

function parseNum(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

function parseStr(val: unknown): string | null {
  if (val === null || val === undefined || val === '') return null;
  const s = String(val).trim();
  return s || null;
}

function valorColuna(linha: unknown[], idx: number): unknown {
  return idx >= 0 ? linha[idx] : null;
}

function buildDadosBrutos(cabecalho: string[], linha: unknown[]): Record<string, unknown> {
  const dados: Record<string, unknown> = {};
  for (let i = 0; i < cabecalho.length; i++) {
    const h = cabecalho[i];
    if (!h || h.startsWith('__EMPTY')) continue;
    const v = linha[i];
    if (v !== null && v !== undefined && v !== '') dados[h] = v;
  }
  return dados;
}

function motivoParaCategoria(motivo: string): string {
  const m = motivo.toLowerCase();
  if (m.includes('negativo')) return 'Valor negativo (fora do dashboard)';
  if (m.includes('acima de') || m.includes(String(MAX_KM_DASHBOARD))) return `KM acima de ${MAX_KM_DASHBOARD} km`;
  if (m.includes('hora')) return 'Formato de hora inválido (use HH:MM)';
  if (m.includes('km')) return 'KM insuficiente ou ausente';
  if (m.includes('peso')) return 'Peso zerado, negativo ou ausente';
  if (m.includes('data')) return 'Data de saída ausente ou inválida';
  if (m.includes('placa') || m.startsWith('placa')) return 'Placa inválida ou ausente';
  return 'Outros';
}

/** Motivos informativos — não bloqueiam o dashboard */
function motivoIgnorarNoRelatorio(motivo: string): boolean {
  const m = motivo.toLowerCase();
  return (
    m.includes('placa será unificada')
    || m.includes('placa unificada')
    || m.startsWith('corrigido automaticamente')
    || m.includes('unificada:')
    || (m.startsWith('placa:') && (m.includes('hífen') || m.includes('hifen') || m.includes('espaço') || m.includes('espaco')))
  );
}

/** Aplica placa canônica (sem hífen) no registro — igual à importação. */
function aplicarPlacaNormalizadaNoRegistro(
  partial: Partial<ColetaData>,
  placaNormalizada: string,
): void {
  partial.placa = placaNormalizada;
  const dados = partial.dados;
  if (!dados || typeof dados !== 'object') return;
  for (const key of Object.keys(dados)) {
    if (colunaEhPlaca(key)) {
      (dados as Record<string, unknown>)[key] = placaNormalizada;
    }
  }
}

export interface ResumoPlacasSaude {
  totalValidas: number;
  totalInvalidas: number;
  totalSemPlaca: number;
  unificadasAutomaticamente: number;
  grafiasDuplicadas: number;
  /** Uma linha para o relatório */
  resumo: string;
  /** Só aparece se houver algo que exige correção na planilha */
  alerta: string | null;
}

function montarResumoPlacas(
  ap: AuditoriaPlacasPlanilha,
  viagensForaDashboard: ResultadoAnaliseViagens['viagens'],
): ResumoPlacasSaude {
  const alertas: string[] = [];

  if (ap.totalInvalidas > 0) {
    alertas.push(`${ap.totalInvalidas} linha(s) com placa inválida (fora do padrão BR)`);
  }

  const comProblemaPlaca = viagensForaDashboard.filter((v) =>
    (v.problemas || []).some((p) => {
      const pl = p.toLowerCase();
      return pl.startsWith('placa:') && !motivoIgnorarNoRelatorio(p);
    }),
  ).length;
  if (comProblemaPlaca > 0) {
    alertas.push(`${comProblemaPlaca} viagem(ns) fora do dashboard por placa inválida`);
  } else if (ap.totalSemPlaca > 0) {
    alertas.push(`${ap.totalSemPlaca} linha(s) sem placa (precisa KM ou Peso se placa vazia)`);
  }

  const grafiasReais = ap.gruposDuplicados?.length ?? 0;
  if (grafiasReais > 0) {
    alertas.push(`${grafiasReais} placa(s) com grafias conflitantes (não só hífen)`);
  }

  let resumo: string;
  if (alertas.length === 0) {
    resumo = `${ap.totalComPlacaValida} placa(s) válida(s) — hífen/espaço corrigido automaticamente na importação`;
  } else {
    resumo = `${ap.totalComPlacaValida} placa(s) válida(s)`;
    if (ap.totalNormalizadas > 0) {
      resumo += ` (${ap.totalNormalizadas} com hífen/espaço — já unificadas)`;
    }
  }

  return {
    totalValidas: ap.totalComPlacaValida,
    totalInvalidas: ap.totalInvalidas,
    totalSemPlaca: ap.totalSemPlaca,
    unificadasAutomaticamente: ap.totalNormalizadas,
    grafiasDuplicadas: grafiasReais,
    resumo,
    alerta: alertas.length > 0 ? alertas.join(' · ') : null,
  };
}

export interface ResultadoAnaliseViagens {
  sucesso: boolean;
  nomeArquivo: string;
  aba: string;
  totalViagens: number;
  viagensCompletas: number;
  viagensIncompletas: number;
  viagensComValorNegativo: number;
  viagensValidasDashboard: number;
  viagensInconsistentesTotal: number;
  linhasDescartadasSemDados?: number;
  /** Linhas de template/rodapé da planilha, sem nada que identifique uma viagem */
  linhasEmBrancoIgnoradas?: number;
  /** Viagens importáveis com KM zerado por hodômetro igual/quebrado */
  viagensCorrigidasHodometro?: number;
  /** Pesagens individuais > 15.000 kg (até 1.000 t) — alerta, não bloqueia dashboard */
  pesagensAltas?: number;
  /** Linhas da planilha com ao menos uma pesagem alta */
  linhasComPesagemAlta?: number;
  podeImportar: boolean;
  avisoDashboard: string | null;
  percentualCompleto: number;
  problemasAgrupados: { tipo: string; quantidade: number }[];
  viagens: Array<{
    linha: number;
    data: string | null;
    placa: string | null;
    placaNormalizada?: string | null;
    placaValida?: boolean;
    motorista: string | null;
    rota: string | null;
    kmTotal: number | null;
    pesoTotal: number | null;
    /** Pesagens individuais da linha (PESO 1–5) — o total é a soma delas */
    pesagensKg?: number[];
    kmSaida: number | null;
    kmChegada: number | null;
    kmTotalCalculado: number | null;
    completa: boolean;
    temIdentificacao: boolean;
    temValorNegativo: boolean;
    problemas: string[];
    /** CONTADOR DE VIAGENS da linha (planilha) */
    contadorViagens?: number | null;
    /** true se a linha NÃO entra no dashboard */
    foraDashboard?: boolean;
    /** Motivo resumido de exclusão do dashboard */
    motivoForaDashboard?: string | null;
    /** true se linha ignorada (sem placa/KM/peso) */
    descartada?: boolean;
    /** true se entrou no dashboard com KM zerado por falha de hodômetro */
    corrigidaHodometro?: boolean;
    /** true se há pesagem > 15.000 kg (alerta informativo) */
    alertaPesagemAlta?: boolean;
    pesoAlertaKg?: number | null;
    /** true se algum trecho tem horário e o PESO N está vazio — sobe no dash */
    alertaSemPesagem?: boolean;
    /** Números das viagens (1–4) sem pesagem nesta linha */
    viagensSemPesagem?: number[];
  }>;
  mensagem?: string;
  regrasSaude?: string[];
  /** Resumo compacto de placas (sem tabelas) */
  resumoPlacas?: ResumoPlacasSaude;
  /** Problemas que excluem viagens do dashboard — sem ruído de normalização de placa */
  problemasDashboard?: { tipo: string; quantidade: number }[];
  auditoriaPlacas?: AuditoriaPlacasPlanilha;
  /** Soma do CONTADOR DE VIAGENS nas linhas analisadas (células preenchidas) */
  somaContadorViagens?: number;
  /** Soma do CONTADOR nas linhas que ENTRAM no dashboard */
  somaContadorNoDashboard?: number;
  /** Soma do CONTADOR nas linhas que NÃO sobem ao dashboard */
  somaContadorForaDashboard?: number;
  /** PESO TOTAL (kg) das linhas que entram no dashboard — mesmo critério da coluna Toneladas do ciclo */
  pesoKgDashboard?: number;
  /** PESO TOTAL (kg) das linhas FORA DO DASH / ignoradas — diferença vs a planilha */
  pesoKgForaDashboard?: number;
  /** Total de viagens com fallback (PESO 1–4) — mesmo critério do dashboard */
  viagensCalculadasDashboard?: number;
  /** Linhas sem contador preenchido */
  linhasSemContador?: number;
  /** Faixas com horário e sem PESO N — entram no dash, peso da faixa não soma */
  viagensSemPesagem?: number;
  /** Linhas da planilha com ao menos uma viagem sem pesagem */
  linhasComSemPesagem?: number;
  /** Conferência planilha × cadastro operacional do contrato */
  conferenciaCadastro?: ConferenciaCadastroOperacional | null;
  /** Contagem de rotas, template, retrabalho e duplicatas na própria planilha */
  conferenciaUpload?: RelatorioAgenteUpload;
}

/** Alerta informativo — pesagem por viagem acima do usual (não bloqueia dashboard). */
export const PESO_ALERTA_VIAGEM_MIN_KG = 15_000;
/** Teto do alerta: 1.000 toneladas (1.000.000 kg). Acima disso trata-se como ruído extremo. */
export const PESO_ALERTA_VIAGEM_MAX_KG = 1_000_000;

function lerPesosViagemParaAlerta(coleta: Partial<ColetaData>): number[] {
  // Preferência: PESO 1–4 sem filtro de teto operacional (alerta até 1.000 t)
  const raw: Record<string, unknown> = { ...(coleta as Record<string, unknown>) };
  if (coleta.dados && typeof coleta.dados === 'object') {
    Object.assign(raw, coleta.dados);
  }
  const pesos: number[] = [];
  for (let i = 1; i <= 4; i++) {
    const tipado = (coleta as Record<string, unknown>)[`peso${i}`];
    const nTipado = tipado != null ? Number(tipado) : NaN;
    if (!isNaN(nTipado) && nTipado > 0) {
      pesos.push(nTipado);
      continue;
    }
    const p = parseNumeroBr(encontrarValorColuna(raw, `PESO ${i}`));
    if (!isNaN(p) && p > 0) pesos.push(p);
  }
  if (pesos.length > 0) return pesos;

  // Fallback: uma viagem só com PESO TOTAL
  const total = coleta.pesoTotal != null && !isNaN(Number(coleta.pesoTotal))
    ? Number(coleta.pesoTotal)
    : parseNumeroBr(encontrarValorColuna(raw, 'PESO TOTAL'));
  const contador = obterContadorViagensRegistro(coleta as ColetaData);
  if (!isNaN(total) && total > 0 && (contador === null || contador === 1)) {
    return [total];
  }
  return [];
}

function detectarPesagemAlta(coleta: Partial<ColetaData>): {
  quantidade: number;
  pesoMaxKg: number | null;
  mensagem: string | null;
} {
  const pesos = lerPesosViagemParaAlerta(coleta);
  const altos = pesos.filter(
    (p) => p > PESO_ALERTA_VIAGEM_MIN_KG && p <= PESO_ALERTA_VIAGEM_MAX_KG,
  );
  if (altos.length === 0) {
    return { quantidade: 0, pesoMaxKg: null, mensagem: null };
  }
  const pesoMaxKg = Math.max(...altos);
  const ton = pesoMaxKg / 1000;
  return {
    quantidade: altos.length,
    pesoMaxKg,
    mensagem:
      `Atenção: pesagem alta por viagem (${pesoMaxKg.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} kg / `
      + `${ton.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} t > 15.000 kg). `
      + `Não bloqueia o dashboard.`,
  };
}

function mensagemSemPesagem(slots: number[]): string {
  const lista = slots.length === 1
    ? `Viagem ${slots[0]}`
    : `Viagens ${slots.slice(0, -1).join(', ')} e ${slots[slots.length - 1]}`;
  const pesos = slots.map((n) => `PESO ${n}`).join(', ');
  return `${lista} sem pesagem (trecho com horário e ${pesos} vazio). `
    + 'Sobe no dashboard; toneladas dessa faixa não entram.';
}

function detectarViagensSemPesagem(coleta: Partial<ColetaData>): number[] {
  return montarViagensPesoDoRegistro({
    rota: String(coleta.distrito || coleta.regional || ''),
    placa: String(coleta.placa || ''),
    motorista: String(coleta.motorista || ''),
    tipo: null,
    pesos: [coleta.peso1, coleta.peso2, coleta.peso3, coleta.peso4],
    objHoras: coleta as Record<string, unknown>,
    pesoIdealKg: null,
  }).filter((v) => v.semPesagem).map((v) => v.nViagem);
}

function correcaoEhHodometro(texto: string): boolean {
  const t = texto.toLowerCase();
  return t.includes('hodômetro')
    || t.includes('hodometro')
    || t.includes('km zerado')
    || t.includes('km total corrigido')
    || t.includes('km total mantido')
    || t.includes('km saída')
    || t.includes('km chegada')
    || t.includes('motivo do tratamento')
    || t.includes('leitura foi descartada');
}

function viagemFicaForaDash(v: {
  foraDashboard?: boolean;
  descartada?: boolean;
  completa?: boolean;
}): boolean {
  return Boolean(v.foraDashboard || v.descartada || v.completa === false);
}

/** Fora do dashboard primeiro — essas linhas não se perdem no meio das tratadas. */
export function priorizarViagensForaDashboard<T extends {
  foraDashboard?: boolean;
  descartada?: boolean;
  completa?: boolean;
}>(lista: T[], maxDetalhe = 500): T[] {
  const fora: T[] = [];
  const resto: T[] = [];
  for (const v of lista) {
    if (viagemFicaForaDash(v)) fora.push(v);
    else resto.push(v);
  }
  return [...fora, ...resto.slice(0, Math.max(0, maxDetalhe - fora.length))];
}

export function analisarViagensPlanilha(
  buffer: Buffer,
  nomeArquivo: string,
  cadastroOperacional?: ConfigOperacionalContrato | null,
): ResultadoAnaliseViagens {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const nomeAba = workbook.SheetNames[0];
  const sheet = workbook.Sheets[nomeAba];
  const dadosBrutos: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    blankrows: true,
    raw: true,
  });

  if (dadosBrutos.length < 2) {
    return {
      sucesso: true,
      nomeArquivo,
      aba: nomeAba,
      viagens: [],
      viagensCompletas: 0,
      viagensIncompletas: 0,
      viagensComValorNegativo: 0,
      viagensValidasDashboard: 0,
      viagensInconsistentesTotal: 0,
      totalViagens: 0,
      podeImportar: true,
      avisoDashboard: null,
      percentualCompleto: 0,
      problemasAgrupados: [],
      mensagem: 'Planilha sem dados de viagens.',
    };
  }

  const cabecalho = (dadosBrutos[0] || []).map(v =>
    v !== null && v !== undefined ? String(v).trim() : ''
  );
  const linhas = dadosBrutos.slice(1);

  const idx = {
    data: encontrarColuna(cabecalho, ['DATA SAIDA', 'DATA SAÍDA', 'DATA', 'DIA']),
    placa: encontrarColuna(cabecalho, ['PLACA', 'VEICULO', 'VEÍCULO', 'CAMINHAO', 'CAMINHÃO']),
    motorista: encontrarColuna(cabecalho, ['MOTORISTA', 'OPERADOR', 'NOME MOTORISTA']),
    rota: encontrarColuna(cabecalho, ['ROTA', 'SETOR', 'DESTINO']),
    regional: encontrarColuna(cabecalho, ['REGIONAL', 'REGIAO', 'REGIÃO']),
    distrito: encontrarColuna(cabecalho, ['DISTRITO', 'BAIRRO']),
    kmTotal: encontrarColuna(cabecalho, ['KM TOTAL', 'KM PERCORRIDO', 'DISTANCIA', 'DISTÂNCIA']),
    pesoTotal: encontrarColuna(cabecalho, ['PESO TOTAL', 'PESO', 'PESO BRUTO']),
    kmSaida: encontrarColuna(cabecalho, ['KM SAIDA', 'KM SAÍDA', 'KM SAIDA BASE']),
    kmChegada: encontrarColuna(cabecalho, ['KM CHEGADA', 'KM DE CHEGADA', 'KM CHEGADA BASE']),
    kmRota1: encontrarColuna(cabecalho, ['KM ROTA 01', 'KM ROTA 1', 'KM ROTA01']),
    kmRota2: encontrarColuna(cabecalho, ['KM ROTA 02', 'KM ROTA 2', 'KM ROTA02']),
    kmRota3: encontrarColuna(cabecalho, ['KM ROTA 03', 'KM ROTA 3', 'KM ROTA03']),
    kmRota4: encontrarColuna(cabecalho, ['KM ROTA 04', 'KM ROTA 4', 'KM ROTA04']),
    peso1: encontrarColuna(cabecalho, ['PESO 1']),
    peso2: encontrarColuna(cabecalho, ['PESO 2']),
    peso3: encontrarColuna(cabecalho, ['PESO 3']),
    peso4: encontrarColuna(cabecalho, ['PESO 4']),
    peso5: encontrarColuna(cabecalho, ['PESO 5']),
    coletor1: encontrarColuna(cabecalho, ['COLETOR 01', 'COLETOR 1']),
    coletor2: encontrarColuna(cabecalho, ['COLETOR 02', 'COLETOR 2']),
    coletor3: encontrarColuna(cabecalho, ['COLETOR 03', 'COLETOR 3']),
    coletor4: encontrarColuna(cabecalho, ['COLETOR 04', 'COLETOR 4']),
  };

  // Planilha sem colunas de coleta (ex.: roçada enviada no serviço errado)
  const temColunasColeta = idx.placa >= 0
    && (idx.kmTotal >= 0 || (idx.kmSaida >= 0 && idx.kmChegada >= 0) || idx.pesoTotal >= 0);
  if (!temColunasColeta) {
    const faltantes: string[] = [];
    if (idx.placa < 0) faltantes.push('PLACA');
    if (idx.kmTotal < 0 && (idx.kmSaida < 0 || idx.kmChegada < 0)) faltantes.push('KM TOTAL (ou KM SAIDA + KM CHEGADA)');
    if (idx.pesoTotal < 0) faltantes.push('PESO TOTAL');
    return {
      sucesso: false,
      nomeArquivo,
      aba: nomeAba,
      viagens: [],
      viagensCompletas: 0,
      viagensIncompletas: 0,
      viagensComValorNegativo: 0,
      viagensValidasDashboard: 0,
      viagensInconsistentesTotal: 0,
      totalViagens: 0,
      podeImportar: false,
      avisoDashboard: null,
      percentualCompleto: 0,
      problemasAgrupados: [],
      mensagem:
        'Esta planilha não parece ser de coleta (faltam colunas como PLACA, KM e PESO). '
        + 'Se for roçada, envie no serviço do tipo Roçadeira. '
        + (faltantes.length ? `Colunas não encontradas: ${faltantes.join(', ')}.` : ''),
    };
  }

  const MAX_DETALHE_VIAGENS = 500;
  const placasPlanilha = new Set<string>();
  const motoristasPlanilha = new Set<string>();
  const coletoresPlanilha = new Set<string>();

  const viagens: ResultadoAnaliseViagens['viagens'] = [];
  let viagensCompletas = 0;
  let viagensIncompletas = 0;
  let viagensComValorNegativo = 0;
  let viagensCorrigidasHodometro = 0;
  let pesagensAltas = 0;
  let linhasComPesagemAlta = 0;
  let linhasDescartadasSemDados = 0;
  let linhasEmBrancoIgnoradas = 0;
  let somaContadorViagens = 0;
  let somaContadorNoDashboard = 0;
  let somaContadorForaDashboard = 0;
  let pesoKgDashboard = 0;
  let pesoKgForaDashboard = 0;
  let viagensCalculadasDashboard = 0;
  let linhasSemContador = 0;
  let viagensSemPesagemCount = 0;
  let linhasComSemPesagem = 0;
  const problemasPorCategoria = new Map<string, Set<number>>();

  const auditoriaPlacas = auditarPlacasPlanilha({
    cabecalho,
    linhas,
    idxPlaca: idx.placa,
    idxData: idx.data,
    idxKmTotal: idx.kmTotal,
    idxPesoTotal: idx.pesoTotal,
    parseNum: (raw) => parseNum(raw),
    parseData: (raw) => formatarDataPlanilha(raw),
  });

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i] || [];
    const temAlgumValor = linha.some(v => v !== null && v !== '' && v !== undefined);
    if (!temAlgumValor) continue;

    const dataRaw = valorColuna(linha, idx.data);
    const placaBruta = parseStr(valorColuna(linha, idx.placa));
    const validacaoPlaca = validarPlacaBr(placaBruta);
    const placa = validacaoPlaca.valida ? validacaoPlaca.normalizada : placaBruta;
    const motorista = parseStr(valorColuna(linha, idx.motorista));
    const rota = parseStr(valorColuna(linha, idx.rota));
    const regional = parseStr(valorColuna(linha, idx.regional));
    const distrito = parseStr(valorColuna(linha, idx.distrito));

    if (validacaoPlaca.valida && validacaoPlaca.normalizada) {
      placasPlanilha.add(validacaoPlaca.normalizada);
    }
    const motoristaNorm = normalizarNomeOperacional(motorista);
    if (motoristaNorm) motoristasPlanilha.add(motoristaNorm);
    for (const idxCol of [idx.coletor1, idx.coletor2, idx.coletor3, idx.coletor4]) {
      const nomeCol = normalizarNomeOperacional(valorColuna(linha, idxCol));
      if (nomeCol) coletoresPlanilha.add(nomeCol);
    }

    const temIdentificacao = !!(dataRaw || placa || motorista);

    const partial: Partial<ColetaData> = {
      dataSaida: parseDataPlanilha(dataRaw),
      placa,
      motorista,
      regional,
      distrito,
      kmTotal: parseNum(valorColuna(linha, idx.kmTotal)),
      pesoTotal: parseNum(valorColuna(linha, idx.pesoTotal)),
      kmSaida: parseNum(valorColuna(linha, idx.kmSaida)),
      kmChegada: parseNum(valorColuna(linha, idx.kmChegada)),
      kmRota1: parseNum(valorColuna(linha, idx.kmRota1)),
      kmRota2: parseNum(valorColuna(linha, idx.kmRota2)),
      kmRota3: parseNum(valorColuna(linha, idx.kmRota3)),
      kmRota4: parseNum(valorColuna(linha, idx.kmRota4)),
      peso1: parseNum(valorColuna(linha, idx.peso1)),
      peso2: parseNum(valorColuna(linha, idx.peso2)),
      peso3: parseNum(valorColuna(linha, idx.peso3)),
      peso4: parseNum(valorColuna(linha, idx.peso4)),
      peso5: parseNum(valorColuna(linha, idx.peso5)),
      dados: buildDadosBrutos(cabecalho, linha) as Record<string, any>,
    };

    if (validacaoPlaca.valida && validacaoPlaca.normalizada) {
      aplicarPlacaNormalizadaNoRegistro(partial, validacaoPlaca.normalizada);
    }

    const coletaTmp = partial as ColetaData;
    const validacao = prepararViagemParaImportacao(coletaTmp);
    const contador = obterContadorViagensRegistro(coletaTmp);
    const viagensLinha = contarViagensPorRotaRegistro(coletaTmp);
    const linhaPlanilha = i + 2;

    const pesagensLinha = [idx.peso1, idx.peso2, idx.peso3, idx.peso4, idx.peso5]
      .map((col) => parseNum(valorColuna(linha, col)))
      .filter((p): p is number => p != null && !Number.isNaN(p) && p > 0);
    const kmCelula = parseNum(valorColuna(linha, idx.kmTotal));
    const pesoCelula = parseNum(valorColuna(linha, idx.pesoTotal));

    // Linha de template/rodapé: nada identifica uma viagem (sem data, placa, motorista,
    // contador, KM e pesagem). Só sujaria o relatório com centenas de "FORA DO DASH".
    const linhaEmBranco = !dataRaw
      && !placa
      && !motorista
      && !(contador != null && contador > 0)
      && !(kmCelula != null && kmCelula > 0)
      && !(pesoCelula != null && pesoCelula > 0)
      && pesagensLinha.length === 0;
    if (linhaEmBranco) {
      linhasEmBrancoIgnoradas++;
      continue;
    }

    // CONTADOR da planilha — soma SEMPRE (inclusive linhas descartadas/fora do dash)
    if (contador !== null && contador > 0) {
      somaContadorViagens += contador;
    } else {
      linhasSemContador++;
    }

    if (validacao.descartada) {
      linhasDescartadasSemDados++;
      if (contador !== null && contador > 0) somaContadorForaDashboard += contador;
      const pesoDesc = parseNum(valorColuna(linha, idx.pesoTotal));
      if (pesoDesc != null && pesoDesc > 0) pesoKgForaDashboard += pesoDesc;
      viagens.push({
          linha: linhaPlanilha,
          data: formatarDataPlanilha(dataRaw),
          placa: validacaoPlaca.valida ? validacaoPlaca.normalizada : (validacaoPlaca.original || placa),
          placaNormalizada: validacaoPlaca.valida ? validacaoPlaca.normalizada : null,
          placaValida: validacaoPlaca.valida,
          motorista,
          rota: rota || regional || distrito,
          kmTotal: kmCelula,
          pesoTotal: pesoCelula,
          pesagensKg: pesagensLinha,
          kmSaida: parseNum(valorColuna(linha, idx.kmSaida)),
          kmChegada: parseNum(valorColuna(linha, idx.kmChegada)),
          kmTotalCalculado: null,
          completa: false,
          temIdentificacao: !!(dataRaw || placa || motorista || contador),
          temValorNegativo: false,
          problemas: ['Linha ignorada na importação: sem placa, KM Total e Peso Total'],
          contadorViagens: contador,
          foraDashboard: true,
          motivoForaDashboard: 'Descartada — sem placa, KM Total e Peso Total (não sobe ao dashboard)',
          descartada: true,
        });
      if (contador !== null && contador > 0) {
        const cat = 'Linha com CONTADOR mas sem placa/KM/peso (não sobe)';
        if (!problemasPorCategoria.has(cat)) problemasPorCategoria.set(cat, new Set());
        problemasPorCategoria.get(cat)!.add(linhaPlanilha);
      }
      continue;
    }

    viagensCalculadasDashboard += viagensLinha;
    if (contador !== null && contador > 0) {
      if (validacao.validoDashboard) somaContadorNoDashboard += contador;
      else somaContadorForaDashboard += contador;
    }
    const pesoLinhaKg = Number(
      coletaTmp.pesoTotal
      ?? parseNum(valorColuna(linha, idx.pesoTotal))
      ?? 0,
    );
    if (pesoLinhaKg > 0) {
      if (validacao.validoDashboard) pesoKgDashboard += pesoLinhaKg;
      else pesoKgForaDashboard += pesoLinhaKg;
    }

    const completa = validacao.validoDashboard;
    const problemas = [...validacao.motivos];
    if (validacao.correcoes?.length) {
      for (const c of validacao.correcoes) {
        problemas.push(`Corrigido automaticamente: ${c}`);
      }
    }

    if (!validacaoPlaca.valida && validacaoPlaca.motivo) {
      problemas.push(`Placa: ${validacaoPlaca.motivo}${validacaoPlaca.original ? ` (${validacaoPlaca.original})` : ''}`);
    }
    const temValorNegativo = problemas.some(p => p.toLowerCase().includes('negativo'));
    const corrigidaHodometro = completa && (validacao.correcoes || []).some(correcaoEhHodometro);
    const detPesagem = detectarPesagemAlta(coletaTmp);
    const alertaPesagemAlta = detPesagem.quantidade > 0;
    if (alertaPesagemAlta && detPesagem.mensagem) {
      problemas.push(detPesagem.mensagem);
      pesagensAltas += detPesagem.quantidade;
      linhasComPesagemAlta++;
    }
    const slotsSemPesagem = completa ? detectarViagensSemPesagem(coletaTmp) : [];
    const alertaSemPesagem = slotsSemPesagem.length > 0;
    if (alertaSemPesagem) {
      problemas.push(mensagemSemPesagem(slotsSemPesagem));
      viagensSemPesagemCount += slotsSemPesagem.length;
      linhasComSemPesagem++;
    }

    if (completa) viagensCompletas++;
    else if (temIdentificacao) viagensIncompletas++;
    if (temValorNegativo && temIdentificacao) viagensComValorNegativo++;
    if (corrigidaHodometro) viagensCorrigidasHodometro++;

    if (!completa && temIdentificacao) {
      for (const motivo of problemas) {
        if (motivoIgnorarNoRelatorio(motivo)) continue;
        if (motivo.toLowerCase().startsWith('atenção: pesagem alta')) continue; // não bloqueia
        const cat = motivoParaCategoria(motivo);
        if (!problemasPorCategoria.has(cat)) problemasPorCategoria.set(cat, new Set());
        problemasPorCategoria.get(cat)!.add(linhaPlanilha);
      }
    }

    const kmTotalRaw = kmCelula;
    const kmTotalCalculado = coletaTmp.kmTotal != null && coletaTmp.kmTotal > 0
      ? Number(coletaTmp.kmTotal.toFixed(1))
      : (validacao.kmEfetivo != null ? Number(validacao.kmEfetivo.toFixed(1)) : null);

    const motivoFora = !completa
      ? (problemas.filter(p => !motivoIgnorarNoRelatorio(p) && !p.toLowerCase().startsWith('corrigido')).slice(0, 2).join('; ')
        || 'Dados inconsistentes — não sobe ao dashboard')
      : null;

    const item = {
      linha: linhaPlanilha,
      data: formatarDataPlanilha(dataRaw),
      placa: validacaoPlaca.valida ? validacaoPlaca.normalizada : (validacaoPlaca.original || placa),
      placaNormalizada: validacaoPlaca.valida ? validacaoPlaca.normalizada : null,
      placaValida: validacaoPlaca.valida,
      motorista,
      rota: rota || regional || distrito,
      kmTotal: kmTotalRaw,
      pesoTotal: coletaTmp.pesoTotal ?? pesoCelula,
      pesagensKg: pesagensLinha,
      kmSaida: parseNum(valorColuna(linha, idx.kmSaida)),
      kmChegada: parseNum(valorColuna(linha, idx.kmChegada)),
      kmTotalCalculado,
      completa,
      temIdentificacao,
      temValorNegativo,
      problemas,
      contadorViagens: contador,
      foraDashboard: !completa,
      motivoForaDashboard: motivoFora,
      descartada: false,
      corrigidaHodometro,
      alertaPesagemAlta,
      pesoAlertaKg: detPesagem.pesoMaxKg,
      alertaSemPesagem,
      viagensSemPesagem: slotsSemPesagem,
    };

    // Inclui: fora do dash, hodômetro tratado, pesagem alta ou sem pesagem — PDF de saúde
    const incluirNoDetalhe = !completa
      || corrigidaHodometro
      || alertaPesagemAlta
      || alertaSemPesagem
      || (temIdentificacao && contador != null && contador > 0 && !completa);

    if (incluirNoDetalhe) {
      viagens.push(item);
    }
  }

  viagens.splice(0, viagens.length, ...priorizarViagensForaDashboard(viagens, MAX_DETALHE_VIAGENS));

  const totalViagens = viagensCompletas + viagensIncompletas;
  const problemasDashboard = Array.from(problemasPorCategoria.entries())
    .map(([tipo, linhasSet]) => ({ tipo, quantidade: linhasSet.size }))
    .sort((a, b) => b.quantidade - a.quantidade);
  const resumoPlacas = montarResumoPlacas(auditoriaPlacas, viagens);

  const cadastro = extrairCadastroOperacional(cadastroOperacional);
  const conferenciaCadastro = cadastro
    ? conferirCadastroOperacional(cadastro, {
        placas: placasPlanilha,
        motoristas: motoristasPlanilha,
        coletores: coletoresPlanilha,
      })
    : null;

  const partesAviso: string[] = [];
  if (viagensIncompletas > 0) {
    partesAviso.push(
      `${viagensIncompletas} viagem(ns) ficam fora do dashboard. ${viagensCompletas} viagem(ns) válida(s) entrarão nos KPIs.`,
    );
  }
  if (viagensCorrigidasHodometro > 0) {
    partesAviso.push(
      `${viagensCorrigidasHodometro} viagem(ns) com hodômetro inconsistente (KM inicial=final/quebrado) foram tratadas: KM zerado, peso e viagens mantidos no dashboard.`,
    );
  }
  if (pesagensAltas > 0) {
    partesAviso.push(
      `${pesagensAltas} pesagem(ns) acima de 15.000 kg/viagem (até 1.000 t) em ${linhasComPesagemAlta} linha(s) — alerta de saúde, não bloqueia o dashboard.`,
    );
  }
  if (viagensSemPesagemCount > 0) {
    partesAviso.push(
      `${viagensSemPesagemCount} viagem(ns) sem pesagem em ${linhasComSemPesagem} linha(s) `
      + '(trecho com horário e PESO vazio) — entram no dashboard; o peso dessa faixa não soma.',
    );
  }
  if (linhasDescartadasSemDados > 0) {
    partesAviso.push(
      `${linhasDescartadasSemDados} linha(s) ignorada(s) por não ter placa, KM Total e Peso Total`
      + (somaContadorForaDashboard > 0
        ? ` (somam ${somaContadorForaDashboard} no CONTADOR DE VIAGENS e NÃO sobem ao dashboard)`
        : '')
      + '.',
    );
  }
  if (linhasEmBrancoIgnoradas > 0) {
    partesAviso.push(
      `${linhasEmBrancoIgnoradas} linha(s) em branco da planilha (sem data, placa, motorista, contador, KM e pesagem) `
      + 'foram ignoradas e não aparecem como problema.',
    );
  }
  if (somaContadorViagens > 0 && somaContadorNoDashboard !== somaContadorViagens) {
    partesAviso.push(
      `CONTADOR DE VIAGENS na planilha = ${somaContadorViagens}; no dashboard = ${somaContadorNoDashboard}`
      + (somaContadorForaDashboard > 0 ? ` (${somaContadorForaDashboard} viagem(ns) do contador ficam fora).` : '.'),
    );
  }
  if (pesoKgForaDashboard > 0) {
    const tDash = (pesoKgDashboard / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
    const tFora = (pesoKgForaDashboard / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
    partesAviso.push(
      `Toneladas no ciclo/dashboard = ${tDash} t. `
      + `${tFora} t ficaram FORA (viagens com erro) e não entram na coluna Toneladas — por isso o total pode divergir da planilha.`,
    );
  }
  const avisoDashboard = partesAviso.length > 0 ? partesAviso.join(' ') : null;

  return {
    sucesso: true,
    nomeArquivo,
    aba: nomeAba,
    totalViagens,
    viagensCompletas,
    viagensIncompletas,
    viagensComValorNegativo,
    viagensValidasDashboard: viagensCompletas,
    viagensInconsistentesTotal: viagensIncompletas,
    linhasDescartadasSemDados,
    linhasEmBrancoIgnoradas,
    viagensCorrigidasHodometro,
    pesagensAltas,
    linhasComPesagemAlta,
    podeImportar: true,
    avisoDashboard,
    percentualCompleto: totalViagens > 0 ? Math.round((viagensCompletas / totalViagens) * 100) : 0,
    problemasAgrupados: problemasDashboard,
    problemasDashboard,
    regrasSaude: [...REGRAS_VIAGEM_DASHBOARD],
    resumoPlacas,
    viagens,
    somaContadorViagens,
    somaContadorNoDashboard,
    somaContadorForaDashboard,
    pesoKgDashboard,
    pesoKgForaDashboard,
    viagensCalculadasDashboard,
    linhasSemContador,
    viagensSemPesagem: viagensSemPesagemCount,
    linhasComSemPesagem,
    conferenciaCadastro,
    conferenciaUpload: analisarConferenciaPlanilha(buffer, nomeArquivo),
  };
}
