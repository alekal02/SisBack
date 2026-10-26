/**
 * Hash do conteúdo normalizado de cada data da planilha.
 * Datas com o mesmo hash da última importação não são apagadas nem regravadas.
 */
import crypto from 'crypto';
import type { EntityManager } from 'typeorm';
import AppDataSource from '../database/data-source';

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

export function canonizarValor(valor: unknown): unknown {
  if (valor == null) return null;
  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return null;
    return valor.toISOString();
  }
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) return null;
    return Object.is(valor, -0) ? 0 : valor;
  }
  if (typeof valor === 'string') {
    const texto = valor.trim();
    return texto === '' ? null : texto;
  }
  if (typeof valor === 'boolean') return valor;
  if (Array.isArray(valor)) return valor.map((item) => canonizarValor(item));
  if (typeof valor === 'object') {
    const saida: Record<string, unknown> = {};
    for (const chave of Object.keys(valor as Record<string, unknown>).sort()) {
      if (!chave || chave.startsWith('__EMPTY')) continue;
      const item = canonizarValor((valor as Record<string, unknown>)[chave]);
      if (item == null) continue;
      saida[chave] = item;
    }
    return saida;
  }
  return String(valor);
}

/** SHA-256 do conteúdo do dia. A ordem das linhas e das chaves não altera o hash. */
export function hashConteudoDia(linhas: unknown[]): string {
  const canon = linhas
    .map((linha) => JSON.stringify(canonizarValor(linha)))
    .sort();
  return crypto.createHash('sha256').update(canon.join('\n')).digest('hex');
}

export function decidirDatasRegravacao(opts: {
  hashesPlanilha: Map<string, string>;
  hashesSalvos: Map<string, string>;
  datasBloqueadas?: Iterable<string>;
}): { regravar: string[]; iguais: string[] } {
  const bloqueadas = new Set(opts.datasBloqueadas ?? []);
  const regravar: string[] = [];
  const iguais: string[] = [];
  for (const data of [...opts.hashesPlanilha.keys()].sort()) {
    if (bloqueadas.has(data)) continue;
    const novo = opts.hashesPlanilha.get(data);
    const salvo = opts.hashesSalvos.get(data);
    if (novo && salvo && salvo === novo) iguais.push(data);
    else regravar.push(data);
  }
  return { regravar, iguais };
}

export function fraseDiasHash(atualizados: number, iguais: number): string {
  const at = `${atualizados} ${atualizados === 1 ? 'dia atualizado' : 'dias atualizados'}`;
  const ig = `${iguais} ${iguais === 1 ? 'dia igual' : 'dias iguais'}`;
  return `${at}, ${ig}`;
}

export function anexarFraseDias(
  mensagem: string,
  resultado: { diasAtualizados?: number | null; diasIguais?: number | null },
): string {
  if (resultado.diasAtualizados == null || resultado.diasIguais == null) return mensagem;
  const frase = fraseDiasHash(resultado.diasAtualizados, resultado.diasIguais);
  if (mensagem.includes(frase)) return mensagem;
  const base = mensagem.trim().replace(/\s+$/g, '');
  const separador = base.endsWith('.') ? ' ' : '. ';
  return `${base}${separador}${frase}.`;
}

/** Há linha nova, data apagada ou dia ausente removido. Reenvio idêntico não invalida cache. */
export function importacaoRegravouDados(resultado: {
  diasAtualizados?: number | null;
  datasApagadas?: unknown[] | null;
  diasRemovidosAusentes?: unknown[] | null;
  importados?: number | null;
}): boolean {
  const apagou = (resultado.datasApagadas?.length ?? 0) > 0
    || (resultado.diasRemovidosAusentes?.length ?? 0) > 0;
  if (resultado.diasAtualizados == null) {
    return apagou || (resultado.importados ?? 0) > 0;
  }
  return resultado.diasAtualizados > 0 || apagou;
}

type ConsultaSql = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

function consulta(manager?: EntityManager): ConsultaSql {
  return manager ?? AppDataSource;
}

function datasValidas(datas: string[]): string[] {
  return [...new Set(datas.filter((data) => DATA_ISO.test(data)))];
}

export async function carregarHashesDia(
  servicoId: string,
  datas: string[],
  manager?: EntityManager,
): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  const validas = datasValidas(datas);
  if (!servicoId || validas.length === 0) return mapa;
  const rows = await consulta(manager).query(
    `SELECT to_char(data, 'YYYY-MM-DD') AS data, hash
     FROM importacao_dia_hash
     WHERE servico_id = $1 AND data = ANY($2::date[])`,
    [servicoId, validas],
  ) as Array<{ data: string; hash: string }>;
  for (const row of rows || []) {
    if (row?.data && row.hash) mapa.set(String(row.data).slice(0, 10), row.hash);
  }
  return mapa;
}

export async function salvarHashesDia(
  servicoId: string,
  itens: Array<{ data: string; hash: string }>,
  manager?: EntityManager,
): Promise<void> {
  const validos = itens.filter((item) => DATA_ISO.test(item.data) && item.hash);
  if (!servicoId || validos.length === 0) return;
  await consulta(manager).query(
    `INSERT INTO importacao_dia_hash (servico_id, data, hash, atualizado_em)
     SELECT $1::uuid, x.data, x.hash, now()
     FROM unnest($2::date[], $3::varchar[]) AS x(data, hash)
     ON CONFLICT (servico_id, data)
     DO UPDATE SET hash = EXCLUDED.hash, atualizado_em = now()`,
    [servicoId, validos.map((item) => item.data), validos.map((item) => item.hash)],
  );
}

export async function removerHashesDia(
  servicoId: string,
  datas: string[],
  manager?: EntityManager,
): Promise<void> {
  const validas = datasValidas(datas);
  if (!servicoId || validas.length === 0) return;
  await consulta(manager).query(
    `DELETE FROM importacao_dia_hash
     WHERE servico_id = $1 AND data = ANY($2::date[])`,
    [servicoId, validas],
  );
}
