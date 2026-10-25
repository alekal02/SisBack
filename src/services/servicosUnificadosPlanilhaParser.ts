/**
 * Parser do modelo unificado de serviços de via/área:
 *   DATA | LOGRADOURO | BAIRRO | UND | QUANTITATIVO | TIPO DE SERVIÇO
 *
 * Não altera o parser de roçada legado (rocadaPlanilhaParser).
 * Detecção é estrita (exige QUANTITATIVO + UND + TIPO DE SERVIÇO) para
 * nunca capturar planilhas de roçada tradicionais (Londrina, QGIS, etc.).
 */
import * as XLSX from 'xlsx';
import { parseDataPlanilha } from '../utils/formatarDataPlanilha';
import { parseNumeroBr } from './FormulaEngine';
import { TipoServico } from '../enums/TipoServico';

export type TipoServicoUnificado =
  | TipoServico.ROCADEIRA
  | TipoServico.CAPINA
  | TipoServico.VARRICAO
  | TipoServico.PODA;

export interface LinhaServicoUnificado {
  dataSaida: Date | null;
  logradouro: string | null;
  bairro: string | null;
  und: string | null;
  quantitativo: number;
  tipoLabel: string;
  tipoSistema: TipoServicoUnificado;
  equipe: string | null;
  operador: string | null;
  equipamento: string | null;
  aba: string;
  /** Colunas prontas para FormulaEngine / KPIs / agregação de roçada */
  dados: Record<string, unknown>;
}

export interface ResumoTipoUnificado {
  tipoSistema: TipoServicoUnificado;
  tipoLabel: string;
  registros: number;
  quantitativoTotal: number;
  undPrincipal: string | null;
  dias: number;
  bairros: number;
}

export interface ResultadoParseServicosUnificados {
  modelo: 'servicos_unificados';
  ehUnificado: true;
  abasUsadas: string[];
  totalLinhasBrutas: number;
  linhas: LinhaServicoUnificado[];
  avisos: string[];
  porTipo: ResumoTipoUnificado[];
  linhasSemQuantitativo: number;
  linhasTipoDesconhecido: number;
}

function norm(s: unknown): string {
  return String(s ?? '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function normKey(s: unknown): string {
  return norm(s).replace(/[^A-Z0-9]/g, '');
}

function cellStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function cellNum(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number' && !isNaN(v) && v > 0) return v;
  const n = parseNumeroBr(v);
  return !isNaN(n) && n > 0 ? n : 0;
}

function parseDataFlex(v: unknown): Date | null {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate(), 12, 0, 0));
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const utcDays = Math.floor(v - 25569);
    const d = new Date(utcDays * 86400 * 1000);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0));
  }
  const parsed = parseDataPlanilha(v);
  if (!parsed) return null;
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate(), 12, 0, 0));
}

/** Mapeia texto da coluna TIPO DE SERVIÇO → enum do sistema */
export function mapearTipoServicoUnificado(raw: unknown): TipoServicoUnificado | null {
  const k = normKey(raw);
  if (!k) return null;
  if (k.includes('ROCAD') || k.includes('ROCADEIR')) return TipoServico.ROCADEIRA;
  if (k.includes('CAPINA')) return TipoServico.CAPINA;
  if (k.includes('VARRIC') || k.includes('VARRICAO') || k.includes('VARREDURA')) return TipoServico.VARRICAO;
  if (k.includes('PODA') || k.includes('EXTIRP')) return TipoServico.PODA;
  return null;
}

interface ColMap {
  data: number;
  logradouro: number;
  bairro: number;
  und: number;
  quantitativo: number;
  tipo: number;
  equipe: number;
  operador: number;
  equipamento: number;
}

function mapearCabecalho(row: unknown[]): ColMap | null {
  const idx = {
    data: -1,
    logradouro: -1,
    bairro: -1,
    und: -1,
    quantitativo: -1,
    tipo: -1,
    equipe: -1,
    operador: -1,
    equipamento: -1,
  };

  for (let i = 0; i < row.length; i++) {
    const k = normKey(row[i]);
    if (!k) continue;
    if (idx.data < 0 && (k === 'DATA' || k === 'DIA' || k === 'DATASAIDA')) idx.data = i;
    else if (idx.logradouro < 0 && (k.includes('LOGRADOURO') || k === 'RUA' || k === 'AVENIDARUA' || k === 'ENDERECO')) idx.logradouro = i;
    else if (idx.bairro < 0 && (k === 'BAIRRO' || k === 'SETOR' || k === 'REGIONAL')) idx.bairro = i;
    else if (idx.und < 0 && (k === 'UND' || k === 'UNIDADE' || k === 'UN' || k === 'UM')) idx.und = i;
    else if (idx.quantitativo < 0 && (k === 'QUANTITATIVO' || k === 'QUANTIDADE' || k === 'QTD' || k === 'QTDE')) idx.quantitativo = i;
    else if (
      idx.tipo < 0
      && (
        k === 'TIPODESERVICO'
        || k === 'TIPOSERVICO'
        || k === 'TIPODESERVICOOPERACIONAL'
        || (k.includes('TIPO') && k.includes('SERVICO'))
      )
    ) {
      idx.tipo = i;
    } else if (idx.equipe < 0 && k === 'EQUIPE') idx.equipe = i;
    else if (idx.operador < 0 && (k === 'OPERADOR' || k === 'FUNCIONARIO' || k === 'MOTORISTA')) idx.operador = i;
    else if (idx.equipamento < 0 && k === 'EQUIPAMENTO') idx.equipamento = i;
  }

  // Estrito: evita falso positivo em planilhas de roçada/coleta legadas
  if (idx.data < 0 || idx.quantitativo < 0 || idx.und < 0 || idx.tipo < 0) return null;
  if (idx.bairro < 0 && idx.logradouro < 0) return null;

  return idx;
}

function acharCabecalho(rows: unknown[][]): { headerRow: number; col: ColMap } | null {
  const lim = Math.min(15, rows.length);
  for (let r = 0; r < lim; r++) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;
    const col = mapearCabecalho(row);
    if (col) return { headerRow: r, col };
  }
  return null;
}

/** Aba “mestre” CONSOLIDADO/UNIFICADO (prioridade quando bem preenchida). */
function sheetEhConsolidado(nome: string): boolean {
  const n = norm(nome);
  return (
    n === 'CONSOLIDADO'
    || n === 'UNIFICADO'
    || n.startsWith('CONSOLIDADO ')
    || n.startsWith('UNIFICADO ')
    || n.includes('CONSOLIDADO')
    || n.includes('UNIFICADO')
  );
}

function chaveLinhaUnificada(l: LinhaServicoUnificado): string {
  const data = l.dataSaida ? l.dataSaida.toISOString().slice(0, 10) : '';
  return [
    data,
    normKey(l.logradouro),
    normKey(l.bairro),
    normKey(l.und),
    String(Math.round(l.quantitativo * 1e6) / 1e6),
    l.tipoSistema,
  ].join('|');
}

function deduplicarLinhasUnificadas(linhas: LinhaServicoUnificado[]): {
  linhas: LinhaServicoUnificado[];
  removidas: number;
} {
  const visto = new Set<string>();
  const out: LinhaServicoUnificado[] = [];
  let removidas = 0;
  for (const l of linhas) {
    const k = chaveLinhaUnificada(l);
    if (visto.has(k)) {
      removidas++;
      continue;
    }
    visto.add(k);
    out.push(l);
  }
  return { linhas: out, removidas };
}

function undNormalizada(und: string | null): string {
  const k = normKey(und);
  if (!k) return '';
  if (k === 'M2' || k === 'M²' || k.includes('METROQUAD') || k === 'MQUADRADO') return 'M²';
  if (k === 'KM' || k === 'KMLINEAR' || k.includes('QUILOMET')) return 'km';
  if (k === 'M' || k === 'ML' || k === 'METRO' || k === 'METROLINEAR' || k === 'MLINEAR') return 'm';
  if (k.includes('ARVORE') || k === 'UN' || k === 'UND' || k === 'UNIDADE') return 'un';
  return cellStr(und) || k;
}

function montarDadosPorTipo(linha: {
  tipoSistema: TipoServicoUnificado;
  und: string | null;
  quantitativo: number;
  logradouro: string | null;
  bairro: string | null;
  equipe: string | null;
  operador: string | null;
  equipamento: string | null;
  tipoLabel: string;
  aba: string;
}): Record<string, unknown> {
  const und = undNormalizada(linha.und);
  const q = Math.round(linha.quantitativo * 1000000) / 1000000;
  const base: Record<string, unknown> = {
    DATA: null,
    Dia: null,
    LOGRADOURO: linha.logradouro,
    'Avenida / Rua': linha.logradouro,
    BAIRRO: linha.bairro,
    Setor: linha.bairro,
    SETOR: linha.bairro,
    LOCAL: linha.bairro || linha.logradouro,
    UND: und || linha.und,
    QUANTITATIVO: q,
    'TIPO DE SERVIÇO': linha.tipoLabel,
    TIPO_SERVICO: linha.tipoLabel,
    'Tipo de serviço': linha.tipoLabel,
    Equipe: linha.equipe,
    EQUIPE: linha.equipe,
    Operador: linha.operador,
    OPERADOR: linha.operador,
    Funcionario: linha.operador,
    FUNCIONARIO: linha.operador,
    Equipamento: linha.equipamento,
    EQUIPAMENTO: linha.equipamento,
    _tipoServico: linha.tipoSistema,
    _modeloPlanilha: 'servicos_unificados',
    _aba: linha.aba,
    _undNormalizada: und || null,
  };

  if (linha.tipoSistema === TipoServico.ROCADEIRA) {
    base['Area m²'] = q;
    base.AREA_M2 = q;
    base.AREA_ROCADA = q;
    base.TIPO = 'ROÇADA';
    base._tipoExecucao = 'desconhecido';
    base.TIPO_EXECUCAO = 'desconhecido';
  } else if (linha.tipoSistema === TipoServico.CAPINA) {
    if (und === 'km') {
      base['KM Linear'] = q;
      base.KM_LINEAR = q;
      // Capina em km: também espelha em metro linear (×1000) para KPIs em m
      base['Metro Linear'] = Math.round(q * 1000 * 100) / 100;
      base.METRO_LINEAR = base['Metro Linear'];
      base.COMPRIMENTO = base['Metro Linear'];
    } else {
      base['Metro Linear'] = q;
      base.METRO_LINEAR = q;
      base.COMPRIMENTO = q;
      if (und === 'm') {
        base['KM Linear'] = Math.round((q / 1000) * 1000000) / 1000000;
        base.KM_LINEAR = base['KM Linear'];
      }
    }
  } else if (linha.tipoSistema === TipoServico.VARRICAO) {
    base['KM Linear'] = und === 'm' ? Math.round((q / 1000) * 1000000) / 1000000 : q;
    base.KM_LINEAR = base['KM Linear'];
    base.QUILOMETROS_VARRIDOS = base['KM Linear'];
  } else if (linha.tipoSistema === TipoServico.PODA) {
    base['Quantidade de Arvore'] = q;
    base.QTD_ARVORE = q;
    base.ARVORES_PODADAS = q;
  }

  return base;
}

function sheetTemCabecalhoUnificado(ws: XLSX.WorkSheet): { headerRow: number; col: ColMap; rows: unknown[][] } | null {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true }) as unknown[][];
  const found = acharCabecalho(rows);
  if (!found) return null;
  return { ...found, rows };
}

function parseLinhasAba(
  nomeAba: string,
  rows: unknown[][],
  headerRow: number,
  col: ColMap,
): { linhas: LinhaServicoUnificado[]; brutas: number; semQ: number; tipoDesc: number } {
  const linhas: LinhaServicoUnificado[] = [];
  let brutas = 0;
  let semQ = 0;
  let tipoDesc = 0;

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;

    const tipoRaw = col.tipo >= 0 ? row[col.tipo] : null;
    const qRaw = col.quantitativo >= 0 ? row[col.quantitativo] : null;
    const dataRaw = col.data >= 0 ? row[col.data] : null;
    const bairro = col.bairro >= 0 ? cellStr(row[col.bairro]) : null;
    const logradouro = col.logradouro >= 0 ? cellStr(row[col.logradouro]) : null;

    // Ignora totais / linhas vazias
    const marcador = norm(bairro || logradouro || tipoRaw || '');
    if (!marcador) continue;
    if (marcador === 'TOTAL' || marcador.startsWith('TOTAL ') || marcador.includes('CNPJ')) continue;

    const temAlgo = dataRaw != null || qRaw != null || tipoRaw != null || bairro || logradouro;
    if (!temAlgo) continue;
    brutas++;

    const tipoSistema = mapearTipoServicoUnificado(tipoRaw);
    if (!tipoSistema) {
      tipoDesc++;
      continue;
    }

    const quantitativo = cellNum(qRaw);
    if (quantitativo <= 0) {
      semQ++;
      continue;
    }

    const und = col.und >= 0 ? cellStr(row[col.und]) : null;
    const equipe = col.equipe >= 0 ? cellStr(row[col.equipe]) : null;
    const operador = col.operador >= 0 ? cellStr(row[col.operador]) : null;
    const equipamento = col.equipamento >= 0 ? cellStr(row[col.equipamento]) : null;
    const tipoLabel = cellStr(tipoRaw) || tipoSistema;
    const dataSaida = parseDataFlex(dataRaw);

    const dados = montarDadosPorTipo({
      tipoSistema,
      und,
      quantitativo,
      logradouro,
      bairro,
      equipe,
      operador,
      equipamento,
      tipoLabel,
      aba: nomeAba,
    });
    if (dataSaida) {
      const iso = dataSaida.toISOString().slice(0, 10);
      dados.DATA = iso;
      dados.Dia = iso;
    }

    linhas.push({
      dataSaida,
      logradouro,
      bairro,
      und,
      quantitativo,
      tipoLabel,
      tipoSistema,
      equipe,
      operador,
      equipamento,
      aba: nomeAba,
      dados,
    });
  }

  return { linhas, brutas, semQ, tipoDesc };
}

function resumoPorTipo(linhas: LinhaServicoUnificado[]): ResumoTipoUnificado[] {
  const map = new Map<TipoServicoUnificado, LinhaServicoUnificado[]>();
  for (const l of linhas) {
    const arr = map.get(l.tipoSistema) || [];
    arr.push(l);
    map.set(l.tipoSistema, arr);
  }
  const out: ResumoTipoUnificado[] = [];
  for (const [tipoSistema, arr] of map) {
    const unds = new Map<string, number>();
    for (const l of arr) {
      const u = undNormalizada(l.und) || '?';
      unds.set(u, (unds.get(u) || 0) + 1);
    }
    let undPrincipal: string | null = null;
    let max = 0;
    for (const [u, n] of unds) {
      if (n > max) {
        max = n;
        undPrincipal = u;
      }
    }
    out.push({
      tipoSistema,
      tipoLabel: arr[0]?.tipoLabel || tipoSistema,
      registros: arr.length,
      quantitativoTotal: Math.round(arr.reduce((s, l) => s + l.quantitativo, 0) * 1000) / 1000,
      undPrincipal,
      dias: new Set(arr.map((l) => (l.dataSaida ? l.dataSaida.toISOString().slice(0, 10) : null)).filter(Boolean)).size,
      bairros: new Set(arr.map((l) => l.bairro).filter(Boolean)).size,
    });
  }
  out.sort((a, b) => b.registros - a.registros);
  return out;
}

/**
 * True se qualquer aba tiver o layout unificado
 * DATA | UND | QUANTITATIVO | TIPO DE SERVIÇO
 * (CONSOLIDADO, Tabela*, CAPINA*, ROÇADA*, etc.).
 */
export function detectarPlanilhaServicosUnificados(buffer: Buffer): boolean {
  try {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true, sheetRows: 20 });
    for (const name of wb.SheetNames) {
      const ws = wb.Sheets[name];
      if (!ws) continue;
      if (sheetTemCabecalhoUnificado(ws)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function parsearPlanilhaServicosUnificados(buffer: Buffer): ResultadoParseServicosUnificados {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const avisos: string[] = [];

  type Cand = {
    nome: string;
    headerRow: number;
    col: ColMap;
    rows: unknown[][];
    ehConsolidado: boolean;
  };

  const candidatos: Cand[] = [];
  for (const nome of wb.SheetNames) {
    const ws = wb.Sheets[nome];
    if (!ws) continue;
    const info = sheetTemCabecalhoUnificado(ws);
    if (!info) continue;
    candidatos.push({
      nome,
      headerRow: info.headerRow,
      col: info.col,
      rows: info.rows,
      ehConsolidado: sheetEhConsolidado(nome),
    });
  }

  if (candidatos.length === 0) {
    return {
      modelo: 'servicos_unificados',
      ehUnificado: true,
      abasUsadas: [],
      totalLinhasBrutas: 0,
      linhas: [],
      avisos: [
        'Nenhuma aba com layout unificado (DATA, UND, QUANTITATIVO, TIPO DE SERVIÇO).',
        ...avisos,
      ],
      porTipo: [],
      linhasSemQuantitativo: 0,
      linhasTipoDesconhecido: 0,
    };
  }

  // Parseia todas as abas candidatas (CONSOLIDADO + Tabelas + CAPINA/ROÇADA…)
  const linhasBrutas: LinhaServicoUnificado[] = [];
  const abasUsadas: string[] = [];
  let totalLinhasBrutas = 0;
  let linhasSemQuantitativo = 0;
  let linhasTipoDesconhecido = 0;

  // CONSOLIDADO primeiro (melhor para dedupe manter a origem mestre quando houver)
  const ordenados = [...candidatos].sort((a, b) => Number(b.ehConsolidado) - Number(a.ehConsolidado));

  for (const c of ordenados) {
    const p = parseLinhasAba(c.nome, c.rows, c.headerRow, c.col);
    if (p.linhas.length === 0 && p.brutas === 0) continue;
    abasUsadas.push(c.nome);
    totalLinhasBrutas += p.brutas;
    linhasSemQuantitativo += p.semQ;
    linhasTipoDesconhecido += p.tipoDesc;
    linhasBrutas.push(...p.linhas);
  }

  const { linhas, removidas } = deduplicarLinhasUnificadas(linhasBrutas);

  if (linhasSemQuantitativo > 0) {
    avisos.push(`${linhasSemQuantitativo} linha(s) sem quantitativo válido ignorada(s).`);
  }
  if (linhasTipoDesconhecido > 0) {
    avisos.push(`${linhasTipoDesconhecido} linha(s) com TIPO DE SERVIÇO não reconhecido ignorada(s).`);
  }
  if (removidas > 0) {
    avisos.push(`${removidas} linha(s) duplicada(s) entre abas foram unificadas.`);
  }
  if (linhas.length === 0) {
    avisos.push(
      'Nenhuma linha válida. Preencha DATA, QUANTITATIVO e TIPO DE SERVIÇO (ROÇADA, CAPINA, VARRIÇÃO, PODA).',
    );
  } else {
    const porTipoTxt = resumoPorTipo(linhas)
      .map((p) => `${p.tipoLabel}: ${p.registros}`)
      .join(' · ');
    avisos.unshift(
      `Layout unificado: ${linhas.length} registro(s) de ${abasUsadas.length} aba(s) `
      + `(${abasUsadas.join(', ')}) — separados por TIPO DE SERVIÇO (${porTipoTxt}).`,
    );
  }

  return {
    modelo: 'servicos_unificados',
    ehUnificado: true,
    abasUsadas,
    totalLinhasBrutas,
    linhas,
    avisos,
    porTipo: resumoPorTipo(linhas),
    linhasSemQuantitativo,
    linhasTipoDesconhecido,
  };
}

export function resumoParseServicosUnificados(parsed: ResultadoParseServicosUnificados) {
  return {
    modelo: parsed.modelo,
    modeloLabel: 'Serviços unificados',
    abas: parsed.abasUsadas.length,
    registros: parsed.linhas.length,
    porTipo: parsed.porTipo,
    podeImportar: parsed.linhas.length > 0,
    avisos: parsed.avisos,
  };
}

/** Tipos de serviço que podem acionar o pipeline unificado */
export const TIPOS_ACEITA_UNIFICADO = new Set<string>([
  TipoServico.ROCADEIRA,
  TipoServico.CAPINA,
  TipoServico.VARRICAO,
  TipoServico.PODA,
  TipoServico.GERAL,
  'rocadeira',
  'capina',
  'varricao',
  'poda',
  'geral',
]);
