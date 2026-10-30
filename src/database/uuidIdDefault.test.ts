import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import {
  SQLS_ALTERAR_ID_UUID,
  SQL_CRIAR_ARQUIVOS_STORAGE,
  SQL_CRIAR_WHATSAPP_AUTORIZADO,
  SQL_CRIAR_WHATSAPP_INSTANCIA,
  SQL_CRIAR_WHATSAPP_MENSAGEM,
  SQL_CRIAR_WHATSAPP_TENTATIVA,
  TABELAS_ID_UUID,
  aplicarDefaultIdUuid,
  sqlAlterDefaultId,
} from './uuidIdDefault';

const SQLS_CRIAR = [
  SQL_CRIAR_WHATSAPP_AUTORIZADO,
  SQL_CRIAR_WHATSAPP_TENTATIVA,
  SQL_CRIAR_WHATSAPP_INSTANCIA,
  SQL_CRIAR_ARQUIVOS_STORAGE,
  SQL_CRIAR_WHATSAPP_MENSAGEM,
];

/** O CREATE antigo, igual ao que está em produção: id sem default. */
const SQLS_CRIAR_SEM_DEFAULT = SQLS_CRIAR.map((sql) => sql.replace(
  /id uuid PRIMARY KEY DEFAULT gen_random_uuid\(\)/i,
  'id uuid PRIMARY KEY',
));

type Tabela = { defaultId: string | null; linhas: string[] };

function nomeCreate(sql: string): string | null {
  return sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/i)?.[1] ?? null;
}

function nomeAlter(sql: string): string | null {
  return sql.match(/^ALTER TABLE (\w+) ALTER COLUMN id SET DEFAULT gen_random_uuid\(\)$/)?.[1] ?? null;
}

function aplicar(banco: Map<string, Tabela>, sql: string): void {
  const criada = nomeCreate(sql);
  if (criada) {
    if (banco.has(criada)) return;
    const comDefault = /id uuid PRIMARY KEY DEFAULT gen_random_uuid\(\)/i.test(sql);
    banco.set(criada, { defaultId: comDefault ? 'gen_random_uuid()' : null, linhas: [] });
    return;
  }
  const alterada = nomeAlter(sql);
  if (alterada) {
    const tabela = banco.get(alterada);
    if (!tabela) throw new Error(`tabela ausente: ${alterada}`);
    tabela.defaultId = 'gen_random_uuid()';
  }
}

function inserirComDefault(banco: Map<string, Tabela>, nome: string): string {
  const tabela = banco.get(nome);
  if (!tabela) throw new Error(`tabela ausente: ${nome}`);
  if (!tabela.defaultId) {
    throw new Error(`null value in column "id" of relation "${nome}" violates not-null constraint`);
  }
  const id = randomUUID();
  tabela.linhas.push(id);
  return id;
}

describe('default gen_random_uuid no id', () => {
  it('o CREATE antigo recusa INSERT com DEFAULT e a migração passa a aceitar', () => {
    const banco = new Map<string, Tabela>();
    for (const sql of SQLS_CRIAR_SEM_DEFAULT) aplicar(banco, sql);
    assert.throws(
      () => inserirComDefault(banco, 'whatsapp_autorizado'),
      /null value in column "id"/,
    );

    for (const sql of SQLS_CRIAR) aplicar(banco, sql);
    assert.throws(
      () => inserirComDefault(banco, 'whatsapp_autorizado'),
      /null value in column "id"/,
    );

    for (const sql of SQLS_ALTERAR_ID_UUID) aplicar(banco, sql);
    for (const nome of TABELAS_ID_UUID) {
      const id = inserirComDefault(banco, nome);
      assert.match(id, /^[0-9a-f-]{36}$/);
    }
  });

  it('um banco novo já nasce com DEFAULT e o INSERT não manda id', () => {
    const banco = new Map<string, Tabela>();
    for (const sql of SQLS_CRIAR) aplicar(banco, sql);
    for (const nome of TABELAS_ID_UUID) {
      assert.equal(banco.get(nome)?.defaultId, 'gen_random_uuid()');
      assert.match(inserirComDefault(banco, nome), /^[0-9a-f-]{36}$/);
    }
  });

  it('no Postgres 16 não cria pgcrypto e aplica o ALTER só nas tabelas que existem', async () => {
    const queries: string[] = [];
    const existentes = new Set(['whatsapp_autorizado', 'arquivos_storage']);
    const aplicados = await aplicarDefaultIdUuid(async (sql, params) => {
      queries.push(sql);
      if (sql.includes('server_version_num')) return [{ num: 160015 }];
      if (sql.includes('information_schema.columns')) {
        return existentes.has(String(params?.[0])) ? [{ ok: 1 }] : [];
      }
      return [];
    });
    assert.deepEqual(aplicados, ['whatsapp_autorizado', 'arquivos_storage']);
    assert.equal(queries.some((sql) => /CREATE EXTENSION/i.test(sql)), false);
    assert.ok(queries.includes(sqlAlterDefaultId('whatsapp_autorizado')));
    assert.equal(queries.includes(sqlAlterDefaultId('whatsapp_instancia')), false);
  });

  it('abaixo do Postgres 13 cria pgcrypto antes do ALTER', async () => {
    const queries: string[] = [];
    await aplicarDefaultIdUuid(async (sql) => {
      queries.push(sql);
      if (sql.includes('server_version_num')) return [{ num: 120000 }];
      if (sql.includes('information_schema.columns')) return [{ ok: 1 }];
      return [];
    });
    const extensao = queries.findIndex((sql) => sql === 'CREATE EXTENSION IF NOT EXISTS pgcrypto');
    const alter = queries.findIndex((sql) => sql === sqlAlterDefaultId('whatsapp_autorizado'));
    assert.ok(extensao >= 0);
    assert.ok(alter > extensao);
  });

  it('o script da mensagem de processamento também cria e altera o id', () => {
    const script = fs.readFileSync(
      path.join(__dirname, '../../scripts/migrate_whatsapp_mensagem_processamento.sql'),
      'utf8',
    );
    assert.match(script, /id uuid PRIMARY KEY DEFAULT gen_random_uuid\(\)/);
    assert.match(
      script,
      /ALTER TABLE whatsapp_mensagem_processamento ALTER COLUMN id SET DEFAULT gen_random_uuid\(\)/,
    );
  });
});
