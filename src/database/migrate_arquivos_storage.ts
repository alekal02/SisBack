import AppDataSource from './data-source';
import { SQL_CRIAR_ARQUIVOS_STORAGE, aplicarDefaultIdUuid } from './uuidIdDefault';

export async function migrateArquivosStorage(): Promise<void> {
  if (String(process.env.STORAGE_DRIVER || '').trim().toLowerCase() !== 'postgres') return;
  if (!AppDataSource.isInitialized) await AppDataSource.initialize();
  await AppDataSource.query(SQL_CRIAR_ARQUIVOS_STORAGE);
  await aplicarDefaultIdUuid((sql, params) => AppDataSource.query(sql, params));
  console.log('[arquivos_storage] tabela pronta');
}
