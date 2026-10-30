/**
 * Tabelas criadas na mão com "id uuid PRIMARY KEY" e sem DEFAULT.
 * O TypeORM manda DEFAULT no id e o Postgres só preenche se a coluna tiver default.
 * gen_random_uuid() é nativo no Postgres 13+. Abaixo disso, pgcrypto.
 */

export const TABELAS_ID_UUID = [
  'whatsapp_autorizado',
  'whatsapp_tentativa_nao_autorizada',
  'whatsapp_instancia',
  'arquivos_storage',
  'whatsapp_mensagem_processamento',
] as const;

export type TabelaIdUuid = (typeof TABELAS_ID_UUID)[number];

const LISTA = new Set<string>(TABELAS_ID_UUID);

export function sqlAlterDefaultId(tabela: string): string {
  if (!LISTA.has(tabela)) throw new Error('Tabela fora da lista de id uuid');
  return `ALTER TABLE ${tabela} ALTER COLUMN id SET DEFAULT gen_random_uuid()`;
}

export const SQLS_ALTERAR_ID_UUID = TABELAS_ID_UUID.map((tabela) => sqlAlterDefaultId(tabela));

export const SQL_CRIAR_WHATSAPP_AUTORIZADO = `CREATE TABLE IF NOT EXISTS whatsapp_autorizado (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid NOT NULL,
    nome varchar(160) NOT NULL,
    telefone varchar(20) NOT NULL,
    lid varchar(80),
    pode_enviar_planilha boolean NOT NULL DEFAULT false,
    pode_pedir_relatorio boolean NOT NULL DEFAULT false,
    ativo boolean NOT NULL DEFAULT true,
    criado_em timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT whatsapp_autorizado_contrato_telefone_uk UNIQUE (contract_id, telefone)
  )`;

export const SQL_CRIAR_WHATSAPP_TENTATIVA = `CREATE TABLE IF NOT EXISTS whatsapp_tentativa_nao_autorizada (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    telefone varchar(32) NOT NULL,
    nome_perfil varchar(160),
    tipo varchar(20) NOT NULL,
    criado_em timestamptz NOT NULL DEFAULT now()
  )`;

export const SQL_CRIAR_WHATSAPP_INSTANCIA = `CREATE TABLE IF NOT EXISTS whatsapp_instancia (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome_instancia VARCHAR(80) NOT NULL,
    token VARCHAR(80) NOT NULL,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ativo BOOLEAN NOT NULL DEFAULT TRUE
  )`;

export const SQL_CRIAR_ARQUIVOS_STORAGE = `CREATE TABLE IF NOT EXISTS arquivos_storage (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    caminho varchar(1024) NOT NULL,
    content_type varchar(200),
    tamanho integer NOT NULL,
    conteudo bytea NOT NULL,
    criado_em timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT arquivos_storage_caminho_uk UNIQUE (caminho)
  )`;

export const SQL_CRIAR_WHATSAPP_MENSAGEM = `CREATE TABLE IF NOT EXISTS whatsapp_mensagem_processamento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "messageId" varchar(128) NOT NULL,
  "grupoJid" varchar(80),
  estado varchar(20) NOT NULL,
  tentativas integer NOT NULL DEFAULT 1,
  "ultimoErro" text,
  motivo varchar(200),
  payload jsonb,
  "criadoEm" timestamptz NOT NULL DEFAULT now(),
  "atualizadoEm" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_mensagem_processamento_estado_chk
    CHECK (estado IN ('processando', 'sucesso', 'falha')),
  CONSTRAINT whatsapp_mensagem_processamento_message_id_uk UNIQUE ("messageId")
)`;

type Consulta = (sql: string, params?: unknown[]) => Promise<Array<Record<string, unknown>>>;

export async function aplicarDefaultIdUuid(query: Consulta): Promise<string[]> {
  const versao = await query(`SELECT current_setting('server_version_num')::int AS num`);
  const num = Number(versao?.[0]?.num);
  if (!Number.isFinite(num) || num < 130000) {
    await query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  }

  const aplicados: string[] = [];
  for (const tabela of TABELAS_ID_UUID) {
    const cols = await query(
      `SELECT 1 AS ok FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'id' AND udt_name = 'uuid'`,
      [tabela],
    );
    if (!cols?.length) continue;
    await query(sqlAlterDefaultId(tabela));
    aplicados.push(tabela);
  }
  return aplicados;
}
