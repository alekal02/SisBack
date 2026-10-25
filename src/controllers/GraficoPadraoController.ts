import { Request, Response } from 'express';
import AppDataSource from '../database/data-source';
import { GraficoPadraoConfig } from '../entities/GraficoPadraoConfig';
import { Servico } from '../entities/Servico';
import { TIPOS_SERVICO_VALORES } from '../enums/TipoServico';
import {
  GRAFICOS_PADRAO,
  getGraficosPorTipo,
  GraficoPadrao,
  gerarConfigGraficosPadrao,
} from '../services/graficosPadrao';

/**
 * Controller para gerenciar a biblioteca de gráficos padrão.
 * Permite:
 * - Listar gráficos da biblioteca com status ativo/inativo (por tipo de serviço)
 * - Ativar/desativar gráficos individuais
 * - Salvar gráfico personalizado como padrão para o tipo de serviço
 * - Sincronizar catálogo com banco (seed automático)
 */
export class GraficoPadraoController {
  private get repository() {
    return AppDataSource.getRepository(GraficoPadraoConfig);
  }

  private get servicoRepo() {
    return AppDataSource.getRepository(Servico);
  }

  /**
   * GET /api/graficos-padrao/biblioteca
   * Retorna a biblioteca de gráficos padrão, opcionalmente filtrada por tipo de serviço.
   * Faz seed automático se a biblioteca ainda não tiver sido populada.
   * 
   * Query params:
   *   ?tipoServico=coleta_caminhao — filtra por tipo
   *   ?apenasAtivos=true — retorna apenas gráficos ativos
   */
  async listarBiblioteca(req: Request, res: Response): Promise<any> {
    try {
      const { tipoServico, apenasAtivos } = req.query;

      // ═══ SEED AUTOMÁTICO: verifica se a biblioteca já foi populada ═══
      const totalRegistros = await this.repository.count();
      if (totalRegistros === 0) {
        await this._seedBiblioteca();
      }

      // Montar where
      const where: any = {};
      if (tipoServico && typeof tipoServico === 'string') {
        where.tipoServico = tipoServico;
      }
      if (apenasAtivos === 'true') {
        where.ativo = true;
      }

      const graficos = await this.repository.find({
        where,
        order: { tipoServico: 'ASC', ordem: 'ASC' },
      });

      // Agrupar por tipo de serviço
      const agrupados: Record<string, GraficoPadraoConfig[]> = {};
      for (const g of graficos) {
        if (!agrupados[g.tipoServico]) agrupados[g.tipoServico] = [];
        agrupados[g.tipoServico].push(g);
      }

      return res.json({
        graficos,
        agrupados,
        total: graficos.length,
        tiposComGraficos: Object.keys(agrupados),
      });
    } catch (error: any) {
      console.error('Erro ao listar biblioteca de gráficos:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao carregar biblioteca de gráficos' });
    }
  }

  /**
   * PUT /api/graficos-padrao/biblioteca/:id/ativar
   * Ativa ou desativa um gráfico na biblioteca.
   * Body: { ativo: boolean }
   */
  async toggleAtivo(req: Request, res: Response): Promise<any> {
    try {
      const id = req.params.id as string;
      const { ativo } = req.body;

      if (ativo === undefined) {
        return res.status(400).json({ error: 'Campo "ativo" (boolean) é obrigatório' });
      }

      const config = await this.repository.findOne({ where: { id } });
      if (!config) {
        return res.status(404).json({ error: 'Configuração de gráfico não encontrada' });
      }

      config.ativo = ativo;
      await this.repository.save(config);

      return res.json({
        message: ativo ? 'Gráfico ativado na biblioteca' : 'Gráfico desativado na biblioteca',
        grafico: config,
      });
    } catch (error: any) {
      console.error('Erro ao alterar status do gráfico:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao alterar status do gráfico' });
    }
  }

  /**
   * PUT /api/graficos-padrao/biblioteca/:id
   * Atualiza configuração de um gráfico na biblioteca (título, ordem, cor, etc.)
   */
  async atualizarConfig(req: Request, res: Response): Promise<any> {
    try {
      const id = req.params.id as string;
      const { titulo, tipo, descricao, categoria, ordem, cor, isContagem, placeholderEixoX, placeholderEixoY } = req.body;

      const config = await this.repository.findOne({ where: { id } });
      if (!config) {
        return res.status(404).json({ error: 'Configuração de gráfico não encontrada' });
      }

      if (titulo !== undefined) config.titulo = titulo;
      if (tipo !== undefined) config.tipo = tipo;
      if (descricao !== undefined) config.descricao = descricao;
      if (categoria !== undefined) config.categoria = categoria;
      if (ordem !== undefined) config.ordem = ordem;
      if (cor !== undefined) config.cor = cor;
      if (isContagem !== undefined) config.isContagem = isContagem;
      if (placeholderEixoX !== undefined) config.placeholderEixoX = placeholderEixoX;
      if (placeholderEixoY !== undefined) config.placeholderEixoY = placeholderEixoY;

      await this.repository.save(config);

      return res.json({
        message: 'Gráfico atualizado na biblioteca',
        grafico: config,
      });
    } catch (error: any) {
      console.error('Erro ao atualizar gráfico:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao atualizar gráfico' });
    }
  }

  /**
   * POST /api/graficos-padrao/salvar-padrao
   * Salva um gráfico personalizado como padrão para o tipo de serviço.
   * 
   * Body: {
   *   servicoId?: string,        // Serviço de origem (alternativa ao tipoServico)
   *   tipoServico?: string,      // Tipo de serviço diretamente (alternativa ao servicoId)
   *   titulo: string,
   *   tipo: 'barra' | 'linha' | 'pizza' | 'area' | 'donut',
   *   placeholderEixoX: string[],
   *   placeholderEixoY: string[],
   *   descricao?: string,
   *   categoria?: string,
   *   cor?: string,
   * }
   */
  async salvarComoPadrao(req: Request, res: Response): Promise<any> {
    try {
      const { servicoId, tipoServico, titulo, tipo, placeholderEixoX, placeholderEixoY, descricao, categoria, cor } = req.body;

      if (!titulo || !tipo || !placeholderEixoX) {
        return res.status(400).json({
          error: 'Campos obrigatórios: titulo, tipo, placeholderEixoX',
        });
      }

      let tipoServicoFinal: string;

      if (servicoId) {
        // Buscar serviço para obter tipo
        const servico = await this.servicoRepo.findOne({ where: { id: servicoId } });
        if (!servico) {
          return res.status(404).json({ error: 'Serviço não encontrado' });
        }
        tipoServicoFinal = servico.tipo || 'geral';
      } else if (tipoServico) {
        tipoServicoFinal = tipoServico;
      } else {
        return res.status(400).json({
          error: 'Informe servicoId ou tipoServico',
        });
      }

      const key = `personalizado_${Date.now()}`;

      const config = new GraficoPadraoConfig();
      config.key = key;
      config.tipoServico = tipoServicoFinal;
      config.ativo = true;
      config.titulo = titulo;
      config.tipo = tipo;
      config.placeholderEixoX = placeholderEixoX;
      config.placeholderEixoY = placeholderEixoY || [];
      config.descricao = descricao || null;
      config.categoria = categoria || 'Personalizado';
      config.ordem = 99; // Fim da lista
      config.isContagem = !placeholderEixoY || placeholderEixoY.length === 0;
      config.cor = cor || '#6366f1';
      config.isPersonalizado = true;
      config.servicoOrigemId = servicoId || null;

      await this.repository.save(config);

      return res.status(201).json({
        message: `Gráfico "${titulo}" salvo como padrão para ${tipoServicoFinal}!`,
        grafico: config,
      });
    } catch (error: any) {
      console.error('Erro ao salvar gráfico como padrão:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao salvar gráfico como padrão' });
    }
  }

  /**
   * DELETE /api/graficos-padrao/biblioteca/:id
   * Remove um gráfico da biblioteca (apenas personalizados)
   */
  async excluir(req: Request, res: Response): Promise<any> {
    try {
      const id = req.params.id as string;
      const config = await this.repository.findOne({ where: { id } });
      if (!config) {
        return res.status(404).json({ error: 'Configuração de gráfico não encontrada' });
      }

      if (!config.isPersonalizado) {
        return res.status(400).json({
          error: 'Gráficos padrão do sistema não podem ser removidos. Use "ativar/desativar".',
        });
      }

      await this.repository.remove(config);

      return res.json({ message: 'Gráfico personalizado removido da biblioteca' });
    } catch (error: any) {
      console.error('Erro ao excluir gráfico:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao excluir gráfico' });
    }
  }

  /**
   * GET /api/graficos-padrao/biblioteca/estatisticas
   * Retorna contagem de gráficos por tipo de serviço (para tela de seleção).
   */
  async listarEstatisticas(req: Request, res: Response): Promise<any> {
    try {
      const totalRegistros = await this.repository.count();
      if (totalRegistros === 0) {
        await this._seedBiblioteca();
      }

      // Agrupa por tipoServico e conta
      const result = await this.repository
        .createQueryBuilder('g')
        .select('g.tipoServico', 'tipo')
        .addSelect('COUNT(*)', 'total')
        .addSelect('SUM(CASE WHEN g.ativo = true THEN 1 ELSE 0 END)', 'ativos')
        .groupBy('g.tipoServico')
        .orderBy('g.tipoServico')
        .getRawMany();

      return res.json({
        tipos: result.map((r: any) => ({
          tipo: r.tipo,
          total: Number(r.total),
          ativos: Number(r.ativos),
        })),
      });
    } catch (error: any) {
      console.error('Erro ao listar estatísticas:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao carregar estatísticas' });
    }
  }

  /**
   * GET /api/graficos-padrao/biblioteca/verificar-servico/:servicoId
   * Retorna os gráficos padrão que seriam gerados para um serviço específico,
   * já resolvendo placeholders com as colunas da planilha.
   */
  async verificarServico(req: Request, res: Response): Promise<any> {
    try {
      const servicoId = req.params.servicoId as string;
      const servico = await this.servicoRepo.findOne({ where: { id: servicoId } });
      if (!servico) {
        return res.status(404).json({ error: 'Serviço não encontrado' });
      }

      const tipo = servico.tipo || 'geral';
      const colunas = servico.padraoPlanilha?.colunas || [];
      const colunasNomes = colunas.map((c: any) => c.nome);

      const graficos = gerarConfigGraficosPadrao(tipo, colunasNomes);

      return res.json({
        tipoServico: tipo,
        colunas: colunasNomes,
        total: graficos.length,
        graficos,
        jaAplicado: servico.configDashboard?.graficosPadraoAplicados === true,
        graficosAtuais: (servico.configDashboard?.graficos || []).filter((g: any) => g.ativo).length,
      });
    } catch (error: any) {
      console.error('Erro ao verificar gráficos do serviço:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao verificar gráficos do serviço' });
    }
  }

  // ─── PRIVADO: Seed da biblioteca a partir do catálogo hardcoded ───

  /**
   * Popula a biblioteca com os gráficos do catálogo hardcoded (seed inicial).
   */
  private async _seedBiblioteca(): Promise<void> {
    console.log('[GraficoPadraoController] ⭐ Populando biblioteca de gráficos padrão...');

    const entradas: GraficoPadraoConfig[] = [];

    for (const [tipoServico, graficos] of Object.entries(GRAFICOS_PADRAO)) {
      for (const g of graficos) {
        const config = new GraficoPadraoConfig();
        config.key = g.key;
        config.tipoServico = tipoServico;
        config.ativo = true;
        config.titulo = g.titulo;
        config.tipo = g.tipo;
        config.placeholderEixoX = g.placeholderEixoX;
        config.placeholderEixoY = g.placeholderEixoY;
        config.descricao = g.descricao;
        config.categoria = g.categoria;
        config.ordem = g.ordem;
        config.isContagem = g.isContagem;
        config.cor = g.cor;
        config.isPersonalizado = false;
        entradas.push(config);
      }
    }

    if (entradas.length > 0) {
      await this.repository.save(entradas);
      console.log(`[GraficoPadraoController] ✅ ${entradas.length} gráficos inseridos na biblioteca`);
    }
  }
}
