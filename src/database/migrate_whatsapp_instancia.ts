/**
 * Instância própria do WhatsApp, só no banco de controle.
 * Idempotente: pode rodar de novo sem apagar linha nenhuma.
 */
import { getControlDataSource } from './data-source';
import { SQL_CRIAR_WHATSAPP_INSTANCIA, aplicarDefaultIdUuid } from './uuidIdDefault';

const COMANDOS = [
  SQL_CRIAR_WHATSAPP_INSTANCIA,
  `CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_instancia_token_uidx
    ON whatsapp_instancia (token)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_instancia_uma_ativa
    ON whatsapp_instancia (ativo) WHERE ativo = TRUE`,
];

export async function migrateWhatsappInstancia(): Promise<void> {
  const ds = getControlDataSource();
  if (!ds.isInitialized) await ds.initialize();
  for (const sql of COMANDOS) await ds.query(sql);
  await aplicarDefaultIdUuid((sql, params) => ds.query(sql, params));
}
