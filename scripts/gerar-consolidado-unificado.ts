/**
 * Gera planilha no layout Power Query (SERVIÇO|DATA|LOCAL|…)
 * com a CONSOLIDADO realmente unificada a partir das abas de produção.
 *
 * Uso: npx ts-node --transpile-only scripts/gerar-consolidado-unificado.ts
 */
import * as fs from 'fs';
import * as XLSX from 'xlsx';
import { parseDataPlanilha } from '../src/utils/formatarDataPlanilha';

const ORIGEM = 'C:/Users/Sistemma/Downloads/PRODUÇÃO - APARECIDA - SET. 2026.xlsx';
const DESTINO = 'C:/Users/Sistemma/Downloads/PRODUÇÃO - APARECIDA - SET. 2026 - CONSOLIDADO UNIFICADO.xlsx';

const CAB = ['SERVIÇO', 'DATA', 'LOCAL', 'TIPO DE EQUIPAMENTO', 'UNIDADE', 'QUANTIDADE', 'OBSERVAÇÃO'] as const;

type LinhaPQ = {
  servico: string;
  data: Date;
  local: string;
  equipamento: string;
  unidade: string;
  quantidade: number | '';
  observacao: string;
  chave: string;
  origem: string;
};

function isoDate(v: unknown): Date | null {
  if (v instanceof Date && !isNaN(v.getTime())) {
    const utcMid = v.getUTCHours() === 0 && v.getUTCMinutes() === 0 && v.getUTCSeconds() === 0;
    if (utcMid) return new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate(), 12, 0, 0));
    return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate(), 12, 0, 0));
  }
  const p = parseDataPlanilha(v);
  if (!p) return null;
  return new Date(Date.UTC(p.getUTCFullYear(), p.getUTCMonth(), p.getUTCDate(), 12, 0, 0));
}

function str(v: unknown): string {
  if (v == null) return '';
  const s = String(v).trim();
  return s;
}

function num(v: unknown): number {
  if (typeof v === 'number' && !isNaN(v)) return v;
  if (v == null || v === '') return 0;
  const n = Number(String(v).replace(/\./g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

function normKey(s: unknown): string {
  return String(s ?? '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

function rowsOf(wb: XLSX.WorkBook, name: string): unknown[][] {
  const ws = wb.Sheets[name];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true }) as unknown[][];
}

function findHeader(rows: unknown[][], need: string[]): { idx: number; keys: string[] } | null {
  for (let i = 0; i < Math.min(25, rows.length); i++) {
    const keys = (rows[i] || []).map(normKey);
    if (need.every((n) => keys.some((k) => k === n || k.includes(n)))) {
      return { idx: i, keys };
    }
  }
  return null;
}

function col(keys: string[], ...cands: string[]): number {
  for (const c of cands) {
    const i = keys.findIndex((k) => k === c || k.includes(c));
    if (i >= 0) return i;
  }
  return -1;
}

function parseConsolidadoOficial(wb: XLSX.WorkBook): LinhaPQ[] {
  const rows = rowsOf(wb, 'CONSOLIDADO');
  const out: LinhaPQ[] = [];
  for (const r of rows.slice(1)) {
    const servico = str(r[0]);
    const data = isoDate(r[1]);
    if (!servico || !data) continue;
    const qRaw = r[5];
    const qEmpty = qRaw == null || qRaw === '';
    const u = str(r[4]) || 'KM';
    out.push({
      servico,
      data,
      local: str(r[2]),
      equipamento: str(r[3]),
      unidade: u,
      quantidade: qEmpty ? '' : num(qRaw),
      observacao: str(r[6]),
      chave: servico.toUpperCase().includes('PODA')
        ? 'poda'
        : servico.toUpperCase().includes('MEC')
          ? 'varricao_mecanizada'
          : 'varricao_manual',
      origem: 'CONSOLIDADO',
    });
  }
  return out;
}

function parseOps(
  wb: XLSX.WorkBook,
  aba: string,
  opts: {
    need: string[];
    servico: string;
    chave: string;
    unidade: string;
    qtyKeys: string[];
    pontoSeVazio?: boolean;
  },
): LinhaPQ[] {
  const rows = rowsOf(wb, aba);
  const h = findHeader(rows, opts.need);
  if (!h) return [];
  const iData = col(h.keys, 'DATA', 'DIA');
  const iQty = opts.qtyKeys.length ? col(h.keys, ...opts.qtyKeys) : -1;
  const iA = col(h.keys, 'BAIRRO', 'SETOR', 'LOCAL');
  const iB = col(h.keys, 'RUA', 'AVRUA', 'AVENIDA', 'LOGRADOURO', 'ENDERECO');
  const iC = col(h.keys, 'COMPLEMENTO');
  const iEq = col(h.keys, 'EQUIPAMENTO');
  const iObs = col(h.keys, 'OBSERVACAO', 'SERVICO');
  const out: LinhaPQ[] = [];
  for (let r = h.idx + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const data = iData >= 0 ? isoDate(row[iData]) : null;
    if (!data) continue;
    const local = [iA >= 0 ? str(row[iA]) : '', iB >= 0 ? str(row[iB]) : '', iC >= 0 ? str(row[iC]) : '']
      .filter(Boolean)
      .join(' · ');
    const q = iQty >= 0 ? num(row[iQty]) : 0;
    const qEmpty = iQty < 0 || q <= 0;
    if (qEmpty && !opts.pontoSeVazio && iQty >= 0) continue;
    out.push({
      servico: opts.servico,
      data,
      local,
      equipamento: iEq >= 0 ? str(row[iEq]) : '',
      unidade: opts.unidade,
      quantidade: qEmpty && opts.pontoSeVazio ? '' : q,
      observacao: iObs >= 0 ? str(row[iObs]) : `Origem: ${aba}`,
      chave: opts.chave,
      origem: aba,
    });
  }
  return out;
}

function toAoa(linhas: LinhaPQ[]): unknown[][] {
  const sorted = [...linhas].sort((a, b) => {
    const ds = a.data.getTime() - b.data.getTime();
    if (ds !== 0) return ds;
    return a.servico.localeCompare(b.servico, 'pt-BR') || a.local.localeCompare(b.local, 'pt-BR');
  });
  return [
    [...CAB],
    ...sorted.map((l) => [
      l.servico,
      l.data,
      l.local,
      l.equipamento,
      l.unidade,
      l.quantidade,
      l.observacao,
    ]),
  ];
}

function sheetFrom(linhas: LinhaPQ[]): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(toAoa(linhas), { cellDates: true });
  ws['!cols'] = [
    { wch: 24 },
    { wch: 12 },
    { wch: 48 },
    { wch: 24 },
    { wch: 10 },
    { wch: 14 },
    { wch: 28 },
  ];
  return ws;
}

function resumo(linhas: LinhaPQ[]): unknown[][] {
  const map = new Map<string, { n: number; q: number; origem: string; min: string; max: string }>();
  for (const l of linhas) {
    const iso = l.data.toISOString().slice(0, 10);
    const cur = map.get(l.chave) || { n: 0, q: 0, origem: l.origem, min: iso, max: iso };
    cur.n += 1;
    cur.q += typeof l.quantidade === 'number' ? l.quantidade : 0;
    if (iso < cur.min) cur.min = iso;
    if (iso > cur.max) cur.max = iso;
    map.set(l.chave, cur);
  }
  const labels: Record<string, string> = {
    varricao_manual: 'Varrição manual',
    varricao_mecanizada: 'Varrição mecanizada',
    rocada_manual: 'Roçada manual',
    rocada_mecanizada: 'Roçada mecanizada',
    poda: 'Poda',
    remocao: 'Remoção de entulho',
    feiras: 'Feiras',
  };
  const rows: unknown[][] = [
    ['Serviço', 'Registros', 'Quantidade', 'Unidade implícita', 'Origem usada', 'De', 'Até'],
  ];
  for (const [k, v] of map) {
    const und = k.startsWith('rocada') ? 'm²' : k.startsWith('varricao') ? 'km' : 'pontos';
    rows.push([
      labels[k] || k,
      v.n,
      Math.round(v.q * 100) / 100,
      und,
      v.origem,
      v.min.split('-').reverse().join('/'),
      v.max.split('-').reverse().join('/'),
    ]);
  }
  rows.push([]);
  rows.push(['Total', linhas.length]);
  rows.push([]);
  rows.push(['Regra de unificação']);
  rows.push(['Varrição manual e mecanizada + poda: linhas da CONSOLIDADO original (bate com o MAPA de varrição).']);
  rows.push(['Roçada: abas ROÇADA MANUAL / ROÇADA MECANIZADA (Tabela* estava vazia).']);
  rows.push(['Remoção: aba REMOÇÃO_ENTULHO (Tabela* era junho).']);
  rows.push(['Feiras: aba FEIRAS se houver DATA; senão residual da TabelaFeira.']);
  rows.push(['Cadastro (Vias*, ListaFeira) não entra.']);
  return rows;
}

function main() {
  if (!fs.existsSync(ORIGEM)) {
    throw new Error(`Arquivo origem não encontrado: ${ORIGEM}`);
  }
  const wbIn = XLSX.readFile(ORIGEM, { cellDates: true });

  const oficiais = parseConsolidadoOficial(wbIn);
  const varrMan = oficiais.filter((l) => l.chave === 'varricao_manual');
  const varrMec = oficiais.filter((l) => l.chave === 'varricao_mecanizada');
  const poda = oficiais.filter((l) => l.chave === 'poda');

  const rocMan = parseOps(wbIn, 'ROÇADA MANUAL', {
    need: ['DATA', 'SETOR'],
    servico: 'ROÇADA MANUAL',
    chave: 'rocada_manual',
    unidade: 'M²',
    qtyKeys: ['AREA'],
  });
  const rocMec = parseOps(wbIn, 'ROÇADA MECANIZADA', {
    need: ['DIA', 'SETOR'],
    servico: 'ROÇADA MECANIZADA',
    chave: 'rocada_mecanizada',
    unidade: 'M²',
    qtyKeys: ['AREA'],
  });
  const remocao = parseOps(wbIn, 'REMOÇÃO_ENTULHO', {
    need: ['DIA', 'SETOR'],
    servico: 'REMOÇÃO DE ENTULHO',
    chave: 'remocao',
    unidade: 'EQUIPE',
    qtyKeys: [],
    pontoSeVazio: true,
  });
  let feiras = parseOps(wbIn, 'FEIRAS', {
    need: ['DATA'],
    servico: 'LIMPEZA DE FEIRAS',
    chave: 'feiras',
    unidade: 'EQUIPE',
    qtyKeys: [],
    pontoSeVazio: true,
  });
  if (feiras.length === 0) {
    const tab = rowsOf(wbIn, 'TabelaFeira');
    for (const r of tab.slice(1)) {
      const data = isoDate(r[1]);
      if (!data) continue;
      feiras.push({
        servico: str(r[0]) || 'LIMPEZA DE FEIRAS',
        data,
        local: str(r[2]),
        equipamento: str(r[3]),
        unidade: str(r[4]) || 'EQUIPE',
        quantidade: '',
        observacao: str(r[6]) || 'Residual TabelaFeira (fora do ciclo SET)',
        chave: 'feiras',
        origem: 'TabelaFeira',
      });
    }
  }

  const porTabela: Array<{ nome: string; linhas: LinhaPQ[] }> = [
    { nome: 'TabelaVarriçãoManual', linhas: varrMan },
    { nome: 'TabelaVarreçãoMec', linhas: varrMec },
    { nome: 'TabelaRoçadaManual', linhas: rocMan },
    { nome: 'TabelaRoçadaMec', linhas: rocMec },
    { nome: 'TabelaPodaÁrvore', linhas: poda },
    { nome: 'TabelaEntulho', linhas: remocao },
    { nome: 'TabelaFeira', linhas: feiras },
  ];

  const consolidado = porTabela.flatMap((t) => t.linhas);

  const wbOut = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wbOut, sheetFrom(consolidado), 'CONSOLIDADO');
  for (const t of porTabela) {
    XLSX.utils.book_append_sheet(wbOut, sheetFrom(t.linhas), t.nome);
  }
  const wsResumo = XLSX.utils.aoa_to_sheet(resumo(consolidado));
  wsResumo['!cols'] = [
    { wch: 28 }, { wch: 12 }, { wch: 16 }, { wch: 18 }, { wch: 28 }, { wch: 12 }, { wch: 12 },
  ];
  XLSX.utils.book_append_sheet(wbOut, wsResumo, 'RESUMO');

  XLSX.writeFile(wbOut, DESTINO, { cellDates: true, bookSST: true });

  const por = Object.fromEntries(
    [...new Set(consolidado.map((l) => l.chave))].map((k) => [k, consolidado.filter((l) => l.chave === k).length]),
  );
  console.log(JSON.stringify({
    destino: DESTINO,
    total: consolidado.length,
    porServico: por,
    tabelas: porTabela.map((t) => ({ nome: t.nome, n: t.linhas.length })),
  }, null, 2));
}

main();
