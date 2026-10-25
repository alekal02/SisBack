import { encontrarValorColuna } from './FormulaEngine';
import { normalizarPlaca } from '../utils/normalizarPlaca';

/** Colunas com nome individual do coletor na planilha padrão */
export const COLUNAS_NOME_COLETOR = [
  'COLETOR 01',
  'COLETOR 02',
  'COLETOR 03',
  'COLETOR 04',
] as const;

const VALORES_IGNORADOS = new Set([
  '', '-', '--', 'N/A', 'NA', 'N/D', 'ND', '0', 'SEM', 'S/N', 'SN',
  'NULL', 'NONE', 'VAGO', 'VAZIO',
]);

function normalizarNomeColetor(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  const str = String(valor).trim();
  if (!str) return null;
  const norm = str
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (VALORES_IGNORADOS.has(norm)) return null;
  if (/^\d+$/.test(norm)) return null;
  return norm;
}

function extrairNomesColetorRegistro(registro: Record<string, any>): string[] {
  const nomes: string[] = [];
  for (const col of COLUNAS_NOME_COLETOR) {
    const val = encontrarValorColuna(registro, col);
    const norm = normalizarNomeColetor(val);
    if (norm) nomes.push(norm);
  }

  // Colunas dinâmicas "COLETOR ..." (planilhas com nomes variados)
  for (const [k, v] of Object.entries(registro)) {
    if (v === null || v === undefined) continue;
    const kn = String(k)
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ');
    if (!kn.includes('COLETOR')) continue;
    if (kn.includes('NUMERO') || kn.includes('NDECOLETORES') || kn.includes('N DECOLETORES')) continue;
    if (/COLETOR\s*0[1-4]/.test(kn.replace(/\s/g, ''))) continue;
    const norm = normalizarNomeColetor(v);
    if (norm) nomes.push(norm);
  }

  return [...new Set(nomes)];
}

/**
 * ⭐ Tenta encontrar coluna PLACA ou similar nos dados
 */
function buscarColunaPlaca(dados: Array<Record<string, any>>): string {
  if (!dados?.length) return '';
  const chaves = Object.keys(dados[0]);
  const candidatos = ['PLACA', 'CAMINHAO', 'CAMINHÃO', 'VEICULO', 'VEÍCULO', 'COLETOR', 'COLETORA', 'EQUIPAMENTO'];
  for (const cand of candidatos) {
    const normCand = cand.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
    for (const chave of chaves) {
      const normChave = chave.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
      if (normChave === normCand || normChave.includes(normCand) || normCand.includes(normChave)) return chave;
    }
  }
  return '';
}

/**
 * Conta coletores únicos no período/filtro:
 * - Percorre COLETOR 01–04 em todas as viagens
 * - Mesmo nome em viagens diferentes conta uma única vez
 * - Fallback: média de Nº DE COLETORES por viagem (quando não há nomes em COLETOR 01–04)
 * - ⭐ Novo fallback: PLACA/CAMINHAO/VEICULO quando não há COLETOR 01-04 nem Nº DE COLETORES
 */
export function contarColetoresUnicos(dados: Array<Record<string, any>>): number {
  if (!dados?.length) return 0;

  const unicos = new Set<string>();
  let maxNroColetores = 0;

  for (const registro of dados) {
    for (const nome of extrairNomesColetorRegistro(registro)) {
      unicos.add(nome);
    }
    const nro = Number(encontrarValorColuna(registro, 'Nº DE COLETORES')) || 0;
    if (nro > maxNroColetores) maxNroColetores = Math.round(nro);
  }

  if (unicos.size > 0) return unicos.size;

  // Sem nomes individuais: média de coletores por viagem (não soma total de participações)
  let somaNro = 0;
  let countNro = 0;
  for (const registro of dados) {
    const nro = Number(encontrarValorColuna(registro, 'Nº DE COLETORES')) || 0;
    if (nro > 0) {
      somaNro += nro;
      countNro++;
    }
  }
  if (countNro > 0) return Math.round(somaNro / countNro);

  // ⭐ Fallback: usar PLACA/CAMINHAO/VEICULO como identificador de coletor único
  const colPlaca = buscarColunaPlaca(dados);
  if (colPlaca) {
    const placas = new Set<string>();
    for (const registro of dados) {
      const placa = normalizarPlaca(String(encontrarValorColuna(registro, colPlaca) || ''));
      if (placa) placas.add(placa);
    }
    if (placas.size > 0) return placas.size;
  }

  return maxNroColetores;
}

/** Participações de coletores em uma viagem (Nº DE COLETORES ou nomes COLETOR 01–04). */
export function contarColetoresNoRegistro(registro: Record<string, any>): number {
  const nro = Number(encontrarValorColuna(registro, 'Nº DE COLETORES')) || 0;
  if (nro > 0) return Math.round(nro);
  const nomes = extrairNomesColetorRegistro(registro);
  return nomes.length;
}

export interface RankingColetorItem {
  coletor: string;
  viagens: number;
  tonelagem: number;
  kmTotal: number;
  tonPorViagem: number;
}

/**
 * Agrega métricas por nome de coletor (COLETOR 01–04).
 * Quando há vários coletores na mesma viagem, divide peso/km/viagens proporcionalmente.
 */
export function agregarRankingColetores(
  dados: Array<Record<string, any>>,
  colPeso: string,
  colKm: string,
  contarViagens: (registro: Record<string, any>) => number,
): RankingColetorItem[] {
  if (!dados?.length) return [];

  const map = new Map<string, { viagens: number; pesoTotal: number; kmTotal: number }>();

  for (const registro of dados) {
    const nomes = extrairNomesColetorRegistro(registro);
    if (nomes.length === 0) continue;

    const peso = Number(encontrarValorColuna(registro, colPeso)) || 0;
    const km = Number(encontrarValorColuna(registro, colKm)) || 0;
    const viagensViagem = contarViagens(registro);
    const share = 1 / nomes.length;

    for (const nome of nomes) {
      if (!map.has(nome)) {
        map.set(nome, { viagens: 0, pesoTotal: 0, kmTotal: 0 });
      }
      const entry = map.get(nome)!;
      entry.viagens += viagensViagem * share;
      entry.pesoTotal += peso * share;
      entry.kmTotal += km * share;
    }
  }

  return Array.from(map.entries())
    .map(([coletor, data]) => {
      const tonelagem = Math.round((data.pesoTotal / 1000) * 100) / 100;
      const viagens = Math.round(data.viagens * 100) / 100;
      const tonPorViagem = viagens > 0 ? Math.round((tonelagem / viagens) * 100) / 100 : 0;
      return {
        coletor,
        viagens,
        tonelagem,
        kmTotal: Math.round(data.kmTotal * 100) / 100,
        tonPorViagem,
      };
    })
    .sort((a, b) => b.tonelagem - a.tonelagem);
}

/**
 * Média de toneladas por coletor por viagem (planilha padrão):
 * SUM(PESO TOTAL em ton) ÷ SUM(participações de coletores em cada linha).
 * O mesmo coletor em várias viagens entra no denominador em cada viagem — é média operacional.
 */
export function calcularMediaTonPorColetorViagem(dados: Array<Record<string, any>>): number {
  if (!dados?.length) return 0;

  let somaPesoKg = 0;
  let somaParticipacoes = 0;

  for (const registro of dados) {
    const peso = Number(encontrarValorColuna(registro, 'PESO TOTAL')) || 0;
    const participacoes = contarColetoresNoRegistro(registro);
    somaPesoKg += peso;
    if (participacoes > 0) somaParticipacoes += participacoes;
  }

  if (somaParticipacoes <= 0) return 0;
  return Math.round((somaPesoKg / 1000 / somaParticipacoes) * 100) / 100;
}
