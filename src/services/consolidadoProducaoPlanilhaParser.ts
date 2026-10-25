/**
 * Parser da planilha padrão de produção (xlsm/xlsx com Power Query):
 *   SERVIÇO | DATA | LOCAL | TIPO DE EQUIPAMENTO | UNIDADE | QUANTIDADE | OBSERVAÇÃO
 *
 * Fonte: aba CONSOLIDADO (união do PQ). Cada valor de SERVIÇO vira um serviço
 * no sistema, com relatório do dia e do ciclo. Tabelas* / mapas só entram se a
 * CONSOLIDADO estiver vazia (modelo ainda não atualizado).
 * Coleta (PLACA/PESO) não passa por aqui.
 * Não altera o layout unificado legado (TIPO DE SERVIÇO / QUANTITATIVO).
 */
import * as XLSX from 'xlsx';
import { parseDataPlanilha } from '../utils/formatarDataPlanilha';
import { parseNumeroBr } from './FormulaEngine';
import { TipoServico } from '../enums/TipoServico';
import {
  classificarTipoExecucaoRocada,
  type TipoExecucaoRocada,
} from '../utils/rocadaTipoExecucao';

export type TipoServicoConsolidado =
  | TipoServico.ROCADEIRA
  | TipoServico.CAPINA
  | TipoServico.VARRICAO
  | TipoServico.PODA
  | TipoServico.REMOCAO
  | TipoServico.COLETA_SELETIVA
  | TipoServico.ATERRO
  | TipoServico.GERAL;

export interface LinhaConsolidadoProducao {
  dataSaida: Date | null;
  local: string | null;
  und: string | null;
  quantitativo: number;
  quantidadeVazia: boolean;
  tipoLabel: string;
  tipoSistema: TipoServicoConsolidado;
  tipoExecucao: TipoExecucaoRocada;
  equipamento: string | null;
  observacao: string | null;
  aba: string;
  chaveServico: string;
  nomeServico: string;
  dados: Record<string, unknown>;
}

export interface ResumoAbaProducao {
  chaveServico: string;
  nomeServico: string;
  aba: string;
  tipoSistema: TipoServicoConsolidado;
  registros: number;
}

export interface ResumoTipoConsolidado {
  tipoSistema: TipoServicoConsolidado;
  tipoLabel: string;
  registros: number;
  quantitativoTotal: number;
  undPrincipal: string | null;
  dias: number;
  locais: number;
  registrosManual: number;
  registrosMecanizada: number;
  quantitativoManual: number;
  quantitativoMecanizada: number;
}

export interface ResultadoParseConsolidadoProducao {
  modelo: 'consolidado_producao';
  ehConsolidadoProducao: true;
  abasUsadas: string[];
  totalLinhasBrutas: number;
  linhas: LinhaConsolidadoProducao[];
  avisos: string[];
  porTipo: ResumoTipoConsolidado[];
  linhasSemTipo: number;
  linhasSemData: number;
  porAba: ResumoAbaProducao[];
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

function calendarParts(v: Date): { y: number; m: number; d: number } {
  const utcMidnight =
    v.getUTCHours() === 0
    && v.getUTCMinutes() === 0
    && v.getUTCSeconds() === 0
    && v.getUTCMilliseconds() === 0;
  if (utcMidnight) {
    return { y: v.getUTCFullYear(), m: v.getUTCMonth(), d: v.getUTCDate() };
  }
  return { y: v.getFullYear(), m: v.getMonth(), d: v.getDate() };
}

function parseDataFlex(v: unknown): Date | null {
  if (v instanceof Date && !isNaN(v.getTime())) {
    const { y, m, d } = calendarParts(v);
    return new Date(Date.UTC(y, m, d, 12, 0, 0));
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const utcDays = Math.floor(v - 25569);
    const d = new Date(utcDays * 86400 * 1000);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0));
  }
  const parsed = parseDataPlanilha(v);
  if (!parsed) return null;
  const { y, m, d } = calendarParts(parsed);
  return new Date(Date.UTC(y, m, d, 12, 0, 0));
}

export function mapearTipoServicoConsolidado(raw: unknown): TipoServicoConsolidado | null {
  const k = normKey(raw);
  if (!k) return null;
  if (k.includes('COLETA') && k.includes('SELETIVA')) return TipoServico.COLETA_SELETIVA;
  if (k.includes('ATERRO')) return TipoServico.ATERRO;
  if (k.includes('FEIRA')) return TipoServico.GERAL;
  if (k.includes('ROCAD') || k.includes('ROCADEIR')) return TipoServico.ROCADEIRA;
  if (k.includes('CAPINA') || k.includes('RASPAG')) return TipoServico.CAPINA;
  if (k.includes('VARRIC') || k.includes('VARRICAO') || k.includes('VARREDURA') || k.includes('VARRECAO')) {
    return TipoServico.VARRICAO;
  }
  if (k.includes('PODA') || k.includes('EXTIRP') || k.includes('ARVORE')) return TipoServico.PODA;
  if (k.includes('REMOC') || k.includes('ENTULHO')) return TipoServico.REMOCAO;
  return null;
}

function ehPontoSemQuantidade(tipo: TipoServicoConsolidado, und: string | null): boolean {
  if (
    tipo === TipoServico.PODA
    || tipo === TipoServico.REMOCAO
    || tipo === TipoServico.ATERRO
    || tipo === TipoServico.GERAL
  ) return true;
  const u = undNormalizada(und);
  return u === 'equipe' || u === 'un';
}

function undNormalizada(und: string | null): string {
  const k = normKey(und);
  if (!k) return '';
  if (k === 'M2' || k.includes('METROQUAD') || k === 'MQUADRADO') return 'M²';
  if (k === 'KM' || k === 'KMLINEAR' || k.includes('QUILOMET')) return 'km';
  if (k === 'M' || k === 'ML' || k === 'METRO' || k === 'METROLINEAR' || k === 'MLINEAR') return 'm';
  if (k.includes('EQUIPE')) return 'equipe';
  if (k.includes('ARVORE') || k === 'UN' || k === 'UND' || k === 'UNIDADE' || k === 'PONTO') return 'un';
  return cellStr(und) || k;
}

interface ColMap {
  servico: number;
  data: number;
  local: number;
  und: number;
  quantidade: number;
  equipamento: number;
  observacao: number;
}

function mapearCabecalhoConsolidado(row: unknown[]): ColMap | null {
  const idx = {
    servico: -1,
    data: -1,
    local: -1,
    und: -1,
    quantidade: -1,
    equipamento: -1,
    observacao: -1,
  };

  for (let i = 0; i < row.length; i++) {
    const k = normKey(row[i]);
    if (!k) continue;
    if (idx.servico < 0 && k === 'SERVICO') idx.servico = i;
    else if (idx.data < 0 && (k === 'DATA' || k === 'DIA' || k === 'DATASAIDA')) idx.data = i;
    else if (idx.local < 0 && (k === 'LOCAL' || k === 'BAIRRO' || k === 'SETOR' || k === 'REGIONAL' || k.includes('LOGRADOURO'))) {
      idx.local = i;
    } else if (idx.und < 0 && (k === 'UNIDADE' || k === 'UND' || k === 'UN' || k === 'UM')) idx.und = i;
    else if (idx.quantidade < 0 && (k === 'QUANTIDADE' || k === 'QUANTITATIVO' || k === 'QTD' || k === 'QTDE')) {
      idx.quantidade = i;
    } else if (
      idx.equipamento < 0
      && (k === 'TIPODEEQUIPAMENTO' || k === 'EQUIPAMENTO' || (k.includes('TIPO') && k.includes('EQUIP')))
    ) {
      idx.equipamento = i;
    } else if (idx.observacao < 0 && (k === 'OBSERVACAO' || k === 'OBS' || k === 'OBSERVACOES')) {
      idx.observacao = i;
    }
  }

  // SERVIÇO (não TIPO DE SERVIÇO) + DATA + UNIDADE + QUANTIDADE + LOCAL
  if (idx.servico < 0 || idx.data < 0 || idx.und < 0 || idx.quantidade < 0 || idx.local < 0) return null;
  return idx;
}

function acharCabecalho(rows: unknown[][]): { headerRow: number; col: ColMap } | null {
  const lim = Math.min(15, rows.length);
  for (let r = 0; r < lim; r++) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;
    const col = mapearCabecalhoConsolidado(row);
    if (col) return { headerRow: r, col };
  }
  return null;
}

export function sheetEhConsolidado(nome: string): boolean {
  const n = norm(nome);
  return n === 'CONSOLIDADO' || n.startsWith('CONSOLIDADO ');
}

export interface CatalogoAbaProducao {
  chaveServico: string;
  nomeServico: string;
  tipoSistema: TipoServicoConsolidado;
  tipoExecucao: TipoExecucaoRocada;
}

function sheetIgnoradaProducao(nome: string): boolean {
  const n = norm(nome);
  if (sheetEhConsolidado(nome)) return true;
  if (n.startsWith('VIAS ') || n.startsWith('VIAS')) return true;
  if (n.includes('LISTA FEIRA') || n === 'LISTAFEIRA') return true;
  if (n.startsWith('MAPA ')) return true;
  return false;
}

/** Cada aba de serviço (Tabela* oculta ou mapa operacional visível) vira um serviço. */
export function catalogoAbaProducao(nome: string): CatalogoAbaProducao | null {
  const n = norm(nome);
  const k = normKey(nome);
  if (k.includes('VARRIC') && k.includes('MANUAL')) {
    return { chaveServico: 'varricao_manual', nomeServico: 'Varrição Manual', tipoSistema: TipoServico.VARRICAO, tipoExecucao: 'manual' };
  }
  if ((k.includes('VARREC') || k.includes('VARRIC')) && (k.includes('MEC') || k.includes('MECANIZ'))) {
    return { chaveServico: 'varricao_mecanizada', nomeServico: 'Varrição Mecanizada', tipoSistema: TipoServico.VARRICAO, tipoExecucao: 'mecanizada' };
  }
  if (k.includes('ROCAD') && k.includes('MANUAL')) {
    return { chaveServico: 'rocada_manual', nomeServico: 'Roçada Manual', tipoSistema: TipoServico.ROCADEIRA, tipoExecucao: 'manual' };
  }
  if (k.includes('ROCAD') && (k.includes('MEC') || k.includes('MECANIZ'))) {
    return { chaveServico: 'rocada_mecanizada', nomeServico: 'Roçada Mecanizada', tipoSistema: TipoServico.ROCADEIRA, tipoExecucao: 'mecanizada' };
  }
  if (k.includes('COLETA') && k.includes('SELETIVA')) {
    return { chaveServico: 'coleta_seletiva', nomeServico: 'Coleta Seletiva', tipoSistema: TipoServico.COLETA_SELETIVA, tipoExecucao: 'desconhecido' };
  }
  if (k.includes('ATERRO')) {
    return { chaveServico: 'aterro', nomeServico: 'Aterro', tipoSistema: TipoServico.ATERRO, tipoExecucao: 'desconhecido' };
  }
  if (k.includes('ENTULHO') || (k.includes('REMOC') && !k.includes('MAPA'))) {
    return { chaveServico: 'remocao', nomeServico: 'Remoção de Entulho', tipoSistema: TipoServico.REMOCAO, tipoExecucao: 'desconhecido' };
  }
  if (k.includes('FEIRA')) {
    return { chaveServico: 'feiras', nomeServico: 'Feiras', tipoSistema: TipoServico.GERAL, tipoExecucao: 'desconhecido' };
  }
  if (k.includes('PODA') || k.includes('ARVORE')) {
    return { chaveServico: 'poda', nomeServico: 'Poda', tipoSistema: TipoServico.PODA, tipoExecucao: 'desconhecido' };
  }
  if (n.includes('CAPINA')) {
    return { chaveServico: 'capina', nomeServico: 'Capina', tipoSistema: TipoServico.CAPINA, tipoExecucao: 'desconhecido' };
  }
  return null;
}

export function agruparLinhasPorServicoAba(
  linhas: LinhaConsolidadoProducao[],
): Map<string, LinhaConsolidadoProducao[]> {
  const map = new Map<string, LinhaConsolidadoProducao[]>();
  for (const l of linhas) {
    const chave = l.chaveServico || l.tipoSistema;
    const arr = map.get(chave) || [];
    arr.push(l);
    map.set(chave, arr);
  }
  return map;
}

function resumoPorAba(linhas: LinhaConsolidadoProducao[]): ResumoAbaProducao[] {
  const map = new Map<string, LinhaConsolidadoProducao[]>();
  for (const l of linhas) {
    const arr = map.get(l.chaveServico) || [];
    arr.push(l);
    map.set(l.chaveServico, arr);
  }
  return [...map.values()].map((arr) => ({
    chaveServico: arr[0].chaveServico,
    nomeServico: arr[0].nomeServico,
    aba: arr[0].aba,
    tipoSistema: arr[0].tipoSistema,
    registros: arr.length,
  })).sort((a, b) => b.registros - a.registros);
}

function montarDados(linha: {
  tipoSistema: TipoServicoConsolidado;
  tipoLabel: string;
  tipoExecucao: TipoExecucaoRocada;
  und: string | null;
  quantitativo: number;
  local: string | null;
  equipamento: string | null;
  observacao: string | null;
  aba: string;
}): Record<string, unknown> {
  const und = undNormalizada(linha.und);
  const q = Math.round(linha.quantitativo * 1000000) / 1000000;
  const execLabel = linha.tipoExecucao === 'manual'
    ? 'MANUAL'
    : linha.tipoExecucao === 'mecanizada'
      ? 'MECANIZADA'
      : linha.tipoLabel;
  const base: Record<string, unknown> = {
    DATA: null,
    Dia: null,
    LOCAL: linha.local,
    BAIRRO: linha.local,
    Setor: linha.local,
    SETOR: linha.local,
    LOGRADOURO: linha.local,
    'Avenida / Rua': linha.local,
    UND: und || linha.und,
    UNIDADE: linha.und,
    QUANTITATIVO: q,
    QUANTIDADE: q,
    SERVIÇO: linha.tipoLabel,
    'TIPO DE SERVIÇO': linha.tipoLabel,
    TIPO_SERVICO: linha.tipoLabel,
    'Tipo de serviço': linha.tipoLabel,
    Equipamento: linha.equipamento,
    EQUIPAMENTO: linha.equipamento,
    'TIPO DE EQUIPAMENTO': linha.equipamento,
    OBSERVAÇÃO: linha.observacao,
    TIPO: execLabel,
    TIPO_EXECUCAO: linha.tipoExecucao,
    _tipoExecucao: linha.tipoExecucao,
    _tipoServico: linha.tipoSistema,
    _modeloPlanilha: 'consolidado_producao',
    _aba: linha.aba,
    _undNormalizada: und || null,
  };

  if (linha.tipoSistema === TipoServico.ROCADEIRA) {
    base['Area m²'] = q;
    base.AREA_M2 = q;
    base.AREA_ROCADA = q;
  } else if (linha.tipoSistema === TipoServico.CAPINA) {
    if (und === 'km') {
      base['KM Linear'] = q;
      base.KM_LINEAR = q;
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
  } else if (linha.tipoSistema === TipoServico.COLETA_SELETIVA) {
    base.Toneladas = q;
    base.TONELADAS = q;
    base.Peso = q;
  } else if (linha.tipoSistema === TipoServico.ATERRO) {
    base['Descrição do serviço'] = linha.observacao;
    base.Peso = q;
    base.Viagens = q;
  }

  return base;
}

function sheetTemCabecalhoConsolidado(ws: XLSX.WorkSheet): {
  headerRow: number;
  col: ColMap;
  rows: unknown[][];
} | null {
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
  catFallback: CatalogoAbaProducao | null,
): { linhas: LinhaConsolidadoProducao[]; brutas: number; semTipo: number; semData: number } {
  const linhas: LinhaConsolidadoProducao[] = [];
  let brutas = 0;
  let semTipo = 0;
  let semData = 0;

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;

    const tipoRaw = col.servico >= 0 ? row[col.servico] : null;
    const qRaw = col.quantidade >= 0 ? row[col.quantidade] : null;
    const dataRaw = col.data >= 0 ? row[col.data] : null;
    const local = col.local >= 0 ? cellStr(row[col.local]) : null;

    const marcador = norm(local || tipoRaw || '');
    if (!marcador) continue;
    if (marcador === 'TOTAL' || marcador.startsWith('TOTAL ') || marcador.includes('CNPJ')) continue;

    const temAlgo = dataRaw != null || qRaw != null || tipoRaw != null || local;
    if (!temAlgo) continue;
    brutas++;

    const cat = catalogoAbaProducao(cellStr(tipoRaw) || '') || catFallback;
    const tipoMapeado = mapearTipoServicoConsolidado(tipoRaw);
    const tipoSistema = (cat?.tipoSistema || tipoMapeado) as TipoServicoConsolidado | null;
    if (!cat || !tipoSistema) {
      semTipo++;
      continue;
    }

    const dataSaida = parseDataFlex(dataRaw);
    if (!dataSaida) {
      semData++;
      continue;
    }

    const und = col.und >= 0 ? cellStr(row[col.und]) : null;
    const qLida = cellNum(qRaw);
    const quantidadeVazia = qLida <= 0;
    const quantitativo = quantidadeVazia && ehPontoSemQuantidade(tipoSistema, und) ? 1 : qLida;
    if (quantitativo <= 0) continue;

    const tipoLabel = cellStr(tipoRaw) || cat.nomeServico;
    const tipoExecucao = cat.tipoExecucao !== 'desconhecido'
      ? cat.tipoExecucao
      : classificarTipoExecucaoRocada(tipoLabel);
    const equipamento = col.equipamento >= 0 ? cellStr(row[col.equipamento]) : null;
    const observacao = col.observacao >= 0 ? cellStr(row[col.observacao]) : null;
    const aba = sheetEhConsolidado(nomeAba) ? cat.nomeServico : nomeAba;

    const dados = montarDados({
      tipoSistema,
      tipoLabel,
      tipoExecucao,
      und,
      quantitativo,
      local,
      equipamento,
      observacao,
      aba,
    });
    const iso = dataSaida.toISOString().slice(0, 10);
    dados.DATA = iso;
    dados.Dia = iso;

    linhas.push({
      dataSaida,
      local,
      und,
      quantitativo,
      quantidadeVazia,
      tipoLabel,
      tipoSistema,
      tipoExecucao,
      equipamento,
      observacao,
      aba,
      chaveServico: cat.chaveServico,
      nomeServico: cat.nomeServico,
      dados,
    });
  }

  return { linhas, brutas, semTipo, semData };
}

function idxHeader(row: unknown[], ...cands: string[]): number {
  const keys = (row || []).map((c) => normKey(c));
  for (const c of cands) {
    const ck = normKey(c);
    const i = keys.findIndex((k) => k === ck || (ck.length >= 4 && k.includes(ck)));
    if (i >= 0) return i;
  }
  return -1;
}

function parseLinhasOperacional(
  nomeAba: string,
  rows: unknown[][],
  cat: CatalogoAbaProducao,
): { linhas: LinhaConsolidadoProducao[]; brutas: number; semData: number } {
  const linhas: LinhaConsolidadoProducao[] = [];
  let headerRow = -1;
  let iData = -1;
  let iLocal = -1;
  let iLocal2 = -1;
  let iLocal3 = -1;
  let iArea = -1;
  let iEquip = -1;
  let iObs = -1;

  const lim = Math.min(20, rows.length);
  for (let r = 0; r < lim; r++) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;
    const d = idxHeader(row, 'DATA', 'DIA');
    if (d < 0) continue;
    const area = idxHeader(row, 'AREA (M²)', 'ÁREA (M²)', 'AREA', 'ÁREA', 'METRAGEM');
    const bairro = idxHeader(row, 'BAIRRO', 'SETOR', 'LOCAL');
    if (area < 0 && bairro < 0) continue;
    headerRow = r;
    iData = d;
    iLocal = bairro >= 0 ? bairro : idxHeader(row, 'SETOR');
    iLocal2 = idxHeader(row, 'RUA', 'AV/RUA', 'AVENIDA / RUA', 'AVENIDA', 'LOGRADOURO', 'ENDEREÇO', 'ENDERECO');
    iLocal3 = idxHeader(row, 'COMPLEMENTO');
    iArea = area;
    iEquip = idxHeader(row, 'EQUIPAMENTO', 'TIPO DE EQUIPAMENTO');
    iObs = idxHeader(row, 'OBSERVAÇÃO', 'OBSERVACAO', 'SERVIÇO', 'SERVICO');
    break;
  }
  if (headerRow < 0 || iData < 0) return { linhas, brutas: 0, semData: 0 };

  let brutas = 0;
  let semData = 0;
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;
    const dataRaw = row[iData];
    const p1 = iLocal >= 0 ? cellStr(row[iLocal]) : null;
    const p2 = iLocal2 >= 0 ? cellStr(row[iLocal2]) : null;
    const p3 = iLocal3 >= 0 ? cellStr(row[iLocal3]) : null;
    const local = [p1, p2, p3].filter(Boolean).join(' · ') || null;
    if (!dataRaw && !local) continue;
    const txt = norm(local || dataRaw || '');
    if (!txt || txt.includes('CNPJ') || txt.startsWith('TOTAL') || txt === 'OBJETO') continue;
    brutas++;
    const dataSaida = parseDataFlex(dataRaw);
    if (!dataSaida) {
      semData++;
      continue;
    }
    const qLida = iArea >= 0 ? cellNum(row[iArea]) : 0;
    const quantidadeVazia = qLida <= 0;
    const quantitativo = quantidadeVazia && ehPontoSemQuantidade(cat.tipoSistema, 'EQUIPE') ? 1 : qLida;
    if (quantitativo <= 0) continue;
    const und = cat.tipoSistema === TipoServico.ROCADEIRA ? 'm²' : (quantidadeVazia ? 'EQUIPE' : null);
    const equipamento = iEquip >= 0 ? cellStr(row[iEquip]) : null;
    const observacao = iObs >= 0 ? cellStr(row[iObs]) : null;
    const tipoLabel = cat.nomeServico;
    const dados = montarDados({
      tipoSistema: cat.tipoSistema,
      tipoLabel,
      tipoExecucao: cat.tipoExecucao,
      und,
      quantitativo,
      local,
      equipamento,
      observacao,
      aba: nomeAba,
    });
    const iso = dataSaida.toISOString().slice(0, 10);
    dados.DATA = iso;
    dados.Dia = iso;
    linhas.push({
      dataSaida,
      local,
      und,
      quantitativo,
      quantidadeVazia,
      tipoLabel,
      tipoSistema: cat.tipoSistema,
      tipoExecucao: cat.tipoExecucao,
      equipamento,
      observacao,
      aba: nomeAba,
      chaveServico: cat.chaveServico,
      nomeServico: cat.nomeServico,
      dados,
    });
  }
  return { linhas, brutas, semData };
}

function resumoPorTipo(linhas: LinhaConsolidadoProducao[]): ResumoTipoConsolidado[] {
  const map = new Map<TipoServicoConsolidado, LinhaConsolidadoProducao[]>();
  for (const l of linhas) {
    const arr = map.get(l.tipoSistema) || [];
    arr.push(l);
    map.set(l.tipoSistema, arr);
  }
  const out: ResumoTipoConsolidado[] = [];
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
    const man = arr.filter((l) => l.tipoExecucao === 'manual');
    const mec = arr.filter((l) => l.tipoExecucao === 'mecanizada');
    const labels = [...new Set(arr.map((l) => l.tipoLabel))];
    out.push({
      tipoSistema,
      tipoLabel: labels.length === 1 ? labels[0] : labels.join(' / '),
      registros: arr.length,
      quantitativoTotal: Math.round(arr.reduce((s, l) => s + l.quantitativo, 0) * 1000) / 1000,
      undPrincipal,
      dias: new Set(arr.map((l) => (l.dataSaida ? l.dataSaida.toISOString().slice(0, 10) : null)).filter(Boolean)).size,
      locais: new Set(arr.map((l) => l.local).filter(Boolean)).size,
      registrosManual: man.length,
      registrosMecanizada: mec.length,
      quantitativoManual: Math.round(man.reduce((s, l) => s + l.quantitativo, 0) * 1000) / 1000,
      quantitativoMecanizada: Math.round(mec.reduce((s, l) => s + l.quantitativo, 0) * 1000) / 1000,
    });
  }
  out.sort((a, b) => b.registros - a.registros);
  return out;
}

function avisoQuantidadeRepetida(linhas: LinhaConsolidadoProducao[]): string | null {
  const mec = linhas.filter(
    (l) => l.tipoSistema === TipoServico.VARRICAO && l.tipoExecucao === 'mecanizada' && !l.quantidadeVazia,
  );
  if (mec.length < 8) return null;
  const porDia = new Map<string, number>();
  for (const l of mec) {
    const d = l.dataSaida ? l.dataSaida.toISOString().slice(0, 10) : '';
    if (!d) continue;
    porDia.set(d, Math.round(((porDia.get(d) || 0) + l.quantitativo) * 100) / 100);
  }
  const totais = [...new Set([...porDia.values()].map((v) => Math.round(v * 10) / 10))];
  if (porDia.size >= 4 && totais.length === 1) {
    return (
      `Varrição mecanizada repetiu ${totais[0].toLocaleString('pt-BR')} km em ${porDia.size} dias. `
      + 'O Power Query pode estar colando o total do mês na QUANTIDADE — o valor importado é o da CONSOLIDADO.'
    );
  }
  return null;
}

/** True se alguma aba tem o layout SERVIÇO|DATA|UNIDADE|QUANTIDADE|LOCAL. */
export function detectarPlanilhaConsolidadoProducao(buffer: Buffer): boolean {
  try {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true, sheetRows: 20 });
    for (const name of wb.SheetNames) {
      const ws = wb.Sheets[name];
      if (!ws) continue;
      if (sheetTemCabecalhoConsolidado(ws)) return true;
      if (!sheetIgnoradaProducao(name) && catalogoAbaProducao(name)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function vazioParse(avisos: string[]): ResultadoParseConsolidadoProducao {
  return {
    modelo: 'consolidado_producao',
    ehConsolidadoProducao: true,
    abasUsadas: [],
    totalLinhasBrutas: 0,
    linhas: [],
    avisos,
    porTipo: [],
    porAba: [],
    linhasSemTipo: 0,
    linhasSemData: 0,
  };
}

function parseUmaAbaProducao(
  nome: string,
  ws: XLSX.WorkSheet,
  cat: CatalogoAbaProducao,
): { linhas: LinhaConsolidadoProducao[]; brutas: number; semTipo: number; semData: number } {
  const info = sheetTemCabecalhoConsolidado(ws);
  if (info) {
    return parseLinhasAba(nome, info.rows, info.headerRow, info.col, cat);
  }
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true }) as unknown[][];
  const op = parseLinhasOperacional(nome, rows, cat);
  return { linhas: op.linhas, brutas: op.brutas, semTipo: 0, semData: op.semData };
}

function montarResultadoParse(
  linhas: LinhaConsolidadoProducao[],
  avisos: string[],
  abasUsadas: string[],
  totalBrutas: number,
  semTipo: number,
  semData: number,
): ResultadoParseConsolidadoProducao {
  const avisoQtd = avisoQuantidadeRepetida(linhas);
  if (semTipo > 0) avisos.push(`${semTipo} linha(s) com SERVIÇO não reconhecido ignorada(s).`);
  if (semData > 0) avisos.push(`${semData} linha(s) sem DATA válida ignorada(s).`);
  if (avisoQtd) avisos.push(avisoQtd);

  if (linhas.length === 0) {
    avisos.push('Nenhuma linha válida na planilha de produção.');
  } else {
    const porAbaTxt = resumoPorAba(linhas)
      .map((t) => `${t.nomeServico}: ${t.registros}`)
      .join(' · ');
    avisos.unshift(`Produção por serviço: ${linhas.length} registro(s). ${porAbaTxt}.`);
  }

  return {
    modelo: 'consolidado_producao',
    ehConsolidadoProducao: true,
    abasUsadas,
    totalLinhasBrutas: totalBrutas,
    linhas,
    avisos,
    porTipo: resumoPorTipo(linhas),
    porAba: resumoPorAba(linhas),
    linhasSemTipo: semTipo,
    linhasSemData: semData,
  };
}

function parsearFonteConsolidadoPq(
  wb: XLSX.WorkBook,
): ResultadoParseConsolidadoProducao | null {
  const nomeCons = wb.SheetNames.find((n) => sheetEhConsolidado(n));
  if (!nomeCons) return null;
  const ws = wb.Sheets[nomeCons];
  if (!ws) return null;
  const info = sheetTemCabecalhoConsolidado(ws);
  if (!info) return null;
  const parsed = parseLinhasAba(nomeCons, info.rows, info.headerRow, info.col, null);
  if (parsed.linhas.length === 0) return null;
  const avisos = [`Fonte: aba CONSOLIDADO (Power Query).`];
  return montarResultadoParse(
    parsed.linhas,
    avisos,
    [nomeCons],
    parsed.brutas,
    parsed.semTipo,
    parsed.semData,
  );
}

export function parsearPlanilhaConsolidadoProducao(buffer: Buffer): ResultadoParseConsolidadoProducao {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });

  const viaPq = parsearFonteConsolidadoPq(wb);
  if (viaPq) return viaPq;

  const avisos: string[] = [];
  const candidatos = wb.SheetNames.filter((n) => !sheetIgnoradaProducao(n) && catalogoAbaProducao(n));
  if (candidatos.length === 0) {
    return vazioParse([
      'Nenhuma aba CONSOLIDADO com dados nem aba de serviço (Tabela* / Roçada / Poda / Remoção / Feiras).',
    ]);
  }

  const porChave = new Map<string, { cat: CatalogoAbaProducao; melhor: { nome: string; linhas: LinhaConsolidadoProducao[]; brutas: number; semTipo: number; semData: number } }>();
  let totalBrutas = 0;
  let semTipo = 0;
  let semData = 0;

  for (const nome of candidatos) {
    const cat = catalogoAbaProducao(nome)!;
    const ws = wb.Sheets[nome];
    if (!ws) continue;
    const parsed = parseUmaAbaProducao(nome, ws, cat);
    totalBrutas += parsed.brutas;
    semTipo += parsed.semTipo;
    semData += parsed.semData;
    const atual = porChave.get(cat.chaveServico);
    if (!atual || parsed.linhas.length > atual.melhor.linhas.length) {
      porChave.set(cat.chaveServico, { cat, melhor: { nome, ...parsed } });
    }
  }

  const linhas: LinhaConsolidadoProducao[] = [];
  const abasUsadas: string[] = [];
  for (const { melhor } of porChave.values()) {
    if (melhor.linhas.length === 0) continue;
    abasUsadas.push(melhor.nome);
    linhas.push(...melhor.linhas);
  }

  return montarResultadoParse(linhas, avisos, abasUsadas, totalBrutas, semTipo, semData);
}

export function resumoParseConsolidadoProducao(parsed: ResultadoParseConsolidadoProducao) {
  return {
    modelo: parsed.modelo,
    modeloLabel: 'Produção padrão (CONSOLIDADO PQ — um serviço cada)',
    abas: parsed.abasUsadas.length,
    registros: parsed.linhas.length,
    porTipo: parsed.porTipo,
    podeImportar: parsed.linhas.length > 0,
    avisos: parsed.avisos,
  };
}

export const TIPOS_ACEITA_CONSOLIDADO = new Set<string>([
  TipoServico.ROCADEIRA,
  TipoServico.CAPINA,
  TipoServico.VARRICAO,
  TipoServico.PODA,
  TipoServico.REMOCAO,
  TipoServico.COLETA_SELETIVA,
  TipoServico.ATERRO,
  TipoServico.GERAL,
  'rocadeira',
  'capina',
  'varricao',
  'poda',
  'remocao',
  'coleta_seletiva',
  'aterro',
  'geral',
]);
