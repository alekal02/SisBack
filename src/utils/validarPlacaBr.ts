import { normalizarPlaca } from './normalizarPlaca';

/** Padrão antigo: ABC1234 */
const PLACA_ANTIGA = /^[A-Z]{3}\d{4}$/;

/** Padrão Mercosul: ABC1D23 */
const PLACA_MERCOSUL = /^[A-Z]{3}\d[A-Z]\d{2}$/;

export interface ResultadoValidacaoPlaca {
  valida: boolean;
  normalizada: string;
  /** Texto original da planilha */
  original: string;
  motivo: string | null;
  /** Hífen/espaço removidos — mesma placa, formato diferente */
  precisaNormalizar: boolean;
}

export function validarPlacaBr(raw: string | null | undefined): ResultadoValidacaoPlaca {
  const original = String(raw ?? '').trim();
  if (!original) {
    return { valida: false, normalizada: '', original: '', motivo: 'Placa ausente', precisaNormalizar: false };
  }

  const normalizada = normalizarPlaca(original);
  if (!normalizada) {
    return { valida: false, normalizada: '', original, motivo: 'Placa vazia ou valor ignorado (N/D, —)', precisaNormalizar: false };
  }

  const precisaNormalizar = /[\s.\-/]/.test(original);

  if (/^\d{5,}$/.test(normalizada)) {
    return {
      valida: false,
      normalizada,
      original,
      motivo: 'Valor numérico longo — parece ID, não placa',
      precisaNormalizar,
    };
  }

  if (normalizada.length !== 7) {
    return {
      valida: false,
      normalizada,
      original,
      motivo: `Formato inválido (${normalizada.length} caracteres; esperado 7)`,
      precisaNormalizar,
    };
  }

  if (!PLACA_ANTIGA.test(normalizada) && !PLACA_MERCOSUL.test(normalizada)) {
    return {
      valida: false,
      normalizada,
      original,
      motivo: 'Não confere com ABC1234 (antiga) nem ABC1D23 (Mercosul)',
      precisaNormalizar,
    };
  }

  return { valida: true, normalizada, original, motivo: null, precisaNormalizar };
}

export interface LinhaAuditoriaPlaca {
  linha: number;
  data: string | null;
  placaOriginal: string;
  placaNormalizada: string;
  motivo: string;
}

export interface GrupoPlacaDuplicada {
  placaNormalizada: string;
  variantes: string[];
  linhas: number[];
}

export interface AuditoriaPlacasPlanilha {
  colunaDetectada: string | null;
  totalLinhasComDados: number;
  totalComPlacaValida: number;
  totalSemPlaca: number;
  totalInvalidas: number;
  totalNormalizadas: number;
  invalidas: LinhaAuditoriaPlaca[];
  normalizadas: Array<{ linha: number; original: string; normalizada: string; data: string | null }>;
  gruposDuplicados: GrupoPlacaDuplicada[];
}

export function auditarPlacasPlanilha(opts: {
  cabecalho: string[];
  linhas: unknown[][];
  idxPlaca: number;
  idxData: number;
  parseData: (raw: unknown) => string | null;
  idxKmTotal?: number;
  idxPesoTotal?: number;
  parseNum?: (raw: unknown) => number | null;
}): AuditoriaPlacasPlanilha {
  const colunaDetectada = opts.idxPlaca >= 0 ? opts.cabecalho[opts.idxPlaca] || null : null;
  const invalidas: LinhaAuditoriaPlaca[] = [];
  const normalizadas: AuditoriaPlacasPlanilha['normalizadas'] = [];
  const porNormalizada = new Map<string, { variantes: Set<string>; linhas: number[] }>();

  let totalLinhasComDados = 0;
  let totalComPlacaValida = 0;
  let totalSemPlaca = 0;
  let totalInvalidas = 0;
  let totalNormalizadas = 0;

  for (let i = 0; i < opts.linhas.length; i++) {
    const linha = opts.linhas[i] || [];
    const temAlgumValor = linha.some(v => v !== null && v !== '' && v !== undefined);
    if (!temAlgumValor) continue;

    const bruta = opts.idxPlaca >= 0 ? String(linha[opts.idxPlaca] ?? '').trim() : '';
    if (opts.parseNum) {
      const km = opts.idxKmTotal != null && opts.idxKmTotal >= 0
        ? opts.parseNum(linha[opts.idxKmTotal])
        : null;
      const peso = opts.idxPesoTotal != null && opts.idxPesoTotal >= 0
        ? opts.parseNum(linha[opts.idxPesoTotal])
        : null;
      if (linhaSemDadosOperacionaisMinimos(bruta, km, peso)) continue;
    }

    totalLinhasComDados++;
    const linhaPlanilha = i + 2;
    const data = opts.parseData(opts.idxData >= 0 ? linha[opts.idxData] : null);
    const resultado = validarPlacaBr(bruta);

    if (!resultado.valida) {
      if (resultado.motivo === 'Placa ausente') {
        totalSemPlaca++;
      } else {
        totalInvalidas++;
        invalidas.push({
          linha: linhaPlanilha,
          data,
          placaOriginal: resultado.original || bruta || '—',
          placaNormalizada: resultado.normalizada || '—',
          motivo: resultado.motivo || 'Placa inválida',
        });
      }
      continue;
    }

    totalComPlacaValida++;
    if (resultado.precisaNormalizar) {
      totalNormalizadas++;
      // Não listar linha a linha — correção automática na importação
    }

    const grupo = porNormalizada.get(resultado.normalizada) || { variantes: new Set<string>(), linhas: [] };
    grupo.variantes.add(resultado.original);
    grupo.linhas.push(linhaPlanilha);
    porNormalizada.set(resultado.normalizada, grupo);
  }

  const gruposDuplicados: GrupoPlacaDuplicada[] = [];
  for (const [placaNormalizada, grupo] of porNormalizada) {
    if (grupo.variantes.size <= 1) continue;
    // Mesma placa com/sem hífen ou espaço — unificada na importação, não é alerta
    const normDistintas = new Set([...grupo.variantes].map((v) => normalizarPlaca(v)));
    if (normDistintas.size <= 1) continue;
    gruposDuplicados.push({
      placaNormalizada,
      variantes: [...grupo.variantes].sort(),
      linhas: grupo.linhas,
    });
  }
  gruposDuplicados.sort((a, b) => b.variantes.length - a.variantes.length);

  return {
    colunaDetectada,
    totalLinhasComDados,
    totalComPlacaValida,
    totalSemPlaca,
    totalInvalidas,
    totalNormalizadas,
    invalidas: invalidas.slice(0, 200),
    normalizadas: normalizadas.slice(0, 100),
    gruposDuplicados: gruposDuplicados.slice(0, 50),
  };
}

/** Linha sem placa, KM Total e Peso Total — lixo de planilha; não importa */
export function linhaSemDadosOperacionaisMinimos(
  placaRaw: string | null | undefined,
  kmTotal: number | null | undefined,
  pesoTotal: number | null | undefined,
): boolean {
  const placa = normalizarPlaca(String(placaRaw ?? '').trim());
  const temPlaca = !!placa;
  const temKm = kmTotal != null && !Number.isNaN(kmTotal) && kmTotal > 0;
  const temPeso = pesoTotal != null && !Number.isNaN(pesoTotal) && pesoTotal > 0;
  return !temPlaca && !temKm && !temPeso;
}

export const REGRAS_PLACA_SAUDE = [
  'Placa no padrão ABC1234 ou ABC1D23 (Mercosul)',
  'Com ou sem hífen/espaço (ABC-1234) — o sistema unifica automaticamente na importação',
  'Só aparecem aqui placas realmente inválidas ou ausentes (quando bloqueiam o dashboard)',
] as const;
