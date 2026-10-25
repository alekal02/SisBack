/**
 * Totais do dia por contrato: a tabela mora no banco do tenant.
 * BH e Aparecida nunca compartilham a mesma `coleta_totais_dia`.
 */
import AppDataSource, { getCurrentTenantDb } from '../database/data-source';
import { ColetaTotaisDia } from '../entities/ColetaTotaisDia';
import { ColetaData } from '../entities/ColetaData';
import { Servico } from '../entities/Servico';
import { dateUtcParaIso, isoParaDateUtc } from '../utils/dateColumnTransformer';
import {
  getMetricasColetaSql,
  type MetricasColetaSql,
} from './coletaAgregacaoService';

export function escopoCacheContrato(): string {
  return getCurrentTenantDb() || 'banco-unico';
}

function metricasDeLinha(row: ColetaTotaisDia): MetricasColetaSql {
  return {
    registros: row.registros,
    viagens: row.viagens,
    pesoTotalKg: row.pesoKg,
    pesoTotalTon: Math.round((row.pesoKg / 1000) * 100) / 100,
    kmTotal: row.kmTotal,
    horasProdutivas: row.horasProdutivas,
    placas: row.placas,
    motoristas: row.motoristas,
    regionais: row.regionais,
    distritos: row.distritos,
    somaColetores: row.somaColetores,
    faturamento: row.faturamento,
    fatPorTipo: row.fatPorTipo || {},
  };
}

export async function lerTotaisDia(
  servicoId: string,
  dataIso: string,
): Promise<MetricasColetaSql | null> {
  const repo = AppDataSource.getRepository(ColetaTotaisDia);
  const row = await repo.findOne({
    where: { servicoId, data: isoParaDateUtc(dataIso) },
  });
  return row ? metricasDeLinha(row) : null;
}

async function gravarTotais(
  servicoId: string,
  contractId: string,
  dataIso: string,
  m: MetricasColetaSql,
): Promise<void> {
  const repo = AppDataSource.getRepository(ColetaTotaisDia);
  const data = isoParaDateUtc(dataIso);
  let row = await repo.findOne({ where: { servicoId, data } });
  if (!row) {
    row = repo.create({ servicoId, contractId, data });
  }
  row.contractId = contractId;
  row.registros = m.registros;
  row.viagens = m.viagens;
  row.pesoKg = m.pesoTotalKg;
  row.kmTotal = m.kmTotal;
  row.horasProdutivas = m.horasProdutivas;
  row.placas = m.placas;
  row.motoristas = m.motoristas;
  row.regionais = m.regionais;
  row.distritos = m.distritos;
  row.somaColetores = m.somaColetores;
  row.faturamento = m.faturamento;
  row.fatPorTipo = m.fatPorTipo || {};
  await repo.save(row);
}

async function diasDoServico(servicoId: string): Promise<string[]> {
  const rows = await AppDataSource.getRepository(ColetaData)
    .createQueryBuilder('c')
    .innerJoin('planilha_uploads', 'u', 'u.id = c."planilhaUploadId"')
    .select("TO_CHAR(c.dataSaida, 'YYYY-MM-DD')", 'dia')
    .where('u.servico_id = :servicoId', { servicoId })
    .andWhere('c.dataSaida IS NOT NULL')
    .groupBy("TO_CHAR(c.dataSaida, 'YYYY-MM-DD')")
    .getRawMany();
  return rows.map((r) => String(r.dia)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
}

/** Recalcula os totais no banco deste contrato (ALS já aponta para o tenant). */
export async function recalcularTotaisDiaServico(servicoId: string): Promise<number> {
  const servico = await AppDataSource.getRepository(Servico).findOne({
    where: { id: servicoId },
    select: ['id', 'contract_id'],
  });
  if (!servico?.contract_id) return 0;

  const dias = await diasDoServico(servicoId);
  const repo = AppDataSource.getRepository(ColetaTotaisDia);
  if (!dias.length) {
    await repo.delete({ servicoId });
    return 0;
  }

  for (const dataIso of dias) {
    const metricas = await getMetricasColetaSql(servicoId, {
      data: dataIso,
      ignorarTotais: true,
    });
    await gravarTotais(servicoId, servico.contract_id, dataIso, metricas);
  }

  const manter = dias.map((d) => isoParaDateUtc(d));
  const antigos = await repo.find({ where: { servicoId } });
  const remover = antigos.filter((r) => !manter.some((d) => dateUtcParaIso(r.data) === dateUtcParaIso(d)));
  if (remover.length) await repo.remove(remover);
  return dias.length;
}

export async function recalcularTotaisDiaServicoSilencioso(servicoId: string): Promise<void> {
  try {
    const n = await recalcularTotaisDiaServico(servicoId);
    if (n > 0) {
      console.log(`[ColetaTotaisDia] ${n} dia(s) gravado(s) servico=${servicoId} banco=${escopoCacheContrato()}`);
    }
  } catch (err: any) {
    console.warn('[ColetaTotaisDia] Recalc falhou:', err?.message || err);
  }
}
