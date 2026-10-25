import { Request, Response } from 'express';
import { whatsAppService } from '../services/WhatsAppService';
import fs from 'fs';
import path from 'path';

export class WhatsAppController {
  /**
   * POST /api/whatsapp/enviar-dashboard
   * Envia um dashboard PDF via WhatsApp para um ou mais números
   * 
   * Body:
   * {
   *   telefones: ["5511999999999", "5511988888888"],
   *   pdfPath: "C:/temp/dashboard.pdf",  // caminho absoluto do PDF no servidor
   *   mensagem?: "📊 Dashboard atualizado" // opcional
   * }
   */
  async enviarDashboard(req: Request, res: Response): Promise<void> {
    try {
      if (!whatsAppService.isConfigured) {
        res.status(400).json({
          sucesso: false,
          erro: 'WhatsApp não configurado. Configure WHATSAPP_TOKEN e WHATSAPP_PHONE_ID no .env',
          configuracao: {
            tokenExiste: !!process.env.WHATSAPP_TOKEN,
            phoneIdExiste: !!process.env.WHATSAPP_PHONE_ID,
          }
        });
        return;
      }

      const { telefones, pdfPath, mensagem } = req.body;

      // Validação dos campos obrigatórios
      if (!telefones || !Array.isArray(telefones) || telefones.length === 0) {
        res.status(400).json({
          sucesso: false,
          erro: 'Informe ao menos um telefone no campo "telefones" (array)'
        });
        return;
      }

      if (!pdfPath) {
        res.status(400).json({
          sucesso: false,
          erro: 'Informe o caminho do PDF em "pdfPath"'
        });
        return;
      }

      if (!fs.existsSync(pdfPath)) {
        res.status(400).json({
          sucesso: false,
          erro: `Arquivo PDF não encontrado no caminho: ${pdfPath}`
        });
        return;
      }

      // Envio para múltiplos destinatários
      const resultado = await whatsAppService.enviarDashboardMultiplos(
        telefones,
        pdfPath,
        mensagem
      );

      res.json({
        sucesso: resultado.falhas === 0,
        mensagem: `📤 Enviado para ${resultado.sucessos} destinatário(s)${
          resultado.falhas > 0 ? `, ${resultado.falhas} falha(s)` : ''
        }`,
        ...resultado,
      });

    } catch (error: any) {
      console.error('[WhatsAppController] Erro:', error?.response?.data || error?.message || error);
      res.status(500).json({
        sucesso: false,
        erro: error?.response?.data?.error?.message || error?.message || 'Erro interno ao enviar WhatsApp'
      });
    }
  }

  /**
   * POST /api/whatsapp/enviar-com-html
   * Gera PDF a partir do HTML e já envia via WhatsApp
   * 
   * Body:
   * {
   *   telefones: ["5511999999999"],
   *   html: "<html>...</html>",
   *   mensagem?: "📊 Dashboard"
   * }
   */
  async enviarComHtml(req: Request, res: Response): Promise<void> {
    try {
      if (!whatsAppService.isConfigured) {
        res.status(400).json({
          sucesso: false,
          erro: 'WhatsApp não configurado. Configure WHATSAPP_TOKEN e WHATSAPP_PHONE_ID no .env',
        });
        return;
      }

      const { telefones, html, mensagem } = req.body;

      if (!telefones || !Array.isArray(telefones) || telefones.length === 0) {
        res.status(400).json({ sucesso: false, erro: 'Informe ao menos um telefone' });
        return;
      }

      if (!html || typeof html !== 'string') {
        res.status(400).json({ sucesso: false, erro: 'HTML é obrigatório' });
        return;
      }

      // 1. Gera PDF a partir do HTML usando Puppeteer
      const puppeteer = require('puppeteer');
      const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdfBuffer = await page.pdf({
        format: 'A4',
        margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
        printBackground: true,
      });
      await browser.close();

      // 2. Envia o PDF via WhatsApp
      let sucessos = 0;
      let falhas = 0;
      const resultados: any[] = [];

      for (const telefone of telefones) {
        const resultado = await whatsAppService.enviarDashboardBuffer(
          telefone,
          pdfBuffer,
          'dashboard_coleta.pdf',
          mensagem
        );
        resultados.push({ ...resultado, telefone });
        if (resultado.sucesso) sucessos++;
        else falhas++;
      }

      res.json({
        sucesso: falhas === 0,
        mensagem: `📤 Enviado para ${sucessos} destinatário(s)${falhas > 0 ? `, ${falhas} falha(s)` : ''}`,
        sucessos,
        falhas,
        resultados,
      });

    } catch (error: any) {
      console.error('[WhatsAppController] Erro ao enviar com HTML:', error?.message || error);
      res.status(500).json({
        sucesso: false,
        erro: error?.message || 'Erro ao gerar PDF e enviar WhatsApp',
      });
    }
  }

  /**
   * GET /api/whatsapp/status
   * Verifica se o serviço está configurado
   */
  async status(req: Request, res: Response): Promise<void> {
    res.json({
      configurado: whatsAppService.isConfigured,
      tokenExiste: !!process.env.WHATSAPP_TOKEN,
      phoneIdExiste: !!process.env.WHATSAPP_PHONE_ID,
      mensagem: whatsAppService.isConfigured
        ? '✅ WhatsApp configurado — pronto para envio'
        : '⚠️ WhatsApp não configurado. Veja WHATSAPP_TOKEN e WHATSAPP_PHONE_ID no .env',
    });
  }
}
