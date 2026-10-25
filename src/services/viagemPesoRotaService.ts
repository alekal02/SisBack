/**
 * Viagem = slot 1–4 com dado real (PESO N ou horário da ROTA N).
 * Sem pesagem só entra se o trecho existe (hora chegada/saída) e o peso falta.
 * CONTADOR ou KM sozinhos não inventam faixa vazia no relatório.
 */
import {
  calcularHorasPorTrechoRota,
  calcularHorasProdutivaImprodutivaRegistro,
  calcularKmNasRotasRegistro,
  lerKmCampoEstrito,
  lerKmChegadaBase,
  lerKmChegadaRota,
  lerKmSaidaBase,
  lerKmSaidaRota,
} from './horasProdutivasService';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Rateia o total para n partes (último recebe o resto, para a soma fechar). */
export function ratearHoras(total: number, n: number): number[] {
  if (!(n > 0) || !(total > 0)) return Array.from({ length: Math.max(0, n) }, () => 0);
  const base = round2(total / n);
  const parts = Array.from({ length: n }, () => base);
  const somaExcetoUltimo = round2(base * (n - 1));
  parts[n - 1] = round2(total - somaExcetoUltimo);
  return parts;
}

export type OrigemHoraViagem = 'trecho' | 'rateio';

export interface ViagemPesoRotaItem {
  data: string | null;
  rota: string;
  placa: string;
  motorista: string;
  tipo: string | null;
  nViagem: number;
  pesoKg: number;
  pesoIdealKg: number | null;
  pctIdeal: number | null;
  encheu: boolean;
  /** true quando o trecho (horário da ROTA N) existe e a planilha não trouxe PESO N. */
  semPesagem: boolean;
  horasProdutivasViagem: number;
  horasProdutivasRota: number;
  /** Jornada base→base da linha (não só o tempo dentro da rota). */
  horasTotaisRota: number;
  /** KM TOTAL da linha (planilha). */
  kmTotalRota: number;
  /** KM desta viagem (hodômetro saída − chegada da ROTA N), se houver. */
  kmViagem: number;
  origemHora: OrigemHoraViagem;
  /** Só quando ainda não encheu: h da viagem × (ideal / peso). */
  tempoEqEncher: number | null;
  estimado: boolean;
}

export interface GrupoViagemPesoRota {
  chave: string;
  data: string | null;
  rota: string;
  placa: string;
  motorista: string;
  tipo: string | null;
  horasProdutivasRota: number;
  horasTotaisRota: number;
  kmTotalRota: number;
  origemHora: OrigemHoraViagem;
  viagens: ViagemPesoRotaItem[];
}

export function viagemTemPesagem(v: { semPesagem?: boolean; pesoKg?: number }): boolean {
  return !v.semPesagem && Number(v.pesoKg) > 0;
}

function normalizarPesos(pesos: Array<number | null | undefined>): number[] {
  const raw = (pesos || []).slice(0, 4).map((kg) => {
    const n = Number(kg);
    return Number.isFinite(n) && n > 0 ? n : 0;
  });
  while (raw.length < 4) raw.push(0);
  return raw;
}

/** Slot com peso ou com horário do trecho — o que justifica uma faixa no relatório. */
export function slotTemDadoDeViagem(pesoKg: number, horasTrecho: number): boolean {
  return pesoKg > 0 || horasTrecho > 0;
}

/**
 * Quantas faixas listar: só slots com PESO ou com horário de trecho.
 * CONTADOR/KM não entram — senão o relatório ganha “sem pesagem” vazia.
 */
export function resolverQtdViagensPesoRota(
  nPesos: number,
  nTrechos: number,
  _nInformado?: number,
  _nKmSlots = 0,
): number {
  return Math.min(4, Math.max(nPesos, nTrechos, 0));
}

function kmDoSlot(objHoras: Record<string, any>, nViagem: number): number {
  const chegada = lerKmChegadaRota(objHoras, nViagem);
  const saida = lerKmSaidaRota(objHoras, nViagem);
  if (chegada > 0 && saida > chegada) {
    const km = round2(saida - chegada);
    return km > 0 && km <= 300 ? km : 0;
  }
  return 0;
}

/** KM TOTAL da linha: coluna da planilha, senão soma dos trechos / hodômetro base. */
function kmTotalDaLinha(objHoras: Record<string, any>): number {
  const entidade = Number(objHoras?.kmTotal);
  if (Number.isFinite(entidade) && entidade > 0) return round2(entidade);

  const colPlanilha = lerKmCampoEstrito(objHoras, 'KM TOTAL', 'KM_TOTAL', 'KMTOTAL');
  if (colPlanilha > 0) return round2(colPlanilha);

  const nasRotas = calcularKmNasRotasRegistro(objHoras);
  if (nasRotas > 0) return round2(nasRotas);

  const saida = lerKmSaidaBase(objHoras);
  const chegada = lerKmChegadaBase(objHoras);
  if (saida > 0 && chegada > saida) {
    const d = round2(chegada - saida);
    if (d > 0 && d <= 1500) return d;
  }
  return 0;
}

function horasDoSlot(
  indice: number,
  trechos: number[],
  indices: number[],
  horasRota: number,
): { horas: number; origem: OrigemHoraViagem } {
  const hTrecho = trechos[indice] || 0;
  if (hTrecho > 0) return { horas: round2(hTrecho), origem: 'trecho' };

  const algumTrecho = indices.some((i) => (trechos[i] || 0) > 0);
  if (algumTrecho) return { horas: 0, origem: 'trecho' };

  const semTrecho = indices.filter((i) => !(trechos[i] > 0));
  if (horasRota > 0 && semTrecho.length > 0) {
    const rateio = ratearHoras(horasRota, semTrecho.length);
    const pos = semTrecho.indexOf(indice);
    return { horas: pos >= 0 ? rateio[pos] : 0, origem: 'rateio' };
  }
  return { horas: 0, origem: 'rateio' };
}

function completarPesosDoJson(
  pesos: number[],
  objHoras: Record<string, any>,
): number[] {
  const dados = objHoras?.dados && typeof objHoras.dados === 'object' ? objHoras.dados : objHoras;
  const out = [...pesos];
  for (let i = 0; i < 4; i++) {
    if (out[i] > 0) continue;
    const bruto = dados?.[`PESO ${i + 1}`] ?? dados?.[`PESO${i + 1}`] ?? objHoras[`peso${i + 1}`];
    const n = Number(bruto);
    if (Number.isFinite(n) && n > 0) out[i] = n;
  }
  return out;
}

export function montarViagensPesoDoRegistro(opts: {
  data?: string | null;
  rota: string;
  placa: string;
  motorista: string;
  tipo: string | null;
  pesos: Array<number | null | undefined>;
  objHoras: Record<string, any>;
  pesoIdealKg: number | null;
  /** Ignorado na listagem: CONTADOR sozinho não cria faixa vazia. */
  nViagens?: number;
}): ViagemPesoRotaItem[] {
  void opts.nViagens;
  const pesosRaw = completarPesosDoJson(normalizarPesos(opts.pesos), opts.objHoras);
  const trechos = calcularHorasPorTrechoRota(opts.objHoras);
  const indices = [0, 1, 2, 3].filter((i) => slotTemDadoDeViagem(pesosRaw[i] || 0, trechos[i] || 0));
  if (indices.length === 0) return [];

  const jornada = calcularHorasProdutivaImprodutivaRegistro(opts.objHoras);
  const horasRota = jornada.horasProdutivas;
  const horasTotaisRota = jornada.horasTotais;
  const kmTotalRota = kmTotalDaLinha(opts.objHoras);
  const ideal = opts.pesoIdealKg != null && opts.pesoIdealKg > 0 ? round2(opts.pesoIdealKg) : null;

  const itens: ViagemPesoRotaItem[] = [];
  for (const i of indices) {
    const pesoKg = pesosRaw[i] || 0;
    const semPesagem = !(pesoKg > 0);
    const { horas: h, origem } = horasDoSlot(i, trechos, indices, horasRota);
    const pctIdeal = !semPesagem && ideal ? round2((pesoKg / ideal) * 100) : null;
    const encheu = !semPesagem && ideal != null && pesoKg >= ideal;
    let tempoEqEncher: number | null = null;
    if (!semPesagem && !encheu && ideal && pesoKg > 0 && h > 0) {
      tempoEqEncher = round2(h * (ideal / pesoKg));
    }
    itens.push({
      data: opts.data || null,
      rota: opts.rota,
      placa: opts.placa,
      motorista: opts.motorista,
      tipo: opts.tipo,
      nViagem: i + 1,
      pesoKg: semPesagem ? 0 : round2(pesoKg),
      pesoIdealKg: semPesagem ? null : ideal,
      pctIdeal,
      encheu,
      semPesagem,
      horasProdutivasViagem: h,
      horasProdutivasRota: horasRota,
      horasTotaisRota,
      kmTotalRota,
      kmViagem: kmDoSlot(opts.objHoras, i + 1),
      origemHora: origem,
      tempoEqEncher,
      estimado: !semPesagem && !encheu && tempoEqEncher != null,
    });
  }
  return itens;
}

export function agruparViagensPesoPorLinha(itens: ViagemPesoRotaItem[]): GrupoViagemPesoRota[] {
  const mapa = new Map<string, GrupoViagemPesoRota>();
  for (const it of itens) {
    const chave = `${it.data || ''}\0${it.rota}\0${it.placa}\0${it.motorista}`;
    let g = mapa.get(chave);
    if (!g) {
      g = {
        chave,
        data: it.data,
        rota: it.rota,
        placa: it.placa,
        motorista: it.motorista,
        tipo: it.tipo,
        horasProdutivasRota: 0,
        horasTotaisRota: 0,
        kmTotalRota: 0,
        origemHora: it.origemHora,
        viagens: [],
      };
      mapa.set(chave, g);
    }
    g.viagens.push(it);
  }
  const grupos = Array.from(mapa.values());
  for (const g of grupos) {
    g.viagens.sort((a, b) => a.nViagem - b.nViagem);
    g.horasProdutivasRota = round2(
      g.viagens.reduce((s, v) => s + (v.horasProdutivasViagem || 0), 0),
    );
    g.horasTotaisRota = round2(Math.max(...g.viagens.map((v) => v.horasTotaisRota || 0), 0));
    const kmLinha = Math.max(...g.viagens.map((v) => v.kmTotalRota || 0), 0);
    const kmSlots = g.viagens.reduce((s, v) => s + (v.kmViagem || 0), 0);
    g.kmTotalRota = round2(kmLinha > 0 ? kmLinha : kmSlots);
  }
  grupos.sort((a, b) =>
    (a.data || '').localeCompare(b.data || '')
    || a.rota.localeCompare(b.rota, 'pt-BR')
    || a.placa.localeCompare(b.placa, 'pt-BR')
    || a.motorista.localeCompare(b.motorista, 'pt-BR'));
  return grupos;
}
