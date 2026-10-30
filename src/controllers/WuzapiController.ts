import { Request, Response } from 'express';
import AppDataSource from '../database/data-source';
import { WhatsappGrupoMapa } from '../entities/WhatsappGrupoMapa';
import { Servico } from '../entities/Servico';
import wuzapiService, { redigirSegredos } from '../services/WuzapiService';
import whatsappPlanilhaPipeline from '../services/WhatsappPlanilhaPipelineService';
import {
  removerRoteamentoWhatsapp,
  sincronizarRoteamentoWhatsapp,
} from '../services/whatsappRoteamentoService';
import {
  invalidarGruposAutorizados,
  listarRecebimentosWhatsapp,
} from '../services/whatsappEscopoGrupo';
import {
  assinaturaRecebida,
  segredoRecebidoWebhook,
  segredoWebhookConfere,
  urlSemSegredoWebhook,
  webhookHmacDeveRecusar,
} from '../services/wuzapiWebhookAuth';

export class WuzapiController {
  /**
   * POST /api/wuzapi/webhook
   * Recebe eventos da WuzAPI (sem JWT — validação opcional por secret).
   */
  async webhook(req: Request, res: Response): Promise<void> {
    try {
      const pedido = req as Request & { rawBody?: Buffer; hmacSha256?: string };
      const corpo = Buffer.isBuffer(pedido.rawBody) ? pedido.rawBody : null;
      const hmacKey = (
        process.env.WUZAPI_WEBHOOK_HMAC_KEY
        || process.env.WUZAPI_GLOBAL_HMAC_KEY
        || ''
      ).trim();
      if (webhookHmacDeveRecusar({
        exigir: process.env.WUZAPI_WEBHOOK_ENFORCE === 'true',
        segredo: hmacKey,
        corpo,
        assinatura: assinaturaRecebida(req.headers as Record<string, unknown>),
        hmacCalculado: pedido.hmacSha256,
      })) {
        res.status(401).json({ sucesso: false, erro: 'Webhook não autenticado' });
        return;
      }

      const secret = wuzapiService.webhookSecret;
      if (secret) {
        const recebido = segredoRecebidoWebhook(
          req.headers as Record<string, unknown>,
          req.query as Record<string, unknown>,
        );
        if (!segredoWebhookConfere(secret, recebido)) {
          res.status(401).json({ sucesso: false, erro: 'Webhook secret inválido' });
          return;
        }
      }

      // Reserva antes do 200. Se o registro falhar, a WuzAPI pode reenviar.
      const aceite = await whatsappPlanilhaPipeline.aceitarWebhook(req.body);
      res.status(aceite.status).json(aceite.body);
      if (aceite.continuar) {
        setImmediate(() => {
          aceite.continuar!().catch((err: any) => {
            console.error('[WuzapiWebhook] Erro no pipeline:', err?.message || err);
          });
        });
      }
    } catch (error: any) {
      console.error('[WuzapiWebhook] Erro:', error?.message || error);
      if (!res.headersSent) {
        res.status(503).json({
          sucesso: false,
          erro: 'Falha ao registrar a mensagem. A WuzAPI pode reenviar.',
        });
      }
    }
  }

  /** GET /api/wuzapi/status — só a instância gravada no banco; sem token e sem número cru */
  async status(_req: Request, res: Response): Promise<void> {
    try {
      const tela = await wuzapiService.consultarParaTela();
      const base = {
        configurado: wuzapiService.isConfigured,
        url: process.env.WUZAPI_URL || null,
        tokenExiste: tela.instanciaPropria,
        webhookSecretExiste: !!process.env.WUZAPI_WEBHOOK_SECRET,
        webhookUrl: urlSemSegredoWebhook(wuzapiService.webhookUrl),
        nomeInstancia: tela.nomeInstancia,
        instanciaPropria: tela.instanciaPropria,
        statusConexao: tela.statusConexao,
        numeroMascarado: tela.numeroMascarado,
        alertaWebhook: tela.alertaWebhook,
      };
      if (!wuzapiService.isConfigured) {
        res.json({
          ...base,
          sessao: null,
          qrCode: null,
          conectado: false,
          logado: false,
          statusConexao: 'deslogado',
          mensagem: 'Configure WUZAPI_URL no .env',
        });
        return;
      }
      let qrCode: string | null = null;
      if (tela.instanciaPropria && tela.connected && !tela.loggedIn) {
        try {
          const qr = await wuzapiService.getQRCode();
          qrCode = qr.qrCode || null;
          if (qrCode && !qrCode.startsWith('data:')) {
            qrCode = `data:image/png;base64,${qrCode}`;
          }
        } catch {
          qrCode = null;
        }
      }
      res.json({
        ...base,
        sessao: null,
        qrCode,
        conectado: tela.connected,
        logado: tela.loggedIn,
        erroSessao: tela.erroSessao ? redigirSegredos(tela.erroSessao) : undefined,
        wuzapiOffline: tela.offline,
        wuzapiOnline: !tela.offline,
        mensagem: tela.offline
          ? 'WuzAPI offline. Suba: docker compose up -d wuzapi-db wuzapi'
          : undefined,
      });
    } catch (error: any) {
      res.status(500).json({ sucesso: false, erro: redigirSegredos(error?.message || 'Erro') });
    }
  }

  /** POST /api/wuzapi/connect — inicia sessão e prepara QR */
  async connect(_req: Request, res: Response): Promise<void> {
    try {
      if (!wuzapiService.isConfigured) {
        res.status(400).json({
          sucesso: false,
          erro: 'WuzAPI não configurada. Defina WUZAPI_URL e WUZAPI_TOKEN no .env',
        });
        return;
      }
      const resultado = await wuzapiService.conectarSessao();
      let qrCode: string | null = null;
      if (!resultado.logado) {
        try {
          await new Promise((r) => setTimeout(r, 1200));
          const qr = await wuzapiService.getQRCode();
          qrCode = qr.qrCode || null;
          if (qrCode && !qrCode.startsWith('data:')) {
            qrCode = `data:image/png;base64,${qrCode}`;
          }
        } catch { /* QR pode demorar */ }
      }

      res.json({
        sucesso: true,
        message: resultado.message,
        qrCode,
        conectado: resultado.connected,
        logado: resultado.logado,
        nomeInstancia: resultado.nomeInstancia,
        numeroMascarado: resultado.numeroMascarado,
        statusConexao: resultado.statusConexao,
        alertaWebhook: resultado.alertaWebhook,
      });
    } catch (error: any) {
      const msg = redigirSegredos(String(error?.message || 'Erro ao conectar'));
      const offline = /ECONNREFUSED|inacess[ií]vel|ENOTFOUND|EHOSTUNREACH/i.test(msg);
      res.status(offline ? 503 : 500).json({
        sucesso: false,
        erro: offline
          ? `${msg} Suba com: docker compose up -d wuzapi-db wuzapi`
          : msg,
        wuzapiOffline: offline,
      });
    }
  }

  /** POST /api/wuzapi/disconnect — logout / encerra sessão WhatsApp */
  async disconnect(_req: Request, res: Response): Promise<void> {
    try {
      if (!wuzapiService.isConfigured) {
        res.status(400).json({
          sucesso: false,
          erro: 'WuzAPI não configurada. Defina WUZAPI_URL e WUZAPI_TOKEN no .env',
        });
        return;
      }
      const resultado = await wuzapiService.desconectarSessao();
      res.json({
        sucesso: true,
        message: resultado.message,
        conectado: false,
        logado: false,
        qrCode: null,
      });
    } catch (error: any) {
      const msg = redigirSegredos(String(error?.message || 'Erro ao desconectar'));
      const offline = /ECONNREFUSED|inacess[ií]vel|ENOTFOUND|EHOSTUNREACH/i.test(msg);
      res.status(offline ? 503 : 500).json({
        sucesso: false,
        erro: offline
          ? `${msg} Suba com: docker compose up -d wuzapi-db wuzapi`
          : msg,
        wuzapiOffline: offline,
      });
    }
  }

  /** POST /api/wuzapi/nova-conexao — nova instância própria; só apaga a anterior do Sistemma */
  async novaConexao(req: Request, res: Response): Promise<void> {
    try {
      if (!process.env.WUZAPI_URL?.trim()) {
        res.status(400).json({ sucesso: false, erro: 'WuzAPI não configurada. Defina WUZAPI_URL no .env' });
        return;
      }
      const resultado = await wuzapiService.gerarNovaConexao({
        confirmacao: req.body?.confirmacao,
      });
      let qrCode: string | null = null;
      if (!resultado.logado) {
        try {
          await new Promise((r) => setTimeout(r, 1200));
          const qr = await wuzapiService.getQRCode();
          qrCode = qr.qrCode || null;
          if (qrCode && !qrCode.startsWith('data:')) {
            qrCode = `data:image/png;base64,${qrCode}`;
          }
        } catch { /* QR pode demorar */ }
      }
      res.json({
        sucesso: true,
        message: resultado.message,
        qrCode,
        conectado: resultado.connected,
        logado: resultado.logado,
        nomeInstancia: resultado.nomeInstancia,
        numeroMascarado: resultado.numeroMascarado,
        statusConexao: resultado.statusConexao,
        alertaWebhook: resultado.alertaWebhook,
      });
    } catch (error: any) {
      const msg = redigirSegredos(String(error?.message || 'Erro ao gerar nova conexão'));
      const recusa = /NOVA CONEXAO/.test(msg);
      res.status(recusa ? 400 : 500).json({ sucesso: false, erro: msg });
    }
  }

  /** GET /api/wuzapi/qr — QR da instância própria */
  async qr(_req: Request, res: Response): Promise<void> {
    try {
      if (!wuzapiService.isConfigured) {
        res.status(400).json({ sucesso: false, erro: 'WuzAPI não configurada' });
        return;
      }
      if (!(await wuzapiService.temInstanciaPropria())) {
        res.status(400).json({ sucesso: false, erro: 'Não há instância própria do Sistemma. Clique em Conectar.' });
        return;
      }
      const qr = await wuzapiService.getQRCode();
      let qrCode = qr.qrCode || null;
      if (qrCode && !qrCode.startsWith('data:')) {
        qrCode = `data:image/png;base64,${qrCode}`;
      }
      res.json({ sucesso: true, qrCode });
    } catch (error: any) {
      res.status(500).json({ sucesso: false, erro: redigirSegredos(error?.message || 'Erro ao obter QR') });
    }
  }

  /** GET /api/wuzapi/grupos-whatsapp — grupos reais da conta WhatsApp */
  async listarGruposWhatsApp(_req: Request, res: Response): Promise<void> {
    try {
      if (!wuzapiService.isConfigured) {
        res.status(400).json({ error: 'WuzAPI não configurada' });
        return;
      }
      if (!(await wuzapiService.temInstanciaPropria())) {
        res.status(400).json({ error: 'Não há instância própria do Sistemma. Clique em Conectar.' });
        return;
      }
      const st = await wuzapiService.getStatus();
      if (!st.loggedIn) {
        res.status(400).json({ error: 'WhatsApp não está logado. Conecte e escaneie o QR primeiro.' });
        return;
      }

      const lista = await wuzapiService.listarGruposWhatsApp();
      const mapaRepo = AppDataSource.getRepository(WhatsappGrupoMapa);
      const mapeados = await mapaRepo.find({ select: ['grupoJid'] });
      const jidsMapeados = new Set(mapeados.map((m) => m.grupoJid));

      res.json({
        grupos: lista.map((g) => ({
          ...g,
          jaMapeado: jidsMapeados.has(g.jid),
        })),
      });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || 'Erro ao listar grupos do WhatsApp' });
    }
  }

  /** GET /api/wuzapi/recebimentos — só grupos autorizados, sem conteúdo de outras conversas */
  async recebimentos(_req: Request, res: Response): Promise<void> {
    res.json({ recebimentos: listarRecebimentosWhatsapp() });
  }

  /** GET /api/wuzapi/grupos */
  async listarGrupos(_req: Request, res: Response): Promise<void> {
    try {
      const repo = AppDataSource.getRepository(WhatsappGrupoMapa);
      const lista = await repo.find({
        relations: ['servico', 'servico.contract'],
        order: { criadoEm: 'DESC' },
      });
      res.json(lista.map((g) => ({
        id: g.id,
        grupoJid: g.grupoJid,
        nomeGrupo: g.nomeGrupo,
        servicoId: g.servicoId,
        servicoNome: g.servico?.nome || null,
        contratoNome: (g.servico as any)?.contract?.numeroContrato || null,
        contractId: g.servico?.contract_id || null,
        ativo: g.ativo,
        estrategia: g.estrategia,
        responderPdf: g.responderPdf,
        criadoEm: g.criadoEm,
      })));
    } catch (error: any) {
      res.status(500).json({ error: error?.message || 'Erro ao listar grupos' });
    }
  }

  /** POST /api/wuzapi/grupos */
  async criarGrupo(req: Request, res: Response): Promise<void> {
    try {
      const { grupoJid, nomeGrupo, servicoId, estrategia, responderPdf, ativo } = req.body || {};
      if (!grupoJid || !servicoId) {
        res.status(400).json({ error: 'grupoJid e servicoId são obrigatórios' });
        return;
      }

      const jid = String(grupoJid).includes('@')
        ? String(grupoJid).trim()
        : `${String(grupoJid).trim()}@g.us`;

      const servico = await AppDataSource.getRepository(Servico).findOne({ where: { id: servicoId } });
      if (!servico) {
        res.status(404).json({ error: 'Serviço não encontrado' });
        return;
      }

      const repo = AppDataSource.getRepository(WhatsappGrupoMapa);
      const existente = await repo.findOne({ where: { grupoJid: jid } });
      if (existente) {
        res.status(409).json({ error: 'Este grupo já está mapeado', id: existente.id });
        return;
      }

      const criado = repo.create({
        grupoJid: jid,
        nomeGrupo: nomeGrupo || null,
        servicoId,
        estrategia: estrategia || 'atualizar_data',
        responderPdf: responderPdf === true,
        ativo: ativo !== false,
      });
      const salvo = await repo.save(criado);
      invalidarGruposAutorizados();
      await sincronizarRoteamentoWhatsapp(salvo, undefined, servico.contract_id);
      res.status(201).json(salvo);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || 'Erro ao criar mapeamento' });
    }
  }

  /** PUT /api/wuzapi/grupos/:id */
  async atualizarGrupo(req: Request, res: Response): Promise<void> {
    try {
      const repo = AppDataSource.getRepository(WhatsappGrupoMapa);
      const item = await repo.findOne({ where: { id: String(req.params.id) } });
      if (!item) {
        res.status(404).json({ error: 'Mapeamento não encontrado' });
        return;
      }

      const { nomeGrupo, servicoId, estrategia, responderPdf, ativo, grupoJid } = req.body || {};
      if (nomeGrupo !== undefined) item.nomeGrupo = nomeGrupo;
      if (estrategia !== undefined) item.estrategia = estrategia;
      if (responderPdf !== undefined) item.responderPdf = !!responderPdf;
      if (ativo !== undefined) item.ativo = !!ativo;
      if (grupoJid) {
        item.grupoJid = String(grupoJid).includes('@')
          ? String(grupoJid).trim()
          : `${String(grupoJid).trim()}@g.us`;
      }
      if (servicoId) {
        const servico = await AppDataSource.getRepository(Servico).findOne({ where: { id: servicoId } });
        if (!servico) {
          res.status(404).json({ error: 'Serviço não encontrado' });
          return;
        }
        item.servicoId = servicoId;
      }

      const salvo = await repo.save(item);
      invalidarGruposAutorizados();
      const servicoAtual = await AppDataSource.getRepository(Servico).findOne({
        where: { id: salvo.servicoId },
      });
      await sincronizarRoteamentoWhatsapp(salvo, undefined, servicoAtual?.contract_id);
      res.json(salvo);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || 'Erro ao atualizar' });
    }
  }

  /** DELETE /api/wuzapi/grupos/:id */
  async excluirGrupo(req: Request, res: Response): Promise<void> {
    try {
      const repo = AppDataSource.getRepository(WhatsappGrupoMapa);
      const item = await repo.findOne({ where: { id: String(req.params.id) } });
      if (!item) {
        res.status(404).json({ error: 'Mapeamento não encontrado' });
        return;
      }
      await removerRoteamentoWhatsapp(item.grupoJid);
      await repo.remove(item);
      invalidarGruposAutorizados();
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || 'Erro ao excluir' });
    }
  }
}
