import { normalizarChave } from '../services/FormulaEngine';

/** Limites atuais de coleta_dados. Não altera o schema. */
export const LIMITE_REGIONAL = 50;
export const LIMITE_DISTRITO = 50;

export function limitarTexto(valor: string | null | undefined, max: number): string | null {
  if (valor == null) return null;
  const s = String(valor).trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

export function textoMaisLongo(...valores: unknown[]): string {
  let melhor = '';
  for (const valor of valores) {
    if (valor == null) continue;
    const s = String(valor).trim();
    if (s.length > melhor.length) melhor = s;
  }
  return melhor;
}

/** Lê o valor mais longo entre colunas sinônimas do JSON da planilha. */
export function lerCampoDados(
  dados: Record<string, unknown> | null | undefined,
  nomes: string[],
): string {
  if (!dados) return '';
  const alvo = new Set(nomes.map((nome) => normalizarChave(nome)));
  let melhor = '';
  for (const [chave, valor] of Object.entries(dados)) {
    if (!alvo.has(normalizarChave(chave))) continue;
    if (valor == null) continue;
    const s = String(valor).trim();
    if (s.length > melhor.length) melhor = s;
  }
  return melhor;
}

/**
 * Corta regional/distrito no limite da coluna varchar e guarda o texto
 * completo no JSON, para a deduplicação não juntar locais diferentes.
 */
export function aplicarLimitesTextoColeta(coleta: {
  distrito?: string | null;
  regional?: string | null;
  dados?: Record<string, unknown> | null;
}): void {
  const dados = coleta.dados && typeof coleta.dados === 'object' ? coleta.dados : {};
  coleta.dados = dados;

  if (coleta.distrito && coleta.distrito.length > LIMITE_DISTRITO) {
    const cheio = coleta.distrito;
    dados.DISTRITO_COMPLETO = textoMaisLongo(dados.DISTRITO_COMPLETO, cheio);
    coleta.distrito = cheio.slice(0, LIMITE_DISTRITO);
  }
  if (coleta.regional && coleta.regional.length > LIMITE_REGIONAL) {
    const cheio = coleta.regional;
    dados.LOCAL_COMPLETO = textoMaisLongo(dados.LOCAL_COMPLETO, cheio);
    coleta.regional = cheio.slice(0, LIMITE_REGIONAL);
  }
}
