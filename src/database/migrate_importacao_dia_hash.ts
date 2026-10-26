import AppDataSource from './data-source';

const SQL = `
  CREATE TABLE IF NOT EXISTS importacao_dia_hash (
    servico_id uuid NOT NULL REFERENCES servicos(id) ON DELETE CASCADE,
    data date NOT NULL,
    hash varchar(64) NOT NULL,
    atualizado_em timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (servico_id, data)
  )
`;

export async function migrateImportacaoDiaHash(): Promise<void> {
  if (!AppDataSource.isInitialized) await AppDataSource.initialize();
  await AppDataSource.query(SQL);
  console.log('[importacao_dia_hash] tabela pronta');
}
