/**
 * Escala operacional vs peso ideal (mesmo critério do frontend).
 * <50% péssimo · 50–90% ruim · 90–110% ótimo · 110–120% ruim · >120% péssimo
 */
import {
  resolverLimitesVolumeL,
  type LimitesVolumeL,
  type TipoCaminhaoPeso,
} from '../../config/pesoMaximoCaminhao';
import {
  DENSIDADE_OTIMA_PADRAO,
  normalizarDensidadeResiduoKgL,
} from '../analisePesoColetaService';
import { normalizarPlaca } from '../../utils/normalizarPlaca';

export const PCT_PESSIMO_BAIXO = 50;
export const PCT_IDEAL_MIN = 90;
export const PCT_IDEAL_MAX = 110;
export const PCT_PESSIMO_ALTO = 120;
export const PCT_MARGEM_IDEAL = 10;

export type FaixaIdealViagem =
  | 'pessimo_baixo'
  | 'ruim_baixo'
  | 'otimo'
  | 'ruim_alto'
  | 'pessimo_alto';

export type NotaIdealViagem = 'pessimo' | 'ruim' | 'otimo';

export const LABEL_FAIXA_IDEAL: Record<FaixaIdealViagem, string> = {
  pessimo_baixo: 'Péssimo (muito baixo)',
  ruim_baixo: 'Ruim (baixo)',
  otimo: 'Ótimo',
  ruim_alto: 'Ruim (excesso)',
  pessimo_alto: 'Péssimo (excesso crítico)',
};

export const LABEL_NOTA_IDEAL: Record<NotaIdealViagem, string> = {
  pessimo: 'Péssimo',
  ruim: 'Ruim',
  otimo: 'Ótimo',
};

export const COR_NOTA_IDEAL: Record<NotaIdealViagem, string> = {
  pessimo: '#b91c1c',
  ruim: '#ea580c',
  otimo: '#16a34a',
};

export const LABEL_TIPO_CAMINHAO: Record<TipoCaminhaoPeso, string> = {
  MINI: 'Mini',
  TOCO: 'Toco',
  BASCULANTE: 'Basculante',
  TRUCK: 'Truck',
};

export function classificarPctIdeal(pctIdeal: number): FaixaIdealViagem {
  if (pctIdeal < PCT_PESSIMO_BAIXO) return 'pessimo_baixo';
  if (pctIdeal < PCT_IDEAL_MIN) return 'ruim_baixo';
  if (pctIdeal <= PCT_IDEAL_MAX) return 'otimo';
  if (pctIdeal <= PCT_PESSIMO_ALTO) return 'ruim_alto';
  return 'pessimo_alto';
}

export function notaDaFaixaIdeal(faixa: FaixaIdealViagem): NotaIdealViagem {
  if (faixa === 'otimo') return 'otimo';
  if (faixa === 'pessimo_baixo' || faixa === 'pessimo_alto') return 'pessimo';
  return 'ruim';
}

export function classificarPesoVsIdeal(
  pesoKg: number,
  pesoIdealKg: number,
): { pctIdeal: number; faixa: FaixaIdealViagem; nota: NotaIdealViagem } {
  const pctIdeal = Math.round((pesoKg / pesoIdealKg) * 1000) / 10;
  const faixa = classificarPctIdeal(pctIdeal);
  return { pctIdeal, faixa, nota: notaDaFaixaIdeal(faixa) };
}

export function calcularPesoIdealKg(volumeL: number, densidadeKgL: number): number {
  if (!(volumeL > 0) || !(densidadeKgL > 0)) return 0;
  return Math.round(volumeL * densidadeKgL);
}

export type DensidadeResiduoInput =
  | number
  | null
  | undefined
  | Partial<Record<TipoCaminhaoPeso, number>>
  | {
      global?: number | null;
      porTipo?: Partial<Record<TipoCaminhaoPeso, number>> | null;
    };

function extrairDensidadeInput(raw?: DensidadeResiduoInput): {
  global: number | null;
  porTipo: Partial<Record<TipoCaminhaoPeso, number>> | null;
} {
  if (raw == null) return { global: null, porTipo: null };
  if (typeof raw === 'number') return { global: raw, porTipo: null };
  if (typeof raw === 'object' && ('global' in raw || 'porTipo' in raw)) {
    return {
      global: (raw as { global?: number | null }).global ?? null,
      porTipo: (raw as { porTipo?: Partial<Record<TipoCaminhaoPeso, number>> | null }).porTipo ?? null,
    };
  }
  return { global: null, porTipo: raw as Partial<Record<TipoCaminhaoPeso, number>> };
}

export function resolverDensidadePorTipo(
  tipo: TipoCaminhaoPeso,
  densidade?: DensidadeResiduoInput,
): number {
  const { global, porTipo } = extrairDensidadeInput(densidade);
  return (
    normalizarDensidadeResiduoKgL(porTipo?.[tipo])
    ?? normalizarDensidadeResiduoKgL(global)
    ?? DENSIDADE_OTIMA_PADRAO
  );
}

export function resolverDensidadesKgL(
  densidade?: DensidadeResiduoInput,
): Record<TipoCaminhaoPeso, number> {
  return {
    MINI: resolverDensidadePorTipo('MINI', densidade),
    TOCO: resolverDensidadePorTipo('TOCO', densidade),
    BASCULANTE: resolverDensidadePorTipo('BASCULANTE', densidade),
    TRUCK: resolverDensidadePorTipo('TRUCK', densidade),
  };
}

export function densidadeOptsToInput(opts?: {
  densidadeResiduoKgL?: number | null;
  densidadeKgL?: Partial<Record<TipoCaminhaoPeso, number>> | null;
} | null): DensidadeResiduoInput {
  return {
    global: opts?.densidadeResiduoKgL ?? null,
    porTipo: opts?.densidadeKgL ?? null,
  };
}

/**
 * Densidade efetiva da viagem/placa:
 * densidadeKgLPorPlaca[placa] → densidade do tipo → global → 0,55.
 */
export function resolverDensidadeParaViagem(opts: {
  placa?: string | null;
  tipo?: TipoCaminhaoPeso | null;
  densidade?: DensidadeResiduoInput;
  porPlaca?: Record<string, number> | null;
}): number {
  const placa = normalizarPlaca(opts.placa);
  if (placa && opts.porPlaca) {
    const densPlaca =
      normalizarDensidadeResiduoKgL(opts.porPlaca[placa])
      ?? normalizarDensidadeResiduoKgL(
        Object.entries(opts.porPlaca).find(([k]) => normalizarPlaca(k) === placa)?.[1],
      );
    if (densPlaca != null) return densPlaca;
  }
  if (opts.tipo) return resolverDensidadePorTipo(opts.tipo, opts.densidade);
  const { global } = extrairDensidadeInput(opts.densidade);
  return normalizarDensidadeResiduoKgL(global) ?? DENSIDADE_OTIMA_PADRAO;
}

/** Peso ideal (kg) da viagem: volume do tipo × densidade efetiva (placa/tipo/global). */
export function calcularPesoIdealViagem(opts: {
  placa?: string | null;
  tipo?: TipoCaminhaoPeso | null;
  volumeOverrides?: Partial<LimitesVolumeL> | null;
  densidade?: DensidadeResiduoInput;
  porPlaca?: Record<string, number> | null;
}): number {
  if (!opts.tipo) return 0;
  const volumes = resolverLimitesVolumeL(opts.volumeOverrides);
  const dens = resolverDensidadeParaViagem(opts);
  return calcularPesoIdealKg(volumes[opts.tipo], dens);
}

export function resolverPesosIdeaisKg(
  volumeOverrides?: Partial<LimitesVolumeL> | null,
  densidade?: DensidadeResiduoInput,
): Record<TipoCaminhaoPeso, number> {
  const volumes = resolverLimitesVolumeL(volumeOverrides);
  const dens = resolverDensidadesKgL(densidade);
  return {
    MINI: calcularPesoIdealKg(volumes.MINI, dens.MINI),
    TOCO: calcularPesoIdealKg(volumes.TOCO, dens.TOCO),
    BASCULANTE: calcularPesoIdealKg(volumes.BASCULANTE, dens.BASCULANTE),
    TRUCK: calcularPesoIdealKg(volumes.TRUCK, dens.TRUCK),
  };
}

export function textoEscalaIdealCurto(): string {
  return `<${PCT_PESSIMO_BAIXO}% péssimo · ${PCT_PESSIMO_BAIXO}–${PCT_IDEAL_MIN}% ruim · `
    + `${PCT_IDEAL_MIN}–${PCT_IDEAL_MAX}% ótimo · ${PCT_IDEAL_MAX}–${PCT_PESSIMO_ALTO}% ruim · `
    + `>${PCT_PESSIMO_ALTO}% péssimo`;
}

export function pctIdealForaDoOtimo(pctIdeal: number | null | undefined): boolean {
  if (pctIdeal == null || !Number.isFinite(pctIdeal)) return false;
  return classificarPctIdeal(pctIdeal) !== 'otimo';
}

/** Status legado PDF: ótimo→bom, ruim→medio, péssimo→ruim. */
export function statusPctVsMargemIdeal(pctIdeal: number): 'bom' | 'medio' | 'ruim' {
  const nota = notaDaFaixaIdeal(classificarPctIdeal(pctIdeal));
  if (nota === 'otimo') return 'bom';
  if (nota === 'ruim') return 'medio';
  return 'ruim';
}
