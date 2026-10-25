/* ============================================
   ModeloExecutivoController
   ═════════════════════════════════════════════
   Gerencia o catálogo central de fórmulas do
   Modelo Executivo, servindo como fonte única
   para frontend e backend.
   ═════════════════════════════════════════════
   GET /api/modelo-executivo/formulas
   ============================================ */

import { Request, Response } from 'express';
import { FORMULAS_PADRAO, agruparPorCategoria, filtrarPorTipo } from '../services/formulasPadrao';

export class ModeloExecutivoController {

  /**
   * GET /api/modelo-executivo/formulas
   * Retorna todo o catálogo de fórmulas do Modelo Executivo
   * Query params:
   *   - tipo: 'primaria' | 'secundaria' (opcional — filtra por tipo)
   *   - agrupado: 'true' (opcional — retorna agrupado por categoria)
   */
  async listarFormulas(req: Request, res: Response): Promise<void> {
    try {
      const { tipo, agrupado } = req.query as Record<string, string | undefined>;

      if (agrupado === 'true') {
        res.json({
          formulas: agruparPorCategoria(),
          total: FORMULAS_PADRAO.length,
        });
        return;
      }

      if (tipo === 'primaria' || tipo === 'secundaria') {
        res.json({
          formulas: filtrarPorTipo(tipo),
          total: filtrarPorTipo(tipo).length,
        });
        return;
      }

      res.json({
        formulas: FORMULAS_PADRAO,
        total: FORMULAS_PADRAO.length,
      });
    } catch (error: any) {
      console.error('[ModeloExecutivo] Erro ao listar fórmulas:', error?.message || error);
      res.status(500).json({ error: 'Erro ao listar fórmulas' });
    }
  }
}
