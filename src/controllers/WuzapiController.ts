import { Request, Response } from 'express';
import AppDataSource from '../database/data-source';
import { WhatsappGrupoMapa } from '../entities/WhatsappGrupoMapa';
import { Servico } from '../entities/Servico';
import wuzapiService from '../services/WuzapiService';
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

  /** GET /api/wuzapi/status — inclui QR quando conectado e ainda não logado */
  async status(_req: Request, res: Response): Promise<void> {
    try {
      const base = {
        configurado: wuzapiService.isConfigured,
        url: process.env.WUZAPI_URL || null,
        tokenExiste: !!process.env.WUZAPI_TOKEN,
        webhookSecretExiste: !!process.env.WUZAPI_WEBHOOK_SECRET,
        webhookUrl: wuzapiService.webhookUrl,
      };
      if (!wuzapiService.isConfigured) {
        res.json({
          ...base,
          sessao: null,
          qrCode: null,
          conectado: false,
          logado: false,
          mensagem: 'Configure WUZAPI_URL e WUZAPI_TOKEN',
        });
        return;
      }
      try {
        const sessao = await wuzapiService.getStatus();
        let qrCode: string | null = null;
        if (sessao.connected && !sessao.loggedIn) {
          try {
            const qr = await wuzapiService.getQRCode();
            qrCode = qr.qrCode || null;
            // Garante data URI para <img src>
            if (qrCode && !qrCode.startsWith('data:')) {
              qrCode = `data:image/png;base64,${qrCode}`;
            }
          } catch {
            qrCode = null;
          }
        }
        res.json({
          ...base,
          sessao,
          qrCode,
          conectado: sessao.connected,
          logado: sessao.loggedIn,
        });
      } catch (err: any) {
        const erroSessao = err?.message || 'Falha ao consultar sessão';
        // 401 = token ainda sem usuário → WuzAPI online, só falta Connect criar instância
        const offline = /ECONNREFUSED|inacess[ií]vel|ENOTFOUND|EHOSTUNREACH/i.test(String(erroSessao));
        res.json({
          ...base,
          sessao: null,
          qrCode: null,
          conectado: false,
          logado: false,
          erroSessao,
          wuzapiOffline: offline,
          wuzapiOnline: !offline,
          mensagem: offline
            ? 'WuzAPI offline. Suba: docker compose up -d wuzapi-db wuzapi'
            : undefined,
        });
      }
    } catch (error: any) {
      res.status(500).json({ sucesso: false, erro: error?.message || 'Erro' });
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
      // Aguarda um pouco e tenta obter QR (também quando já estava connected)
      let qrCode: string | null = null;
      try {
        await new Promise((r) => setTimeout(r, 1200));
        const st = await wuzapiService.getStatus();
        if (!st.loggedIn) {
          const qr = await wuzapiService.getQRCode();
          qrCode = qr.qrCode || null;
          if (qrCode && !qrCode.startsWith('data:')) {
            qrCode = `data:image/png;base64,${qrCode}`;
          }
        }
      } catch { /* QR pode demorar */ }

      res.json({
        sucesso: true,
        message: resultado.message,
        jid: resultado.jid,
        qrCode,
        conectado: true,
        logado: false,
      });
    } catch (error: any) {
      const msg = String(error?.message || 'Erro ao conectar');
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
      const msg = String(error?.message || 'Erro ao desconectar');
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

  /** GET /api/wuzapi/qr — QR atual */
  async qr(_req: Request, res: Response): Promise<void> {
    try {
      if (!wuzapiService.isConfigured) {
        res.status(400).json({ sucesso: false, erro: 'WuzAPI não configurada' });
        return;
      }
      const qr = await wuzapiService.getQRCode();
      let qrCode = qr.qrCode || null;
      if (qrCode && !qrCode.startsWith('data:')) {
        qrCode = `data:image/png;base64,${qrCode}`;
      }
      res.json({ sucesso: true, qrCode });
    } catch (error: any) {
      res.status(500).json({ sucesso: false, erro: error?.message || 'Erro ao obter QR' });
    }
  }

  /** GET /api/wuzapi/grupos-whatsapp — grupos reais da conta WhatsApp */
  async listarGruposWhatsApp(_req: Request, res: Response): Promise<void> {
    try {
      if (!wuzapiService.isConfigured) {
        res.status(400).json({ error: 'WuzAPI não configurada' });
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
