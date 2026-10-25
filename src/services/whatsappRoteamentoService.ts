import { getControlDataSource, getCurrentTenantDb, isMultiTenant } from '../database/data-source';
import { WhatsappGrupoRoteamento } from '../entities/WhatsappGrupoRoteamento';
import { WhatsappGrupoMapa } from '../entities/WhatsappGrupoMapa';

export async function sincronizarRoteamentoWhatsapp(
  mapa: Pick<WhatsappGrupoMapa, 'grupoJid' | 'nomeGrupo' | 'servicoId' | 'ativo' | 'estrategia' | 'responderPdf'>,
  tenantDb?: string | null,
  contractId?: string | null,
): Promise<void> {
  if (!isMultiTenant()) return;
  const db = tenantDb || getCurrentTenantDb();
  if (!db) return;

  const repo = getControlDataSource().getRepository(WhatsappGrupoRoteamento);
  const existente = await repo.findOne({ where: { grupoJid: mapa.grupoJid } });
  if (existente) {
    existente.nomeGrupo = mapa.nomeGrupo;
    existente.servicoId = mapa.servicoId;
    existente.tenantDb = db;
    existente.contractId = contractId ?? existente.contractId;
    existente.ativo = mapa.ativo;
    existente.estrategia = mapa.estrategia;
    existente.responderPdf = mapa.responderPdf;
    await repo.save(existente);
    return;
  }
  await repo.save(repo.create({
    grupoJid: mapa.grupoJid,
    nomeGrupo: mapa.nomeGrupo,
    servicoId: mapa.servicoId,
    tenantDb: db,
    contractId: contractId ?? null,
    ativo: mapa.ativo,
    estrategia: mapa.estrategia,
    responderPdf: mapa.responderPdf,
  }));
}

export async function removerRoteamentoWhatsapp(grupoJid: string): Promise<void> {
  if (!isMultiTenant()) return;
  await getControlDataSource().getRepository(WhatsappGrupoRoteamento).delete({ grupoJid });
}

export async function removerRoteamentoPorServico(servicoId: string): Promise<void> {
  if (!isMultiTenant() || !servicoId) return;
  await getControlDataSource().getRepository(WhatsappGrupoRoteamento).delete({ servicoId });
}

export async function buscarRoteamentoGrupo(grupoJid: string): Promise<WhatsappGrupoRoteamento | null> {
  if (!isMultiTenant()) return null;
  return getControlDataSource().getRepository(WhatsappGrupoRoteamento).findOne({
    where: { grupoJid, ativo: true },
  });
}
