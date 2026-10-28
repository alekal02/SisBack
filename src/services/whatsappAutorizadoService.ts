import { In } from 'typeorm';
import { getControlDataSource, isMultiTenant } from '../database/data-source';
import { WhatsappAutorizado } from '../entities/WhatsappAutorizado';
import { WhatsappTentativaNaoAutorizada } from '../entities/WhatsappTentativaNaoAutorizada';
import { Tenant } from '../entities/Tenant';
import { Contract } from '../entities/Contract';
import {
  validarTelefoneComDdi,
  type ContratoAutorizadoWhatsapp,
  type TipoTentativaWhatsapp,
} from './whatsappConversaPrivada';

export class ErroWhatsappAutorizado extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function repoAutorizado() {
  return getControlDataSource().getRepository(WhatsappAutorizado);
}

function repoTentativa() {
  return getControlDataSource().getRepository(WhatsappTentativaNaoAutorizada);
}

async function nomesDosContratos(ids: string[]): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  const unicos = [...new Set(ids.filter(Boolean))];
  if (!unicos.length) return mapa;
  if (isMultiTenant()) {
    const tenants = await getControlDataSource().getRepository(Tenant).find({
      where: { contractId: In(unicos) },
    });
    for (const tenant of tenants) mapa.set(tenant.contractId, tenant.numeroContrato);
  } else {
    const contratos = await getControlDataSource().getRepository(Contract).find({
      where: { id: In(unicos) },
    });
    for (const contrato of contratos) {
      mapa.set(contrato.id, contrato.numeroContrato || contrato.id);
    }
  }
  for (const id of unicos) {
    if (!mapa.has(id)) mapa.set(id, id.slice(0, 8));
  }
  return mapa;
}

function paraApi(row: WhatsappAutorizado, nomeContrato?: string) {
  return {
    id: row.id,
    contractId: row.contractId,
    nomeContrato: nomeContrato || null,
    nome: row.nome,
    telefone: row.telefone,
    lid: row.lid,
    podeEnviarPlanilha: row.podeEnviarPlanilha,
    podePedirRelatorio: row.podePedirRelatorio,
    ativo: row.ativo,
    criadoEm: row.criadoEm,
  };
}

export async function listarAutorizadosPorContrato(contractId: string) {
  const rows = await repoAutorizado().find({
    where: { contractId },
    order: { nome: 'ASC' },
  });
  const nomes = await nomesDosContratos(rows.map((r) => r.contractId));
  return rows.map((r) => paraApi(r, nomes.get(r.contractId)));
}

export async function pessoasAtivasPorTelefone(telefone: string): Promise<ContratoAutorizadoWhatsapp[]> {
  const rows = await repoAutorizado().find({ where: { telefone, ativo: true } });
  const nomes = await nomesDosContratos(rows.map((r) => r.contractId));
  return rows.map((r) => ({
    contractId: r.contractId,
    nome: nomes.get(r.contractId) || r.contractId,
    podeEnviarPlanilha: r.podeEnviarPlanilha,
    podePedirRelatorio: r.podePedirRelatorio,
    ativo: r.ativo,
  }));
}

export async function telefoneDoLid(lid: string): Promise<string | null> {
  if (!lid) return null;
  const row = await repoAutorizado().findOne({ where: { lid, ativo: true } });
  return row?.telefone || null;
}

export async function gravarLidNasPessoas(telefone: string, lid: string): Promise<void> {
  if (!telefone || !lid) return;
  await getControlDataSource().query(
    `UPDATE whatsapp_autorizado
        SET lid = $1
      WHERE telefone = $2
        AND (lid IS NULL OR lid <> $1)`,
    [lid, telefone],
  );
}

export async function criarAutorizado(input: {
  contractId: string;
  nome: string;
  telefone: string;
  podeEnviarPlanilha?: boolean;
  podePedirRelatorio?: boolean;
  ativo?: boolean;
}) {
  const nome = String(input.nome || '').trim();
  if (!nome) throw new ErroWhatsappAutorizado(400, 'Informe o nome.');
  if (!input.contractId) throw new ErroWhatsappAutorizado(400, 'Informe o contrato.');
  const tel = validarTelefoneComDdi(input.telefone);
  if (!tel.ok) throw new ErroWhatsappAutorizado(400, tel.erro);
  const repo = repoAutorizado();
  const existe = await repo.findOne({ where: { contractId: input.contractId, telefone: tel.telefone } });
  if (existe) throw new ErroWhatsappAutorizado(409, 'Este telefone já está neste contrato.');
  const salvo = await repo.save(repo.create({
    contractId: input.contractId,
    nome,
    telefone: tel.telefone,
    lid: null,
    podeEnviarPlanilha: input.podeEnviarPlanilha === true,
    podePedirRelatorio: input.podePedirRelatorio === true,
    ativo: input.ativo !== false,
  }));
  const nomes = await nomesDosContratos([salvo.contractId]);
  return paraApi(salvo, nomes.get(salvo.contractId));
}

export async function atualizarAutorizado(id: string, input: {
  nome?: string;
  telefone?: string;
  podeEnviarPlanilha?: boolean;
  podePedirRelatorio?: boolean;
  ativo?: boolean;
  contractId?: string;
}) {
  const repo = repoAutorizado();
  const row = await repo.findOne({ where: { id } });
  if (!row) throw new ErroWhatsappAutorizado(404, 'Pessoa não encontrada.');
  if (input.nome !== undefined) {
    const nome = String(input.nome || '').trim();
    if (!nome) throw new ErroWhatsappAutorizado(400, 'Informe o nome.');
    row.nome = nome;
  }
  if (input.telefone !== undefined) {
    const tel = validarTelefoneComDdi(input.telefone);
    if (!tel.ok) throw new ErroWhatsappAutorizado(400, tel.erro);
    row.telefone = tel.telefone;
  }
  if (input.contractId) row.contractId = input.contractId;
  if (input.podeEnviarPlanilha !== undefined) row.podeEnviarPlanilha = !!input.podeEnviarPlanilha;
  if (input.podePedirRelatorio !== undefined) row.podePedirRelatorio = !!input.podePedirRelatorio;
  if (input.ativo !== undefined) row.ativo = !!input.ativo;
  const duplicata = await repo.findOne({ where: { contractId: row.contractId, telefone: row.telefone } });
  if (duplicata && duplicata.id !== row.id) {
    throw new ErroWhatsappAutorizado(409, 'Este telefone já está neste contrato.');
  }
  const salvo = await repo.save(row);
  const nomes = await nomesDosContratos([salvo.contractId]);
  return paraApi(salvo, nomes.get(salvo.contractId));
}

export async function removerAutorizado(id: string): Promise<void> {
  const repo = repoAutorizado();
  const row = await repo.findOne({ where: { id } });
  if (!row) throw new ErroWhatsappAutorizado(404, 'Pessoa não encontrada.');
  await repo.remove(row);
}

export async function registrarTentativaNaoAutorizada(input: {
  telefone: string;
  nomePerfil: string | null;
  tipo: TipoTentativaWhatsapp;
}): Promise<void> {
  const telefone = String(input.telefone || '').replace(/\D/g, '').slice(0, 32) || 'sem-telefone';
  const repo = repoTentativa();
  await repo.save(repo.create({
    telefone,
    nomePerfil: input.nomePerfil ? input.nomePerfil.slice(0, 160) : null,
    tipo: input.tipo,
  }));
}

export async function listarTentativasNaoAutorizadas(limite = 200) {
  const rows = await repoTentativa().find({
    order: { criadoEm: 'DESC' },
    take: Math.min(Math.max(limite, 1), 500),
  });
  return rows.map((r) => ({
    id: r.id,
    telefone: r.telefone,
    nomePerfil: r.nomePerfil,
    tipo: r.tipo,
    criadoEm: r.criadoEm,
  }));
}

export async function autorizarTentativa(id: string, input: {
  contractId: string;
  telefone?: string;
  nome?: string;
  podeEnviarPlanilha?: boolean;
  podePedirRelatorio?: boolean;
}) {
  const tentativa = await repoTentativa().findOne({ where: { id } });
  if (!tentativa) throw new ErroWhatsappAutorizado(404, 'Tentativa não encontrada.');
  const telefone = input.telefone || tentativa.telefone;
  const nome = String(input.nome || tentativa.nomePerfil || '').trim() || 'WhatsApp';
  const tel = validarTelefoneComDdi(telefone);
  if (!tel.ok) throw new ErroWhatsappAutorizado(400, tel.erro);
  const repo = repoAutorizado();
  const existe = await repo.findOne({ where: { contractId: input.contractId, telefone: tel.telefone } });
  if (existe) {
    return atualizarAutorizado(existe.id, {
      nome,
      podeEnviarPlanilha: input.podeEnviarPlanilha === true,
      podePedirRelatorio: input.podePedirRelatorio === true,
      ativo: true,
    });
  }
  return criarAutorizado({
    contractId: input.contractId,
    nome,
    telefone: tel.telefone,
    podeEnviarPlanilha: input.podeEnviarPlanilha === true,
    podePedirRelatorio: input.podePedirRelatorio === true,
    ativo: true,
  });
}
