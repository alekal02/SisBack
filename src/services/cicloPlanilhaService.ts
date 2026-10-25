import { EntityManager } from 'typeorm';
import AppDataSource from '../database/data-source';
import { PlanilhaUpload } from '../entities/PlanilhaUpload';
import { ColetaData } from '../entities/ColetaData';
import { Contract } from '../entities/Contract';
import { Servico } from '../entities/Servico';
import {
  calcularCicloMensalContrato,
  inferirCicloReferenciaDeDatas,
  inferirMesReferenciaAtual,
  normalizarDiaInicioCiclo,
  restringirDatasAoCicloDaDataMaisRecente,
  type PeriodoCicloContrato,
} from '../utils/periodoCicloContrato';
import { invalidarCacheDadosServico } from './servicoDadosCache';
import { dashboardCache } from './DashboardCacheManager';
import { agendarWarmupPosUpload } from './executivoCacheWarmupService';
import FileStorageService from './FileStorageService';
import PlanilhaService from './PlanilhaService';
import {
  escolherUploadParaBackup,
  garantirPastaBackup,
  nomeArquivoBackupCiclo,
  pastaDestinoBackupCiclo,
} from './planilhaOriginalStorage';
import fs from 'fs/promises';
import path from 'path';

export interface CicloFechadoInfo {
  mesReferencia: number;
  anoReferencia: number;
  dataInicio: string;
  dataFim: string;
  label: string;
  fechadoEm: string;
  uploadIds: number[];
  totalRegistros: number;
}

export interface BackupPlanilhaCicloResultado {
  ok: boolean;
  caminho?: string;
  /** Caminho visível na máquina (ex.: C:\\Sistemma\\planilhas-ciclo\\Contrato\\...) */
  caminhoHost?: string;
  uploadId?: number;
  erro?: string;
  /** true se não havia pasta configurada — backup ignorado de propósito */
  ignorado?: boolean;
}

export interface FiltroUploadsCiclo {
  /** Ciclo específico para consulta histórica */
  mesReferencia?: number;
  anoReferencia?: number;
  /** Apenas uploads ainda abertos (padrão para importação) */
  apenasAbertos?: boolean;
}

async function obterDiaInicioCiclo(servicoId: string): Promise<number> {
  const servicoRepo = AppDataSource.getRepository(Servico);
  const servico = await servicoRepo.findOne({
    where: { id: servicoId },
    relations: ['contract'],
  });
  if (!servico?.contract) return 1;
  return normalizarDiaInicioCiclo(servico.contract.diaInicioCiclo);
}

export async function obterUploadIdsPorServico(
  servicoId: string,
  filtro?: FiltroUploadsCiclo,
  manager?: EntityManager,
): Promise<number[]> {
  const uploadRepo = (manager ?? AppDataSource.manager).getRepository(PlanilhaUpload);
  const qb = uploadRepo.createQueryBuilder('u')
    .select('u.id', 'id')
    .where('u.servico_id = :servicoId', { servicoId });

  if (filtro?.apenasAbertos) {
    qb.andWhere('u.cicloFechadoEm IS NULL');
  }

  if (filtro?.mesReferencia != null && filtro?.anoReferencia != null) {
    qb.andWhere('u.cicloMesReferencia = :mes', { mes: filtro.mesReferencia })
      .andWhere('u.cicloAnoReferencia = :ano', { ano: filtro.anoReferencia });
  }

  const rows = await qb.getRawMany<{ id: number }>();
  return rows.map(r => Number(r.id)).filter(id => Number.isFinite(id));
}

/** Uploads que novas importações podem substituir/apagar */
export async function obterUploadIdsModificaveis(
  servicoId: string,
  manager?: EntityManager,
): Promise<number[]> {
  return obterUploadIdsPorServico(servicoId, { apenasAbertos: true }, manager);
}

/**
 * Apaga registros das datas informadas somente em uploads ABERTOS.
 * Datas que caem em ciclo já fechado são ignoradas (o histórico permanece).
 * Compara `date` do Postgres com yyyy-MM-dd — evita fuso (UTC−3) excluir o 1º dia.
 */
export async function apagarDatasDeUploadsAbertos(
  servicoId: string,
  datasIso: string[],
  manager?: EntityManager,
): Promise<{ data: string; registrosRemovidos: number }[]> {
  const datasValidas = [...new Set(datasIso.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))];
  if (datasValidas.length === 0) return [];

  const { bloqueadas } = await verificarDatasEmCicloFechado(servicoId, datasValidas);
  const bloqueadasSet = new Set(bloqueadas);
  let datas = datasValidas.filter((d) => !bloqueadasSet.has(d));
  datas = restringirDatasAoCicloDaDataMaisRecente(
    datas,
    await obterDiaInicioCiclo(servicoId),
  ).datas;
  if (datas.length === 0) return [];

  const uploadIds = await obterUploadIdsModificaveis(servicoId, manager);
  if (uploadIds.length === 0) return [];

  const coletaRepo = (manager ?? AppDataSource.manager).getRepository(ColetaData);
  const resultado: { data: string; registrosRemovidos: number }[] = [];

  for (const dataStr of datas) {
    const count = await coletaRepo.createQueryBuilder('c')
      .where('c.planilhaUploadId IN (:...uploadIds)', { uploadIds })
      .andWhere('c.dataSaida = :data', { data: dataStr })
      .getCount();
    if (count <= 0) continue;

    await coletaRepo.createQueryBuilder()
      .delete()
      .from('coleta_dados')
      .where('planilhaUploadId IN (:...uploadIds)', { uploadIds })
      .andWhere('"dataSaida" = :data', { data: dataStr })
      .execute();

    resultado.push({ data: dataStr, registrosRemovidos: count });
  }

  return resultado;
}

export function montarAvisoDatasCicloFechado(
  bloqueadas: string[],
  ciclos: { mes: number; ano: number; label: string }[],
): string {
  const labels = ciclos.map((c) => c.label).join(', ');
  return `${bloqueadas.length} data(s) de ciclo já fechado (${labels}) foram ignoradas. `
    + 'O ciclo anterior permanece intacto.';
}

export async function cicloEstaFechado(
  servicoId: string,
  mesReferencia: number,
  anoReferencia: number,
): Promise<boolean> {
  const uploadRepo = AppDataSource.getRepository(PlanilhaUpload);
  const count = await uploadRepo.createQueryBuilder('u')
    .where('u.servico_id = :servicoId', { servicoId })
    .andWhere('u.cicloMesReferencia = :mes', { mes: mesReferencia })
    .andWhere('u.cicloAnoReferencia = :ano', { ano: anoReferencia })
    .andWhere('u.cicloFechadoEm IS NOT NULL')
    .getCount();
  return count > 0;
}

export async function listarCiclosFechados(servicoId: string): Promise<CicloFechadoInfo[]> {
  const uploadRepo = AppDataSource.getRepository(PlanilhaUpload);
  const diaInicio = await obterDiaInicioCiclo(servicoId);

  const uploads = await uploadRepo.find({
    where: { servico_id: servicoId },
    order: { cicloAnoReferencia: 'DESC', cicloMesReferencia: 'DESC', cicloFechadoEm: 'DESC' },
  });

  const fechados = uploads.filter(u => u.cicloFechadoEm != null && u.cicloMesReferencia && u.cicloAnoReferencia);
  const mapa = new Map<string, CicloFechadoInfo>();

  for (const u of fechados) {
    const chave = `${u.cicloAnoReferencia}-${u.cicloMesReferencia}`;
    const periodo = calcularCicloMensalContrato(u.cicloAnoReferencia!, u.cicloMesReferencia!, diaInicio);
    const existente = mapa.get(chave);
    if (!existente) {
      mapa.set(chave, {
        mesReferencia: u.cicloMesReferencia!,
        anoReferencia: u.cicloAnoReferencia!,
        dataInicio: periodo.dataInicio,
        dataFim: periodo.dataFim,
        label: periodo.label,
        fechadoEm: u.cicloFechadoEm!.toISOString(),
        uploadIds: [u.id],
        totalRegistros: 0,
      });
    } else {
      existente.uploadIds.push(u.id);
      if (u.cicloFechadoEm && u.cicloFechadoEm.toISOString() > existente.fechadoEm) {
        existente.fechadoEm = u.cicloFechadoEm.toISOString();
      }
    }
  }

  const coletaRepo = AppDataSource.getRepository(ColetaData);
  for (const info of mapa.values()) {
    if (info.uploadIds.length === 0) continue;
    info.totalRegistros = await coletaRepo.createQueryBuilder('c')
      .where('c.planilhaUploadId IN (:...ids)', { ids: info.uploadIds })
      .getCount();
  }

  return [...mapa.values()].sort((a, b) => {
    if (a.anoReferencia !== b.anoReferencia) return b.anoReferencia - a.anoReferencia;
    return b.mesReferencia - a.mesReferencia;
  });
}

export async function verificarDatasEmCicloFechado(
  servicoId: string,
  datasIso: string[],
): Promise<{ bloqueadas: string[]; ciclos: { mes: number; ano: number; label: string }[] }> {
  const diaInicio = await obterDiaInicioCiclo(servicoId);
  const fechados = await listarCiclosFechados(servicoId);
  if (fechados.length === 0) return { bloqueadas: [], ciclos: [] };

  const bloqueadas = new Set<string>();
  const ciclosHit = new Map<string, { mes: number; ano: number; label: string }>();

  for (const data of datasIso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) continue;
    for (const ciclo of fechados) {
      if (data >= ciclo.dataInicio && data <= ciclo.dataFim) {
        bloqueadas.add(data);
        ciclosHit.set(`${ciclo.anoReferencia}-${ciclo.mesReferencia}`, {
          mes: ciclo.mesReferencia,
          ano: ciclo.anoReferencia,
          label: ciclo.label,
        });
      }
    }
  }

  return {
    bloqueadas: [...bloqueadas].sort(),
    ciclos: [...ciclosHit.values()],
  };
}

export function filtrarDatasAoPeriodo(datas: string[], inicio: string, fim: string): string[] {
  return [...new Set(
    datas.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= inicio && d <= fim),
  )].sort();
}

/**
 * Ciclo da planilha nova = o da data mais recente. Datas de outro ciclo
 * (ex.: mês anterior ainda no Excel) não entram na importação e não são apagadas.
 */
export async function resolverCicloAlvoDaPlanilha(
  servicoId: string,
  datasIso: string[],
): Promise<PeriodoCicloContrato | null> {
  const diaInicio = await obterDiaInicioCiclo(servicoId);
  return restringirDatasAoCicloDaDataMaisRecente(datasIso, diaInicio).ciclo;
}

export async function prepararDatasImportacaoCiclo(
  servicoId: string,
  datasIso: string[],
): Promise<{
  datas: string[];
  cicloAlvo: PeriodoCicloContrato | null;
  avisos: string[];
  bloqueadasFechado: string[];
  ignoradasOutroCiclo: string[];
}> {
  const avisos: string[] = [];
  let datas = [...new Set(datasIso.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();

  const { bloqueadas, ciclos } = await verificarDatasEmCicloFechado(servicoId, datas);
  if (bloqueadas.length > 0) {
    const bloqueadasSet = new Set(bloqueadas);
    datas = datas.filter((d) => !bloqueadasSet.has(d));
    avisos.push(montarAvisoDatasCicloFechado(bloqueadas, ciclos));
  }

  const diaInicio = await obterDiaInicioCiclo(servicoId);
  const restrito = restringirDatasAoCicloDaDataMaisRecente(datas, diaInicio);
  const ignoradasOutroCiclo = restrito.ignoradas;
  datas = restrito.datas;
  const cicloAlvo = restrito.ciclo;
  if (ignoradasOutroCiclo.length > 0 && cicloAlvo) {
    avisos.push(
      `${ignoradasOutroCiclo.length} data(s) de outro ciclo foram ignoradas `
      + `(${ignoradasOutroCiclo[0]} a ${ignoradasOutroCiclo[ignoradasOutroCiclo.length - 1]}). `
      + `Só o ciclo ${cicloAlvo.label} (${cicloAlvo.dataInicio} a ${cicloAlvo.dataFim}) é substituído.`,
    );
  }

  return { datas, cicloAlvo, avisos, bloqueadasFechado: bloqueadas, ignoradasOutroCiclo };
}

export async function aplicarReferenciaCicloNoUpload(
  uploadId: number,
  datasIso: string[],
  diaInicioCiclo: number,
  manager?: EntityManager,
): Promise<void> {
  const ref = inferirCicloReferenciaDeDatas(datasIso, diaInicioCiclo);
  const fallback = inferirMesReferenciaAtual(diaInicioCiclo);
  const uploadRepo = (manager ?? AppDataSource.manager).getRepository(PlanilhaUpload);
  await uploadRepo.update(uploadId, {
    cicloMesReferencia: ref?.mesReferencia ?? fallback.mes,
    cicloAnoReferencia: ref?.anoReferencia ?? fallback.ano,
  });
}

export async function fecharCicloServico(opts: {
  servicoId: string;
  contractId: string;
  mesReferencia: number;
  anoReferencia: number;
}): Promise<{
  ciclo: PeriodoCicloContrato;
  uploadIds: number[];
  totalRegistros: number;
  backupPlanilha: BackupPlanilhaCicloResultado;
}> {
  const { servicoId, contractId, mesReferencia, anoReferencia } = opts;

  const contractRepo = AppDataSource.getRepository(Contract);
  const contract = await contractRepo.findOne({ where: { id: contractId } });
  if (!contract) throw new Error('Contrato não encontrado');

  const diaInicio = normalizarDiaInicioCiclo(contract.diaInicioCiclo);
  const periodo = calcularCicloMensalContrato(anoReferencia, mesReferencia, diaInicio);

  const jaFechado = await cicloEstaFechado(servicoId, mesReferencia, anoReferencia);
  if (jaFechado) {
    throw new Error(`O ciclo ${periodo.label} já está fechado.`);
  }

  const uploadRepo = AppDataSource.getRepository(PlanilhaUpload);
  const coletaRepo = AppDataSource.getRepository(ColetaData);
  const agora = new Date();

  // Uploads com dados neste período (compara date ISO, sem fuso)
  const uploadIdsComDados = await coletaRepo.createQueryBuilder('c')
    .innerJoin(PlanilhaUpload, 'u', 'u.id = c.planilhaUploadId AND u.servico_id = :servicoId', { servicoId })
    .select('DISTINCT c.planilhaUploadId', 'uploadId')
    .where('c.dataSaida BETWEEN :inicio AND :fim', {
      inicio: periodo.dataInicio,
      fim: periodo.dataFim,
    })
    .getRawMany<{ uploadId: number }>();

  const idsSet = new Set<number>(
    uploadIdsComDados.map(r => Number(r.uploadId)).filter(id => Number.isFinite(id)),
  );

  // Uploads já marcados para este ciclo (mesmo sem dados ainda)
  const uploadsMarcados = await uploadRepo.find({
    where: {
      servico_id: servicoId,
      cicloMesReferencia: mesReferencia,
      cicloAnoReferencia: anoReferencia,
    },
    select: ['id'],
  });
  for (const u of uploadsMarcados) idsSet.add(u.id);

  const uploadIds = [...idsSet];
  if (uploadIds.length === 0) {
    throw new Error(`Nenhuma planilha com dados no ciclo ${periodo.label} para fechar.`);
  }

  // Se a mesma planilha tem dias do ciclo seguinte, separa antes de travar.
  // Sem isso o upload inteiro fecha e o próximo arquivo apaga/esconde o histórico.
  for (const uploadId of uploadIds) {
    await separarRegistrosForaDoCiclo(uploadId, servicoId, periodo.dataInicio, periodo.dataFim, diaInicio);
  }

  await uploadRepo.createQueryBuilder()
    .update(PlanilhaUpload)
    .set({
      cicloFechadoEm: agora,
      cicloMesReferencia: mesReferencia,
      cicloAnoReferencia: anoReferencia,
    })
    .where('id IN (:...uploadIds)', { uploadIds })
    .andWhere('servico_id = :servicoId', { servicoId })
    .execute();

  const totalRegistros = await coletaRepo.createQueryBuilder('c')
    .where('c.planilhaUploadId IN (:...uploadIds)', { uploadIds })
    .andWhere('c.dataSaida BETWEEN :inicio AND :fim', {
      inicio: periodo.dataInicio,
      fim: periodo.dataFim,
    })
    .getCount();

  invalidarCacheDadosServico(servicoId);
  dashboardCache.invalidar(servicoId);
  agendarWarmupPosUpload(servicoId);

  const backupPlanilha = await salvarUltimaPlanilhaNaPastaBackup({
    contract,
    servicoId,
    uploadIds,
    mesReferencia,
    anoReferencia,
    dataInicio: periodo.dataInicio,
    dataFim: periodo.dataFim,
  });

  return { ciclo: periodo, uploadIds, totalRegistros, backupPlanilha };
}

export async function reabrirCicloServico(opts: {
  servicoId: string;
  contractId: string;
  mesReferencia: number;
  anoReferencia: number;
}): Promise<{ ciclo: PeriodoCicloContrato; uploadIds: number[] }> {
  const { servicoId, contractId, mesReferencia, anoReferencia } = opts;
  const contractRepo = AppDataSource.getRepository(Contract);
  const contract = await contractRepo.findOne({ where: { id: contractId } });
  if (!contract) throw new Error('Contrato não encontrado');

  const diaInicio = normalizarDiaInicioCiclo(contract.diaInicioCiclo);
  const periodo = calcularCicloMensalContrato(anoReferencia, mesReferencia, diaInicio);

  const jaFechado = await cicloEstaFechado(servicoId, mesReferencia, anoReferencia);
  if (!jaFechado) {
    throw new Error(`O ciclo ${periodo.label} não está fechado.`);
  }

  const uploadRepo = AppDataSource.getRepository(PlanilhaUpload);
  const uploads = await uploadRepo.find({
    where: {
      servico_id: servicoId,
      cicloMesReferencia: mesReferencia,
      cicloAnoReferencia: anoReferencia,
    },
    select: ['id'],
  });
  const uploadIds = uploads.map((u) => u.id);
  if (uploadIds.length === 0) {
    throw new Error(`Nenhuma planilha encontrada para reabrir o ciclo ${periodo.label}.`);
  }

  await uploadRepo.createQueryBuilder()
    .update(PlanilhaUpload)
    .set({ cicloFechadoEm: null })
    .where('id IN (:...uploadIds)', { uploadIds })
    .andWhere('servico_id = :servicoId', { servicoId })
    .execute();

  invalidarCacheDadosServico(servicoId);
  dashboardCache.invalidar(servicoId);
  agendarWarmupPosUpload(servicoId);

  return { ciclo: periodo, uploadIds };
}

async function separarRegistrosForaDoCiclo(
  uploadId: number,
  servicoId: string,
  dataInicio: string,
  dataFim: string,
  diaInicioCiclo: number,
): Promise<void> {
  const coletaRepo = AppDataSource.getRepository(ColetaData);
  const uploadRepo = AppDataSource.getRepository(PlanilhaUpload);

  const qtdFora = await coletaRepo.createQueryBuilder('c')
    .where('c.planilhaUploadId = :uploadId', { uploadId })
    .andWhere('(c.dataSaida < :inicio OR c.dataSaida > :fim)', { inicio: dataInicio, fim: dataFim })
    .getCount();
  if (qtdFora === 0) return;

  const origem = await uploadRepo.findOne({ where: { id: uploadId } });
  if (!origem) return;

  const continuacao = await uploadRepo.save(uploadRepo.create({
    nomeArquivo: origem.nomeArquivo,
    totalLinhas: qtdFora,
    linhasImportadas: qtdFora,
    linhasComErro: 0,
    linhasIgnoradas: 0,
    linhasSubstituidas: 0,
    linhasConflitantes: 0,
    estrategia: origem.estrategia || 'atualizar_data',
    usuarioId: origem.usuarioId,
    servico_id: servicoId,
    urlDownload: origem.urlDownload,
    cicloFechadoEm: null,
    resumo: {
      novos: qtdFora,
      duplicadosIgnorados: 0,
      conflitantes: 0,
      substituidos: 0,
      modelo: 'continuacao-ciclo-aberto',
    },
  }));

  await coletaRepo.createQueryBuilder()
    .update(ColetaData)
    .set({ planilhaUploadId: continuacao.id })
    .where('planilhaUploadId = :uploadId', { uploadId })
    .andWhere('("dataSaida" < :inicio OR "dataSaida" > :fim)', { inicio: dataInicio, fim: dataFim })
    .execute();

  const datasFora = await coletaRepo.createQueryBuilder('c')
    .select("DISTINCT to_char(c.dataSaida, 'YYYY-MM-DD')", 'data')
    .where('c.planilhaUploadId = :id', { id: continuacao.id })
    .andWhere('c.dataSaida IS NOT NULL')
    .getRawMany<{ data: string }>();

  await aplicarReferenciaCicloNoUpload(
    continuacao.id,
    datasFora.map((r) => r.data).filter(Boolean),
    diaInicioCiclo,
  );

  const restantes = await coletaRepo.count({ where: { planilhaUploadId: uploadId } });
  origem.linhasImportadas = restantes;
  if (origem.resumo) {
    origem.resumo = { ...origem.resumo, viagensValidasDashboard: restantes };
  }
  await uploadRepo.save(origem);
}

function pastaBackupPadrao(contract: Contract): string {
  return pastaDestinoBackupCiclo({
    numeroContrato: contract.numeroContrato || 'contrato',
    pastaConfigurada: contract.configOperacional?.pastaBackupPlanilhas,
  }).pastaAbs;
}

function sanitizarParteNome(parte: string): string {
  return String(parte || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 60) || 'Servico';
}

async function salvarUltimaPlanilhaNaPastaBackup(opts: {
  contract: Contract;
  servicoId: string;
  uploadIds: number[];
  mesReferencia: number;
  anoReferencia: number;
  dataInicio: string;
  dataFim: string;
}): Promise<BackupPlanilhaCicloResultado> {
  const destino = pastaDestinoBackupCiclo({
    numeroContrato: opts.contract.numeroContrato || 'contrato',
    pastaConfigurada: opts.contract.configOperacional?.pastaBackupPlanilhas,
  });

  try {
    const uploadRepo = AppDataSource.getRepository(PlanilhaUpload);
    const candidatos = await uploadRepo
      .createQueryBuilder('u')
      .where('u.id IN (:...ids)', { ids: opts.uploadIds })
      .orderBy('u.criadoEm', 'DESC')
      .getMany();

    const ultimo = escolherUploadParaBackup(candidatos);
    if (!ultimo) {
      return { ok: false, erro: 'Nenhum upload encontrado para backup' };
    }

    const servicoRepo = AppDataSource.getRepository(Servico);
    const servico = await servicoRepo.findOne({
      where: { id: opts.servicoId },
      select: ['id', 'nome'],
    });
    const nomeServico = sanitizarParteNome(servico?.nome || 'Servico');
    const nomeDestino = nomeArquivoBackupCiclo({
      dataInicio: opts.dataInicio,
      dataFim: opts.dataFim,
      nomeServico,
      nomeOriginal: ultimo.nomeArquivo,
    });

    let buffer: Buffer;
    if (ultimo.urlDownload) {
      try {
        buffer = await FileStorageService.downloadArquivo(ultimo.urlDownload);
      } catch (errMinio) {
        console.warn('[cicloPlanilha] Falha MinIO no backup, usando export regenerado:', errMinio);
        const exp = await PlanilhaService.exportarPlanilha(ultimo.id);
        buffer = exp.buffer;
      }
    } else {
      const exp = await PlanilhaService.exportarPlanilha(ultimo.id);
      buffer = exp.buffer;
    }

    await garantirPastaBackup(destino.pastaAbs);
    const caminhoFinal = path.join(destino.pastaAbs, nomeDestino);
    await fs.writeFile(caminhoFinal, buffer);
    const caminhoHost = path.join(destino.caminhoHost, nomeDestino);

    console.log(`[cicloPlanilha] Backup da planilha salvo: ${caminhoFinal} → ${caminhoHost} (upload ${ultimo.id})`);
    return { ok: true, caminho: caminhoHost, caminhoHost, uploadId: ultimo.id };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[cicloPlanilha] Erro ao salvar backup da planilha:', msg);
    return { ok: false, erro: msg };
  }
}
