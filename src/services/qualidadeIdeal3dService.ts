/**
 * Agrega PESO 1–4 por (dia, rota) para scatter 3D no TV Mode:
 * X=dia, Y=% vs ideal, Z=viagens, cor=rota.
 */
import AppDataSource from '../database/data-source';
import { ColetaData } from '../entities/ColetaData';
import { PlanilhaUpload } from '../entities/PlanilhaUpload';
import { Servico } from '../entities/Servico';
import { Contract } from '../entities/Contract';
import {
  normalizarTipoCaminhaoPeso,
  resolverLimitesDoContrato,
} from '../config/pesoMaximoCaminhao';
import { aplicarFiltroViagensValidasDashboard } from './validacaoViagemService';
import {
  calcularPesoIdealViagem,
  densidadeOptsToInput,
} from './relatorioDia/escalaIdealPeso';
import { classificarFaixaVsIdeal } from './analisePesoColetaService';
import { normalizarPlaca } from '../utils/normalizarPlaca';
import { In } from 'typeorm';

export type FaixaDominante3d = 'pessimo' | 'ruim' | 'otimo' | 'excedido';

export interface PontoQualidadeIdeal3d {
  data: string;
  rota: string;
  viagens: number;
  pctIdealMedio: number;
  faixaDominante: FaixaDominante3d;
  faixas: Record<FaixaDominante3d, number>;
  servicoId: string;
  servicoNome: string;
  contratoId: string;
  contratoNome: string;
}

export interface QualidadeIdeal3dResult {
  dataInicio: string;
  dataFim: string;
  totalPontos: number;
  totalViagens: number;
  rotas: string[];
  dias: string[];
  pontos: PontoQualidadeIdeal3d[];
}

function toIsoDateUtc(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dominanteFaixa(contagem: Record<FaixaDominante3d, number>): FaixaDominante3d {
  const ordem: FaixaDominante3d[] = ['otimo', 'ruim', 'excedido', 'pessimo'];
  let melhor: FaixaDominante3d = 'otimo';
  let max = -1;
  for (const f of ordem) {
    if (contagem[f] > max) {
      max = contagem[f];
      melhor = f;
    }
  }
  return melhor;
}

async function getUploadIds(servicoId: string): Promise<number[]> {
  const rows = await AppDataSource.getRepository(PlanilhaUpload).find({
    where: { servico_id: servicoId },
    select: ['id'],
  });
  return rows.map((u) => u.id);
}

export async function agregarQualidadeIdeal3d(opts: {
  servicoIds: string[];
  dataInicio: string;
  dataFim: string;
}): Promise<QualidadeIdeal3dResult> {
  const { dataInicio, dataFim } = opts;
  const vazio: QualidadeIdeal3dResult = {
    dataInicio,
    dataFim,
    totalPontos: 0,
    totalViagens: 0,
    rotas: [],
    dias: [],
    pontos: [],
  };

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataInicio) || !/^\d{4}-\d{2}-\d{2}$/.test(dataFim)) {
    return vazio;
  }
  if (!opts.servicoIds.length) return vazio;

  const servicos = await AppDataSource.getRepository(Servico).find({
    where: { id: In(opts.servicoIds) },
  });
  if (!servicos.length) return vazio;

  const contractIds = [...new Set(servicos.map((s) => s.contract_id))];
  const contracts = await AppDataSource.getRepository(Contract).find({
    where: { id: In(contractIds) },
  });
  const contractMap = new Map(contracts.map((c) => [c.id, c]));

  type Acc = {
    data: string;
    rota: string;
    servicoId: string;
    servicoNome: string;
    contratoId: string;
    contratoNome: string;
    somaPct: number;
    nPct: number;
    viagens: number;
    faixas: Record<FaixaDominante3d, number>;
  };

  const mapa = new Map<string, Acc>();

  for (const servico of servicos) {
    const contrato = contractMap.get(servico.contract_id) || null;
    const cfgOp = contrato?.configOperacional;
    const densInput = densidadeOptsToInput({
      densidadeResiduoKgL: cfgOp?.densidadeResiduoKgL ?? null,
      densidadeKgL: cfgOp?.densidadeKgL || null,
    });
    const limites = resolverLimitesDoContrato({
      pesoMaximoKg: cfgOp?.pesoMaximoKg || null,
      volumeL: cfgOp?.volumeL || null,
    });

    const uploadIds = await getUploadIds(servico.id);
    if (!uploadIds.length) continue;

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
      ])
      .where('c.planilhaUploadId IN (:...uploadIds)', { uploadIds })
      .andWhere('c.dataSaida >= :inicio', { inicio: `${dataInicio}T00:00:00.000Z` })
      .andWhere('c.dataSaida <= :fim', { fim: `${dataFim}T23:59:59.999Z` });
    aplicarFiltroViagensValidasDashboard(qb, 'c');

    const rows = await qb.getMany();
    const contratoNome = contrato?.numeroContrato || '—';

    for (const row of rows) {
      if (!row.dataSaida) continue;
      const dataIso = toIsoDateUtc(new Date(row.dataSaida));
      if (dataIso < dataInicio || dataIso > dataFim) continue;

      const tipo = normalizarTipoCaminhaoPeso(row.tipoCaminhao);
      const limiteKg = tipo ? limites.peso[tipo] : null;
      const placaNorm = normalizarPlaca(row.placa) || '—';
      const densOpts = {
        placa: placaNorm !== '—' ? placaNorm : null,
        tipo,
        densidade: densInput,
        porPlaca: cfgOp?.densidadeKgLPorPlaca || null,
      };
      const pesoIdealCalc = tipo
        ? calcularPesoIdealViagem({
          ...densOpts,
          volumeOverrides: cfgOp?.volumeL || null,
        })
        : 0;
      const pesoIdealKg = pesoIdealCalc > 0 ? pesoIdealCalc : null;
      const rota = String(row.distrito || row.regional || '').trim() || '—';
      const pesos = [row.peso1, row.peso2, row.peso3, row.peso4]
        .map((p) => Number(p))
        .filter((p) => Number.isFinite(p) && p > 0);

      for (const pesoKg of pesos) {
        const tetoFiltro = limiteKg ?? (pesoIdealKg != null ? pesoIdealKg * 2 : null);
        if (tetoFiltro != null && pesoKg > tetoFiltro * 1.5) continue;

        const refKg = pesoIdealKg && pesoIdealKg > 0 ? pesoIdealKg : limiteKg;
        if (!(refKg && refKg > 0)) continue;

        const pctIdeal = Math.round((pesoKg / refKg) * 1000) / 10;
        const faixa = classificarFaixaVsIdeal(pctIdeal) as FaixaDominante3d;
        const chave = `${servico.id}|${dataIso}|${rota}`;
        let acc = mapa.get(chave);
        if (!acc) {
          acc = {
            data: dataIso,
            rota,
            servicoId: servico.id,
            servicoNome: servico.nome,
            contratoId: servico.contract_id,
            contratoNome,
            somaPct: 0,
            nPct: 0,
            viagens: 0,
            faixas: { pessimo: 0, ruim: 0, otimo: 0, excedido: 0 },
          };
          mapa.set(chave, acc);
        }
        acc.viagens += 1;
        acc.somaPct += pctIdeal;
        acc.nPct += 1;
        acc.faixas[faixa] += 1;
      }
    }
  }

  const pontos: PontoQualidadeIdeal3d[] = [...mapa.values()]
    .map((a) => ({
      data: a.data,
      rota: a.rota,
      viagens: a.viagens,
      pctIdealMedio: a.nPct > 0 ? Math.round((a.somaPct / a.nPct) * 10) / 10 : 0,
      faixaDominante: dominanteFaixa(a.faixas),
      faixas: { ...a.faixas },
      servicoId: a.servicoId,
      servicoNome: a.servicoNome,
      contratoId: a.contratoId,
      contratoNome: a.contratoNome,
    }))
    .sort((a, b) => a.data.localeCompare(b.data) || a.rota.localeCompare(b.rota));

  const dias = [...new Set(pontos.map((p) => p.data))].sort();
  const rotas = [...new Set(pontos.map((p) => p.rota))].sort();
  const totalViagens = pontos.reduce((s, p) => s + p.viagens, 0);

  return {
    dataInicio,
    dataFim,
    totalPontos: pontos.length,
    totalViagens,
    rotas,
    dias,
    pontos,
  };
}
