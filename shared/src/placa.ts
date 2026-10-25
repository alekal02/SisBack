const VALORES_INVALIDOS = new Set([
  '', '-', '--', '—', 'N/D', 'ND', 'N/A', 'NA', 'NULL', 'NONE', 'SEM PLACA', 'SEMPLACA',
]);

function chaveColuna(s: string): string {
  return s.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
}

/** Indica se a coluna representa placa de veículo (não "PLACA BASE" etc.). */
export function colunaEhPlaca(nomeColuna: string): boolean {
  const n = chaveColuna(nomeColuna);
  if (!n || n.includes('BASE')) return false;
  if (n === 'PLACA' || n.startsWith('PLACA')) return true;
  return ['VEICULO', 'CAMINHAO', 'COLETOR', 'CARRO', 'EQUIPAMENTO'].includes(n);
}

/**
 * Canonicaliza placa BR para deduplicação:
 * ABC-1234, abc 1234 e ABC1234 → ABC1234
 */
export function normalizarPlaca(raw: string | null | undefined): string {
  const p = String(raw ?? '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s.\-/]/g, '');

  if (!p || VALORES_INVALIDOS.has(p)) return '';
  return p;
}

export function normalizarPlacaOuNull(raw: string | null | undefined): string | null {
  const p = normalizarPlaca(raw);
  return p || null;
}
