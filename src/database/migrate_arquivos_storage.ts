import AppDataSource from './data-source';

const SQL = `
  CREATE TABLE IF NOT EXISTS arquivos_storage (
    id uuid PRIMARY KEY,
    caminho varchar(1024) NOT NULL,
    content_type varchar(200),
    tamanho integer NOT NULL,
    conteudo bytea NOT NULL,
    criado_em timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT arquivos_storage_caminho_uk UNIQUE (caminho)
  )
`;

export async function migrateArquivosStorage(): Promise<void> {
  if (String(process.env.STORAGE_DRIVER || '').trim().toLowerCase() !== 'postgres') return;
  if (!AppDataSource.isInitialized) await AppDataSource.initialize();
  await AppDataSource.query(SQL);
  console.log('[arquivos_storage] tabela pronta');
}
