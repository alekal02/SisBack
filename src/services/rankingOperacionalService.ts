import { encontrarValorColuna } from './FormulaEngine';

export const RANKING_LIMITE_PADRAO = 20;

/** Colunas candidatas para agrupar ranking de rotas (ordem de preferência em empate) */
const CANDIDATOS_COLUNA_ROTA = [
  'DISTRITO', 'BAIRRO', 'SETOR', 'ROTA', 'REGIAO', 'REGIONAL',
  'DESTINO', 'ORIGEM', 'LOCAL', 'LOCALIDADE', 'CIDADE',
  'ROTA/DESTINO', 'DIRETORIA', 'FILIAL',
] as const;

const VALORES_IGNORADOS_ROTA = new Set(['', '-', '--', 'N/D', 'ND', 'N/A', 'NA', '0', 'NULL', 'NONE']);

/** Campos técnicos do banco/entidade — nunca usar como rota/distrito */
const COLUNAS_INTERNAS = new Set([
  'ID', 'UUID', 'SERVICOID', 'SERVICO_ID', 'CONTRACTID', 'CONTRACT_ID',
  'PLANILHAUPLOADID', 'PLANILHA_UPLOAD_ID', 'UPLOADID', 'UPLOAD_ID',
  'CREATEDAT', 'UPDATEDAT', 'VALIDODASHBOARD', 'DADOS', 'VIAGENSPORROTA',
  'NUMEROVIAGENS', 'KMTOTAL', 'PESOTOTAL', 'KMROTA1', 'KMROTA2', 'KMROTA3', 'KMROTA4',
]);

function normalizarChaveColuna(chave: string): string {
  return chave.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
}

function isColunaInterna(chaveNorm: string): boolean {
  if (COLUNAS_INTERNAS.has(chaveNorm)) return true;
  if (/^(KM|HORA|PESO|COLETOR|DATA)/.test(chaveNorm)) return true;
  return false;
}

function colunaCorrespondeCandidatoRota(chaveNorm: string, candidatoNorm: string): boolean {
  if (isColunaInterna(chaveNorm)) return false;
  if (chaveNorm === candidatoNorm) return true;
  // Evita colunas operacionais (KM/HORA ROTA 01, etc.) ao buscar "ROTA"
  if (candidatoNorm === 'ROTA' && /ROTA0?[1-4]|KM|HORA|CHEGADA|SAIDA|SAÍDA/.test(chaveNorm)) return false;
  // Match parcial só quando o nome da coluna contém o candidato inteiro
  // (nunca candidato.includes(coluna) — evita LOCALIDADE ⊃ "id")
  if (chaveNorm.length >= candidatoNorm.length && chaveNorm.includes(candidatoNorm)) return true;
  return false;
}

/** Valores numéricos longos (ex.: PK do banco) não são nomes de distrito/rota */
function pareceColunaIdSequencial(valores: string[]): boolean {
  if (valores.length < 5) return false;
  const numericosLongos = valores.filter((v) => /^\d{5,}$/.test(v));
  return numericosLongos.length / valores.length > 0.85;
}

/**
 * Detecta a melhor coluna para ranking de rotas.
 * Prefere a coluna com mais valores distintos preenchidos (ex.: DISTRITO em vez de REGIONAL única).
 */
export function detectarColunaRankingRotas(dados: Array<Record<string, any>>): string {
  if (!dados?.length) return '';

  const chaves = Object.keys(dados[0]).filter((k) => !k.startsWith('__EMPTY'));
  const colunasEncontradas = new Set<string>();

  for (const chave of chaves) {
    const chaveNorm = normalizarChaveColuna(chave);
    for (const candidato of CANDIDATOS_COLUNA_ROTA) {
      const candNorm = normalizarChaveColuna(candidato);
      if (colunaCorrespondeCandidatoRota(chaveNorm, candNorm)) {
        colunasEncontradas.add(chave);
        break;
      }
    }
  }

  let melhorColuna = '';
  let melhorScore = 0;

  for (const col of colunasEncontradas) {
    const valoresPreenchidos: string[] = [];
    const unicos = new Set<string>();

    for (const registro of dados) {
      const valor = String(encontrarValorColuna(registro, col) || '').trim();
      const norm = valor.toUpperCase();
      if (!valor || VALORES_IGNORADOS_ROTA.has(norm)) continue;
      valoresPreenchidos.push(valor);
      unicos.add(norm);
    }
    if (unicos.size === 0) continue;
    if (pareceColunaIdSequencial(valoresPreenchidos)) continue;

    const idxPreferencia = CANDIDATOS_COLUNA_ROTA.findIndex((c) =>
      colunaCorrespondeCandidatoRota(normalizarChaveColuna(col), normalizarChaveColuna(c)),
    );
    const bonusPreferencia = idxPreferencia >= 0
      ? (CANDIDATOS_COLUNA_ROTA.length - idxPreferencia) * 50_000
      : 0;
    const score = unicos.size * 100 + valoresPreenchidos.length + bonusPreferencia;

    if (score > melhorScore) {
      melhorScore = score;
      melhorColuna = col;
    }
  }

  // Rótulo amigável para exibição (distrito → DISTRITO)
  if (melhorColuna && normalizarChaveColuna(melhorColuna) === 'DISTRITO') {
    return 'DISTRITO';
  }

  return melhorColuna;
}

/** Nome legível da coluna de rota/distrito para exibir na UI */
export function labelColunaRankingRotas(coluna: string): string {
  const norm = normalizarChaveColuna(coluna);
  if (norm === 'DISTRITO' || norm === 'DISTRITOS') return 'Distrito';
  if (norm === 'REGIONAL' || norm === 'REGIAO') return 'Regional';
  if (norm === 'ROTA' || norm === 'ROTAS') return 'Rota';
  return coluna;
}

export interface RankingPar<T> {
  melhores: T[];
  piores: T[];
}

/** Separa top N melhores e piores por métrica numérica (ex.: tonelagem). */
export function separarMelhoresPiores<T>(
  items: T[],
  getScore: (item: T) => number,
  limite = RANKING_LIMITE_PADRAO,
): RankingPar<T> {
  const valid = items.filter((i) => getScore(i) > 0);
  const melhores = [...valid].sort((a, b) => getScore(b) - getScore(a)).slice(0, limite);
  const piores = [...valid].sort((a, b) => getScore(a) - getScore(b)).slice(0, limite);
  return { melhores, piores };
}
