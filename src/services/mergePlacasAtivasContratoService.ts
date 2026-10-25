import AppDataSource from '../database/data-source';
import { ColetaData } from '../entities/ColetaData';
import { Contract } from '../entities/Contract';
import { Servico } from '../entities/Servico';
import { encontrarValorColuna } from './FormulaEngine';
import { normalizarListaPlacasAtivas } from '../utils/configOperacional';
import { normalizarPlaca } from '../utils/normalizarPlaca';

function buscarColunaPlaca(dados: Array<Record<string, unknown>>): string {
  if (!dados?.length) return '';
  const chaves = new Set<string>();
  for (const reg of dados) {
    for (const k of Object.keys(reg || {})) chaves.add(k);
  }
  const candidatos = ['PLACA', 'CAMINHAO', 'CAMINHÃO', 'VEICULO', 'VEÍCULO', 'EQUIPAMENTO'];
  for (const cand of candidatos) {
    const normCand = cand.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
    for (const chave of chaves) {
      const normChave = chave.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
      if (normChave === normCand || normChave.includes(normCand) || normCand.includes(normChave)) {
        return chave;
      }
    }
  }
  return '';
}

/** Extrai placas únicas normalizadas de registros (planilha / JSON). */
export function extrairPlacasUnicasDeDados(dados: Array<Record<string, unknown>>): string[] {
  if (!dados?.length) return [];
  const col = buscarColunaPlaca(dados);
  const unicos = new Set<string>();
  for (const reg of dados) {
    const raw = col
      ? encontrarValorColuna(reg, col)
      : (reg as any).placa ?? (reg as any).PLACA;
    const placa = normalizarPlaca(String(raw || ''));
    if (placa) unicos.add(placa);
  }
  return [...unicos].sort();
}

/**
 * Une placas novas em configOperacional.placasAtivas do contrato.
 * Não remove placas existentes nem densidades por placa.
 */
export async function mergePlacasAtivasDoContrato(
  contractId: string,
  placasNovas: string[],
): Promise<{ adicionadas: number; total: number }> {
  const novas = normalizarListaPlacasAtivas(placasNovas);
  if (!contractId || novas.length === 0) {
    return { adicionadas: 0, total: 0 };
  }

  const repo = AppDataSource.getRepository(Contract);
  const contract = await repo.findOne({ where: { id: contractId } });
  if (!contract) return { adicionadas: 0, total: 0 };

  const atuais = normalizarListaPlacasAtivas(contract.configOperacional?.placasAtivas);
  const set = new Set(atuais);
  let adicionadas = 0;
  for (const p of novas) {
    if (!set.has(p)) {
      set.add(p);
      adicionadas++;
    }
  }
  if (adicionadas === 0) {
    return { adicionadas: 0, total: atuais.length };
  }

  const placasAtivas = [...set].sort();
  const novoConfig = {
    ...(contract.configOperacional || {}),
    placasAtivas,
  };
  contract.configOperacional = novoConfig;
  await repo.update(contractId, { configOperacional: novoConfig as any });
  await repo.save(contract);

  return { adicionadas, total: placasAtivas.length };
}

/** Placas distintas de um upload de coleta → union no contrato do serviço. */
export async function mergePlacasAtivasPorUpload(
  servicoId: string,
  planilhaUploadId?: number | null,
): Promise<{ adicionadas: number; total: number }> {
  if (!servicoId) return { adicionadas: 0, total: 0 };

  const servico = await AppDataSource.getRepository(Servico).findOne({
    where: { id: servicoId },
    select: ['id', 'contract_id'],
  });
  if (!servico?.contract_id) return { adicionadas: 0, total: 0 };

  const qb = AppDataSource.getRepository(ColetaData)
    .createQueryBuilder('c')
    .select('DISTINCT c.placa', 'placa')
    .where('c.placa IS NOT NULL')
    .andWhere("TRIM(c.placa) <> ''");

  if (planilhaUploadId) {
    qb.andWhere('c.planilhaUploadId = :uid', { uid: planilhaUploadId });
  } else {
    qb.innerJoin('c.planilhaUpload', 'u').andWhere('u.servico_id = :sid', { sid: servicoId });
  }

  const rows = await qb.getRawMany<{ placa: string }>();
  const placas = rows.map((r) => r.placa).filter(Boolean);
  return mergePlacasAtivasDoContrato(servico.contract_id, placas);
}

/** Union a partir de registros em memória (ex.: WhatsApp / unificado). */
export async function mergePlacasAtivasPorServicoEDados(
  servicoId: string,
  dados: Array<Record<string, unknown>>,
): Promise<{ adicionadas: number; total: number }> {
  if (!servicoId || !dados?.length) return { adicionadas: 0, total: 0 };
  const servico = await AppDataSource.getRepository(Servico).findOne({
    where: { id: servicoId },
    select: ['id', 'contract_id'],
  });
  if (!servico?.contract_id) return { adicionadas: 0, total: 0 };
  return mergePlacasAtivasDoContrato(servico.contract_id, extrairPlacasUnicasDeDados(dados));
}
