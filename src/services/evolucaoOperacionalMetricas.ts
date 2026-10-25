/**
 * Faixas operacionais da Evolução Diária (correções da diretoria):
 * tempo até encher por tipo (TOCO/TRUCADO/MINI) com caixa/peso ideal,
 * velocidade (km/h produtivos), ton/km e ton/h (inversos de km/t e h/t).
 */

export type MetricaEvolucaoId =
  | 'peso_ideal'
  | 'tempo_encher'
  | 'velocidade'
  | 'ton_por_km'
  | 'ton_por_hora';

export type FaixaEvolucaoId = string;

export interface DefFaixaEvolucao {
  id: FaixaEvolucaoId;
  label: string;
  cor: string;
  regra: string;
}

export interface DefMetricaEvolucao {
  id: MetricaEvolucaoId;
  label: string;
  descricao: string;
  faixas: DefFaixaEvolucao[];
}

const COR = {
  otimo: '#22c55e',
  bom: '#0ea5e9',
  regular: '#facc15',
  ruim: '#ef4444',
  pessimo: '#b91c1c',
  excedido: '#a855f7',
  risco: '#f97316',
} as const;

/**
 * Limiares de tempo equivalente (h) para encher 100% da caixa — por tipo.
 * Tempo eq. = HR produtiva ÷ (peso / pesoIdeal), pesoIdeal = volume(L)×densidade
 * (mesma base da CAIXA MÉDIA / peso ideal do contrato).
 */
export const LIMIARES_TEMPO_ENCHER = {
  TOCO: { bom: 3.5, regular: 4.5, metaBom: 20, metaRegular: 70, metaRuim: 10 },
  TRUCK: { bom: 3.8, regular: 5.0 },
  MINI: { bom: 1.2, regular: 1.6 },
} as const;

/** Referência diretoria: ~2,35714 t/h ⇔ 1/0,424 h/t (limite regular→ruim). */
export const REF_TON_POR_HORA = 2.35714;

/** Limites ton/km = inverso dos limiares km/t (4 / 6 / 8). */
export const LIMIARES_TON_POR_KM = {
  otimo: 1 / 4,      // > 0,25 t/km  ⇔  < 4 km/t
  bom: 1 / 6,        // > ~0,167     ⇔  < 6 km/t
  regular: 1 / 8,    // > 0,125      ⇔  < 8 km/t
} as const;

export const METRICAS_EVOLUCAO: DefMetricaEvolucao[] = [
  {
    id: 'peso_ideal',
    label: 'Qualidade vs peso ideal',
    descricao: 'Aderência ao peso ideal por viagem (caixa L × densidade)',
    faixas: [
      { id: 'otimo', label: 'Ótimo', cor: COR.otimo, regra: '90–110% do ideal' },
      { id: 'ruim', label: 'Ruim', cor: COR.regular, regra: '50–90% do ideal' },
      { id: 'pessimo', label: 'Péssimo', cor: COR.ruim, regra: 'abaixo de 50%' },
      { id: 'excedido', label: 'Excedido', cor: COR.excedido, regra: 'acima de 110%' },
    ],
  },
  {
    id: 'tempo_encher',
    label: 'Tempo até encher (caixa)',
    descricao:
      'HR produtiva extrapolada para 100% da caixa — peso ideal = volume do tipo × densidade (mesma base da CAIXA MÉDIA)',
    faixas: [
      {
        id: 'bom',
        label: 'Bom',
        cor: COR.bom,
        regra: 'TOCO <3,5h (meta 20%) · TRUCADO <3,8h · MINI <1,2h',
      },
      {
        id: 'regular',
        label: 'Regular',
        cor: COR.regular,
        regra: 'TOCO 3,5–4,5h (meta 70%) · TRUCADO 3,8–5h · MINI 1,2–1,6h',
      },
      {
        id: 'ruim',
        label: 'Ruim',
        cor: COR.ruim,
        regra: 'TOCO >4,5h (meta 10%) · TRUCADO >5h · MINI >1,6h',
      },
    ],
  },
  {
    id: 'velocidade',
    label: 'Velocidade de coleta',
    descricao: 'KM produtivo nas rotas ÷ HR produtiva nas rotas (por viagem)',
    faixas: [
      { id: 'ruim', label: 'Ruim', cor: COR.ruim, regra: '< 5 km/h' },
      { id: 'regular', label: 'Regular', cor: COR.regular, regra: '5–7 km/h' },
      { id: 'bom', label: 'Bom', cor: COR.bom, regra: '7–9 km/h' },
      { id: 'risco', label: 'Risco de acidente', cor: COR.risco, regra: '> 9 km/h' },
    ],
  },
  {
    id: 'ton_por_km',
    label: 'Tonelada / km',
    descricao: 'Toneladas ÷ KM produtivo nas rotas (maior = melhor)',
    faixas: [
      { id: 'otimo', label: 'Ótimo', cor: COR.otimo, regra: '> 0,25 t/km' },
      { id: 'bom', label: 'Bom', cor: COR.bom, regra: '0,17–0,25 t/km' },
      { id: 'regular', label: 'Regular', cor: COR.regular, regra: '0,125–0,17 t/km' },
      { id: 'ruim', label: 'Ruim', cor: COR.ruim, regra: '< 0,125 t/km' },
    ],
  },
  {
    id: 'ton_por_hora',
    label: 'Tonelada / hora',
    descricao:
      `Toneladas ÷ HR produtiva nas rotas (maior = melhor) · ref. ${REF_TON_POR_HORA.toLocaleString('pt-BR', { maximumFractionDigits: 5 })} t/h`,
    faixas: [
      { id: 'bom', label: 'Bom', cor: COR.bom, regra: '> 3,33 t/h' },
      { id: 'regular', label: 'Regular', cor: COR.regular, regra: '2,36–3,33 t/h' },
      { id: 'ruim', label: 'Ruim', cor: COR.ruim, regra: '< 2,36 t/h' },
    ],
  },
];

export function defMetrica(id: MetricaEvolucaoId): DefMetricaEvolucao {
  const d = METRICAS_EVOLUCAO.find((m) => m.id === id);
  if (!d) throw new Error(`Métrica desconhecida: ${id}`);
  return d;
}

export function zeradoFaixas(faixas: DefFaixaEvolucao[]): Record<string, number> {
  return Object.fromEntries(faixas.map((f) => [f.id, 0]));
}

/**
 * Tempo equivalente para encher 100% da caixa (peso ideal do tipo / caixa):
 * horasProd / (peso / pesoIdeal), pesoIdeal = volumeL × densidade.
 */
export function tempoEquivalenteEncher(opts: {
  horasProd: number;
  pesoKg: number;
  volumeL?: number;
  densidadeKgL?: number;
  /** Preferencial: peso ideal já resolvido (caixa/tipo × densidade do contrato). */
  pesoIdealKg?: number;
}): number | null {
  const { horasProd, pesoKg } = opts;
  if (!(horasProd > 0) || !(pesoKg > 0)) return null;

  let pesoIdeal = Number(opts.pesoIdealKg) || 0;
  if (!(pesoIdeal > 0)) {
    const volumeL = Number(opts.volumeL) || 0;
    const densidadeKgL = Number(opts.densidadeKgL) || 0;
    if (!(volumeL > 0) || !(densidadeKgL > 0)) return null;
    pesoIdeal = volumeL * densidadeKgL;
  }
  if (!(pesoIdeal > 0)) return null;

  const fracao = Math.min(1.5, Math.max(0.2, pesoKg / pesoIdeal));
  return Math.round((horasProd / fracao) * 100) / 100;
}

/**
 * Tempo da rota para encher o peso ideal do caminhão, pela média da viagem.
 * tempo = (HR produtiva / viagens) × (pesoIdeal / kg médio)
 * — se a média já atingiu o ideal, o tempo é o real até 100%;
 * — se não atingiu, estima pela taxa média da rota.
 */
export function tempoParaEncherPorMedia(opts: {
  horasProd: number;
  pesoKg: number;
  pesoIdealKg: number;
  viagens: number;
}): {
  tempoH: number;
  atingiuIdeal: boolean;
  estimado: boolean;
  pesoMedioKg: number;
  horasPorViagem: number;
} | null {
  const viagens = Number(opts.viagens) || 0;
  const horasProd = Number(opts.horasProd) || 0;
  const pesoKg = Number(opts.pesoKg) || 0;
  const pesoIdealKg = Number(opts.pesoIdealKg) || 0;
  if (!(viagens > 0) || !(horasProd > 0) || !(pesoKg > 0) || !(pesoIdealKg > 0)) return null;

  const pesoMedioKg = pesoKg / viagens;
  const horasPorViagem = horasProd / viagens;
  if (!(pesoMedioKg > 0) || !(horasPorViagem > 0)) return null;

  const atingiuIdeal = pesoMedioKg >= pesoIdealKg;
  const tempoH = Math.round((horasPorViagem * (pesoIdealKg / pesoMedioKg)) * 100) / 100;
  if (!(tempoH > 0) || !Number.isFinite(tempoH)) return null;

  return {
    tempoH,
    atingiuIdeal,
    estimado: !atingiuIdeal,
    pesoMedioKg: Math.round(pesoMedioKg * 100) / 100,
    horasPorViagem: Math.round(horasPorViagem * 100) / 100,
  };
}

/** Basculante usa os limiares do TRUCADO (caixa grande). */
export function tipoParaTempoEncher(
  tipo: string | null | undefined,
): 'TOCO' | 'TRUCK' | 'MINI' | null {
  const t = String(tipo || '').toUpperCase();
  if (t === 'TOCO' || t === 'MINI' || t === 'TRUCK') return t;
  if (t === 'BASCULANTE') return 'TRUCK';
  return null;
}

/** Classifica tempo equivalente (h) para encher a caixa, conforme tipo. */
export function classificarTempoPorTipo(
  horas: number,
  tipo: 'TOCO' | 'TRUCK' | 'MINI',
): FaixaEvolucaoId | null {
  if (!(horas > 0)) return null;
  const lim = LIMIARES_TEMPO_ENCHER[tipo];
  if (horas < lim.bom) return 'bom';
  if (horas <= lim.regular) return 'regular';
  return 'ruim';
}

export function classificarVelocidade(kmh: number): FaixaEvolucaoId | null {
  if (!(kmh > 0) || !Number.isFinite(kmh)) return null;
  if (kmh < 5) return 'ruim';
  if (kmh <= 7) return 'regular';
  if (kmh <= 9) return 'bom';
  return 'risco';
}

/** Toneladas / km (maior = melhor) — inverso de km/t. */
export function classificarTonPorKm(tonKm: number): FaixaEvolucaoId | null {
  if (!(tonKm > 0) || !Number.isFinite(tonKm)) return null;
  if (tonKm > LIMIARES_TON_POR_KM.otimo) return 'otimo';
  if (tonKm > LIMIARES_TON_POR_KM.bom) return 'bom';
  if (tonKm > LIMIARES_TON_POR_KM.regular) return 'regular';
  return 'ruim';
}

/** Toneladas / hora (maior = melhor) — ref. 2,35714 t/h. */
export function classificarTonPorHora(tonH: number): FaixaEvolucaoId | null {
  if (!(tonH > 0) || !Number.isFinite(tonH)) return null;
  if (tonH > (1 / 0.3)) return 'bom';
  if (tonH >= REF_TON_POR_HORA) return 'regular';
  return 'ruim';
}
