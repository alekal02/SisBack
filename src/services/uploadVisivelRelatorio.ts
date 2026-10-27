/**
 * Relatório de produção.
 * Cada linha gravada entra na soma. O distrito cortado em 50 caracteres
 * não junta nem descarta ruas diferentes do mesmo dia.
 */
export interface CandidatoUploadDia {
  uploadId: number;
  criadoEm: number;
  fechado: boolean;
}

export interface LinhaRelatorioProducao extends CandidatoUploadDia {
  dia: string;
  local: string;
  valor: number;
}

export function escolherUploadDoDia(candidatos: CandidatoUploadDia[]): number | null {
  if (candidatos.length === 0) return null;
  const ordenados = [...candidatos].sort((a, b) => {
    if (a.fechado !== b.fechado) return a.fechado ? -1 : 1;
    return b.criadoEm - a.criadoEm;
  });
  return ordenados[0].uploadId;
}

export function normalizarLocalRelatorio(local: string): string {
  return String(local || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

export function linhasVisiveisNoRelatorio(linhas: LinhaRelatorioProducao[]): LinhaRelatorioProducao[] {
  return linhas;
}

export function somarLinhasVisiveis(linhas: LinhaRelatorioProducao[]): number {
  const total = linhasVisiveisNoRelatorio(linhas).reduce((soma, linha) => soma + linha.valor, 0);
  return Math.round(total * 1000) / 1000;
}

/** Não descarta linha. O relatório soma tudo o que está gravado. */
export function sqlSomenteUploadVigenteDoDia(_alias: string): string {
  return 'TRUE';
}
