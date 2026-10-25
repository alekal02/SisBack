export const TIPOS_CAMINHAO_ORDEM = ['MINI', 'TOCO', 'BASCULANTE', 'TRUCK'] as const;

export type TipoCaminhaoPeso = typeof TIPOS_CAMINHAO_ORDEM[number];

export const PESO_MAX_KG_PADRAO: Record<TipoCaminhaoPeso, number> = {
  MINI: 5000,
  TOCO: 12000,
  BASCULANTE: 14000,
  TRUCK: 16000,
};

/** Volume útil da caixa por tipo (litros) — base do cálculo de caixa média da frota. */
export const VOLUME_L_PADRAO: Record<TipoCaminhaoPeso, number> = {
  MINI: 6000,
  TOCO: 15000,
  BASCULANTE: 17000,
  TRUCK: 19000,
};

export const CHAVE_VALOR_POR_TIPO: Record<TipoCaminhaoPeso, string> = {
  MINI: 'VALOR_MINI',
  TRUCK: 'VALOR_TRUCK',
  TOCO: 'VALOR_TOCO',
  BASCULANTE: 'VALOR_BASCULANTE',
};

export function normalizarTipoCaminhaoPeso(raw: string | null | undefined): TipoCaminhaoPeso | null {
  const t = String(raw || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

  if (!t) return null;
  if (t.includes('MINI')) return 'MINI';
  if (t.includes('TRUCK') || t.includes('TRUQUE') || t.includes('TRUCAD')) return 'TRUCK';
  if (t.includes('BASCULANTE') || t.includes('BASCULANTO')) return 'BASCULANTE';
  if (t.includes('TOCO')) return 'TOCO';
  return null;
}

/** Normaliza texto da planilha para MINI | TRUCK | TOCO | BASCULANTE. */
export function normalizarTextoTipoCaminhao(raw: string | null | undefined): string | null {
  if (!raw || !String(raw).trim()) return null;
  const norm = normalizarTipoCaminhaoPeso(raw);
  if (norm) return norm;
  return String(raw).trim();
}

export interface LimitesPesoKg extends Record<TipoCaminhaoPeso, number> {}

export function criarContagemZeraTipos(): Record<TipoCaminhaoPeso, number> {
  return { MINI: 0, TOCO: 0, BASCULANTE: 0, TRUCK: 0 };
}

export function somarContagemTipos(contagem: Record<TipoCaminhaoPeso, number>): number {
  return TIPOS_CAMINHAO_ORDEM.reduce((s, t) => s + (contagem[t] || 0), 0);
}

export function resolverLimitesPesoKg(overrides?: Partial<LimitesPesoKg> | null): LimitesPesoKg {
  return {
    MINI: overrides?.MINI && overrides.MINI > 0 ? overrides.MINI : PESO_MAX_KG_PADRAO.MINI,
    TOCO: overrides?.TOCO && overrides.TOCO > 0 ? overrides.TOCO : PESO_MAX_KG_PADRAO.TOCO,
    BASCULANTE: overrides?.BASCULANTE && overrides.BASCULANTE > 0
      ? overrides.BASCULANTE
      : PESO_MAX_KG_PADRAO.BASCULANTE,
    TRUCK: overrides?.TRUCK && overrides.TRUCK > 0 ? overrides.TRUCK : PESO_MAX_KG_PADRAO.TRUCK,
  };
}

export type LimitesVolumeL = LimitesPesoKg;

export function resolverLimitesVolumeL(overrides?: Partial<LimitesVolumeL> | null): LimitesVolumeL {
  return {
    MINI: overrides?.MINI && overrides.MINI > 0 ? overrides.MINI : VOLUME_L_PADRAO.MINI,
    TOCO: overrides?.TOCO && overrides.TOCO > 0 ? overrides.TOCO : VOLUME_L_PADRAO.TOCO,
    BASCULANTE: overrides?.BASCULANTE && overrides.BASCULANTE > 0
      ? overrides.BASCULANTE
      : VOLUME_L_PADRAO.BASCULANTE,
    TRUCK: overrides?.TRUCK && overrides.TRUCK > 0 ? overrides.TRUCK : VOLUME_L_PADRAO.TRUCK,
  };
}

export function limiteParaTipo(tipo: TipoCaminhaoPeso | null, limites: LimitesPesoKg): number {
  if (!tipo) return limites.TRUCK;
  return limites[tipo];
}

export function resolverValorUnitarioPorTipo(
  tipoRaw: string,
  valoresFixos: Record<string, number>,
  fallbackTonelada = 0,
): number {
  const tipo = normalizarTipoCaminhaoPeso(tipoRaw);
  if (tipo) {
    const chave = CHAVE_VALOR_POR_TIPO[tipo];
    const especifico = valoresFixos[chave];
    if (especifico !== undefined && especifico > 0) return especifico;
  }
  const geral = valoresFixos['VALOR_TONELADA'];
  if (geral !== undefined && geral > 0) return geral;
  return fallbackTonelada;
}

/** Extrai overrides parciais de um mapa { MINI, TOCO, BASCULANTE, TRUCK }. */
export function extrairOverridesLimites(
  raw: unknown,
): Partial<LimitesPesoKg> | null {
  if (!raw || typeof raw !== 'object') return null;
  const cfg = raw as Record<string, unknown>;
  const out: Partial<LimitesPesoKg> = {};
  for (const tipo of TIPOS_CAMINHAO_ORDEM) {
    const n = Number(cfg[tipo]);
    if (!Number.isNaN(n) && n > 0) out[tipo] = n;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Limites de peso/volume do contrato (configOperacional) com fallback aos padrões.
 * Usado na análise de peso, caixa média e sobrecarga.
 */
export function resolverLimitesDoContrato(configOperacional?: {
  pesoMaximoKg?: Partial<LimitesPesoKg> | null;
  volumeL?: Partial<LimitesVolumeL> | null;
} | null): { peso: LimitesPesoKg; volume: LimitesVolumeL } {
  return {
    peso: resolverLimitesPesoKg(extrairOverridesLimites(configOperacional?.pesoMaximoKg)),
    volume: resolverLimitesVolumeL(extrairOverridesLimites(configOperacional?.volumeL)),
  };
}

/** Normaliza mapa de limites para gravar no contrato (só valores > 0). */
export function normalizarMapaLimitesContrato(raw: unknown): Partial<LimitesPesoKg> | undefined {
  if (raw === null) return undefined;
  if (raw === undefined) return undefined;
  const out = extrairOverridesLimites(raw);
  return out ?? {};
}
