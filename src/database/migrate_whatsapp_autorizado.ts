/**
 * Pessoas autorizadas no WhatsApp, no banco de controle.
 * Idempotente: não apaga linha nenhuma.
 */
import { getControlDataSource } from './data-source';

const COMANDOS = [
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
];

export async function migrateWhatsappAutorizado(): Promise<void> {
  const ds = getControlDataSource();
  if (!ds.isInitialized) await ds.initialize();
  for (const sql of COMANDOS) await ds.query(sql);
}
