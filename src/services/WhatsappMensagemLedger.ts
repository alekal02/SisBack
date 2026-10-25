import { randomUUID } from 'crypto';
import AppDataSource from '../database/data-source';

export type EstadoMensagemWhatsapp = 'processando' | 'sucesso' | 'falha';

/** Importar planilha grande passa de 2 minutos. Antes disso a reentrega abria outra importação e derrubava o processo. */
export const WHATSAPP_MSG_STALE_MS = 15 * 60 * 1000;
export const WHATSAPP_MSG_MAX_TENTATIVAS = 5;
export const MOTIVO_GRUPO_NAO_MAPEADO = 'grupo_nao_mapeado';
/** Queda no meio do trabalho. Não retomar no próximo boot: isso derrubava o processo de novo. */
export const MOTIVO_INTERROMPIDO = 'interrompido';

export interface RegistroMensagemWhatsapp {
  messageId: string;
  grupoJid: string | null;
  estado: EstadoMensagemWhatsapp;
  tentativas: number;
  ultimoErro: string | null;
  motivo: string | null;
  atualizadoEm: number;
  payload: unknown;
}

export type DecisaoReservaMensagem =
  | { acao: 'criar' }
  | { acao: 'reprocessar' }
  | { acao: 'ignorar'; motivo: string };

export function decidirReservaMensagem(
  atual: Pick<RegistroMensagemWhatsapp, 'estado' | 'atualizadoEm' | 'tentativas' | 'motivo'> | null,
  agora: number,
  opts?: {
    staleMs?: number;
    maxTentativas?: number;
    recuperacaoAutomatica?: boolean;
    /** No reinício do processo, todo "processando" ficou órfão. */
    recuperarInterrompidos?: boolean;
  },
): DecisaoReservaMensagem {
  const staleMs = opts?.staleMs ?? WHATSAPP_MSG_STALE_MS;
  const maxTentativas = opts?.maxTentativas ?? WHATSAPP_MSG_MAX_TENTATIVAS;
  if (!atual) return { acao: 'criar' };
  if (atual.estado === 'sucesso') {
    return { acao: 'ignorar', motivo: 'Duplicata ignorada: já processada com sucesso' };
  }
  if (atual.tentativas >= maxTentativas && atual.estado !== 'processando') {
    return { acao: 'ignorar', motivo: 'Limite de tentativas atingido' };
  }
  if (atual.estado === 'processando') {
    if (!opts?.recuperarInterrompidos && agora - atual.atualizadoEm < staleMs) {
      return { acao: 'ignorar', motivo: 'Mensagem em processamento' };
    }
    if (atual.tentativas >= maxTentativas) {
      return { acao: 'ignorar', motivo: 'Limite de tentativas atingido' };
    }
    return { acao: 'reprocessar' };
  }
  if (opts?.recuperacaoAutomatica && atual.motivo === MOTIVO_GRUPO_NAO_MAPEADO) {
    return { acao: 'ignorar', motivo: 'Grupo não configurado: aguarda novo envio' };
  }
  return { acao: 'reprocessar' };
}

/**
 * Depois de um pull/restart: uma tentativa nova no máximo.
 * A partir da segunda, abandona e avisa uma vez. Interrompida não entra de novo.
 */
export function decidirRetomadaAposQueda(
  tentativas: number,
  motivo: string | null,
): 'retomar' | 'abandonar' | 'ignorar' {
  if (motivo === MOTIVO_INTERROMPIDO || motivo === MOTIVO_GRUPO_NAO_MAPEADO) return 'ignorar';
  if (tentativas >= 2) return 'abandonar';
  return 'retomar';
}

export function textoGrupoNaoConfigurado(): string {
  return '⚠️ Este grupo não está configurado no Sistemma. Mapeie o grupo em WhatsApp → Grupos e reenvie a planilha.';
}

export function textoFalhaImportacao(detalhe: string): string {
  const msg = String(detalhe || 'erro desconhecido').replace(/\s+/g, ' ').slice(0, 400);
  return `❌ Não foi possível importar a planilha: ${msg}`;
}

export function codigoFalhaMensagem(motivo?: string): string | null {
  const texto = String(motivo || '');
  if (texto.startsWith('Grupo não mapeado')) return MOTIVO_GRUPO_NAO_MAPEADO;
  if (texto.startsWith('Serviço do mapeamento')) return 'servico_nao_encontrado';
  if (texto.includes('WuzAPI não configurada')) return 'wuzapi_nao_configurada';
  return null;
}

type Memoria = Map<string, RegistroMensagemWhatsapp>;

const memoriaGlobal: Memoria = new Map();
let persistenciaAusenteAvisada = false;
let usarMemoria = false;
let filaMemoria: Promise<unknown> = Promise.resolve();

function emFila<T>(fn: () => Promise<T>): Promise<T> {
  const run = filaMemoria.then(fn, fn);
  filaMemoria = run.then(() => undefined, () => undefined);
  return run;
}

export interface ReservarMensagemInput {
  messageId: string;
  grupoJid?: string | null;
  payload?: unknown;
  recuperacaoAutomatica?: boolean;
  recuperarInterrompidos?: boolean;
  agora?: number;
}

export interface ResultadoReservaMensagem {
  acao: 'processar' | 'ignorar';
  motivo?: string;
  persistente: boolean;
}

function registroMemoria(messageId: string): RegistroMensagemWhatsapp | null {
  return memoriaGlobal.get(messageId) || null;
}

async function reservarNaMemoria(input: ReservarMensagemInput): Promise<ResultadoReservaMensagem> {
  const agora = input.agora ?? Date.now();
  const atual = registroMemoria(input.messageId);
  const decisao = decidirReservaMensagem(atual, agora, {
    recuperacaoAutomatica: input.recuperacaoAutomatica,
    recuperarInterrompidos: input.recuperarInterrompidos,
  });
  if (decisao.acao === 'ignorar') {
    return { acao: 'ignorar', motivo: decisao.motivo, persistente: false };
  }
  const registro: RegistroMensagemWhatsapp = {
    messageId: input.messageId,
    grupoJid: input.grupoJid || atual?.grupoJid || null,
    estado: 'processando',
    tentativas: (atual?.tentativas || 0) + 1,
    ultimoErro: null,
    motivo: null,
    atualizadoEm: agora,
    payload: input.payload ?? atual?.payload ?? null,
  };
  memoriaGlobal.set(input.messageId, registro);
  return { acao: 'processar', persistente: false };
}

function tabelaAusente(err: unknown): boolean {
  const codigo = (err as { code?: string })?.code;
  const msg = String((err as { message?: string })?.message || err || '');
  return codigo === '42P01' || /whatsapp_mensagem_processamento/i.test(msg) && /does not exist|não existe/i.test(msg);
}

function avisarPersistenciaAusente(): void {
  if (persistenciaAusenteAvisada) return;
  persistenciaAusenteAvisada = true;
  usarMemoria = true;
  console.warn(
    '[WhatsappLedger] Tabela whatsapp_mensagem_processamento ausente. '
    + 'Deduplicação ficou só na memória deste processo. '
    + 'O script backend/scripts/migrate_whatsapp_mensagem_processamento.sql foi preparado e não foi aplicado.',
  );
}

function linhaParaRegistro(row: Record<string, unknown>): RegistroMensagemWhatsapp {
  const atualizado = row.atualizadoEm instanceof Date
    ? row.atualizadoEm.getTime()
    : new Date(String(row.atualizadoEm || Date.now())).getTime();
  return {
    messageId: String(row.messageId),
    grupoJid: row.grupoJid ? String(row.grupoJid) : null,
    estado: String(row.estado) as EstadoMensagemWhatsapp,
    tentativas: Number(row.tentativas || 1),
    ultimoErro: row.ultimoErro ? String(row.ultimoErro) : null,
    motivo: row.motivo ? String(row.motivo) : null,
    atualizadoEm: atualizado,
    payload: row.payload ?? null,
  };
}

async function reservarNoPostgres(input: ReservarMensagemInput): Promise<ResultadoReservaMensagem> {
  const agora = input.agora ?? Date.now();
  return AppDataSource.transaction(async (manager) => {
    await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1)::bigint)`, [input.messageId]);
    const rows = await manager.query(
      `SELECT "messageId", "grupoJid", estado, tentativas, "ultimoErro", motivo, "atualizadoEm", payload
       FROM whatsapp_mensagem_processamento
       WHERE "messageId" = $1
       FOR UPDATE`,
      [input.messageId],
    );
    const atual = rows?.[0] ? linhaParaRegistro(rows[0]) : null;
    const decisao = decidirReservaMensagem(atual, agora, {
      recuperacaoAutomatica: input.recuperacaoAutomatica,
      recuperarInterrompidos: input.recuperarInterrompidos,
    });
    if (decisao.acao === 'ignorar') {
      return { acao: 'ignorar', motivo: decisao.motivo, persistente: true };
    }
    const tentativas = (atual?.tentativas || 0) + 1;
    if (!atual) {
      await manager.query(
        `INSERT INTO whatsapp_mensagem_processamento
          (id, "messageId", "grupoJid", estado, tentativas, "ultimoErro", motivo, payload, "criadoEm", "atualizadoEm")
         VALUES ($1, $2, $3, 'processando', 1, NULL, NULL, $4::jsonb, now(), now())`,
        [randomUUID(), input.messageId, input.grupoJid || null, JSON.stringify(input.payload ?? null)],
      );
    } else {
      await manager.query(
        `UPDATE whatsapp_mensagem_processamento
         SET estado = 'processando',
             tentativas = $2,
             "grupoJid" = COALESCE($3, "grupoJid"),
             payload = COALESCE($4::jsonb, payload),
             "ultimoErro" = NULL,
             motivo = NULL,
             "atualizadoEm" = now()
         WHERE "messageId" = $1`,
        [input.messageId, tentativas, input.grupoJid || null, input.payload == null ? null : JSON.stringify(input.payload)],
      );
    }
    return { acao: 'processar', persistente: true };
  });
}

export async function reservarMensagemWhatsapp(input: ReservarMensagemInput): Promise<ResultadoReservaMensagem> {
  if (!input.messageId) return { acao: 'processar', persistente: false };
  if (usarMemoria) return emFila(() => reservarNaMemoria(input));
  try {
    return await reservarNoPostgres(input);
  } catch (err) {
    if (tabelaAusente(err)) {
      avisarPersistenciaAusente();
      return reservarNaMemoria(input);
    }
    throw err;
  }
}

async function atualizarEstado(
  messageId: string,
  estado: EstadoMensagemWhatsapp,
  erro: string | null,
  motivo: string | null,
): Promise<void> {
  if (!messageId) return;
  if (usarMemoria || memoriaGlobal.has(messageId)) {
    const atual = memoriaGlobal.get(messageId);
    if (atual && !usarMemoria) {
      /* também persiste abaixo quando a tabela existe */
    } else if (atual || usarMemoria) {
      const base = atual || {
        messageId,
        grupoJid: null,
        tentativas: 1,
        payload: null,
        atualizadoEm: Date.now(),
        estado,
        ultimoErro: erro,
        motivo,
      };
      memoriaGlobal.set(messageId, {
        ...base,
        estado,
        ultimoErro: erro,
        motivo,
        atualizadoEm: Date.now(),
      });
      if (usarMemoria) return;
    }
  }
  try {
    await AppDataSource.query(
      `UPDATE whatsapp_mensagem_processamento
       SET estado = $2, "ultimoErro" = $3, motivo = $4, "atualizadoEm" = now()
       WHERE "messageId" = $1`,
      [messageId, estado, erro, motivo],
    );
  } catch (err) {
    if (tabelaAusente(err)) {
      avisarPersistenciaAusente();
      const atual = memoriaGlobal.get(messageId);
      if (atual) {
        memoriaGlobal.set(messageId, {
          ...atual,
          estado,
          ultimoErro: erro,
          motivo,
          atualizadoEm: Date.now(),
        });
      }
      return;
    }
    console.error('[WhatsappLedger] Falha ao atualizar estado:', (err as Error)?.message || err);
  }
}

export async function marcarSucessoMensagemWhatsapp(messageId: string, motivo?: string | null): Promise<void> {
  await atualizarEstado(messageId, 'sucesso', null, motivo || null);
}

export async function marcarFalhaMensagemWhatsapp(
  messageId: string,
  erro: string,
  motivo?: string | null,
): Promise<void> {
  await atualizarEstado(messageId, 'falha', erro, motivo || 'erro_processamento');
}

export async function listarMensagensRecuperaveis(limite = 20): Promise<RegistroMensagemWhatsapp[]> {
  if (usarMemoria) {
    const agora = Date.now();
    return [...memoriaGlobal.values()].filter((item) => {
      if (decidirRetomadaAposQueda(item.tentativas, item.motivo) === 'ignorar') return false;
      const decisao = decidirReservaMensagem(item, agora, {
        recuperacaoAutomatica: true,
        recuperarInterrompidos: true,
      });
      return decisao.acao === 'reprocessar';
    }).slice(0, limite);
  }
  try {
    const rows = await AppDataSource.query(
      `SELECT "messageId", "grupoJid", estado, tentativas, "ultimoErro", motivo, "atualizadoEm", payload
       FROM whatsapp_mensagem_processamento
       WHERE tentativas < $1
         AND COALESCE(motivo, '') <> $2
         AND COALESCE(motivo, '') <> $3
         AND (
           estado = 'processando'
           OR estado = 'falha'
         )
       ORDER BY "atualizadoEm" ASC
       LIMIT $4`,
      [WHATSAPP_MSG_MAX_TENTATIVAS, MOTIVO_GRUPO_NAO_MAPEADO, MOTIVO_INTERROMPIDO, limite],
    );
    return (rows || []).map((row: Record<string, unknown>) => linhaParaRegistro(row));
  } catch (err) {
    if (tabelaAusente(err)) {
      avisarPersistenciaAusente();
      return [];
    }
    throw err;
  }
}

/** Só para testes. */
export function _resetLedgerMemoriaParaTeste(): void {
  memoriaGlobal.clear();
  usarMemoria = true;
  persistenciaAusenteAvisada = true;
}

export function _lerLedgerMemoriaParaTeste(messageId: string): RegistroMensagemWhatsapp | null {
  return memoriaGlobal.get(messageId) || null;
}
