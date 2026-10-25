import { Request, Response } from 'express';
import { htmlPdfBloqueado } from '../services/pdfRecursoPermitido';

type MargemPreset = 'full' | 'default' | 'print';

const MARGENS: Record<MargemPreset, { top: string; right: string; bottom: string; left: string }> = {
  full: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
  default: { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' },
  print: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
};

export class PdfController {
  /**
   * POST /api/pdf/generate
   * Body: { html: string, filename?: string, margin?: 'full' | 'default' | 'print' }
   */
  async generate(req: Request, res: Response): Promise<void> {
    try {
      const { html, filename = 'documento', margin = 'default', useCache } = req.body ?? {};

      if (!html || typeof html !== 'string') {
        res.status(400).json({ error: 'HTML é obrigatório' });
        return;
      }

      const bloqueio = htmlPdfBloqueado(html);
      if (bloqueio) {
        res.status(400).json({ error: bloqueio });
        return;
      }

      const preset: MargemPreset = MARGENS[margin as MargemPreset] ? (margin as MargemPreset) : 'default';
      const { htmlToPdf } = await import('../services/PdfGeneratorService');
      const pdfBuffer = await htmlToPdf(html, {
        margin: MARGENS[preset],
        useCache: useCache !== false,
      });

      const safeName = String(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}.pdf"`);
      res.send(pdfBuffer);
    } catch (error: any) {
      console.error('Erro ao gerar PDF:', error?.message || error);
      res.status(500).json({ error: 'Erro ao gerar PDF: ' + (error?.message || '') });
    }
  }
}

export const pdfController = new PdfController();
