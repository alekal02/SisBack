/** Acesso sem senha. Só liga com o valor exato "true"; vazio ou ausente fica desligado. */
export function acessoLivreLigado(env: { ACESSO_LIVRE?: string } = process.env): boolean {
  return env.ACESSO_LIVRE === 'true';
}
