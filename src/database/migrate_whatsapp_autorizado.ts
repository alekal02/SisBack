/**
 * Pessoas autorizadas e tentativas sem autorização, no banco de controle.
 * Uma função só: as duas tabelas não são criadas de novo em outro arquivo.
 * arquivos_storage continua no banco ativo (por contrato), como já estava em produção.
 */
import AppDataSource, { getControlDataSource } from './data-source';

const TABELAS_CONTROLE = [
  `CREATE TABLE IF NOT EXISTS whatsapp_autorizado (
    id uuid PRIMARY KEY,
    contract_id uuid NOT NULL,
    nome varchar(160) NOT NULL,
    telefone varchar(20) NOT NULL,
    lid varchar(80),
    pode_enviar_planilha boolean NOT NULL DEFAULT false,
    pode_pedir_relatorio boolean NOT NULL DEFAULT false,
    ativo boolean NOT NULL DEFAULT true,
    criado_em timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT whatsapp_autorizado_contrato_telefone_uk UNIQUE (contract_id, telefone)
  )`,
  `CREATE INDEX IF NOT EXISTS whatsapp_autorizado_telefone_idx ON whatsapp_autorizado (telefone)`,
  `CREATE INDEX IF NOT EXISTS whatsapp_autorizado_lid_idx ON whatsapp_autorizado (lid)`,
  `CREATE TABLE IF NOT EXISTS whatsapp_tentativa_nao_autorizada (
    id uuid PRIMARY KEY,
    telefone varchar(32) NOT NULL,
    nome_perfil varchar(160),
    tipo varchar(20) NOT NULL,
    criado_em timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS whatsapp_tentativa_criado_idx ON whatsapp_tentativa_nao_autorizada (criado_em DESC)`,
];

const ARQUIVOS_STORAGE = `CREATE TABLE IF NOT EXISTS arquivos_storage (
    id uuid PRIMARY KEY,
    caminho varchar(1024) NOT NULL,
    content_type varchar(200),
    tamanho integer NOT NULL,
    conteudo bytea NOT NULL,
    criado_em timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT arquivos_storage_caminho_uk UNIQUE (caminho)
  )`;

export async function migrateWhatsappAutorizado(): Promise<void> {
  const controle = getControlDataSource();
  if (!controle.isInitialized) await controle.initialize();
  for (const sql of TABELAS_CONTROLE) await controle.query(sql);

  if (!AppDataSource.isInitialized) await AppDataSource.initialize();
  await AppDataSource.query(ARQUIVOS_STORAGE);
  console.log('[whatsapp_autorizado] tabelas prontas');
}
