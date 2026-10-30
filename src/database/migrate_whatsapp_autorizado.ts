/**
 * Pessoas autorizadas e tentativas sem autorização, no banco de controle.
 * Uma função só: as duas tabelas não são criadas de novo em outro arquivo.
 * arquivos_storage continua no banco ativo (por contrato), como já estava em produção.
 */
import AppDataSource, { getControlDataSource } from './data-source';
import {
  SQL_CRIAR_ARQUIVOS_STORAGE,
  SQL_CRIAR_WHATSAPP_AUTORIZADO,
  SQL_CRIAR_WHATSAPP_TENTATIVA,
  aplicarDefaultIdUuid,
} from './uuidIdDefault';

const TABELAS_CONTROLE = [
  SQL_CRIAR_WHATSAPP_AUTORIZADO,
  `CREATE INDEX IF NOT EXISTS whatsapp_autorizado_telefone_idx ON whatsapp_autorizado (telefone)`,
  `CREATE INDEX IF NOT EXISTS whatsapp_autorizado_lid_idx ON whatsapp_autorizado (lid)`,
  SQL_CRIAR_WHATSAPP_TENTATIVA,
  `CREATE INDEX IF NOT EXISTS whatsapp_tentativa_criado_idx ON whatsapp_tentativa_nao_autorizada (criado_em DESC)`,
];

export async function migrateWhatsappAutorizado(): Promise<void> {
  const controle = getControlDataSource();
  if (!controle.isInitialized) await controle.initialize();
  for (const sql of TABELAS_CONTROLE) await controle.query(sql);
  const doControle = await aplicarDefaultIdUuid((sql, params) => controle.query(sql, params));

  if (!AppDataSource.isInitialized) await AppDataSource.initialize();
  await AppDataSource.query(SQL_CRIAR_ARQUIVOS_STORAGE);
  const doAtivo = await aplicarDefaultIdUuid((sql, params) => AppDataSource.query(sql, params));
  const tabelas = [...new Set([...doControle, ...doAtivo])];
  console.log(`[whatsapp_autorizado] tabelas prontas; id com default em: ${tabelas.join(', ') || 'nenhuma'}`);
}
