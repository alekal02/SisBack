import { Request, Response } from 'express';
import { pdfController } from './PdfController';
import { Between, Repository } from 'typeorm';
import { startOfDay, endOfDay, subDays } from 'date-fns';
import AppDataSource from '../database/data-source';
import { Abastecimento } from '../entities/Abastecimento';

export class DashboardController {
  private get repository(): Repository<Abastecimento> {
    return AppDataSource.getRepository(Abastecimento);
  }

  /**
   * GET /api/dashboard/hoje
   * ⚡ OTIMIZADO: usa agregação no banco (SUM, COUNT, DISTINCT) em vez de carregar registros
   * Retorna estatísticas do dia atual (filtrado por usuário se não admin)
   */
  async hoje(req: Request, res: Response): Promise<void> {
    try {
      const hoje = new Date();
      const inicio = startOfDay(hoje);
      const fim = endOfDay(hoje);

      const qb = this.repository.createQueryBuilder('a')
        .select([
          'COUNT(*) as total_abastecimentos',
          'COALESCE(SUM(a.litragem), 0) as total_litros',
          'COALESCE(SUM(a.valor), 0) as total_valor',
          'COUNT(DISTINCT a.placa) as qtd_caminhoes',
        ])
        .where('a.dataAbastecimento BETWEEN :inicio AND :fim', { inicio, fim });

      // Se não for admin, filtra apenas os próprios registros
      if (req.usuario?.role !== 'admin' && req.usuario?.id) {
        qb.andWhere('a.usuarioCriadorId = :usuarioId', { usuarioId: req.usuario.id });
      }

      const agregado = await qb.getRawOne();

      // Buscar apenas os 10 últimos abastecimentos (select leve)
      const ultimosQb = this.repository.createQueryBuilder('a')
        .where('a.dataAbastecimento BETWEEN :inicio AND :fim', { inicio, fim });
      if (req.usuario?.role !== 'admin' && req.usuario?.id) {
        ultimosQb.andWhere('a.usuarioCriadorId = :usuarioId', { usuarioId: req.usuario.id });
      }
      const ultimosAbastecimentos = await ultimosQb
        .select(['a.id', 'a.placa', 'a.litragem', 'a.valor', 'a.dataAbastecimento', 'a.criadoEm'])
        .orderBy('a.criadoEm', 'DESC')
        .take(10)
        .getMany();

      const totalAbastecimentos = Number(agregado?.total_abastecimentos || 0);
      const totalLitros = Number(agregado?.total_litros || 0);
      const totalValor = Number(agregado?.total_valor || 0);
      const quantidadeCaminhoes = Number(agregado?.qtd_caminhoes || 0);

      res.json({
        totalAbastecimentos,
        totalLitros: Math.round(totalLitros * 100) / 100,
        totalValor: Math.round(totalValor * 100) / 100,
        mediaPorAbastecimento:
          totalAbastecimentos > 0
            ? Math.round((totalValor / totalAbastecimentos) * 100) / 100
            : 0,
        quantidadeCaminhoes,
        ultimosAbastecimentos,
      });
    } catch (error) {
      console.error('Erro ao buscar dashboard:', error);
      res.status(500).json({ error: 'Erro ao carregar dados do dashboard' });
    }
  }

  /**
   * GET /api/dashboard/graficos
   * ⚡ OTIMIZADO: usa GROUP BY e SUM no banco em vez de carregar registros
   * Retorna dados agregados para gráficos (filtrado por usuário se não admin)
   */
  async graficos(req: Request, res: Response): Promise<void> {
    try {
      const hoje = new Date();
      const seteDiasAtras = subDays(hoje, 6);
      const inicio = startOfDay(seteDiasAtras);
      const fim = endOfDay(hoje);

      const whereUsuario = (req.usuario?.role !== 'admin' && req.usuario?.id)
        ? { usuarioCriadorId: req.usuario.id }
        : {};

      // 1. Abastecimentos por dia (GROUP BY data)
      const qbDia = this.repository.createQueryBuilder('a')
        .select([
          'a.dataAbastecimento as dia',
          'COALESCE(SUM(a.litragem), 0) as litros',
          'COALESCE(SUM(a.valor), 0) as valor',
          'COUNT(*) as qtd',
        ])
        .where('a.dataAbastecimento BETWEEN :inicio AND :fim', { inicio, fim })
        .groupBy('a.dataAbastecimento')
        .orderBy('a.dataAbastecimento', 'ASC');

      this.aplicarFiltroUsuario(qbDia, req);
      const porDiaRaw = await qbDia.getRawMany();

      // Preencher dias sem registros com zero
      const mapaPorDia: Record<string, { dia: string; litros: number; valor: number; qtd: number }> = {};
      for (let i = 6; i >= 0; i--) {
        const d = subDays(hoje, i);
        const chave = d.toISOString().slice(0, 10);
        mapaPorDia[chave] = { dia: chave, litros: 0, valor: 0, qtd: 0 };
      }
      for (const r of porDiaRaw) {
        const chave = r.dia ? new Date(r.dia).toISOString().slice(0, 10) : '';
        if (mapaPorDia[chave]) {
          mapaPorDia[chave].litros = Math.round(Number(r.litros) * 100) / 100;
          mapaPorDia[chave].valor = Math.round(Number(r.valor) * 100) / 100;
          mapaPorDia[chave].qtd = Number(r.qtd);
        }
      }
      const abastecimentosPorDia = Object.values(mapaPorDia);

      // 2. Top 5 placas por total de litros (GROUP BY placa)
      const qbPlaca = this.repository.createQueryBuilder('a')
        .select([
          'a.placa as placa',
          'COALESCE(SUM(a.litragem), 0) as litros',
          'COALESCE(SUM(a.valor), 0) as valor',
          'COUNT(*) as qtd',
        ])
        .where('a.dataAbastecimento BETWEEN :inicio AND :fim', { inicio, fim })
        .andWhere('a.placa IS NOT NULL')
        .groupBy('a.placa')
        .orderBy('litros', 'DESC')
        .limit(5);

      this.aplicarFiltroUsuario(qbPlaca, req);
      const porPlacaRaw = await qbPlaca.getRawMany();

      const abastecimentosPorPlaca = porPlacaRaw.map(r => ({
        placa: r.placa,
        litros: Math.round(Number(r.litros) * 100) / 100,
        valor: Math.round(Number(r.valor) * 100) / 100,
        qtd: Number(r.qtd),
      }));

      res.json({
        abastecimentosPorDia,
        abastecimentosPorPlaca,
      });
    } catch (error) {
      console.error('Erro ao buscar dados dos gráficos:', error);
      res.status(500).json({ error: 'Erro ao carregar dados dos gráficos' });
    }
  }

  /**
   * POST /api/dashboard/generate-pdf (legado — margem full para dashboards)
   */
  async generatePdf(req: Request, res: Response): Promise<void> {
    if (!req.body.margin) req.body.margin = 'full';
    return pdfController.generate(req, res);
  }

  /**
   * Aplica filtro de usuário em QueryBuilder
   */
  private aplicarFiltroUsuario(qb: any, req: Request): void {
    if (req.usuario?.role !== 'admin' && req.usuario?.id) {
      qb.andWhere('a.usuarioCriadorId = :usuarioId', { usuarioId: req.usuario.id });
    }
  }
}
