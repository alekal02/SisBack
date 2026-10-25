import { ColetaData } from '../entities/ColetaData';
import { parseNumeroBr } from './FormulaEngine';

/** Limite máximo de quilometragem por rota (regra de negócio) */
export const MAX_KM_ROTA = 200;

/** Acima disso, valor provavelmente é hodômetro — não tratar como km da rota */
const LIMITE_HODOMETRO = 1000;

export interface KmRotaExcesso {
  rota: string;
  km: number;
  origem: string;
}

function normalizarChave(chave: string): string {
  return chave
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '');
}

/** Indica coluna de quilometragem de rota (exclui KM TOTAL e hodômetro base) */
export function isColunaKmRota(nomeColuna: string): boolean {
  const n = normalizarChave(nomeColuna);
  if (!n.includes('KM') || !n.includes('ROTA')) return false;
  if (n.includes('KMTOTAL')) return false;
  if (n.includes('KMSAIDA') && !n.includes('ROTA')) return false;
  if (n.includes('KMCHEGADA') && !n.includes('ROTA')) return false;
  return true;
}

function numeroKm(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  const n = typeof val === 'number' ? val : parseNumeroBr(val);
  return !isNaN(n) && n > 0 ? n : null;
}

function indiceRota(nomeNorm: string): number | null {
  const m = nomeNorm.match(/ROTA0?([1-4])/);
  if (m) return parseInt(m[1], 10);
  if (nomeNorm.endsWith('ROTA1') || nomeNorm.includes('ROTA01')) return 1;
  if (nomeNorm.endsWith('ROTA2') || nomeNorm.includes('ROTA02')) return 2;
  if (nomeNorm.endsWith('ROTA3') || nomeNorm.includes('ROTA03')) return 3;
  if (nomeNorm.endsWith('ROTA4') || nomeNorm.includes('ROTA04')) return 4;
  return null;
}

function pareceKmDistancia(km: number): boolean {
  return km > MAX_KM_ROTA && km < LIMITE_HODOMETRO;
}

/**
 * Extrai excessos de KM por rota em um registro (campos tipados + dados brutos).
 */
export function extrairKmRotasExcessivos(registro: Record<string, any>): KmRotaExcesso[] {
  const excessos: KmRotaExcesso[] = [];
  const vistos = new Set<string>();

  const adicionar = (rota: string, km: number, origem: string) => {
    if (km <= MAX_KM_ROTA) return;
    const chave = `${rota}|${origem}|${km}`;
    if (vistos.has(chave)) return;
    vistos.add(chave);
    excessos.push({ rota, km: Math.round(km * 100) / 100, origem });
  };

  // Campos tipados kmRota1–4
  for (let i = 1; i <= 4; i++) {
    const val = numeroKm(registro[`kmRota${i}`]);
    if (val !== null && pareceKmDistancia(val)) {
      adicionar(`Rota ${String(i).padStart(2, '0')}`, val, `kmRota${i}`);
    }
  }

  // Agrupar colunas brutas por rota
  const porRota: Record<number, { saida?: number; chegada?: number; direto?: number; diretoCol?: string }> = {};

  for (const [chave, valor] of Object.entries(registro)) {
    if (chave === 'dados' && valor && typeof valor === 'object') {
      for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
        processarColuna(k, v, porRota);
      }
      continue;
    }
    processarColuna(chave, valor, porRota);
  }

  function processarColuna(
    nome: string,
    valor: unknown,
    rotas: Record<number, { saida?: number; chegada?: number; direto?: number; diretoCol?: string }>,
  ) {
    if (!isColunaKmRota(nome)) return;
    const n = normalizarChave(nome);
    const rotaIdx = indiceRota(n);
    if (!rotaIdx) return;

    const km = numeroKm(valor);
    if (km === null) return;

    if (!rotas[rotaIdx]) rotas[rotaIdx] = {};

    if (n.includes('SAIDA')) {
      rotas[rotaIdx].saida = km;
    } else if (n.includes('CHEGADA')) {
      rotas[rotaIdx].chegada = km;
    } else if (n.includes('KMROTA') || (n.includes('KM') && n.includes('ROTA'))) {
      rotas[rotaIdx].direto = km;
      rotas[rotaIdx].diretoCol = nome.trim();
    }
  }

  for (const [idxStr, info] of Object.entries(porRota)) {
    const rotaLabel = `Rota ${String(idxStr).padStart(2, '0')}`;

    if (info.saida != null && info.chegada != null && info.chegada >= info.saida) {
      const diff = info.chegada - info.saida;
      // Ignora diferenças enormes (hodômetro) — só distâncias plausíveis de rota
      if (pareceKmDistancia(diff)) {
        adicionar(rotaLabel, diff, 'KM CHEGADA − KM SAÍDA');
      }
      continue;
    }

    if (info.direto != null && pareceKmDistancia(info.direto)) {
      adicionar(rotaLabel, info.direto, info.diretoCol || 'KM ROTA');
    }
  }

  return excessos;
}

/** Registros ColetaData com alguma rota acima do limite */
export function filtrarRegistrosKmRotaExcessivo(registros: ColetaData[]): ColetaData[] {
  return registros.filter(r => {
    const merged = { ...r, ...(r.dados || {}) };
    return extrairKmRotasExcessivos(merged).length > 0;
  });
}

export interface ResultadoPreviewKmRota {
  totalOcorrencias: number;
  registrosAfetados: number;
  detalhes: string[];
}

/** Analisa linhas da planilha (pré-upload) */
export function analisarKmRotaExcessivoPreview(
  cabecalhoLimpo: string[],
  indicesValidos: number[],
  linhas: any[][],
  linhasComDados: number[],
): ResultadoPreviewKmRota {
  const detalhes: string[] = [];
  const linhasAfetadas = new Set<number>();
  let totalOcorrencias = 0;

  for (const i of linhasComDados) {
    const linha = linhas[i];
    const registro: Record<string, any> = {};
    for (let j = 0; j < cabecalhoLimpo.length && j < indicesValidos.length; j++) {
      registro[cabecalhoLimpo[j]] = linha[indicesValidos[j]];
    }
    const excessos = extrairKmRotasExcessivos(registro);
    if (excessos.length === 0) continue;

    linhasAfetadas.add(i);
    totalOcorrencias += excessos.length;

    if (detalhes.length < 8) {
      for (const ex of excessos.slice(0, 2)) {
        detalhes.push(
          `Linha ${i + 2}: ${ex.rota} — ${ex.km.toLocaleString('pt-BR')} km (${ex.origem})`,
        );
      }
    }
  }

  return {
    totalOcorrencias,
    registrosAfetados: linhasAfetadas.size,
    detalhes,
  };
}

export function resumoKmRotaExcesso(registro: ColetaData): Record<string, number> {
  const merged = { ...registro, ...(registro.dados || {}) };
  const excessos = extrairKmRotasExcessivos(merged);
  const resumo: Record<string, number> = {};
  for (const ex of excessos) {
    resumo[`${ex.rota} (${ex.origem})`] = ex.km;
  }
  return resumo;
}
