import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { EntityManager } from 'typeorm';
import AppDataSource from '../database/data-source';
import { PlanilhaUpload } from '../entities/PlanilhaUpload';
import { Servico } from '../entities/Servico';
import { slugificarContrato } from '../utils/slugContrato';
import {
  calcularCicloMensalContrato,
  inferirMesReferenciaDeData,
  isoHojeLocal,
  normalizarDiaInicioCiclo,
} from '../utils/periodoCicloContrato';

export type OrigemPlanilhaUpload = 'whatsapp' | 'web';

type ExecutarSql = (sql: string, params?: unknown[]) => Promise<unknown>;

/** Grava o arquivo original em arquivos_storage e devolve a url db://arquivos/... */
export async function gravarEmArquivosStorage(
  caminho: string,
  buffer: Buffer,
  mime: string,
  executar: ExecutarSql = (sql, params) => AppDataSource.query(sql, params),
): Promise<string> {
  if (!buffer?.length) throw new Error('Arquivo original da planilha está vazio.');
  const pathNorm = String(caminho || '').replace(/^\/+/, '').replace(/\\/g, '/');
  if (!pathNorm || pathNorm.includes('..')) throw new Error('Caminho do arquivo original inválido.');
  await executar(
    `INSERT INTO arquivos_storage (id, caminho, content_type, tamanho, conteudo)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (caminho) DO UPDATE
       SET content_type = EXCLUDED.content_type,
           tamanho = EXCLUDED.tamanho,
           conteudo = EXCLUDED.conteudo`,
    [crypto.randomUUID(), pathNorm, mime || 'application/octet-stream', buffer.length, buffer],
  );
  return `db://arquivos/${pathNorm}`;
}

function mimePlanilha(nomeArquivo: string): string {
  const ext = path.extname(nomeArquivo).toLowerCase();
  if (ext === '.xls') return 'application/vnd.ms-excel';
  if (ext === '.csv') return 'text/csv';
  if (ext === '.ods') return 'application/vnd.oasis.opendocument.spreadsheet';
  return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
}

function extensaoPlanilha(nomeArquivo: string): string {
  const ext = path.extname(nomeArquivo).toLowerCase();
  return ['.xlsx', '.xls', '.xlsm', '.csv', '.ods'].includes(ext) ? ext : '.xlsx';
}

/** Pastas estáveis: contratos/{slug}/ciclo-{ini}_{fim}/consolidado + diario/{data}. */
export function pathMinioCicloContrato(opts: {
  numeroContrato: string;
  dataInicio: string;
  dataFim: string;
  ext?: string;
  dataDiario?: string | null;
}): { pasta: string; consolidado: string; diario: string | null } {
  const slug = slugificarContrato(opts.numeroContrato)
    || sanitizarNomePastaContrato(opts.numeroContrato).toLowerCase();
  const ext = opts.ext || '.xlsm';
  const pasta = `contratos/${slug}/ciclo-${opts.dataInicio}_${opts.dataFim}`;
  return {
    pasta,
    consolidado: `${pasta}/consolidado${ext}`,
    diario: opts.dataDiario ? `${pasta}/diario/${opts.dataDiario}${ext}` : null,
  };
}

/** Guarda o arquivo original (o do chatbot / upload) no MinIO e no registro. */
export async function persistirArquivoOriginalUpload(
  uploadId: number,
  buffer: Buffer,
  nomeArquivo: string,
  dataOperacao?: string | null,
  manager?: EntityManager,
): Promise<string | null> {
  if (!uploadId || !buffer?.length) {
    throw new Error('Arquivo original da planilha não foi gravado.');
  }
  try {
    const mime = mimePlanilha(nomeArquivo);
    const ext = extensaoPlanilha(nomeArquivo);
    const dataIso = (dataOperacao && /^\d{4}-\d{2}-\d{2}$/.test(dataOperacao))
      ? dataOperacao
      : isoHojeLocal();

    let numeroContrato = '';
    let diaInicio = 1;
    const repos = manager ?? AppDataSource.manager;
    const upload = await repos.getRepository(PlanilhaUpload).findOne({ where: { id: uploadId } });
    if (upload?.servico_id) {
      const servico = await repos.getRepository(Servico).findOne({
        where: { id: upload.servico_id },
        relations: ['contract'],
      });
      numeroContrato = servico?.contract?.numeroContrato || '';
      diaInicio = normalizarDiaInicioCiclo(servico?.contract?.diaInicioCiclo);
    }

    const query = (sql: string, params?: unknown[]) => repos.query(sql, params);
    let url: string;
    if (numeroContrato) {
      const ref = inferirMesReferenciaDeData(dataIso, diaInicio);
      const ciclo = calcularCicloMensalContrato(ref.ano, ref.mes, diaInicio);
      const paths = pathMinioCicloContrato({
        numeroContrato,
        dataInicio: ciclo.dataInicio,
        dataFim: ciclo.dataFim,
        ext,
        dataDiario: dataIso,
      });
      await gravarEmArquivosStorage(paths.consolidado, buffer, mime, query);
      url = await gravarEmArquivosStorage(paths.diario as string, buffer, mime, query);
    } else {
      url = await gravarEmArquivosStorage(`planilhas/${crypto.randomUUID()}${ext}`, buffer, mime, query);
    }
    if (!url.startsWith('db://arquivos/')) {
      throw new Error('Arquivo original não vinculado em arquivos_storage.');
    }

    await repos.getRepository(PlanilhaUpload).update(uploadId, { urlDownload: url });
    return url;
  } catch (err) {
    console.warn('[planilhaOriginal] Falha ao guardar arquivo original em arquivos_storage:', err);
    throw err;
  }
}

export async function marcarOrigemPlanilhaUpload(
  uploadId: number,
  origem: OrigemPlanilhaUpload,
): Promise<void> {
  if (!uploadId) return;
  const repo = AppDataSource.getRepository(PlanilhaUpload);
  const u = await repo.findOne({ where: { id: uploadId } });
  if (!u) return;
  u.resumo = {
    novos: u.resumo?.novos ?? 0,
    duplicadosIgnorados: u.resumo?.duplicadosIgnorados ?? 0,
    conflitantes: u.resumo?.conflitantes ?? 0,
    substituidos: u.resumo?.substituidos ?? 0,
    ...u.resumo,
    origem,
  };
  await repo.save(u);
}

export interface UploadCandidatoBackup {
  id: number;
  criadoEm: Date;
  urlDownload?: string | null;
  nomeArquivo?: string;
  resumo?: { origem?: string; modelo?: string } | null;
}

/**
 * Última planilha real do ciclo: prefere a do chatbot (WhatsApp) com arquivo original.
 */
export function escolherUploadParaBackup(uploads: UploadCandidatoBackup[]): UploadCandidatoBackup | null {
  if (!uploads.length) return null;
  const ordenados = [...uploads].sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime());
  const reais = ordenados.filter((u) => u.resumo?.modelo !== 'continuacao-ciclo-aberto');
  const pool = reais.length ? reais : ordenados;
  const whatsapp = pool.find((u) => u.resumo?.origem === 'whatsapp' && u.urlDownload);
  if (whatsapp) return whatsapp;
  const comArquivo = pool.find((u) => !!u.urlDownload);
  if (comArquivo) return comArquivo;
  return pool[0];
}

export function sanitizarNomePastaContrato(parte: string): string {
  return String(parte || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 60) || 'contrato';
}

function isoParaBrArquivo(iso: string): string {
  const [y, m, d] = String(iso || '').split('-');
  if (!y || !m || !d) return iso.replace(/[^\d-]/g, '') || 'ciclo';
  return `${d}-${m}-${y}`;
}

/** Ex.: 25-07-2026_a_24-08-2026_Coleta.xlsx */
export function nomeArquivoBackupCiclo(opts: {
  dataInicio: string;
  dataFim: string;
  nomeServico: string;
  nomeOriginal?: string | null;
}): string {
  const inicio = isoParaBrArquivo(opts.dataInicio);
  const fim = isoParaBrArquivo(opts.dataFim);
  const servico = sanitizarNomePastaContrato(opts.nomeServico || 'Servico');
  const ext = path.extname(String(opts.nomeOriginal || '')).toLowerCase() || '.xlsx';
  const extOk = ['.xlsx', '.xls', '.csv', '.ods'].includes(ext) ? ext : '.xlsx';
  return `${inicio}_a_${fim}_${servico}${extOk}`;
}

export function pastaDestinoBackupCiclo(opts: {
  numeroContrato: string;
  pastaConfigurada?: string | null;
  volumeMontado?: boolean;
  hostDir?: string;
}): { pastaAbs: string; caminhoHost: string } {
  const nome = sanitizarNomePastaContrato(opts.numeroContrato);
  const hostDir = String(opts.hostDir || process.env.PLANILHAS_BACKUP_HOST_DIR || 'planilhas-ciclo')
    .trim()
    .replace(/^\.[\\/]/, '')
    .replace(/[\\/]+$/, '') || 'planilhas-ciclo';
  const base = path.isAbsolute(hostDir) ? hostDir : path.resolve(process.cwd(), hostDir);
  const pastaAbs = path.join(base, nome);
  return { pastaAbs, caminhoHost: pastaAbs };
}

/**
 * Pasta configurada no contrato → caminho que o processo do backend consegue gravar.
 * @deprecated use pastaDestinoBackupCiclo
 */
export function resolverPastaBackupPlanilhas(pastaRaw: string, fallbackAbsoluto: string): string {
  return pastaDestinoBackupCiclo({
    numeroContrato: path.basename(fallbackAbsoluto) || 'contrato',
    pastaConfigurada: pastaRaw,
  }).pastaAbs;
}

export async function garantirPastaBackup(pastaAbs: string): Promise<void> {
  await fs.mkdir(pastaAbs, { recursive: true });
}
