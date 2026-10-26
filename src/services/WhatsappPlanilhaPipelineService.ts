import { diretorioInboxWhatsapp } from './webhookCorpoStream';
import fs from 'fs';
import path from 'path';
import AppDataSource, {
  getCurrentTenantDb,
  isMultiTenant,
  runWithTenant,
} from '../database/data-source';
import { buscarRoteamentoGrupo } from './whatsappRoteamentoService';
import { WhatsappGrupoMapa } from '../entities/WhatsappGrupoMapa';
import { Servico } from '../entities/Servico';
import { Contract } from '../entities/Contract';
import { TipoServico } from '../enums/TipoServico';
import DeduplicacaoService from './DeduplicacaoService';
import RocadaImportService from './rocadaImportService';
import ServicosUnificadosImportService from './servicosUnificadosImportService';
import ConsolidadoProducaoImportService from './consolidadoProducaoImportService';
import { estrategiaSubstituiDatasProducao } from './substituicaoImportacaoProducao';
import { classificarPlanilhaContrato } from './planilhaContratoClassifier';
import { obterServicoPorTipoContrato } from './servicosPadraoContratoService';
import PlanilhaService from './PlanilhaService';
import { invalidarCacheSaudeContratos } from '../controllers/ContractController';
import { fraseDiasHash, importacaoRegravouDados } from './importacaoDiaHash';
import { marcarOrigemPlanilhaUpload } from './planilhaOriginalStorage';
import { liberarNavegadorPdf } from './PdfGeneratorService';
import wuzapiService from './WuzapiService';
import {
  extrairTextoMensagem,
  processarComandoTextoWhatsapp,
  sessaoComandoAtiva,
} from './WhatsappComandoRelatorioService';
import { textoMereceProcessamento } from './WhatsappComandoRelatorioTexto';
import {
  analisarConferenciaPlanilhaVsSistema,
  type RelatorioAgenteUpload,
} from './agenteConferenciaUploadService';
import {
  conferenciaDoUpload,
  gravarAlertasArquivoEm,
  idsDeUploads,
  mensagemWhatsappDeConferencias,
} from './conferenciaImportacaoService';
import {
  codigoFalhaMensagem,
  decidirRetomadaAposQueda,
  listarMensagensRecuperaveis,
  marcarFalhaMensagemWhatsapp,
  marcarSucessoMensagemWhatsapp,
  MOTIVO_INTERROMPIDO,
  reservarMensagemWhatsapp,
  textoFalhaImportacao,
  textoGrupoNaoConfigurado,
} from './WhatsappMensagemLedger';
import { liberarTrabalhoPesado, ocuparTrabalhoPesado } from './trabalhoPesado';
import {
  decidirEscopoDaMensagem,
  registrarRecebimentoWhatsapp,
} from './whatsappEscopoGrupo';

const EXT_PLANILHA = /\.(xlsx|xls|xlsm)$/i;
const MIME_PLANILHA = /spreadsheet|excel|ms-excel|officedocument\.spreadsheetml|octet-stream/i;

export interface WuzapiWebhookPayload {
  type?: string;
  event?: {
    Info?: {
      ID?: string;
      Chat?: string;
      Sender?: string;
      IsFromMe?: boolean;
      IsGroup?: boolean;
      PushName?: string;
      Timestamp?: string;
      MediaType?: string;
    };
    Message?: {
      documentMessage?: {
        url?: string;
        URL?: string;
        mimetype?: string;
        fileName?: string;
        title?: string;
        fileSHA256?: string | Uint8Array;
        fileEncSHA256?: string | Uint8Array;
        fileLength?: number | string;
        mediaKey?: string | Uint8Array;
        directPath?: string;
        DirectPath?: string;
      };
      DocumentMessage?: Record<string, unknown>;
    };
  };
  base64?: string;
  /** Planilha grande gravada em disco para não estourar a memória nem o banco. */
  base64Arquivo?: string;
  mimeType?: string;
  fileName?: string;
  userID?: string;
  instanceName?: string;
  jsonData?: string;
}

/** Normaliza body form/json da WuzAPI para o formato esperado. */
export function normalizarPayloadWebhook(body: unknown): WuzapiWebhookPayload {
  if (!body || typeof body !== 'object') return {};
  const raw = body as Record<string, any>;

  if (typeof raw.jsonData === 'string') {
    try {
      const parsed = JSON.parse(raw.jsonData);
      return {
        ...parsed,
        userID: raw.userID || parsed.userID,
        instanceName: raw.instanceName || parsed.instanceName,
        base64: raw.base64 || parsed.base64,
        base64Arquivo: raw.base64Arquivo || parsed.base64Arquivo,
        mimeType: raw.mimeType || parsed.mimeType,
        fileName: raw.fileName || parsed.fileName,
      };
    } catch {
      /* segue com raw */
    }
  }

  // Alguns builds mandam event como string JSON
  if (typeof raw.event === 'string') {
    try {
      raw.event = JSON.parse(raw.event);
    } catch { /* ignore */ }
  }

  return raw as WuzapiWebhookPayload;
}

function normalizarGrupoJid(chat: string): string {
  const raw = String(chat || '').trim();
  if (!raw) return '';
  if (raw.includes('@')) return raw;
  return `${raw}@g.us`;
}

const BASE64_DISCO_A_PARTIR = 512 * 1024;

function pastaInboxWhatsapp(): string {
  return diretorioInboxWhatsapp();
}

function nomeArquivoInbox(messageId: string): string {
  const seguro = messageId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
  return `${seguro || 'msg'}.b64`;
}

function arquivoInboxPermitido(arquivo: string): string | null {
  const dir = path.resolve(pastaInboxWhatsapp());
  const alvo = path.resolve(arquivo);
  if (alvo !== dir && !alvo.startsWith(dir + path.sep)) return null;
  return alvo;
}

/** Recusa caminho fora da pasta da inbox (webhook não pode ler arquivo arbitrário). */
export function caminhoInboxPermitido(arquivo: string): string | null {
  return arquivoInboxPermitido(arquivo);
}

/**
 * Tira o base64 grande da memória e do JSON gravado no Postgres.
 * Na máquina de destino o heap é 768 MB: duas planilhas no banco reiniciavam o backend no meio do envio.
 */
export async function prepararPayloadPlanilhaWhatsapp(
  payload: WuzapiWebhookPayload,
  messageId: string,
): Promise<WuzapiWebhookPayload> {
  const base64 = payload.base64;
  if (typeof base64 !== 'string' || base64.length < BASE64_DISCO_A_PARTIR) return payload;
  const dir = pastaInboxWhatsapp();
  const arquivo = path.join(dir, nomeArquivoInbox(messageId));
  let gravou = false;
  try {
    await fs.promises.mkdir(dir, { recursive: true });
    try {
      const handle = await fs.promises.open(arquivo, 'wx');
      await handle.writeFile(base64);
      await handle.close();
      gravou = true;
    } catch (err: any) {
      if (err?.code !== 'EEXIST') throw err;
      gravou = true;
    }
  } catch (err: any) {
    console.warn('[WhatsappPipeline] Não foi possível gravar a planilha em disco:', err?.message || err);
  }
  const copia: WuzapiWebhookPayload = { ...payload };
  delete copia.base64;
  if (gravou) {
    copia.base64Arquivo = arquivo;
    return copia;
  }
  Object.defineProperty(copia, 'base64', { value: base64, enumerable: false });
  return copia;
}

async function lerBase64Arquivo(arquivo: string): Promise<string | null> {
  const permitido = arquivoInboxPermitido(arquivo);
  if (!permitido) return null;
  try {
    return await fs.promises.readFile(permitido, 'utf8');
  } catch {
    return null;
  }
}

async function apagarBase64Arquivo(payload: WuzapiWebhookPayload): Promise<void> {
  const arquivo = payload.base64Arquivo;
  if (!arquivo) return;
  const permitido = arquivoInboxPermitido(arquivo);
  if (!permitido) return;
  try {
    await fs.promises.unlink(permitido);
  } catch {
    /* já removido */
  }
}

let filaProcessamento: Promise<unknown> = Promise.resolve();

function enfileirarProcessamento<T>(fn: () => Promise<T>): Promise<T> {
  const run = filaProcessamento.then(fn, fn);
  filaProcessamento = run.then(() => undefined, () => undefined);
  return run;
}

async function avisarGrupoWhatsapp(grupoJid: string, texto: string): Promise<void> {
  if (!grupoJid.endsWith('@g.us') || !wuzapiService.isConfigured) return;
  try {
    await wuzapiService.enviarTexto(grupoJid, texto);
  } catch (err: any) {
    console.error('[WhatsappPipeline] Falha ao avisar o grupo:', err?.message || err);
  }
}

function bytesToBase64(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    // Go serializa []byte como base64 no JSON do webhook
    if (/^[A-Za-z0-9+/]+={0,2}$/.test(value) && value.length % 4 === 0) return value;
    try {
      return Buffer.from(value, 'utf8').toString('base64');
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) {
    return Buffer.from(value).toString('base64');
  }
  if (typeof value === 'object' && value !== null && 'data' in (value as object)) {
    const data = (value as { data: number[] }).data;
    if (Array.isArray(data)) return Buffer.from(data).toString('base64');
  }
  return null;
}

function extrairDocumento(payload: WuzapiWebhookPayload) {
  const msg = payload.event?.Message || {};
  const doc = (msg.documentMessage || msg.DocumentMessage || {}) as Record<string, any>;
  const fileName =
    payload.fileName ||
    doc.fileName ||
    doc.FileName ||
    doc.title ||
    '';
  const mimetype = payload.mimeType || doc.mimetype || doc.Mimetype || '';
  return { doc, fileName: String(fileName), mimetype: String(mimetype) };
}

function isPlanilha(fileName: string, mimetype: string): boolean {
  if (EXT_PLANILHA.test(fileName)) return true;
  if (mimetype && MIME_PLANILHA.test(mimetype) && EXT_PLANILHA.test(fileName || '.xlsx')) return true;
  return false;
}

async function obterBufferPlanilha(payload: WuzapiWebhookPayload, doc: Record<string, any>): Promise<{ buffer: Buffer; nomeArquivo: string }> {
  const { fileName } = extrairDocumento(payload);
  const nome = fileName || `planilha_${Date.now()}.xlsx`;

  if (payload.base64Arquivo) {
    const doDisco = await lerBase64Arquivo(payload.base64Arquivo);
    if (doDisco) {
      const raw = doDisco.includes(',') ? doDisco.split(',').pop()! : doDisco;
      return { buffer: Buffer.from(raw, 'base64'), nomeArquivo: nome };
    }
  }

  if (payload.base64) {
    const raw = payload.base64.includes(',')
      ? payload.base64.split(',').pop()!
      : payload.base64;
    return { buffer: Buffer.from(raw, 'base64'), nomeArquivo: nome };
  }

  const url = doc.url || doc.URL || '';
  const directPath = doc.directPath || doc.DirectPath || '';
  const mediaKey = bytesToBase64(doc.mediaKey || doc.MediaKey);
  const fileSHA256 = bytesToBase64(doc.fileSHA256 || doc.FileSHA256);
  const fileEncSHA256 = bytesToBase64(doc.fileEncSHA256 || doc.FileEncSHA256);
  const fileLength = Number(doc.fileLength || doc.FileLength || 0);
  const mimetype = doc.mimetype || doc.Mimetype || 'application/octet-stream';

  if ((!url && !directPath) || !mediaKey || !fileSHA256 || !fileLength) {
    throw new Error('Webhook sem base64 e sem metadados suficientes para baixar o documento.');
  }

  let downloaded: { data: string; mimetype?: string };
  try {
    downloaded = await wuzapiService.downloadDocument({
      Url: String(url),
      DirectPath: String(directPath),
      Mimetype: String(mimetype),
      MediaKey: mediaKey,
      FileSHA256: fileSHA256,
      FileEncSHA256: fileEncSHA256 || undefined,
      FileLength: fileLength,
    });
  } catch (err: any) {
    throw new Error(
      `${err?.message || 'erro ao baixar do WhatsApp'}. `
      + 'Reenvie a planilha como documento (não como encaminhamento antigo).',
    );
  }

  if (!downloaded.data) {
    throw new Error('Download do documento retornou vazio.');
  }

  const raw = downloaded.data.includes(',')
    ? downloaded.data.split(',').pop()!
    : downloaded.data;

  return { buffer: Buffer.from(raw, 'base64'), nomeArquivo: nome };
}

type AlvoImportWhatsapp = {
  servicoId: string;
  servicoNome: string;
  tipo: string;
  importados: number;
};

type ResultadoImportWhatsapp = {
  planilhaUploadId?: number;
  planilhaUploadIds?: number[];
  importadas: number;
  totalLinhas?: number;
  tipoDetectado: string;
  tipoDetectadoLabel: string;
  mensagem: string;
  diasAtualizados?: number;
  diasIguais?: number;
  conferencia?: RelatorioAgenteUpload;
  /** Serviços que receberam dados (ex.: Capina + Roçada no CONSOLIDADO) */
  alvos: AlvoImportWhatsapp[];
};

/**
 * Mesma lógica do upload por contrato: classifica a planilha e grava no serviço certo.
 * O serviço mapeado no grupo define o contrato; o conteúdo define o(s) tipo(s).
 */
async function importarPlanilha(
  buffer: Buffer,
  nomeArquivo: string,
  servicoMapa: Servico,
  estrategia: string,
): Promise<ResultadoImportWhatsapp> {
  const contractId = servicoMapa.contract_id;
  if (!contractId) {
    throw new Error('Serviço mapeado sem contrato');
  }

  const classificacao = classificarPlanilhaContrato(buffer);
  const est = (estrategia || 'atualizar_data') as 'ignorar' | 'substituir' | 'atualizar_data' | 'inserir_data';
  const substituir = estrategiaSubstituiDatasProducao(est);

  if (classificacao.tipo === 'consolidado_producao') {
    const r = await ConsolidadoProducaoImportService.importarPorContrato(
      buffer,
      nomeArquivo,
      contractId,
      undefined,
      substituir,
    );
    if (importacaoRegravouDados(r)) invalidarCacheSaudeContratos(contractId);
    const alvos = (r.splitPorServico || [])
      .filter((s) => s.importados > 0)
      .map((s) => ({
        servicoId: s.servicoId,
        servicoNome: s.servicoNome,
        tipo: String(s.tipoSistema),
        importados: s.importados,
      }));
    const partes = alvos.map((s) => `${s.servicoNome}: ${s.importados} reg.`);
    const avisoDup = (r.avisos || []).find((a) => a.includes('já estavam no sistema') || a.includes('repetida'));
    const fraseDias = r.diasAtualizados != null && r.diasIguais != null
      ? fraseDiasHash(r.diasAtualizados, r.diasIguais)
      : '';
    const mioloProducao = [partes.join(' · '), fraseDias, avisoDup || ''].filter(Boolean).join('. ');
    return {
      planilhaUploadId: r.planilhaUploadId,
      planilhaUploadIds: idsDeUploads(r),
      importadas: r.importados,
      totalLinhas: r.totalLinhas,
      tipoDetectado: classificacao.tipo,
      tipoDetectadoLabel: classificacao.label,
      diasAtualizados: r.diasAtualizados,
      diasIguais: r.diasIguais,
      mensagem: `Produção: ${r.importados} registro(s).${mioloProducao ? ` ${mioloProducao}.` : ''}`,
      alvos: alvos.length
        ? alvos
        : [{
            servicoId: servicoMapa.id,
            servicoNome: servicoMapa.nome,
            tipo: String(servicoMapa.tipo || ''),
            importados: r.importados,
          }],
    };
  }

  if (classificacao.tipo === 'unificado') {
    const r = await ServicosUnificadosImportService.importarPorContrato(
      buffer,
      nomeArquivo,
      contractId,
      undefined,
      substituir,
    );
    invalidarCacheSaudeContratos(contractId);
    const alvos = (r.splitPorServico || [])
      .filter((s) => s.importados > 0)
      .map((s) => ({
        servicoId: s.servicoId,
        servicoNome: s.servicoNome,
        tipo: String(s.tipoSistema),
        importados: s.importados,
      }));
    const partes = alvos.map((s) => `${s.servicoNome}: ${s.importados} reg.`);
    const avisoDup = (r.avisos || []).find((a) => a.includes('já estavam no sistema') || a.includes('repetida'));
    return {
      planilhaUploadId: r.planilhaUploadId,
      planilhaUploadIds: idsDeUploads(r),
      importadas: r.importados,
      totalLinhas: r.totalLinhas,
      tipoDetectado: classificacao.tipo,
      tipoDetectadoLabel: classificacao.label,
      mensagem: `Planilha unificada: ${r.importados} registro(s). ${partes.join(' · ')}${avisoDup ? ` ${avisoDup}` : ''}`,
      alvos: alvos.length
        ? alvos
        : [{
            servicoId: servicoMapa.id,
            servicoNome: servicoMapa.nome,
            tipo: String(servicoMapa.tipo || ''),
            importados: r.importados,
          }],
    };
  }

  if (classificacao.tipo === 'coleta') {
    const alvo = await obterServicoPorTipoContrato(contractId, TipoServico.COLETA_CAMINHAO);
    const conferencia = await analisarConferenciaPlanilhaVsSistema(buffer, nomeArquivo, alvo.id);
    const r = (est === 'atualizar_data' || est === 'inserir_data')
      ? await DeduplicacaoService.importarPorData(buffer, nomeArquivo, est, undefined, alvo.id, 'whatsapp')
      : await DeduplicacaoService.importarComDedup(
        buffer,
        nomeArquivo,
        est === 'substituir' ? 'substituir' : 'ignorar',
        undefined,
        alvo.id,
        'whatsapp',
      );
    const qtd = Number((r as { importados?: number }).importados ?? 0);
    const diasColeta = r as { diasAtualizados?: number; diasIguais?: number };
    const fraseColeta = diasColeta.diasAtualizados != null && diasColeta.diasIguais != null
      ? fraseDiasHash(diasColeta.diasAtualizados, diasColeta.diasIguais)
      : '';
    if ((r as { planilhaUploadId?: number }).planilhaUploadId) {
      await atualizarPadraoServicoAposImport(alvo.id, buffer, nomeArquivo, r.planilhaUploadId, r.totalLinhas);
    }
    if (importacaoRegravouDados({
      diasAtualizados: diasColeta.diasAtualizados,
      datasApagadas: (r as { datasApagadas?: unknown[] }).datasApagadas,
      diasRemovidosAusentes: (r as { diasRemovidosAusentes?: unknown[] }).diasRemovidosAusentes,
      importados: qtd,
    })) {
      invalidarCacheSaudeContratos(contractId);
    }
    return {
      planilhaUploadId: r.planilhaUploadId,
      planilhaUploadIds: idsDeUploads(r),
      importadas: qtd,
      totalLinhas: r.totalLinhas,
      tipoDetectado: classificacao.tipo,
      tipoDetectadoLabel: classificacao.label,
      diasAtualizados: diasColeta.diasAtualizados,
      diasIguais: diasColeta.diasIguais,
      mensagem: `Coleta importada em “${alvo.nome}”: ${qtd} registro(s).${fraseColeta ? ` ${fraseColeta}.` : ''}`,
      conferencia,
      alvos: [{
        servicoId: alvo.id,
        servicoNome: alvo.nome,
        tipo: String(alvo.tipo || TipoServico.COLETA_CAMINHAO),
        importados: qtd,
      }],
    };
  }

  if (classificacao.tipo === 'rocada') {
    const alvo = await obterServicoPorTipoContrato(contractId, TipoServico.ROCADEIRA);
    const r = await RocadaImportService.importar(buffer, nomeArquivo, alvo.id, undefined, substituir);
    invalidarCacheSaudeContratos(contractId);
    const avisoDup = (r.avisos || []).find((a) => a.includes('já estavam no sistema') || a.includes('repetida'));
    return {
      planilhaUploadId: r.planilhaUploadId,
      planilhaUploadIds: idsDeUploads(r),
      importadas: r.importados,
      totalLinhas: r.totalLinhas,
      tipoDetectado: classificacao.tipo,
      tipoDetectadoLabel: classificacao.label,
      mensagem: `Roçada importada em “${alvo.nome}”: ${r.importados} registro(s).${avisoDup ? ` ${avisoDup}` : ''}`,
      alvos: [{
        servicoId: alvo.id,
        servicoNome: alvo.nome,
        tipo: String(alvo.tipo || TipoServico.ROCADEIRA),
        importados: r.importados,
      }],
    };
  }

  throw new Error(
    'Formato de planilha não reconhecido. Use CONSOLIDADO (SERVIÇO/DATA/QUANTIDADE), unificado (TIPO DE SERVIÇO), Coleta (PLACA/PESO) ou Roçada.',
  );
}

/** Detecta colunas e salva padraoPlanilha (necessário para a UI marcar upload). */
async function atualizarPadraoServicoAposImport(
  servicoId: string,
  buffer: Buffer,
  nomeArquivo: string,
  planilhaUploadId?: number,
  totalLinhas?: number,
): Promise<void> {
  try {
    const { detectarPadraoPlanilha } = await import('./PadraoPlanilhaDetector');
    const { gerarConfigGraficosPadrao, reResolverGraficos } = await import('./graficosPadrao');
    const { buildConfigDashboardPadraoColeta } = await import('../config/dashboardPadraoColeta');

    const servicoRepo = AppDataSource.getRepository(Servico);
    const servico = await servicoRepo.findOne({ where: { id: servicoId } });
    if (!servico) return;

    const colunas = detectarPadraoPlanilha(buffer);
    const colunasNomes = colunas.map((c: { nome: string }) => c.nome);
    const graficosAtuais = servico.configDashboard?.graficos || [];
    const graficosReResolvidos = graficosAtuais.length > 0
      ? reResolverGraficos(graficosAtuais, colunasNomes)
      : gerarConfigGraficosPadrao(servico.tipo || 'coleta_caminhao', colunasNomes);

    servico.padraoPlanilha = {
      colunas,
      totalLinhas: totalLinhas ?? 0,
      ultimoUpload: planilhaUploadId,
      ultimoUploadNome: nomeArquivo,
      detectadoEm: new Date().toISOString(),
    };

    const cfgAtual = servico.configDashboard || {};
    const tipoColeta = servico.tipo === TipoServico.COLETA_CAMINHAO || servico.tipo === 'coleta_caminhao';
    const padraoColeta = tipoColeta ? buildConfigDashboardPadraoColeta() : null;
    const semKpis = !cfgAtual.kpis?.length;

    servico.configDashboard = {
      ...cfgAtual,
      kpis: semKpis && padraoColeta ? padraoColeta.kpis : cfgAtual.kpis,
      graficos: graficosReResolvidos,
      rankingsOperacionais: cfgAtual.rankingsOperacionais ?? padraoColeta?.rankingsOperacionais,
      reResolvidoEm: new Date().toISOString(),
      reResolvido: true,
      graficosPadraoAplicados: true,
      graficosPadraoTotal: graficosReResolvidos.length,
      ...(semKpis && padraoColeta ? { dashboardPadraoVersao: padraoColeta.dashboardPadraoVersao } : {}),
    };

    await servicoRepo.save(servico);
  } catch (err: any) {
    console.warn('[WhatsappPipeline] Falha ao gravar padraoPlanilha:', err?.message || err);
  }
}

/**
 * Processa mensagem de grupo com planilha: importa + gera PDF do dia + responde no grupo.
 */
export class WhatsappPlanilhaPipelineService {
  /**
   * Reserva a mensagem antes do HTTP 200.
   * Se o banco cair, a exceção sobe e o webhook responde 5xx para a WuzAPI tentar de novo.
   */
  async aceitarWebhook(rawPayload: unknown): Promise<{
    status: number;
    body: Record<string, unknown>;
    continuar: (() => Promise<unknown>) | null;
  }> {
    const payload = normalizarPayloadWebhook(rawPayload);
    if (payload.type && payload.type !== 'Message') {
      return { status: 200, body: { sucesso: true, recebido: true, ignorado: true }, continuar: null };
    }
    const info = payload.event?.Info;
    const chat = String(info?.Chat || '');
    const isGroup = info?.IsGroup === true || chat.endsWith('@g.us');
    if (!info || !isGroup) {
      return {
        status: 200,
        body: { sucesso: true, recebido: true, ignorado: 'conversa_privada' },
        continuar: null,
      };
    }

    const grupoJid = normalizarGrupoJid(chat);
    const escopo = await decidirEscopoDaMensagem({ isGroup: true, grupoJid });
    if (escopo !== 'autorizado') {
      return {
        status: 200,
        body: { sucesso: true, recebido: true, ignorado: escopo },
        continuar: null,
      };
    }

    const { fileName, mimetype } = extrairDocumento(payload);
    const parecePlanilha = isPlanilha(fileName, mimetype) || EXT_PLANILHA.test(fileName || '');
    const textoMsg = extrairTextoMensagem(payload);
    const pedidoRelatorio = sessaoComandoAtiva(grupoJid) || textoMereceProcessamento(textoMsg);
    if (!parecePlanilha && !pedidoRelatorio) {
      return {
        status: 200,
        body: { sucesso: true, recebido: true, ignorado: 'conversa' },
        continuar: null,
      };
    }

    if (isMultiTenant() && !getCurrentTenantDb()) {
      const rota = await buscarRoteamentoGrupo(grupoJid);
      if (rota) return runWithTenant(rota.tenantDb, () => this.aceitarWebhook(rawPayload));
    }

    const msgId = String(info.ID || '').trim();
    const payloadParaFila = msgId
      ? await prepararPayloadPlanilhaWhatsapp(payload, msgId)
      : payload;
    if (msgId) {
      const reserva = await reservarMensagemWhatsapp({
        messageId: msgId,
        grupoJid,
        payload: payloadParaFila,
      });
      if (reserva.acao === 'ignorar') {
        return {
          status: 200,
          body: { sucesso: true, recebido: true, duplicata: true },
          continuar: null,
        };
      }
    }

    const tenantDb = getCurrentTenantDb();
    return {
      status: 200,
      body: { sucesso: true, recebido: true },
      continuar: () => this.processarEmFila(payloadParaFila, tenantDb),
    };
  }

  /** Uma planilha ou um relatório por vez, com o Chrome fechado antes e depois. */
  processarEmFila(payload: unknown, tenantDb?: string | null): Promise<unknown> {
    return enfileirarProcessamento(async () => {
      ocuparTrabalhoPesado();
      try {
        await liberarNavegadorPdf();
        const run = () => this.processarWebhook(payload, { reservaPronta: true });
        return tenantDb ? await runWithTenant(tenantDb, run) : await run();
      } finally {
        liberarTrabalhoPesado();
        await liberarNavegadorPdf();
      }
    });
  }

  async processarWebhook(
    rawPayload: WuzapiWebhookPayload | unknown,
    opts?: { reservaPronta?: boolean },
  ): Promise<{
    processado: boolean;
    motivo?: string;
    resultado?: Record<string, unknown>;
  }> {
    const payload = normalizarPayloadWebhook(rawPayload);

    if (payload.type && payload.type !== 'Message') {
      return { processado: false, motivo: `Evento ignorado: ${payload.type}` };
    }

    const info = payload.event?.Info;
    if (!info) {
      return { processado: false, motivo: 'Payload sem Info' };
    }

    const chat = String(info.Chat || '');
    const isGroup = info.IsGroup === true || chat.endsWith('@g.us');
    if (!isGroup) {
      return { processado: false, motivo: 'Conversa privada ignorada' };
    }

    const grupoJid = normalizarGrupoJid(chat);
    const escopo = await decidirEscopoDaMensagem({ isGroup: true, grupoJid });
    if (escopo !== 'autorizado') {
      return { processado: false, motivo: 'Grupo não autorizado' };
    }
    if (isMultiTenant() && !getCurrentTenantDb()) {
      const rota = await buscarRoteamentoGrupo(grupoJid);
      if (rota) {
        return runWithTenant(rota.tenantDb, () => this.processarWebhook(rawPayload, opts));
      }
    }

    const msgId = String(info.ID || '').trim();
    let reservou = false;
    if (msgId && !opts?.reservaPronta) {
      const reserva = await reservarMensagemWhatsapp({
        messageId: msgId,
        grupoJid,
        payload: rawPayload,
      });
      if (reserva.acao === 'ignorar') {
        return { processado: false, motivo: reserva.motivo || `Duplicata ignorada: ${msgId}` };
      }
      reservou = true;
    } else if (msgId && opts?.reservaPronta) {
      reservou = true;
    }

    try {
      const resultado = await this.processarGrupoReservado(payload, grupoJid, info);
      const encerrado = await this.encerrarMensagem(msgId, reservou, grupoJid, resultado);
      if (encerrado.processado) await apagarBase64Arquivo(payload);
      return encerrado;
    } catch (err: any) {
      const detalhe = err?.message || 'erro desconhecido';
      if (msgId && reservou) {
        await marcarFalhaMensagemWhatsapp(msgId, detalhe, 'erro_processamento');
      }
      await avisarGrupoWhatsapp(grupoJid, textoFalhaImportacao(detalhe));
      throw err;
    }
  }

  private async encerrarMensagem(
    msgId: string,
    reservou: boolean,
    grupoJid: string,
    resultado: { processado: boolean; motivo?: string; resultado?: Record<string, unknown> },
  ) {
    if (!msgId || !reservou) return resultado;
    const codigo = codigoFalhaMensagem(resultado.motivo);
    if (codigo) {
      await marcarFalhaMensagemWhatsapp(msgId, resultado.motivo || codigo, codigo);
      if (codigo === 'grupo_nao_mapeado') {
        return resultado;
      }
      if (codigo === 'servico_nao_encontrado') {
        await avisarGrupoWhatsapp(grupoJid, textoGrupoNaoConfigurado());
      } else if (codigo !== 'wuzapi_nao_configurada') {
        await avisarGrupoWhatsapp(grupoJid, textoFalhaImportacao(resultado.motivo || codigo));
      }
      return resultado;
    }
    await marcarSucessoMensagemWhatsapp(msgId, resultado.motivo || null);
    return resultado;
  }

  private async processarGrupoReservado(
    payload: WuzapiWebhookPayload,
    grupoJid: string,
    info: { IsFromMe?: boolean; Sender?: string },
  ): Promise<{
    processado: boolean;
    motivo?: string;
    resultado?: Record<string, unknown>;
  }> {
    const textoMsg = extrairTextoMensagem(payload);

    // Comandos de texto (relatorio / ciclo / comparativo) — antes do fluxo de planilha
    if (textoMsg && !payload.base64) {
      const { doc: docChk, fileName: fnChk, mimetype: mimeChk } = extrairDocumento(payload);
      const temDocChk = !!(docChk && Object.keys(docChk).length > 0);
      if (!temDocChk || (!isPlanilha(fnChk, mimeChk) && !EXT_PLANILHA.test(fnChk))) {
        const cmd = await processarComandoTextoWhatsapp({
          grupoJid,
          texto: textoMsg,
          isFromMe: info.IsFromMe === true,
        });
        if (cmd.processado) {
          registrarRecebimentoWhatsapp({
            grupoJid,
            nomeGrupo: null,
            tipo: 'relatorio',
            resumo: textoMsg.slice(0, 80),
          });
          return { processado: true, motivo: 'comando-texto', resultado: { comando: true } };
        }
      }
    }

    const { doc, fileName, mimetype } = extrairDocumento(payload);
    const temDocumento = !!(doc && Object.keys(doc).length > 0) || !!payload.base64;

    // Mensagens próprias (IsFromMe) só entram se forem planilha/documento —
    // permite testar enviando do mesmo número conectado.
    if (info.IsFromMe && !temDocumento) {
      return { processado: false, motivo: 'Mensagem própria ignorada' };
    }

    if (!temDocumento) {
      return { processado: false, motivo: 'Sem documento na mensagem' };
    }

    if (!isPlanilha(fileName, mimetype) && !payload.base64) {
      if (!MIME_PLANILHA.test(mimetype) && !EXT_PLANILHA.test(fileName)) {
        return { processado: false, motivo: `Arquivo não é planilha: ${fileName || mimetype}` };
      }
    }
    if (fileName && !EXT_PLANILHA.test(fileName) && !payload.base64) {
      return { processado: false, motivo: `Extensão ignorada: ${fileName}` };
    }

    const mapaRepo = AppDataSource.getRepository(WhatsappGrupoMapa);
    const mapa = await mapaRepo.findOne({
      where: { grupoJid, ativo: true },
      relations: ['servico', 'servico.contract'],
    });

    if (!mapa) {
      console.warn(`[WhatsappPipeline] Grupo sem mapeamento: ${grupoJid}`);
      return { processado: false, motivo: `Grupo não mapeado: ${grupoJid}` };
    }

    const servico = mapa.servico
      || await AppDataSource.getRepository(Servico).findOne({
        where: { id: mapa.servicoId },
        relations: ['contract'],
      });

    if (!servico) {
      return { processado: false, motivo: 'Serviço do mapeamento não encontrado' };
    }

    if (!wuzapiService.isConfigured) {
      return { processado: false, motivo: 'WuzAPI não configurada (WUZAPI_URL/WUZAPI_TOKEN)' };
    }

    const tamanhoMb = Number(doc.fileLength || doc.FileLength || 0) / (1024 * 1024);
    const tamanhoTxt = tamanhoMb >= 0.1 ? ` (${tamanhoMb.toFixed(1)} MB)` : '';
    registrarRecebimentoWhatsapp({
      grupoJid,
      nomeGrupo: mapa.nomeGrupo,
      tipo: 'planilha',
      resumo: fileName || 'planilha',
    });
    console.log(`[WhatsappPipeline] Importando ${fileName || 'planilha'}${tamanhoTxt} grupo=${grupoJid}`);
    await avisarGrupoWhatsapp(
      grupoJid,
      `Recebi a planilha *${fileName || 'arquivo'}*${tamanhoTxt}. Estou importando. Pode levar alguns minutos.`,
    );

    const { buffer, nomeArquivo: nomeRaw } = await obterBufferPlanilha(payload, doc);
    const nomeArquivo = EXT_PLANILHA.test(nomeRaw) ? nomeRaw : `${nomeRaw.replace(/\.[^.]+$/, '') || 'planilha'}.xlsx`;
    const importResult = await importarPlanilha(buffer, nomeArquivo, servico, mapa.estrategia);
    const idsUpload = importResult.planilhaUploadIds?.length
      ? importResult.planilhaUploadIds
      : (importResult.planilhaUploadId ? [importResult.planilhaUploadId] : []);
    for (const id of idsUpload) {
      await marcarOrigemPlanilhaUpload(id, 'whatsapp');
    }
    try {
      await gravarAlertasArquivoEm(idsUpload, buffer);
    } catch (err: any) {
      console.warn('[WhatsappPipeline] Alertas da conferência:', err?.message || err);
    }

    return this.posImport(servico, grupoJid, nomeArquivo, importResult);
  }

  private async posImport(
    servicoMapa: Servico,
    grupoJid: string,
    nomeArquivo: string,
    importResult: ResultadoImportWhatsapp,
  ) {
    const contrato = (servicoMapa as Servico & { contract?: Contract }).contract
      || await AppDataSource.getRepository(Contract).findOne({ where: { id: servicoMapa.contract_id } });
    const contratoNome = contrato?.numeroContrato || '—';
    const diasPorServico: Array<{ nome: string; dia: string | null }> = [];

    for (const alvo of importResult.alvos) {
      if (alvo.importados <= 0) continue;
      try {
        const { mergePlacasAtivasPorUpload } = await import('./mergePlacasAtivasContratoService');
        await mergePlacasAtivasPorUpload(alvo.servicoId, importResult.planilhaUploadId);
      } catch (err: any) {
        console.warn('[WhatsappPipeline] Merge placas:', err?.message || err);
      }
    }

    for (const alvo of importResult.alvos) {
      if (alvo.importados <= 0) continue;
      try {
        const periodo = await PlanilhaService.getPeriodoDadosPorServico(alvo.servicoId);
        diasPorServico.push({ nome: alvo.servicoNome, dia: periodo?.dataFim || null });
      } catch {
        diasPorServico.push({ nome: alvo.servicoNome, dia: null });
      }
    }

    const idsUpload = importResult.planilhaUploadIds?.length
      ? importResult.planilhaUploadIds
      : (importResult.planilhaUploadId ? [importResult.planilhaUploadId] : []);
    const conferencias = [];
    for (const id of idsUpload) {
      const conferencia = await conferenciaDoUpload(id);
      if (conferencia) conferencias.push(conferencia);
    }
    const nomeGrupo = conferencias.length > 1 && conferencias.every((c) => c.tipo === 'producao')
      ? 'Produção'
      : undefined;
    const textoConferencia = mensagemWhatsappDeConferencias(conferencias, nomeGrupo);
    const servicosTxt = importResult.alvos
      .filter((a) => a.importados > 0)
      .map((a) => `${a.servicoNome} (${a.importados})`)
      .join(' · ');
    const diasTxt = diasPorServico
      .filter((d) => d.dia)
      .map((d) => `${d.nome}: ${String(d.dia).split('-').reverse().join('/')}`)
      .join(' · ');
    const fraseDias = importResult.diasAtualizados != null && importResult.diasIguais != null
      ? fraseDiasHash(importResult.diasAtualizados, importResult.diasIguais)
      : null;
    const cabeca = fraseDias && importResult.importadas === 0 && (importResult.diasIguais ?? 0) > 0
      ? `✅ Planilha já estava igual. ${fraseDias}.`
      : `✅ ${importResult.importadas} registro(s) importado(s)`;
    const rodape = 'Para o PDF, envie *dia 16/09* com a data desejada. Saúde: *saude*.';
    const resumo = textoConferencia
      ? `${textoConferencia}\n${rodape}`
      : [
        cabeca,
        fraseDias && importResult.importadas > 0 ? fraseDias : null,
        servicosTxt ? servicosTxt : null,
        `Contrato: ${contratoNome}`,
        diasTxt ? `Último dia: ${diasTxt}` : null,
        rodape,
      ].filter(Boolean).join('\n');
    try {
      await wuzapiService.enviarTexto(grupoJid, resumo);
    } catch { /* ignore */ }

    return {
      processado: true,
      resultado: {
        grupoJid,
        contrato: contratoNome,
        nomeArquivo,
        tipoDetectado: importResult.tipoDetectado,
        importadas: importResult.importadas,
        planilhaUploadId: importResult.planilhaUploadId,
        alvos: importResult.alvos,
        diasPorServico,
        pdfSaudeEnviado: false,
        pdfDiarioEnviado: false,
      },
    };
  }
}

async function limparInboxAntiga(): Promise<void> {
  try {
    const dir = pastaInboxWhatsapp();
    const nomes = await fs.promises.readdir(dir);
    const limite = Date.now() - 48 * 60 * 60 * 1000;
    for (const nome of nomes) {
      const arquivo = arquivoInboxPermitido(path.join(dir, nome));
      if (!arquivo) continue;
      const st = await fs.promises.stat(arquivo);
      if (st.mtimeMs < limite) await fs.promises.unlink(arquivo).catch(() => undefined);
    }
  } catch {
    /* pasta ainda não existe */
  }
}

export async function recuperarMensagensWhatsappPendentes(): Promise<number> {
  await limparInboxAntiga();
  let pendentes: Awaited<ReturnType<typeof listarMensagensRecuperaveis>> = [];
  try {
    pendentes = await listarMensagensRecuperaveis();
  } catch (err: any) {
    console.error('[WhatsappLedger] Falha ao listar pendências:', err?.message || err);
    return 0;
  }
  const pipeline = new WhatsappPlanilhaPipelineService();
  let retomadas = 0;
  for (const item of pendentes) {
    if (!item.payload) continue;
    const retomada = decidirRetomadaAposQueda(item.tentativas, item.motivo);
    if (retomada === 'ignorar') continue;
    if (retomada === 'abandonar') {
      await marcarFalhaMensagemWhatsapp(
        item.messageId,
        'Interrompida para o servidor não reiniciar de novo',
        MOTIVO_INTERROMPIDO,
      );
      if (item.grupoJid && wuzapiService.isConfigured) {
        try {
          await wuzapiService.enviarTexto(
            item.grupoJid,
            '⚠️ A mensagem anterior foi interrompida porque o servidor ficou sem fôlego. Envie a planilha ou o pedido de relatório de novo.',
          );
        } catch { /* grupo pode estar indisponível no boot */ }
      }
      continue;
    }
    try {
      const reserva = await reservarMensagemWhatsapp({
        messageId: item.messageId,
        grupoJid: item.grupoJid,
        payload: item.payload,
        recuperacaoAutomatica: true,
        recuperarInterrompidos: true,
      });
      if (reserva.acao !== 'processar') continue;
      await pipeline.processarEmFila(item.payload, getCurrentTenantDb());
      retomadas++;
    } catch (err: any) {
      console.error('[WhatsappLedger] Reprocessamento falhou e o lote parou:', item.messageId, err?.message || err);
      break;
    }
  }
  if (retomadas > 0) {
    console.log(`[WhatsappLedger] ${retomadas} mensagem(ns) retomada(s)`);
  }
  return retomadas;
}

export default new WhatsappPlanilhaPipelineService();
