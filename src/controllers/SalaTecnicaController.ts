import { Request, Response } from 'express';
import AppDataSource from '../database/data-source';
import { WhatsappGrupoMapa } from '../entities/WhatsappGrupoMapa';
import wuzapiService from '../services/WuzapiService';
import {
  secretSalaTecnica,
  urlSalaTecnica,
  validarSecretChatbot,
} from '../services/SalaTecnicaChatbotService';
import { decidirDestinosSalaTecnica } from '../services/salaTecnicaDestinos';

function secretDoPedido(req: Request): { header: string; query: string } {
  return {
    header:
      String(req.headers['x-chatbot-secret'] || '')
      || String(req.headers['x-webhook-secret'] || ''),
    query: String((req.query as { secret?: string }).secret || ''),
  };
}

export class SalaTecnicaController {
  /**
   * GET /api/sala-tecnica/status
   * A Sala técnica testa se o servidor do chatbot está no ar.
   */
  async status(req: Request, res: Response): Promise<void> {
    const { header, query } = secretDoPedido(req);
    if (!validarSecretChatbot(header, query)) {
      res.status(401).json({
        ok: false,
        erro: secretSalaTecnica()
          ? 'Token da API inválido.'
          : 'Configure SALA_TECNICA_SECRET no servidor do Sistemma.',
      });
      return;
    }
    let grupos = 0;
    try {
      grupos = await AppDataSource.getRepository(WhatsappGrupoMapa).count({
        where: { ativo: true },
      });
    } catch {
      grupos = 0;
    }
    res.json({
      ok: true,
      servico: 'sistemma-chatbot',
      wuzapi: wuzapiService.isConfigured,
      gruposMapeados: grupos,
      salaTecnicaUrl: urlSalaTecnica() || null,
    });
  }

  /**
   * POST /api/sala-tecnica/enviar-relatorio
   * Recebe o PDF gerado na Sala técnica e envia no WhatsApp pelo chatbot.
   */
  async enviarRelatorio(req: Request, res: Response): Promise<void> {
    const { header, query } = secretDoPedido(req);
    if (!validarSecretChatbot(header, query)) {
      res.status(401).json({
        ok: false,
        erro: secretSalaTecnica()
          ? 'Token da API inválido.'
          : 'Configure SALA_TECNICA_SECRET no servidor do Sistemma.',
      });
      return;
    }
    if (!wuzapiService.isConfigured) {
      res.status(400).json({ ok: false, erro: 'WhatsApp (WuzAPI) não está configurado neste servidor.' });
      return;
    }

    const body = req.body || {};
    const pdfBase64 = String(body.pdfBase64 || body.pdf || '').replace(/^data:[^;]+;base64,/, '');
    if (!pdfBase64 || pdfBase64.length < 80) {
      res.status(400).json({ ok: false, erro: 'Informe o PDF em pdfBase64.' });
      return;
    }

    let buffer: Buffer;
    try {
      buffer = Buffer.from(pdfBase64, 'base64');
    } catch {
      res.status(400).json({ ok: false, erro: 'PDF em base64 inválido.' });
      return;
    }
    if (buffer.length < 100) {
      res.status(400).json({ ok: false, erro: 'PDF vazio ou corrompido.' });
      return;
    }

    const data = String(body.data || '').trim();
    const fileName = String(body.fileName || `relatorio-gps${data ? `-${data}` : ''}.pdf`);
    const caption = String(
      body.caption
      || `📍 Relatório GPS da Sala técnica${data ? ` · ${data}` : ''}`,
    );
    const grupoPedido = String(body.grupoJid || body.grupo || '').trim();
    const confirmarTodosGrupos = body.confirmarTodosGrupos === true;

    let gruposAtivos: string[] = [];
    if (!grupoPedido && confirmarTodosGrupos) {
      try {
        const mapas = await AppDataSource.getRepository(WhatsappGrupoMapa).find({
          where: { ativo: true },
        });
        gruposAtivos = mapas.map((m) => m.grupoJid).filter(Boolean);
      } catch {
        gruposAtivos = [];
      }
    }

    const decisao = decidirDestinosSalaTecnica({
      grupoPedido,
      confirmarTodosGrupos,
      gruposAtivos,
    });
    if ('erro' in decisao) {
      res.status(400).json({ ok: false, erro: decisao.erro });
      return;
    }
    const destinos = decisao.destinos;

    const enviados: string[] = [];
    const falhas: string[] = [];
    for (const jid of destinos) {
      try {
        await wuzapiService.enviarDocumento(jid, fileName, buffer, caption);
        enviados.push(jid);
      } catch (err: any) {
        falhas.push(`${jid}: ${err?.message || 'falha'}`);
      }
    }

    res.json({
      ok: falhas.length === 0,
      enviados: enviados.length,
      destinos: enviados,
      falhas,
    });
  }
}

export const salaTecnicaController = new SalaTecnicaController();
