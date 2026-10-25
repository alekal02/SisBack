/**
 * Agrega evolução diária operacional (tempo até encher unificado com caixa L,
 * velocidade, ton/km, ton/h) — um gráfico por contrato.
 */
import { In } from 'typeorm';
import AppDataSource from '../database/data-source';
import { ColetaData } from '../entities/ColetaData';
import { PlanilhaUpload } from '../entities/PlanilhaUpload';
import { Servico } from '../entities/Servico';
import { Contract } from '../entities/Contract';
import {
  normalizarTipoCaminhaoPeso,
  resolverLimitesDoContrato,
  type TipoCaminhaoPeso,
} from '../config/pesoMaximoCaminhao';
import { aplicarFiltroViagensValidasDashboard } from './validacaoViagemService';
import {
  calcularHorasNasRotasRegistro,
  calcularKmNasRotasRegistro,
  calcularVelocidadeColetaRegistro,
} from './horasProdutivasService';
import { agregarQualidadeIdeal3d } from './qualidadeIdeal3dService';
import { calcularCaixaMediaPorFrota } from './analisePesoColetaService';
import {
  calcularPesoIdealViagem,
  densidadeOptsToInput,
} from './relatorioDia/escalaIdealPeso';
import { normalizarPlaca } from '../utils/normalizarPlaca';
import {
  METRICAS_EVOLUCAO,
  type DefFaixaEvolucao,
  type DefMetricaEvolucao,
  type MetricaEvolucaoId,
  classificarTempoPorTipo,
  classificarTonPorHora,
  classificarTonPorKm,
  classificarVelocidade,
  tempoEquivalenteEncher,
  zeradoFaixas,
} from './evolucaoOperacionalMetricas';

export interface PontoEvolucaoOperacional {
  data: string;
  rota: string;
  viagens: number;
  faixaDominante: string;
  faixas: Record<string, number>;
  servicoId: string;
  servicoNome: string;
  contratoId: string;
  contratoNome: string;
  /** Caixa média (L) do contrato — mesma base do painel Análise de Peso. */
  caixaMediaL?: number;
}

export interface SerieEvolucaoOperacional {
  id: MetricaEvolucaoId;
  label: string;
  descricao: string;
  faixas: DefFaixaEvolucao[];
  totalPontos: number;
  totalViagens: number;
  pontos: PontoEvolucaoOperacional[];
}

export interface EvolucaoOperacionalResult {
  dataInicio: string;
  dataFim: string;
  dias: string[];
  series: SerieEvolucaoOperacional[];
}

function toIsoDateUtc(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dominanteFaixa(contagem: Record<string, number>, ordem: string[]): string {
  let melhor = ordem[0] || 'bom';
  let max = -1;
  for (const f of ordem) {
    const n = contagem[f] || 0;
    if (n > max) {
      max = n;
      melhor = f;
    }
  }
  return melhor;
}

function pesoKgRegistro(row: ColetaData): number {
  const total = Number(row.pesoTotal);
  if (Number.isFinite(total) && total > 0) return total;
  return [row.peso1, row.peso2, row.peso3, row.peso4]
    .map((p) => Number(p))
    .filter((p) => Number.isFinite(p) && p > 0)
    .reduce((s, p) => s + p, 0);
}

function pesoToneladas(row: ColetaData): number {
  const kg = pesoKgRegistro(row);
  return kg > 0 ? kg / 1000 : 0;
}

function kmViagem(row: ColetaData): number {
  const total = Number(row.kmTotal);
  if (Number.isFinite(total) && total > 0) return total;
  const saida = Number(row.kmSaida);
  const chegada = Number(row.kmChegada);
  if (Number.isFinite(saida) && Number.isFinite(chegada) && chegada > saida) {
    return chegada - saida;
  }
  return 0;
}

/** Objeto unificado para cálculos de km/h produtivos nas rotas. */
function objOperacionalRota(row: ColetaData): Record<string, any> {
  return {
    horaSaida: row.horaSaida,
    horaChegada: row.horaChegada,
    kmRota1: row.kmRota1,
    kmRota2: row.kmRota2,
    kmRota3: row.kmRota3,
    kmRota4: row.kmRota4,
    dados: row.dados || {},
  };
}

async function getUploadIds(servicoId: string): Promise<number[]> {
  const rows = await AppDataSource.getRepository(PlanilhaUpload).find({
    where: { servico_id: servicoId },
    select: ['id'],
  });
  return rows.map((u) => u.id);
}

type Acc = {
  data: string;
  rota: string;
  servicoId: string;
  servicoNome: string;
  contratoId: string;
  contratoNome: string;
  caixaMediaL?: number;
  viagens: number;
  faixas: Record<string, number>;
};

function bump(
  mapa: Map<string, Acc>,
  meta: Omit<Acc, 'viagens' | 'faixas'>,
  faixaIds: DefFaixaEvolucao[],
  faixaId: string,
): void {
  const chave = `${meta.servicoId}|${meta.data}|${meta.rota}`;
  let acc = mapa.get(chave);
  if (!acc) {
    acc = { ...meta, viagens: 0, faixas: zeradoFaixas(faixaIds) };
    mapa.set(chave, acc);
  }
  acc.viagens += 1;
  acc.faixas[faixaId] = (acc.faixas[faixaId] || 0) + 1;
}

function serieDeMapa(
  def: DefMetricaEvolucao,
  mapa: Map<string, Acc>,
): SerieEvolucaoOperacional {
  const ordem = def.faixas.map((f) => f.id);
  const pontos: PontoEvolucaoOperacional[] = [...mapa.values()].map((a) => ({
    data: a.data,
    rota: a.rota,
    viagens: a.viagens,
    faixaDominante: dominanteFaixa(a.faixas, ordem),
    faixas: a.faixas,
    servicoId: a.servicoId,
    servicoNome: a.servicoNome,
    contratoId: a.contratoId,
    contratoNome: a.contratoNome,
    caixaMediaL: a.caixaMediaL,
  }));
  return {
    id: def.id,
    label: def.label,
    descricao: def.descricao,
    faixas: def.faixas,
    totalPontos: pontos.length,
    totalViagens: pontos.reduce((s, p) => s + p.viagens, 0),
    pontos,
  };
}

function frotaZerada(): Record<TipoCaminhaoPeso, number> {
  return { MINI: 0, TOCO: 0, BASCULANTE: 0, TRUCK: 0 };
}

export async function agregarEvolucaoOperacional(opts: {
  servicoIds: string[];
  dataInicio: string;
  dataFim: string;
}): Promise<EvolucaoOperacionalResult> {
  const { dataInicio, dataFim } = opts;
  const vazio: EvolucaoOperacionalResult = {
    dataInicio,
    dataFim,
    dias: [],
    series: [],
  };

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataInicio) || !/^\d{4}-\d{2}-\d{2}$/.test(dataFim)) {
    return vazio;
  }
  if (!opts.servicoIds.length) return vazio;

  const defsOp = METRICAS_EVOLUCAO.filter((m) => m.id !== 'peso_ideal');
  const mapas = new Map<MetricaEvolucaoId, Map<string, Acc>>();
  for (const d of defsOp) mapas.set(d.id, new Map());

  const pesoIdeal = await agregarQualidadeIdeal3d(opts);
  const defPeso = METRICAS_EVOLUCAO.find((m) => m.id === 'peso_ideal')!;
  const seriePeso: SerieEvolucaoOperacional = {
    id: 'peso_ideal',
    label: defPeso.label,
    descricao: defPeso.descricao,
    faixas: defPeso.faixas,
    totalPontos: pesoIdeal.totalPontos,
    totalViagens: pesoIdeal.totalViagens,
    pontos: pesoIdeal.pontos.map((p) => ({
      data: p.data,
      rota: p.rota,
      viagens: p.viagens,
      faixaDominante: p.faixaDominante,
      faixas: p.faixas as Record<string, number>,
      servicoId: p.servicoId,
      servicoNome: p.servicoNome,
      contratoId: p.contratoId,
      contratoNome: p.contratoNome,
    })),
  };

  const servicos = await AppDataSource.getRepository(Servico).find({
    where: { id: In(opts.servicoIds) },
  });
  if (!servicos.length) {
    return {
      dataInicio,
      dataFim,
      dias: pesoIdeal.dias,
      series: [seriePeso],
    };
  }

  const contractIds = [...new Set(servicos.map((s) => s.contract_id))];
  const contracts = await AppDataSource.getRepository(Contract).find({
    where: { id: In(contractIds) },
  });
  const contractMap = new Map(contracts.map((c) => [c.id, c]));

  for (const servico of servicos) {
    const contrato = contractMap.get(servico.contract_id) || null;
    const uploadIds = await getUploadIds(servico.id);
    if (!uploadIds.length) continue;

    const cfgOp = contrato?.configOperacional;
    const limites = resolverLimitesDoContrato({
      pesoMaximoKg: cfgOp?.pesoMaximoKg || null,
      volumeL: cfgOp?.volumeL || null,
    });
    const densInput = densidadeOptsToInput({
      densidadeResiduoKgL: cfgOp?.densidadeResiduoKgL ?? null,
      densidadeKgL: cfgOp?.densidadeKgL || null,
    });

    const qb = AppDataSource.getRepository(ColetaData)
      .createQueryBuilder('c')
      .select([
        'c.dataSaida',
        'c.placa',
        'c.distrito',
        'c.regional',
        'c.tipoCaminhao',
        'c.peso1',
        'c.peso2',
        'c.peso3',
        'c.peso4',
        'c.pesoTotal',
        'c.kmTotal',
        'c.kmSaida',
        'c.kmChegada',
        'c.kmRota1',
        'c.kmRota2',
        'c.kmRota3',
        'c.kmRota4',
        'c.horaSaida',
        'c.horaChegada',
        'c.dados',
      ])
      .where('c.planilhaUploadId IN (:...uploadIds)', { uploadIds })
      .andWhere('c.dataSaida >= :inicio', { inicio: `${dataInicio}T00:00:00.000Z` })
      .andWhere('c.dataSaida <= :fim', { fim: `${dataFim}T23:59:59.999Z` });
    aplicarFiltroViagensValidasDashboard(qb, 'c');

    const rows = await qb.getMany();
    const contratoNome = contrato?.numeroContrato || '—';

    // Mesma CAIXA MÉDIA (L) do painel Análise de Peso — frota × volume do contrato
    const frota = frotaZerada();
    const placasPorTipo: Record<TipoCaminhaoPeso, Set<string>> = {
      MINI: new Set(),
      TOCO: new Set(),
      BASCULANTE: new Set(),
      TRUCK: new Set(),
    };
    for (const row of rows) {
      const tipo = normalizarTipoCaminhaoPeso(row.tipoCaminhao);
      if (!tipo) continue;
      const placa = normalizarPlaca(row.placa) || `sem-placa:${tipo}`;
      if (!placasPorTipo[tipo].has(placa)) {
        placasPorTipo[tipo].add(placa);
        frota[tipo] += 1;
      }
    }
    const caixaMediaL = Math.round(calcularCaixaMediaPorFrota(frota, limites.volume) * 100) / 100;

    const baseMeta = {
      servicoId: servico.id,
      servicoNome: servico.nome,
      contratoId: servico.contract_id,
      contratoNome,
      caixaMediaL: caixaMediaL > 0 ? caixaMediaL : undefined,
    };

    for (const row of rows) {
      if (!row.dataSaida) continue;
      const dataIso = toIsoDateUtc(new Date(row.dataSaida));
      if (dataIso < dataInicio || dataIso > dataFim) continue;

      const tipo = normalizarTipoCaminhaoPeso(row.tipoCaminhao);
      const rota = String(row.distrito || row.regional || '').trim() || '—';
      const meta = { ...baseMeta, data: dataIso, rota };

      const objRota = objOperacionalRota(row);
      const horasProd = calcularHorasNasRotasRegistro(objRota);
      const kmProdutivo = calcularKmNasRotasRegistro(objRota);
      const km = kmProdutivo > 0 ? kmProdutivo : kmViagem(row);
      const pesoKg = pesoKgRegistro(row);
      const toneladas = pesoToneladas(row);

      // Tempo até encher: horas ajustadas para 100% da caixa (volume L × dens. do contrato)
      if (tipo === 'TOCO' || tipo === 'TRUCK' || tipo === 'MINI') {
        const pesoIdealKg = calcularPesoIdealViagem({
          placa: row.placa,
          tipo,
          volumeOverrides: cfgOp?.volumeL || null,
          densidade: densInput,
          porPlaca: cfgOp?.densidadeKgLPorPlaca || null,
        });
        // Preferência: peso ideal do tipo (volume L × dens. do contrato = base da CAIXA MÉDIA)
        const tempoEq = tempoEquivalenteEncher({
          horasProd,
          pesoKg,
          pesoIdealKg: pesoIdealKg > 0 ? pesoIdealKg : undefined,
          volumeL: limites.volume[tipo],
          densidadeKgL: pesoIdealKg > 0 && limites.volume[tipo] > 0
            ? pesoIdealKg / limites.volume[tipo]
            : undefined,
        });
        const faixaTempo = tempoEq != null ? classificarTempoPorTipo(tempoEq, tipo) : null;
        if (faixaTempo) {
          const def = defsOp.find((d) => d.id === 'tempo_encher')!;
          bump(mapas.get('tempo_encher')!, meta, def.faixas, faixaTempo);
        }
      }

      // Velocidade = KM produtivo nas rotas ÷ HR produtiva nas rotas (por viagem)
      const velocidade = calcularVelocidadeColetaRegistro(objRota);
      if (velocidade != null) {
        const faixaVel = classificarVelocidade(velocidade);
        if (faixaVel) {
          const def = defsOp.find((d) => d.id === 'velocidade')!;
          bump(mapas.get('velocidade')!, meta, def.faixas, faixaVel);
        }
      }

      // Tonelada / km (inverso de km/t)
      if (toneladas > 0 && km > 0) {
        const faixaTonKm = classificarTonPorKm(toneladas / km);
        if (faixaTonKm) {
          const def = defsOp.find((d) => d.id === 'ton_por_km')!;
          bump(mapas.get('ton_por_km')!, meta, def.faixas, faixaTonKm);
        }
      }

      // Tonelada / hora (inverso de h/t)
      if (toneladas > 0 && horasProd > 0) {
        const faixaTonH = classificarTonPorHora(toneladas / horasProd);
        if (faixaTonH) {
          const def = defsOp.find((d) => d.id === 'ton_por_hora')!;
          bump(mapas.get('ton_por_hora')!, meta, def.faixas, faixaTonH);
        }
      }
    }
  }

  const seriesOp = defsOp.map((d) => {
    const serie = serieDeMapa(d, mapas.get(d.id)!);
    if (d.id === 'tempo_encher') {
      const caixas = [...new Set(
        serie.pontos.map((p) => p.caixaMediaL).filter((n): n is number => n != null && n > 0),
      )];
      if (caixas.length === 1) {
        serie.descricao =
          `${d.descricao} · CAIXA MÉDIA ${caixas[0].toLocaleString('pt-BR', { maximumFractionDigits: 0 })} L · limiares por tipo (TOCO/TRUCADO/MINI)`;
      }
    }
    return serie;
  });
  const series = [seriePeso, ...seriesOp];

  const diasSet = new Set<string>();
  for (const s of series) {
    for (const p of s.pontos) diasSet.add(p.data);
  }

  return {
    dataInicio,
    dataFim,
    dias: [...diasSet].sort(),
    series,
  };
}
