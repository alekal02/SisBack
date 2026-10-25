/**
 * Localiza coluna da planilha sem colapsar "KM CHEGADA" em "KM CHEGADA ROTA 01"
 * nem "DIA" em "DIA DA SEMANA".
 */
export function normalizarRotuloColuna(chave: string): string {
  return String(chave ?? '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function encontrarChavePlanilha(
  obj: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  if (!obj || typeof obj !== 'object') return null;
  const want = normalizarRotuloColuna(key);
  if (!want) return null;
  const chaves = Object.keys(obj);
  const rotulo = (ch: string) => normalizarRotuloColuna(ch);

  const comValor = (ch: string) => obj[ch] !== undefined && obj[ch] !== null && obj[ch] !== '';

  for (const ch of chaves) {
    if (rotulo(ch) === want && comValor(ch)) return ch;
  }
  for (const ch of chaves) {
    if (rotulo(ch) === want) return ch;
  }

  // KM SAIDA → KM SAIDA BASE (nunca KM SAÍDA ROTA 01)
  const base = `${want} BASE`;
  const bases = chaves.filter((ch) => rotulo(ch) === base);
  if (bases.length === 1) return bases[0];
  const baseComValor = bases.find((ch) => comValor(ch));
  if (baseComValor) return baseComValor;
  if (bases[0]) return bases[0];

  return null;
}
