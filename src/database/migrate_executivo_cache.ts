import AppDataSource from './data-source';

const SQL = `
  CREATE TABLE IF NOT EXISTS executivo_cache (
    contrato_id uuid NOT NULL,
    ciclo varchar(120) NOT NULL,
    payload jsonb NOT NULL,
    calculado_em timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (contrato_id, ciclo)
  )
`;

/** Um CREATE TABLE. Roda mesmo com as outras migrations puladas. */
export async function migrateExecutivoCache(): Promise<void> {
  if (!AppDataSource.isInitialized) await AppDataSource.initialize();
  await AppDataSource.query(SQL);
  console.log('[executivo_cache] tabela pronta');
}
