import { EntityManager } from 'typeorm';
import AppDataSource from '../database/data-source';
import { ImportacaoLinhaIgnorada } from '../entities/ImportacaoLinhaIgnorada';

export const MOTIVO_LINHA_IGNORADA = {
  semKmESemPeso: 'sem km e sem peso',
  foraDoCiclo: 'data fora do ciclo',
  dataSuspeita: 'data suspeita',
  repetidaNoArquivo: 'repetida no arquivo',
  semData: 'sem data',
} as const;

export type MotivoLinhaIgnorada = typeof MOTIVO_LINHA_IGNORADA[keyof typeof MOTIVO_LINHA_IGNORADA];

export interface LinhaIgnoradaRegistro {
  linhaExcel: number;
  motivo: string;
}

const MS_DIA = 24 * 60 * 60 * 1000;

/** Mais de 45 dias antes da data mais recente da planilha. */
export function dataSuspeitaAntesDaMaisRecente(
  data: Date,
  dataMaisRecente: Date,
): boolean {
  const diff = (dataMaisRecente.getTime() - data.getTime()) / MS_DIA;
  return diff > 45;
}

export function dataMaisRecente(datas: Array<Date | null | undefined>): Date | null {
  let max: Date | null = null;
  for (const d of datas) {
    if (!d || Number.isNaN(d.getTime())) continue;
    if (!max || d.getTime() > max.getTime()) max = d;
  }
  return max;
}

export async function gravarLinhasIgnoradas(
  planilhaUploadId: number,
  linhas: LinhaIgnoradaRegistro[],
  manager?: EntityManager,
): Promise<void> {
  if (!planilhaUploadId || linhas.length === 0) return;
  const repo = (manager ?? AppDataSource.manager).getRepository(ImportacaoLinhaIgnorada);
  const batch: ImportacaoLinhaIgnorada[] = [];
  for (const linha of linhas) {
    if (!linha.linhaExcel || linha.linhaExcel < 1 || !linha.motivo) continue;
    const row = repo.create({
      planilhaUploadId,
      linhaExcel: linha.linhaExcel,
      motivo: linha.motivo.slice(0, 80),
    });
    batch.push(row);
    if (batch.length >= 500) {
      await repo.save(batch);
      batch.length = 0;
    }
  }
  if (batch.length) await repo.save(batch);
}
