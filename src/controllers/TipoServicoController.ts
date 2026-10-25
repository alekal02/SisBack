import { Request, Response } from 'express';
import TipoServicoTemplateService from '../services/TipoServicoTemplateService';

/**
 * Controller para o Catálogo de Tipos de Serviço
 *
 * Endpoints:
 *   GET  /api/tipo-servico/categorias          → Lista tipos por categoria
 *   GET  /api/tipo-servico/:tipo                → Template completo de um tipo
 *   GET  /api/tipo-servico/:tipo/kpis           → KPIs padrão de um tipo
 *   GET  /api/tipo-servico/:tipo/graficos       → Gráficos padrão de um tipo
 *   GET  /api/tipo-servico/:tipo/colunas        → Colunas esperadas de um tipo
 *   GET  /api/tipo-servico/:tipo/modelo         → Modelo de planilha (headers + linhas exemplo)
 *   POST /api/tipo-servico/:tipo/validar        → Valida colunas contra o tipo
 */
export class TipoServicoController {
  /**
   * GET /api/tipo-servico/categorias
   * Lista todos os tipos organizados por categoria (para o seletor visual)
   */
  async listarCategorias(req: Request, res: Response): Promise<any> {
    try {
      const categorias = TipoServicoTemplateService.listarCategorias();
      return res.json({ categorias });
    } catch (error: any) {
      console.error('Erro ao listar categorias:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao listar categorias' });
    }
  }

  /**
   * GET /api/tipo-servico/:tipo
   * Retorna o template completo de um tipo de serviço
   */
  async getTemplate(req: Request, res: Response): Promise<any> {
    try {
      const tipo = req.params.tipo as string;
      const template = TipoServicoTemplateService.getTemplate(tipo);

      if (!template) {
        return res.status(404).json({
          error: 'Tipo de serviço não encontrado',
          tiposDisponiveis: Object.keys(TipoServicoTemplateService.TEMPLATES),
        });
      }

      return res.json({ tipo: template });
    } catch (error: any) {
      console.error('Erro ao buscar template:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao buscar template' });
    }
  }

  /**
   * GET /api/tipo-servico/:tipo/kpis
   * Retorna KPIs padrão de um tipo
   */
  async getKpis(req: Request, res: Response): Promise<any> {
    try {
      const tipo = req.params.tipo as string;
      const kpis = TipoServicoTemplateService.getKpisPadrao(tipo);

      if (!kpis) {
        return res.status(404).json({ error: 'Tipo de serviço não encontrado' });
      }

      return res.json({ tipo, total: kpis.length, kpis });
    } catch (error: any) {
      console.error('Erro ao buscar KPIs:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao buscar KPIs' });
    }
  }

  /**
   * GET /api/tipo-servico/:tipo/graficos
   * Retorna gráficos padrão sugeridos para um tipo
   */
  async getGraficos(req: Request, res: Response): Promise<any> {
    try {
      const tipo = req.params.tipo as string;
      const graficos = TipoServicoTemplateService.getGraficosPadrao(tipo);

      if (!graficos) {
        return res.status(404).json({ error: 'Tipo de serviço não encontrado' });
      }

      return res.json({ tipo, total: graficos.length, graficos });
    } catch (error: any) {
      console.error('Erro ao buscar gráficos:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao buscar gráficos' });
    }
  }

  /**
   * GET /api/tipo-servico/:tipo/colunas
   * Retorna colunas esperadas para um tipo
   */
  async getColunas(req: Request, res: Response): Promise<any> {
    try {
      const tipo = req.params.tipo as string;
      const colunas = TipoServicoTemplateService.getColunasEsperadas(tipo);

      if (!colunas) {
        return res.status(404).json({ error: 'Tipo de serviço não encontrado' });
      }

      return res.json({ tipo, total: colunas.length, colunas });
    } catch (error: any) {
      console.error('Erro ao buscar colunas:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao buscar colunas' });
    }
  }

  /**
   * GET /api/tipo-servico/:tipo/modelo
   * Retorna headers + linhas exemplo para gerar modelo de planilha
   * O frontend pode usar para baixar um XLSX ou exibir o template
   */
  async getModelo(req: Request, res: Response): Promise<any> {
    try {
      const tipo = req.params.tipo as string;
      const modelo = TipoServicoTemplateService.gerarModeloPlanilha(tipo);

      return res.json({
        tipo,
        ...modelo,
        sugestaoDownload: true,
      });
    } catch (error: any) {
      console.error('Erro ao gerar modelo:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao gerar modelo' });
    }
  }

  /**
   * POST /api/tipo-servico/:tipo/validar
   * Valida colunas encontradas no upload contra as esperadas pelo tipo
   * Body: { colunas: string[] }
   */
  async validarColunas(req: Request, res: Response): Promise<any> {
    try {
      const tipo = req.params.tipo as string;
      const { colunas } = req.body;

      if (!colunas || !Array.isArray(colunas) || colunas.length === 0) {
        return res.status(400).json({ error: 'Lista de colunas é obrigatória' });
      }

      const resultado = TipoServicoTemplateService.validarColunasEsperadas(tipo, colunas);

      return res.json({
        tipo,
        ...resultado,
        dicas: resultado.colunasAusentes.length > 0
          ? `Colunas ausentes: ${resultado.colunasAusentes.join(', ')}. Adicione-as à planilha para melhor análise.`
          : 'Todas as colunas obrigatórias foram encontradas!',
      });
    } catch (error: any) {
      console.error('Erro ao validar colunas:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao validar colunas' });
    }
  }
}

export default TipoServicoController;
