import { normalizarPlaca } from './normalizarPlaca';

export interface ConfigOperacionalContrato {
  placasReserva?: string[];
  placasAtivas?: string[];
  motoristas?: string[];
  coletores?: string[];
  pesoMaximoKg?: { MINI?: number; TOCO?: number; BASCULANTE?: number; TRUCK?: number };
  volumeL?: { MINI?: number; TOCO?: number; BASCULANTE?: number; TRUCK?: number };
  /** Densidade do resíduo (kg/L) padrão do contrato (fallback). */
  densidadeResiduoKgL?: number | null;
  /** Densidade (kg/L) por tipo de caminhão. */
  densidadeKgL?: { MINI?: number; TOCO?: number; BASCULANTE?: number; TRUCK?: number };
  /** Densidade (kg/L) por placa — override do tipo/global. */
  densidadeKgLPorPlaca?: Record<string, number>;
  /**
   * Pasta onde salvar a última planilha ao fechar o ciclo.
   * Caminho relativo ao processo, ex.: `planilhas-ciclo/NomeDoContrato`.
   */
  pastaBackupPlanilhas?: string | null;
}

const VALORES_IGNORADOS = new Set([
  '', '-', '--', 'N/A', 'NA', 'N/D', 'ND', '0', 'SEM', 'S/N', 'SN',
  'NULL', 'NONE', 'VAGO', 'VAZIO',
]);

/** Normaliza nome de motorista/coletor para comparação */
export function normalizarNomeOperacional(valor: unknown): string | null {
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

export function normalizarListaPlacasAtivas(raw: unknown): string[] {
  if (!raw || !Array.isArray(raw)) return [];
  return [...new Set(raw.map((v) => normalizarPlaca(String(v))).filter(Boolean))];
}

export function normalizarListaNomesOperacionais(raw: unknown): string[] {
  if (!raw || !Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    const norm = normalizarNomeOperacional(item);
    if (norm) out.push(norm);
  }
  return [...new Set(out)];
}

export function parseListaTexto(texto: string): string[] {
  return texto
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseListaNomesTexto(texto: string): string[] {
  return normalizarListaNomesOperacionais(parseListaTexto(texto));
}

export function parseListaPlacasTexto(texto: string): string[] {
  return normalizarListaPlacasAtivas(parseListaTexto(texto));
}

export function listaParaTexto(lista: string[]): string {
  return lista.join('\n');
}

export function extrairCadastroOperacional(
  config: ConfigOperacionalContrato | null | undefined,
): ConfigOperacionalContrato | null {
  const placasAtivas = normalizarListaPlacasAtivas(config?.placasAtivas);
  const motoristas = normalizarListaNomesOperacionais(config?.motoristas);
  const coletores = normalizarListaNomesOperacionais(config?.coletores);
  if (placasAtivas.length === 0 && motoristas.length === 0 && coletores.length === 0) {
    return null;
  }
  return { placasAtivas, motoristas, coletores };
}

export function cadastroOperacionalTemDados(
  config: ConfigOperacionalContrato | null | undefined,
): boolean {
  return extrairCadastroOperacional(config) !== null;
}
