import AppDataSource from './data-source';

const SQL = `
  CREATE TABLE IF NOT EXISTS meta_ciclo (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contrato_id uuid NOT NULL,
    ciclo_inicio date NOT NULL,
    meta_faturamento numeric(14,2),
    metas_producao jsonb NOT NULL DEFAULT '{}'::jsonb,
    atualizado_em timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT meta_ciclo_contrato_inicio_uk UNIQUE (contrato_id, ciclo_inicio)
  );

  CREATE TABLE IF NOT EXISTS painel_cache (
    chave varchar(220) PRIMARY KEY,
    payload jsonb NOT NULL,
    calculado_em timestamptz NOT NULL DEFAULT now()
  );
`;

/** Metas do ciclo e cache do painel. Um CREATE, mesmo com as outras migrations puladas. */
export async function migratePainelDiretoria(): Promise<void> {
  if (!AppDataSource.isInitialized) await AppDataSource.initialize();
  await AppDataSource.query(SQL);
  console.log('[painel] metas e cache prontos');
}
