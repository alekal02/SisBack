import AppDataSource from './data-source';

const COMANDOS = [
  `CREATE TABLE IF NOT EXISTS importacao_linha_ignorada (
    id serial PRIMARY KEY,
    "planilhaUploadId" integer NOT NULL REFERENCES planilha_uploads(id) ON DELETE CASCADE,
    "linhaExcel" integer NOT NULL,
    motivo varchar(80) NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_importacao_linha_ignorada_upload
    ON importacao_linha_ignorada ("planilhaUploadId")`,
  `ALTER TABLE coleta_dados ADD COLUMN IF NOT EXISTS "placaSuspeita" boolean NOT NULL DEFAULT false`,
  `ALTER TABLE coleta_totais_dia ADD COLUMN IF NOT EXISTS "viagensComKm" integer NOT NULL DEFAULT 0`,
  `ALTER TABLE coleta_totais_dia ADD COLUMN IF NOT EXISTS "pesoKgComKm" double precision NOT NULL DEFAULT 0`,
];

export async function migrateImportacaoLinhaIgnorada(): Promise<void> {
  if (!AppDataSource.isInitialized) await AppDataSource.initialize();
  for (const sql of COMANDOS) await AppDataSource.query(sql);
  console.log('[importacao_linha_ignorada] tabela pronta');
}
