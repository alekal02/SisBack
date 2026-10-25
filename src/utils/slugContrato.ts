export function slugificarContrato(nome: string): string {
  const base = (nome || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return base || 'contrato';
}

/** Identificador PostgreSQL seguro para CREATE DATABASE (sem interpolar entrada crua). */
export function afirmarNomeBanco(nome: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(nome)) {
    throw new Error(`Nome de banco inválido: ${nome}`);
  }
  return nome;
}

export function nomeBancoContrato(slug: string): string {
  const nome = `contrato_${slug}`.slice(0, 63);
  return afirmarNomeBanco(nome);
}
