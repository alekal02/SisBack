import { encontrarValorColuna } from './FormulaEngine';
import { normalizarPlaca } from '../utils/normalizarPlaca';

const VALORES_IGNORADOS = new Set([
  '', '-', '--', 'N/A', 'NA', 'N/D', 'ND', '0', 'SEM', 'S/N', 'SN',
  'NULL', 'NONE', 'VAGO', 'VAZIO',
]);

function normalizarTexto(valor: unknown): string | null {
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

function buscarColuna(dados: Array<Record<string, any>>, candidatos: string[]): string {
  if (!dados?.length) return '';
  const chavesVistas = new Set<string>();
  for (const registro of dados) {
    for (const chave of Object.keys(registro)) {
      chavesVistas.add(chave);
    }
  }
  const chaves = [...chavesVistas];
  for (const cand of candidatos) {
    const normCand = cand.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
    for (const chave of chaves) {
      const normChave = chave.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
      if (normChave === normCand || normChave.includes(normCand) || normCand.includes(normChave)) return chave;
    }
  }
  return '';
}

/** Motoristas distintos no período (mesmo nome em várias viagens conta uma vez). */
export function contarMotoristasUnicos(dados: Array<Record<string, any>>): number {
  if (!dados?.length) return 0;
  const col = buscarColuna(dados, ['MOTORISTA', 'NOME MOTORISTA', 'CONDUTOR', 'OPERADOR']);
  if (!col) return 0;

  const unicos = new Set<string>();
  for (const registro of dados) {
    const norm = normalizarTexto(encontrarValorColuna(registro, col));
    if (norm) unicos.add(norm);
  }
  return unicos.size;
}

/** Placas/veículos distintos em operação. */
export function contarPlacasUnicas(dados: Array<Record<string, any>>): number {
  if (!dados?.length) return 0;
  const col = buscarColuna(dados, ['PLACA', 'CAMINHAO', 'CAMINHÃO', 'VEICULO', 'VEÍCULO', 'EQUIPAMENTO']);
  if (!col) return 0;

  const unicos = new Set<string>();
  for (const registro of dados) {
    const placa = normalizarPlaca(String(encontrarValorColuna(registro, col) || ''));
    if (placa) unicos.add(placa);
  }
  return unicos.size;
}

/** Distritos/bairros distintos atendidos no período. */
export function contarDistritosUnicos(dados: Array<Record<string, any>>): number {
  if (!dados?.length) return 0;
  const col = buscarColuna(dados, ['DISTRITO', 'BAIRRO', 'SETOR', 'LOCAL']);
  if (!col) return 0;

  const unicos = new Set<string>();
  for (const registro of dados) {
    const norm = normalizarTexto(encontrarValorColuna(registro, col));
    if (norm) unicos.add(norm);
  }
  return unicos.size;
}
