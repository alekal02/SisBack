-- Fase 2 — ledger do chatbot WhatsApp.
-- NÃO APLICADO automaticamente. Revise e rode em cada banco de contrato
-- (e no banco único, se MULTI_TENANT estiver desligado) antes de depender
-- da deduplicação persistente.
--
-- Não altera coleta_dados nem registros históricos.

CREATE TABLE IF NOT EXISTS whatsapp_mensagem_processamento (
  id uuid PRIMARY KEY,
  "messageId" varchar(128) NOT NULL,
  "grupoJid" varchar(80),
  estado varchar(20) NOT NULL,
  tentativas integer NOT NULL DEFAULT 1,
  "ultimoErro" text,
  motivo varchar(200),
  payload jsonb,
  "criadoEm" timestamptz NOT NULL DEFAULT now(),
  "atualizadoEm" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_mensagem_processamento_estado_chk
    CHECK (estado IN ('processando', 'sucesso', 'falha')),
  CONSTRAINT whatsapp_mensagem_processamento_message_id_uk UNIQUE ("messageId")
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_msg_estado_atualizado
  ON whatsapp_mensagem_processamento (estado, "atualizadoEm");
