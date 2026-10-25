/**
 * Escopo da estratégia atualizar_data / substituir nas planilhas de produção.
 * Um lançamento é da importação anterior somente quando está ligado a um upload
 * aberto do mesmo serviço, numa data que a planilha nova vai repor.
 */
import type { EntityManager, QueryRunner } from 'typeorm';

export type EstrategiaPlanilha = 'ignorar' | 'substituir' | 'atualizar_data' | 'inserir_data' | string;

export interface RegistroImportacao {
  servicoId: string;
  planilhaUploadId: number | null;
  cicloFechado: boolean;
  dataIso: string;
}

export function estrategiaSubstituiDatasProducao(estrategia: EstrategiaPlanilha | null | undefined): boolean {
  return estrategia === 'substituir' || estrategia === 'atualizar_data';
}

/**
 * Verdadeiro só para linha de planilha já importada, no mesmo serviço,
 * em upload de ciclo aberto e numa data presente na reposição.
 * Sem upload (lançamento sem planilha), outro serviço ou ciclo fechado ficam de fora.
 */
export function registroPertenceAImportacaoAnterior(
  registro: RegistroImportacao,
  alvo: { servicoId: string; datas: ReadonlySet<string> },
): boolean {
  if (registro.planilhaUploadId == null) return false;
  if (registro.servicoId !== alvo.servicoId) return false;
  if (registro.cicloFechado) return false;
  if (!alvo.datas.has(registro.dataIso)) return false;
  return true;
}

export function chaveLockImportacaoServico(servicoId: string): string {
  return `importacao-producao:${servicoId}`;
}

export interface RunnerImportacao {
  connect(): Promise<void>;
  startTransaction(): Promise<void>;
  commitTransaction(): Promise<void>;
  rollbackTransaction(): Promise<void>;
  release(): Promise<void>;
  query(sql: string, params?: unknown[]): Promise<unknown>;
  manager: EntityManager;
}

function runnerPadrao(): RunnerImportacao {
  // Carrega o DataSource só quando a importação real roda.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const AppDataSource = require('../database/data-source').default;
  return AppDataSource.createQueryRunner() as QueryRunner;
}

/**
 * Apaga as datas e grava o novo lote na mesma transação.
 * O lock é da transação: o segundo upload do mesmo serviço espera e não duplica.
 * Qualquer erro desfaz a exclusão e a inclusão.
 */
export async function executarImportacaoAtomica<T>(
  servicoId: string,
  trabalho: (manager: EntityManager) => Promise<T>,
  criarRunner: () => RunnerImportacao = runnerPadrao,
): Promise<T> {
  const qr = criarRunner();
  await qr.connect();
  await qr.startTransaction();
  try {
    await qr.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [
      chaveLockImportacaoServico(servicoId),
    ]);
    const resultado = await trabalho(qr.manager);
    await qr.commitTransaction();
    return resultado;
  } catch (err) {
    await qr.rollbackTransaction();
    throw err;
  } finally {
    await qr.release();
  }
}
