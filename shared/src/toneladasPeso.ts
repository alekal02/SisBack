/**
 * Um dia de coleta de um contrato não chega a 10.000 t.
 * Acima disso o número ainda está em kg (ou kg gravado × 1000).
 */
export const TETO_TONELADAS_POR_DIA = 10_000;

/**
 * Converte soma de PESO TOTAL da planilha (kg) para toneladas do dia.
 * Nunca é média. Se o valor ainda parecer kg (ex.: 25.673 t na tela), divide de novo.
 */
export function toneladasDoPesoKg(pesoTotalKg: number): number {
  const kg = Number(pesoTotalKg);
  if (!Number.isFinite(kg) || kg <= 0) return 0;
  let t = kg / 1000;
  while (t >= TETO_TONELADAS_POR_DIA) {
    t /= 1000;
  }
  return t;
}
