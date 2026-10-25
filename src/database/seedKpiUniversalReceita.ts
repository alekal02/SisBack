import dotenv from 'dotenv';
dotenv.config();

import AppDataSource from './data-source';
import { KpiUniversal, PlaceholderKpi } from '../entities/KpiUniversal';
import { TipoServico } from '../enums/TipoServico';
import { upsertKpiSistema } from './kpiUniversalSeedUtils';

/**
 * Seed de KPIs de RECEITA por tipo de serviço.
 * Idempotente — insere apenas KPIs que ainda não existem (nome + tipoServico).
 */
/** Catálogo canônico de KPIs de receita (sem gravar no banco). */
export function buildKpisUniversaisReceita(): Partial<KpiUniversal>[] {
  const PH_PESO: PlaceholderKpi = {
    nome: 'PESO_PLACEHOLDER',
    label: 'Coluna de Peso',
    colunasCandidatas: ['PESO TOTAL', 'PESO', 'PESOTOTAL', 'PESO_BRUTO', 'PESO COLETADO', 'PESO (KG)', 'PESO COLETA'],
  };

  const PH_TIPO: PlaceholderKpi = {
    nome: 'TIPO_PLACEHOLDER',
    label: 'Coluna de Tipo de Caminhão',
    colunasCandidatas: ['TIPO CAMINHAO', 'TIPO_CAMINHAO', 'CAMINHAO', 'TIPO DE CAMINHAO', 'TIPODECAMINHAO'],
  };

  const PH_KM_VARRIDOS: PlaceholderKpi = {
    nome: 'KM_VARRIDOS_PLACEHOLDER',
    label: 'Coluna de KM Varridos',
    colunasCandidatas: ['QUILOMETROS_VARRIDOS', 'KM VARRIDOS', 'KM VARRIÇÃO', 'KM VARRICAO', 'KM Linear', 'KM LINEAR'],
  };

  const PH_AREA: PlaceholderKpi = {
    nome: 'AREA_PLACEHOLDER',
    label: 'Coluna de Área',
    colunasCandidatas: ['AREA_ROCADA', 'AREA_CAPINADA', 'AREA', 'METRAGEM', 'M2', 'Area m²', 'AREA M2'],
  };

  const PH_ARVORES: PlaceholderKpi = {
    nome: 'ARVORES_PLACEHOLDER',
    label: 'Coluna de Árvores Podadas',
    colunasCandidatas: ['ARVORES_PODADAS', 'QTDE ARVORES', 'ARVORES', 'Nº ARVORES', 'QUANTIDADE', 'Quantidade de Arvore', 'Quantidade de Árvore'],
  };

  const PH_COMPRIMENTO: PlaceholderKpi = {
    nome: 'COMPRIMENTO_PLACEHOLDER',
    label: 'Coluna de Comprimento',
    colunasCandidatas: ['COMPRIMENTO', 'COMPRIMENTO TOTAL', 'METRAGEM', 'EXTENSÃO', 'Metro Linear'],
  };

  const PH_EQUIPE: PlaceholderKpi = {
    nome: 'EQUIPE_PLACEHOLDER',
    label: 'Coluna de Equipe',
    colunasCandidatas: ['Equipe', 'EQUIPE', 'FUNCIONARIO', 'FUNCIONÁRIO', 'NOME', 'OPERADOR'],
  };

  const PH_METRO_LINEAR: PlaceholderKpi = {
    nome: 'METRO_LINEAR_PLACEHOLDER',
    label: 'Coluna de Metro Linear',
    colunasCandidatas: ['Metro Linear', 'METRO LINEAR', 'COMPRIMENTO', 'METRAGEM', 'KM Linear'],
  };

  const financeiro = (kpi: Partial<KpiUniversal>): Partial<KpiUniversal> => ({
    ...kpi,
    categoria: 'Financeiro',
    formato: 'moeda',
    unidade: 'R$',
    cor: kpi.cor || '#10b981',
  });

  const kpisReceita: Partial<KpiUniversal>[] = [
    // ─── VARRIÇÃO: valor por KM linear ───
    financeiro({
      nome: 'Faturamento Estimado',
      label: 'Faturamento Estimado',
      formula: 'MULTIPLY(SUM(KM_VARRIDOS_PLACEHOLDER), VALOR_KM_LINEAR)',
      agregacao: 'sum',
      descricao: 'Receita estimada: KM varridos × valor por KM linear do serviço',
      tipoServico: TipoServico.VARRICAO,
      placeholders: [PH_KM_VARRIDOS],
    }),
    financeiro({
      nome: 'Ticket Médio',
      label: 'Ticket Médio',
      formula: 'DIVIDE(MULTIPLY(SUM(KM_VARRIDOS_PLACEHOLDER), VALOR_KM_LINEAR), COUNT(*))',
      agregacao: 'sum',
      cor: '#34d399',
      descricao: 'Receita média por registro de varrição',
      tipoServico: TipoServico.VARRICAO,
      placeholders: [PH_KM_VARRIDOS],
    }),

    // ─── ROÇADEIRA: valor por m² ───
    financeiro({
      nome: 'Faturamento Estimado',
      label: 'Faturamento Estimado',
      formula: 'MULTIPLY(SUM(AREA_PLACEHOLDER), VALOR_M2)',
      agregacao: 'sum',
      descricao: 'Receita estimada: área roçada (m²) × valor por m² do serviço',
      tipoServico: TipoServico.ROCADEIRA,
      placeholders: [PH_AREA],
    }),
    financeiro({
      nome: 'Ticket Médio',
      label: 'Ticket Médio',
      formula: 'DIVIDE(MULTIPLY(SUM(AREA_PLACEHOLDER), VALOR_M2), COUNT(*))',
      agregacao: 'sum',
      cor: '#34d399',
      descricao: 'Receita média por registro de roçada',
      tipoServico: TipoServico.ROCADEIRA,
      placeholders: [PH_AREA],
    }),

    // ─── PODA: valor por árvore ───
    financeiro({
      nome: 'Faturamento Estimado',
      label: 'Faturamento Estimado',
      formula: 'MULTIPLY(SUM(ARVORES_PLACEHOLDER), VALOR_POR_ARVORE)',
      agregacao: 'sum',
      descricao: 'Receita estimada: árvores podadas × valor por árvore do serviço',
      tipoServico: TipoServico.PODA,
      placeholders: [PH_ARVORES],
    }),
    financeiro({
      nome: 'Ticket Médio',
      label: 'Ticket Médio',
      formula: 'DIVIDE(MULTIPLY(SUM(ARVORES_PLACEHOLDER), VALOR_POR_ARVORE), COUNT(*))',
      agregacao: 'sum',
      cor: '#34d399',
      descricao: 'Receita média por registro de poda',
      tipoServico: TipoServico.PODA,
      placeholders: [PH_ARVORES],
    }),

    // ─── REMOÇÃO: valor por equipe ───
    financeiro({
      nome: 'Faturamento Estimado',
      label: 'Faturamento Estimado',
      formula: 'MULTIPLY(COUNT(DISTINCT EQUIPE_PLACEHOLDER), VALOR_POR_EQUIPE)',
      agregacao: 'count',
      descricao: 'Receita estimada: equipes distintas × valor por equipe do serviço',
      tipoServico: TipoServico.REMOCAO,
      placeholders: [PH_EQUIPE],
    }),
    financeiro({
      nome: 'Receita por Equipe',
      label: 'Receita por Equipe',
      formula: 'DIVIDE(MULTIPLY(COUNT(DISTINCT EQUIPE_PLACEHOLDER), VALOR_POR_EQUIPE), COUNT(DISTINCT EQUIPE_PLACEHOLDER))',
      agregacao: 'count',
      cor: '#34d399',
      descricao: 'Valor médio de receita por equipe ativa no período',
      tipoServico: TipoServico.REMOCAO,
      placeholders: [PH_EQUIPE],
    }),

    // ─── PINTURA MEIO-FIO: valor por metro linear ───
    financeiro({
      nome: 'Faturamento Estimado',
      label: 'Faturamento Estimado',
      formula: 'MULTIPLY(SUM(COMPRIMENTO_PLACEHOLDER), VALOR_KM_LINEAR)',
      agregacao: 'sum',
      descricao: 'Receita estimada: comprimento pintado (m) × valor por metro linear do serviço',
      tipoServico: TipoServico.PINTURA_MEIO_FIO,
      placeholders: [PH_COMPRIMENTO],
    }),
    financeiro({
      nome: 'Ticket Médio',
      label: 'Ticket Médio',
      formula: 'DIVIDE(MULTIPLY(SUM(COMPRIMENTO_PLACEHOLDER), VALOR_KM_LINEAR), COUNT(*))',
      agregacao: 'sum',
      cor: '#34d399',
      descricao: 'Receita média por registro de pintura',
      tipoServico: TipoServico.PINTURA_MEIO_FIO,
      placeholders: [PH_COMPRIMENTO],
    }),

    // ─── CAPINA: valor por metro linear ───
    financeiro({
      nome: 'Faturamento Estimado',
      label: 'Faturamento Estimado',
      formula: 'MULTIPLY(SUM(METRO_LINEAR_PLACEHOLDER), VALOR_KM_LINEAR)',
      agregacao: 'sum',
      descricao: 'Receita estimada: metro linear capinado × valor por metro do serviço',
      tipoServico: TipoServico.CAPINA,
      placeholders: [PH_METRO_LINEAR],
    }),

    // ─── GERAL: valor por unidade ───
    financeiro({
      nome: 'Faturamento Estimado',
      label: 'Faturamento Estimado',
      formula: 'MULTIPLY(COUNT(*), VALOR_POR_UNIDADE)',
      agregacao: 'count',
      descricao: 'Receita estimada: total de registros × valor por unidade do serviço',
      tipoServico: TipoServico.GERAL,
      placeholders: [],
    }),
  ];

  return kpisReceita;
}

export async function seedKpisUniversaisReceita(): Promise<void> {
  const repo = AppDataSource.getRepository(KpiUniversal);
  const kpisReceita = buildKpisUniversaisReceita();

  let criados = 0;
  let atualizados = 0;
  for (const kpiData of kpisReceita) {
    const resultado = await upsertKpiSistema(repo, kpiData);
    if (resultado === 'created') criados++;
    if (resultado === 'updated') atualizados++;
  }

  console.log(`[seedKpisUniversaisReceita] ✅ ${criados} novos, ${atualizados} atualizados.`);
}

if (require.main === module) {
  (async () => {
    try {
      await AppDataSource.initialize();
      await seedKpisUniversaisReceita();
      await AppDataSource.destroy();
      process.exit(0);
    } catch (err) {
      console.error('[seedKpisUniversaisReceita] Erro:', err);
      process.exit(1);
    }
  })();
}
