import AppDataSource from './data-source';
import { GraficoPadraoConfig } from '../entities/GraficoPadraoConfig';
import { GRAFICOS_PADRAO } from '../services/graficosPadrao';

/**
 * Seed da biblioteca de gráficos padrão.
 * Popula o banco com os gráficos do catálogo hardcoded.
 */
export async function seedGraficosPadrao(): Promise<void> {
  const repo = AppDataSource.getRepository(GraficoPadraoConfig);

  const existentes = await repo.count();
  if (existentes > 0) {
    console.log(`[seedGraficosPadrao] ${existentes} gráficos já existentes na biblioteca. Pulando seed.`);
    return;
  }

  console.log('[seedGraficosPadrao] ⭐ Populando biblioteca de gráficos padrão...');

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
      config.descricao = g.descricao || null;
      config.categoria = g.categoria || 'Operacional';
      config.ordem = g.ordem;
      config.isContagem = g.isContagem || (g.tipo === 'pizza' || (g.placeholderEixoY?.length === 0));
      config.cor = g.cor || '#6366f1';
      config.isPersonalizado = false;
      entradas.push(config);
    }
  }

  if (entradas.length > 0) {
    await repo.save(entradas);
    console.log(`[seedGraficosPadrao] ✅ ${entradas.length} gráficos inseridos na biblioteca`);
  }
}
