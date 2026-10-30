/**
 * Instância própria do WhatsApp, só no banco de controle.
 * Idempotente: pode rodar de novo sem apagar linha nenhuma.
 */
import { getControlDataSource } from './data-source';

const COMANDOS = [
  `CREATE TABLE IF NOT EXISTS whatsapp_instancia (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome_instancia VARCHAR(80) NOT NULL,
    token VARCHAR(80) NOT NULL,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ativo BOOLEAN NOT NULL DEFAULT TRUE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_instancia_token_uidx
    ON whatsapp_instancia (token)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_instancia_uma_ativa
    ON whatsapp_instancia (ativo) WHERE ativo = TRUE`,
];

export async function migrateWhatsappInstancia(): Promise<void> {
  const ds = getControlDataSource();
  if (!ds.isInitialized) await ds.initialize();
  for (const sql of COMANDOS) await ds.query(sql);
}
