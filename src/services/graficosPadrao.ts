/* ============================================
   CATÁLOGO DE GRÁFICOS PADRÃO POR TIPO DE SERVIÇO
   ═══════════════════════════════════════════════
   Fonte única para gráficos pré-definidos no estilo Google Analytics.
   Cada tipo de serviço tem de 8 a 12 gráficos com placeholders
   que são resolvidos automaticamente conforme as colunas da planilha.
   ═══════════════════════════════════════════════
   CATEGORIAS:
     - Operacional     → métricas do dia-a-dia
     - Financeiro      → faturamento, receita, custos
     - Produtividade   → eficiência, horas, performance
     - Qualidade       → variação, outliers, distribuição
     - Temporal        → evolução ao longo do tempo
     - Geográfico      → distribuição por região/bairro
   ============================================ */

import { TipoServico } from '../enums/TipoServico';
import { normalizarChave } from './FormulaEngine';

// ─── TIPOS ───

export type TipoGrafico = 'barra' | 'linha' | 'pizza' | 'area' | 'donut';

export interface GraficoPadrao {
  /** Chave única do gráfico dentro do tipo de serviço */
  key: string;
  /** Tipo visual do gráfico */
  tipo: TipoGrafico;
  /** Título exibido no dashboard */
  titulo: string;
  /** Placeholder(s) para eixo X (resolvido dinamicamente) */
  placeholderEixoX: string[];
  /** Placeholder(s) para eixo Y (resolvido dinamicamente) */
  placeholderEixoY: string[];
  /** Descrição do que o gráfico mostra */
  descricao: string;
  /** Ordem de exibição (1-based) */
  ordem: number;
  /** Categoria para agrupamento visual */
  categoria: string;
  /** Se o gráfico é de contagem (pizza/donut sem eixoY fixo) */
  isContagem: boolean;
  /** Cor tema do gráfico */
  cor: string;
}

// ─── CATÁLOGO ───

export const GRAFICOS_PADRAO: Record<string, GraficoPadrao[]> = {
  // ═══════════════════════════════════════════════
  // COLETA_CAMINHAO — 12 gráficos
  // ═══════════════════════════════════════════════
  [TipoServico.COLETA_CAMINHAO]: [
    {
      key: 'tonelagem_por_veiculo',
      tipo: 'barra',
      titulo: 'Tonelagem por Veículo',
      placeholderEixoX: ['CAMINHAO', 'PLACA', 'VEICULO', 'COLETOR'],
      placeholderEixoY: ['PESO TOTAL', 'PESO', 'PESOTOTAL'],
      descricao: 'Peso total coletado em toneladas agrupado por veículo',
      ordem: 1,
      categoria: 'Operacional',
      isContagem: false,
      cor: '#3b82f6',
    },
    {
      key: 'km_por_veiculo',
      tipo: 'barra',
      titulo: 'KM Rodados por Veículo',
      placeholderEixoX: ['CAMINHAO', 'PLACA', 'VEICULO', 'COLETOR'],
      placeholderEixoY: ['KM TOTAL', 'KM', 'KMTOTAL', 'QUILOMETRO', 'DISTANCIA'],
      descricao: 'Total de quilômetros rodados agrupado por veículo',
      ordem: 2,
      categoria: 'Operacional',
      isContagem: false,
      cor: '#06b6d4',
    },
    {
      key: 'faturamento_por_veiculo',
      tipo: 'barra',
      titulo: 'Faturamento por Veículo',
      placeholderEixoX: ['CAMINHAO', 'PLACA', 'VEICULO', 'COLETOR'],
      placeholderEixoY: ['PESO TOTAL', 'PESO'],
      descricao: 'Faturamento estimado por veículo (peso × valor do contrato)',
      ordem: 3,
      categoria: 'Financeiro',
      isContagem: false,
      cor: '#f59e0b',
    },
    {
      key: 'receita_km_por_veiculo',
      tipo: 'barra',
      titulo: 'Receita por KM por Veículo',
      placeholderEixoX: ['CAMINHAO', 'PLACA', 'VEICULO', 'COLETOR'],
      placeholderEixoY: ['KM TOTAL', 'KM', 'KMTOTAL'],
      descricao: 'Faturamento dividido pelos KM rodados — rentabilidade por veículo',
      ordem: 4,
      categoria: 'Financeiro',
      isContagem: false,
      cor: '#eab308',
    },
    {
      key: 'distribuicao_tipo_caminhao',
      tipo: 'pizza',
      titulo: 'Distribuição por Tipo de Caminhão',
      placeholderEixoX: ['TIPO CAMINHAO', 'TIPO_CAMINHAO', 'CAMINHAO', 'TIPO', 'TIPO DE CAMINHAO'],
      placeholderEixoY: [],
      descricao: 'Quantidade de viagens por tipo de caminhão',
      ordem: 5,
      categoria: 'Operacional',
      isContagem: true,
      cor: '#8b5cf6',
    },
    {
      key: 'tonelagem_ao_longo_do_tempo',
      tipo: 'linha',
      titulo: 'Evolução da Tonelagem',
      placeholderEixoX: ['DATA SAIDA', 'DATA', 'DIA', 'DATA DE SAIDA'],
      placeholderEixoY: ['PESO TOTAL', 'PESO', 'PESOTOTAL'],
      descricao: 'Peso total coletado ao longo do tempo',
      ordem: 6,
      categoria: 'Temporal',
      isContagem: false,
      cor: '#22c55e',
    },
    {
      key: 'km_ao_longo_do_tempo',
      tipo: 'linha',
      titulo: 'Evolução dos KM Rodados',
      placeholderEixoX: ['DATA SAIDA', 'DATA', 'DIA', 'DATA DE SAIDA'],
      placeholderEixoY: ['KM TOTAL', 'KM', 'KMTOTAL', 'QUILOMETRO', 'DISTANCIA'],
      descricao: 'KM rodados ao longo do tempo',
      ordem: 7,
      categoria: 'Temporal',
      isContagem: false,
      cor: '#06b6d4',
    },
    {
      key: 'horas_produtivas_por_veiculo',
      tipo: 'barra',
      titulo: 'Horas Produtivas por Veículo',
      placeholderEixoX: ['CAMINHAO', 'PLACA', 'VEICULO', 'COLETOR'],
      placeholderEixoY: ['HORA SAIDA BASE', 'HORA SAIDA', 'HORA SÁIDA BASE', 'HORASAIDABASE'],
      descricao: 'Total de horas produtivas agrupado por veículo (soma de horas)',
      ordem: 8,
      categoria: 'Produtividade',
      isContagem: false,
      cor: '#f97316',
    },
    {
      key: 'produtividade_por_coletor',
      tipo: 'barra',
      titulo: 'Produtividade por Motorista',
      placeholderEixoX: ['MOTORISTA', 'NOME', 'COLETOR', 'OPERADOR'],
      placeholderEixoY: ['PESO TOTAL', 'PESO'],
      descricao: 'Tonelagem coletada por motorista/coletor',
      ordem: 9,
      categoria: 'Produtividade',
      isContagem: false,
      cor: '#14b8a6',
    },
    {
      key: 'tonelada_km_por_veiculo',
      tipo: 'barra',
      titulo: 'Tonelada por KM por Veículo',
      placeholderEixoX: ['CAMINHAO', 'PLACA', 'VEICULO', 'COLETOR'],
      placeholderEixoY: ['KM TOTAL', 'KM', 'KMTOTAL'],
      descricao: 'Relação peso/KM — eficiência de carga por distância por veículo',
      ordem: 10,
      categoria: 'Eficiencia',
      isContagem: false,
      cor: '#6366f1',
    },
    {
      key: 'distribuicao_por_motorista',
      tipo: 'pizza',
      titulo: 'Viagens por Motorista',
      placeholderEixoX: ['MOTORISTA', 'NOME', 'COLETOR', 'OPERADOR'],
      placeholderEixoY: [],
      descricao: 'Quantidade de viagens por motorista',
      ordem: 11,
      categoria: 'Operacional',
      isContagem: true,
      cor: '#a855f7',
    },
    {
      key: 'distribuicao_por_regional',
      tipo: 'pizza',
      titulo: 'Distribuição por Regional',
      placeholderEixoX: ['REGIONAL', 'REGIAO', 'DISTRITO', 'SETOR', 'ROTA'],
      placeholderEixoY: [],
      descricao: 'Quantidade de viagens por regional/distrito',
      ordem: 12,
      categoria: 'Geográfico',
      isContagem: true,
      cor: '#ec4899',
    },
  ],

  // ═══════════════════════════════════════════════
  // ROCADEIRA — 10 gráficos
  // ═══════════════════════════════════════════════
  [TipoServico.ROCADEIRA]: [
    {
      key: 'area_por_tipo_execucao',
      tipo: 'pizza',
      titulo: 'Área Manual × Mecanizada',
      placeholderEixoX: ['TIPO', 'TIPO_EXECUCAO', 'Tipo'],
      placeholderEixoY: ['Area m²', 'AREA_M2', 'AREA_ROCADA', 'AREA ROCADA', 'AREA', 'M2', 'METROS QUADRADOS', 'QUANTITATIVO'],
      descricao: 'Distribuição da área roçada entre Manual e Mecanizada',
      ordem: 0,
      categoria: 'Operacional',
      isContagem: false,
      cor: '#0ea5e9',
    },
    {
      key: 'area_por_equipamento',
      tipo: 'barra',
      titulo: 'Área Roçada por Equipamento',
      placeholderEixoX: ['EQUIPAMENTO', 'MAQUINA', 'TRATOR', 'ROCADA'],
      placeholderEixoY: ['Area m²', 'AREA_M2', 'AREA_ROCADA', 'AREA ROCADA', 'AREA', 'M2', 'METROS QUADRADOS', 'QUANTITATIVO'],
      descricao: 'Área total roçada agrupada por equipamento',
      ordem: 1,
      categoria: 'Operacional',
      isContagem: false,
      cor: '#22c55e',
    },
    {
      key: 'area_por_funcionario',
      tipo: 'barra',
      titulo: 'Área Roçada por Funcionário',
      placeholderEixoX: ['FUNCIONARIO', 'NOME', 'OPERADOR'],
      placeholderEixoY: ['Area m²', 'AREA_M2', 'AREA_ROCADA', 'AREA ROCADA', 'AREA', 'M2', 'METROS QUADRADOS', 'QUANTITATIVO'],
      descricao: 'Área total roçada agrupada por funcionário',
      ordem: 2,
      categoria: 'Produtividade',
      isContagem: false,
      cor: '#14b8a6',
    },
    {
      key: 'area_ao_longo_do_tempo',
      tipo: 'linha',
      titulo: 'Evolução da Área Roçada',
      placeholderEixoX: ['DATA', 'DIA'],
      placeholderEixoY: ['Area m²', 'AREA_M2', 'AREA_ROCADA', 'AREA ROCADA', 'AREA', 'M2', 'METROS QUADRADOS', 'QUANTITATIVO'],
      descricao: 'Evolução da área roçada ao longo do tempo',
      ordem: 3,
      categoria: 'Temporal',
      isContagem: false,
      cor: '#06b6d4',
    },
    {
      key: 'horas_por_equipamento',
      tipo: 'barra',
      titulo: 'Horas Trabalhadas por Equipamento',
      placeholderEixoX: ['EQUIPAMENTO', 'MAQUINA', 'TRATOR', 'ROCADA'],
      placeholderEixoY: ['HORAS TRABALHADAS', 'HORAS', 'HORAS TRAB', 'HRS TRABALHADAS'],
      descricao: 'Total de horas trabalhadas agrupado por equipamento',
      ordem: 4,
      categoria: 'Produtividade',
      isContagem: false,
      cor: '#f59e0b',
    },
    {
      key: 'horas_por_bairro',
      tipo: 'barra',
      titulo: 'Horas Trabalhadas por Bairro',
      placeholderEixoX: ['BAIRRO', 'REGIAO', 'SETOR', 'LOCAL'],
      placeholderEixoY: ['HORAS TRABALHADAS', 'HORAS', 'HORAS TRAB', 'HRS TRABALHADAS'],
      descricao: 'Total de horas trabalhadas agrupado por bairro',
      ordem: 5,
      categoria: 'Operacional',
      isContagem: false,
      cor: '#3b82f6',
    },
    {
      key: 'distribuicao_por_equipe',
      tipo: 'pizza',
      titulo: 'Distribuição por Funcionário',
      placeholderEixoX: ['FUNCIONARIO', 'NOME', 'OPERADOR', 'EQUIPE'],
      placeholderEixoY: [],
      descricao: 'Quantidade de registros por funcionário',
      ordem: 6,
      categoria: 'Operacional',
      isContagem: true,
      cor: '#8b5cf6',
    },
    {
      key: 'produtividade_por_equipamento',
      tipo: 'barra',
      titulo: 'Produtividade (m²) por Equipamento',
      placeholderEixoX: ['EQUIPAMENTO', 'MAQUINA', 'TRATOR', 'ROCADA'],
      placeholderEixoY: ['Area m²', 'AREA_M2', 'AREA_ROCADA', 'AREA ROCADA', 'AREA', 'QUANTITATIVO'],
      descricao: 'Área roçada agrupada por equipamento (eficiência produtiva)',
      ordem: 7,
      categoria: 'Eficiencia',
      isContagem: false,
      cor: '#6366f1',
    },
    {
      key: 'evolucao_horas_tempo',
      tipo: 'linha',
      titulo: 'Evolução das Horas Trabalhadas',
      placeholderEixoX: ['DATA', 'DIA'],
      placeholderEixoY: ['HORAS TRABALHADAS', 'HORAS', 'HORAS TRAB', 'HRS TRABALHADAS'],
      descricao: 'Horas trabalhadas ao longo do tempo',
      ordem: 8,
      categoria: 'Temporal',
      isContagem: false,
      cor: '#f97316',
    },
    {
      key: 'distribuicao_por_bairro',
      tipo: 'pizza',
      titulo: 'Distribuição por Bairro',
      placeholderEixoX: ['BAIRRO', 'REGIAO', 'SETOR', 'LOCAL'],
      placeholderEixoY: [],
      descricao: 'Quantidade de registros por bairro/localidade',
      ordem: 9,
      categoria: 'Geográfico',
      isContagem: true,
      cor: '#ec4899',
    },
    {
      key: 'area_por_bairro',
      tipo: 'barra',
      titulo: 'Área Roçada por Bairro',
      placeholderEixoX: ['BAIRRO', 'REGIAO', 'SETOR', 'LOCAL'],
      placeholderEixoY: ['Area m²', 'AREA_M2', 'AREA_ROCADA', 'AREA ROCADA', 'AREA', 'M2', 'METROS QUADRADOS', 'QUANTITATIVO'],
      descricao: 'Área total roçada agrupada por bairro',
      ordem: 10,
      categoria: 'Geográfico',
      isContagem: false,
      cor: '#a855f7',
    },
  ],

  // ═══════════════════════════════════════════════
  // PODA — 10 gráficos
  // ═══════════════════════════════════════════════
  [TipoServico.PODA]: [
    {
      key: 'podas_por_setor',
      tipo: 'pizza',
      titulo: 'Podas por Setor',
      placeholderEixoX: ['SETOR', 'BAIRRO', 'REGIAO', 'DISTRITO'],
      placeholderEixoY: [],
      descricao: 'Quantidade de podas realizadas por setor/bairro',
      ordem: 1,
      categoria: 'Geográfico',
      isContagem: true,
      cor: '#22c55e',
    },
    {
      key: 'arvores_por_setor',
      tipo: 'barra',
      titulo: 'Árvores Podadas por Setor',
      placeholderEixoX: ['SETOR', 'BAIRRO', 'REGIAO', 'DISTRITO'],
      placeholderEixoY: ['Quantidade de Arvore', 'QTD_ARVORE', 'ARVORES_PODADAS', 'QTDE ARVORES', 'ARVORES', 'N ARVORES', 'QUANTIDADE', 'QUANTITATIVO'],
      descricao: 'Quantidade de árvores podadas agrupada por setor',
      ordem: 2,
      categoria: 'Operacional',
      isContagem: false,
      cor: '#14b8a6',
    },
    {
      key: 'podas_por_equipe',
      tipo: 'pizza',
      titulo: 'Podas por Equipe',
      placeholderEixoX: ['EQUIPE', 'FUNCIONARIO', 'OPERADOR', 'NOME'],
      placeholderEixoY: [],
      descricao: 'Quantidade de podas realizadas por equipe',
      ordem: 3,
      categoria: 'Operacional',
      isContagem: true,
      cor: '#8b5cf6',
    },
    {
      key: 'arvores_por_equipe',
      tipo: 'barra',
      titulo: 'Árvores Podadas por Equipe',
      placeholderEixoX: ['EQUIPE', 'FUNCIONARIO', 'OPERADOR', 'NOME'],
      placeholderEixoY: ['Quantidade de Arvore', 'QTD_ARVORE', 'ARVORES_PODADAS', 'QTDE ARVORES', 'ARVORES', 'N ARVORES', 'QUANTIDADE', 'QUANTITATIVO'],
      descricao: 'Quantidade de árvores podadas agrupada por equipe',
      ordem: 4,
      categoria: 'Produtividade',
      isContagem: false,
      cor: '#3b82f6',
    },
    {
      key: 'podas_ao_longo_do_tempo',
      tipo: 'linha',
      titulo: 'Podas ao Longo do Tempo',
      placeholderEixoX: ['DIA', 'DATA'],
      placeholderEixoY: [],
      descricao: 'Evolução do número de podas ao longo do tempo',
      ordem: 5,
      categoria: 'Temporal',
      isContagem: true,
      cor: '#06b6d4',
    },
    {
      key: 'evolucao_arvores_podadas',
      tipo: 'linha',
      titulo: 'Evolução de Árvores Podadas',
      placeholderEixoX: ['DIA', 'DATA'],
      placeholderEixoY: ['Quantidade de Arvore', 'QTD_ARVORE', 'ARVORES_PODADAS', 'QTDE ARVORES', 'ARVORES', 'N ARVORES', 'QUANTIDADE', 'QUANTITATIVO'],
      descricao: 'Quantidade de árvores podadas ao longo do tempo',
      ordem: 6,
      categoria: 'Temporal',
      isContagem: false,
      cor: '#22c55e',
    },
    {
      key: 'ruas_com_mais_podas',
      tipo: 'barra',
      titulo: 'Ruas com Mais Podas',
      placeholderEixoX: ['AVENIDA / RUA', 'AV/RUA', 'RUA', 'AVENIDA', 'LOGRADOURO'],
      placeholderEixoY: [],
      descricao: 'Ruas/avenidas com maior número de podas realizadas',
      ordem: 7,
      categoria: 'Geográfico',
      isContagem: true,
      cor: '#f59e0b',
    },
    {
      key: 'distribuicao_por_bairro',
      tipo: 'pizza',
      titulo: 'Distribuição por Bairro',
      placeholderEixoX: ['BAIRRO', 'REGIAO', 'SETOR', 'DISTRITO'],
      placeholderEixoY: [],
      descricao: 'Quantidade de podas por bairro',
      ordem: 8,
      categoria: 'Geográfico',
      isContagem: true,
      cor: '#ec4899',
    },
    {
      key: 'horas_por_setor',
      tipo: 'barra',
      titulo: 'Horas de Poda por Setor',
      placeholderEixoX: ['SETOR', 'BAIRRO', 'REGIAO', 'DISTRITO'],
      placeholderEixoY: ['HORAS', 'HORAS TRABALHADAS', 'HORAS TRAB', 'HRS TRABALHADAS'],
      descricao: 'Total de horas de poda agrupado por setor',
      ordem: 9,
      categoria: 'Produtividade',
      isContagem: false,
      cor: '#f97316',
    },
    {
      key: 'altura_media_por_setor',
      tipo: 'barra',
      titulo: 'Altura Média por Setor',
      placeholderEixoX: ['SETOR', 'BAIRRO', 'REGIAO', 'DISTRITO'],
      placeholderEixoY: ['ALTURA_MEDIA', 'ALTURA', 'ALTURA MÉDIA'],
      descricao: 'Altura média das árvores podadas agrupada por setor',
      ordem: 10,
      categoria: 'Qualidade',
      isContagem: false,
      cor: '#a855f7',
    },
  ],

  // ═══════════════════════════════════════════════
  // CAPINA — 10 gráficos
  // ═══════════════════════════════════════════════
  [TipoServico.CAPINA]: [
    {
      key: 'capina_por_bairro',
      tipo: 'barra',
      titulo: 'Metragem Capinada por Bairro',
      placeholderEixoX: ['BAIRRO', 'REGIAO', 'SETOR', 'DISTRITO'],
      placeholderEixoY: ['Metro Linear', 'METRO_LINEAR', 'KM Linear', 'KM_LINEAR', 'COMPRIMENTO (METROS)', 'COMPRIMENTO', 'METROS', 'AREA_CAPINADA', 'AREA', 'QUANTITATIVO'],
      descricao: 'Metragem total capinada agrupada por bairro',
      ordem: 1,
      categoria: 'Operacional',
      isContagem: false,
      cor: '#22c55e',
    },
    {
      key: 'capina_por_funcionario',
      tipo: 'barra',
      titulo: 'Metragem Capinada por Funcionário',
      placeholderEixoX: ['FUNCIONARIO', 'NOME', 'OPERADOR', 'EQUIPE'],
      placeholderEixoY: ['Metro Linear', 'METRO_LINEAR', 'KM Linear', 'KM_LINEAR', 'COMPRIMENTO (METROS)', 'COMPRIMENTO', 'METROS', 'AREA_CAPINADA', 'AREA', 'QUANTITATIVO'],
      descricao: 'Metragem total capinada agrupada por funcionário',
      ordem: 2,
      categoria: 'Produtividade',
      isContagem: false,
      cor: '#14b8a6',
    },
    {
      key: 'evolucao_da_capina',
      tipo: 'linha',
      titulo: 'Evolução da Metragem Capinada',
      placeholderEixoX: ['DATA', 'DIA'],
      placeholderEixoY: ['Metro Linear', 'METRO_LINEAR', 'KM Linear', 'KM_LINEAR', 'COMPRIMENTO (METROS)', 'COMPRIMENTO', 'METROS', 'AREA_CAPINADA', 'AREA', 'QUANTITATIVO'],
      descricao: 'Metragem capinada ao longo do tempo',
      ordem: 3,
      categoria: 'Temporal',
      isContagem: false,
      cor: '#06b6d4',
    },
    {
      key: 'horas_por_funcionario',
      tipo: 'barra',
      titulo: 'Horas de Capina por Funcionário',
      placeholderEixoX: ['FUNCIONARIO', 'NOME', 'OPERADOR', 'EQUIPE'],
      placeholderEixoY: ['HORAS', 'HORAS TRABALHADAS', 'HORAS TRAB', 'HRS TRABALHADAS'],
      descricao: 'Total de horas de capina agrupado por funcionário',
      ordem: 4,
      categoria: 'Produtividade',
      isContagem: false,
      cor: '#f59e0b',
    },
    {
      key: 'maiores_trechos_capinados',
      tipo: 'barra',
      titulo: 'Maiores Trechos Capinados',
      placeholderEixoX: ['AV/RUA', 'AVENIDA / RUA', 'RUA', 'AVENIDA', 'LOGRADOURO', 'LOCAL', 'NOME'],
      placeholderEixoY: ['Metro Linear', 'METRO_LINEAR', 'KM Linear', 'KM_LINEAR', 'COMPRIMENTO (METROS)', 'COMPRIMENTO', 'METROS', 'AREA_CAPINADA', 'AREA', 'QUANTITATIVO'],
      descricao: 'Ruas/avenidas com maior metragem capinada',
      ordem: 5,
      categoria: 'Operacional',
      isContagem: false,
      cor: '#3b82f6',
    },
    {
      key: 'distribuicao_por_funcionario',
      tipo: 'pizza',
      titulo: 'Distribuição por Funcionário',
      placeholderEixoX: ['FUNCIONARIO', 'NOME', 'OPERADOR', 'EQUIPE'],
      placeholderEixoY: [],
      descricao: 'Quantidade de registros por funcionário',
      ordem: 6,
      categoria: 'Operacional',
      isContagem: true,
      cor: '#8b5cf6',
    },
    {
      key: 'capina_por_setor_pizza',
      tipo: 'pizza',
      titulo: 'Distribuição por Setor',
      placeholderEixoX: ['SETOR', 'BAIRRO', 'REGIAO', 'DISTRITO'],
      placeholderEixoY: [],
      descricao: 'Distribuição da capina por setor/bairro',
      ordem: 7,
      categoria: 'Geográfico',
      isContagem: true,
      cor: '#ec4899',
    },
    {
      key: 'evolucao_horas_capina',
      tipo: 'linha',
      titulo: 'Evolução das Horas de Capina',
      placeholderEixoX: ['DATA', 'DIA'],
      placeholderEixoY: ['HORAS', 'HORAS TRABALHADAS', 'HORAS TRAB', 'HRS TRABALHADAS'],
      descricao: 'Horas de capina ao longo do tempo',
      ordem: 8,
      categoria: 'Temporal',
      isContagem: false,
      cor: '#f97316',
    },
    {
      key: 'distribuicao_por_local',
      tipo: 'pizza',
      titulo: 'Distribuição por Localidade',
      placeholderEixoX: ['LOCAL', 'BAIRRO', 'REGIAO', 'SETOR', 'DISTRITO'],
      placeholderEixoY: [],
      descricao: 'Quantidade de registros por localidade',
      ordem: 9,
      categoria: 'Geográfico',
      isContagem: true,
      cor: '#a855f7',
    },
    {
      key: 'produtividade_metros_por_hora',
      tipo: 'barra',
      titulo: 'Produtividade (m) por Funcionário',
      placeholderEixoX: ['FUNCIONARIO', 'NOME', 'OPERADOR', 'EQUIPE'],
      placeholderEixoY: ['Metro Linear', 'METRO_LINEAR', 'KM Linear', 'KM_LINEAR', 'COMPRIMENTO (METROS)', 'COMPRIMENTO', 'METROS', 'QUANTITATIVO'],
      descricao: 'Metros capinados por funcionário — produtividade individual',
      ordem: 10,
      categoria: 'Eficiencia',
      isContagem: false,
      cor: '#6366f1',
    },
  ],

  // ═══════════════════════════════════════════════
  // VARRICAO — 10 gráficos
  // ═══════════════════════════════════════════════
  [TipoServico.VARRICAO]: [
    {
      key: 'km_por_bairro',
      tipo: 'barra',
      titulo: 'KM Varridos por Bairro',
      placeholderEixoX: ['BAIRRO', 'REGIAO', 'SETOR', 'DISTRITO'],
      placeholderEixoY: ['KM Linear', 'KM_LINEAR', 'QUILOMETROS_VARRIDOS', 'KM VARRIDOS', 'KM', 'KMVARRIDOS', 'DISTANCIA', 'QUANTITATIVO'],
      descricao: 'Quilômetros varridos agrupados por bairro',
      ordem: 1,
      categoria: 'Operacional',
      isContagem: false,
      cor: '#06b6d4',
    },
    {
      key: 'km_por_funcionario',
      tipo: 'barra',
      titulo: 'KM Varridos por Funcionário',
      placeholderEixoX: ['FUNCIONARIO', 'OPERADOR', 'NOME', 'EQUIPE', 'GARI'],
      placeholderEixoY: ['KM Linear', 'KM_LINEAR', 'QUILOMETROS_VARRIDOS', 'KM VARRIDOS', 'KM', 'KMVARRIDOS', 'DISTANCIA', 'QUANTITATIVO'],
      descricao: 'Total de KM varridos agrupado por funcionário',
      ordem: 2,
      categoria: 'Produtividade',
      isContagem: false,
      cor: '#14b8a6',
    },
    {
      key: 'evolucao_da_varricao',
      tipo: 'linha',
      titulo: 'Evolução da Varrição (KM)',
      placeholderEixoX: ['DATA', 'DIA'],
      placeholderEixoY: ['KM Linear', 'KM_LINEAR', 'QUILOMETROS_VARRIDOS', 'KM VARRIDOS', 'KM', 'KMVARRIDOS', 'DISTANCIA', 'QUANTITATIVO'],
      descricao: 'KM varridos ao longo do tempo',
      ordem: 3,
      categoria: 'Temporal',
      isContagem: false,
      cor: '#22c55e',
    },
    {
      key: 'km_por_turno',
      tipo: 'barra',
      titulo: 'KM Varridos por Turno',
      placeholderEixoX: ['TURNO', 'PERIODO', 'TURNO (M/T/N)'],
      placeholderEixoY: ['KM Linear', 'KM_LINEAR', 'QUILOMETROS_VARRIDOS', 'KM VARRIDOS', 'KM', 'KMVARRIDOS', 'DISTANCIA', 'QUANTITATIVO'],
      descricao: 'Total de KM varridos agrupado por turno',
      ordem: 4,
      categoria: 'Operacional',
      isContagem: false,
      cor: '#f59e0b',
    },
    {
      key: 'distribuicao_por_funcionario',
      tipo: 'pizza',
      titulo: 'Distribuição por Funcionário',
      placeholderEixoX: ['FUNCIONARIO', 'OPERADOR', 'NOME', 'EQUIPE', 'GARI'],
      placeholderEixoY: [],
      descricao: 'Quantidade de registros por funcionário',
      ordem: 5,
      categoria: 'Operacional',
      isContagem: true,
      cor: '#8b5cf6',
    },
    {
      key: 'distribuicao_por_bairro',
      tipo: 'pizza',
      titulo: 'Distribuição por Bairro',
      placeholderEixoX: ['BAIRRO', 'REGIAO', 'SETOR', 'DISTRITO'],
      placeholderEixoY: [],
      descricao: 'Quantidade de registros por bairro',
      ordem: 6,
      categoria: 'Geográfico',
      isContagem: true,
      cor: '#ec4899',
    },
    {
      key: 'distribuicao_por_turno',
      tipo: 'pizza',
      titulo: 'Distribuição por Turno',
      placeholderEixoX: ['TURNO', 'PERIODO', 'TURNO (M/T/N)'],
      placeholderEixoY: [],
      descricao: 'Quantidade de registros por turno',
      ordem: 7,
      categoria: 'Operacional',
      isContagem: true,
      cor: '#a855f7',
    },
    {
      key: 'evolucao_horas_varricao',
      tipo: 'linha',
      titulo: 'Evolução das Horas de Varrição',
      placeholderEixoX: ['DATA', 'DIA'],
      placeholderEixoY: ['HORAS', 'HORAS TRABALHADAS', 'HORAS TRAB', 'HRS TRABALHADAS'],
      descricao: 'Horas de varrição ao longo do tempo',
      ordem: 8,
      categoria: 'Temporal',
      isContagem: false,
      cor: '#f97316',
    },
    {
      key: 'produtividade_km_por_hora',
      tipo: 'barra',
      titulo: 'Produtividade (KM/h) por Funcionário',
      placeholderEixoX: ['FUNCIONARIO', 'OPERADOR', 'NOME', 'EQUIPE', 'GARI'],
      placeholderEixoY: ['QUILOMETROS_VARRIDOS', 'KM VARRIDOS', 'KM'],
      descricao: 'KM varridos por funcionário — eficiência individual',
      ordem: 9,
      categoria: 'Eficiencia',
      isContagem: false,
      cor: '#6366f1',
    },
    {
      key: 'km_por_dia_semana',
      tipo: 'barra',
      titulo: 'KM Varridos por Dia da Semana',
      placeholderEixoX: ['DATA', 'DIA'],
      placeholderEixoY: ['QUILOMETROS_VARRIDOS', 'KM VARRIDOS', 'KM', 'KMVARRIDOS', 'DISTANCIA'],
      descricao: 'KM varridos agrupados por dia da semana',
      ordem: 10,
      categoria: 'Temporal',
      isContagem: false,
      cor: '#3b82f6',
    },
  ],

  // ═══════════════════════════════════════════════
  // PINTURA_MEIO_FIO — 10 gráficos
  // ═══════════════════════════════════════════════
  [TipoServico.PINTURA_MEIO_FIO]: [
    {
      key: 'pintura_por_bairro',
      tipo: 'barra',
      titulo: 'Comprimento Pintado por Bairro',
      placeholderEixoX: ['BAIRRO', 'REGIAO', 'SETOR', 'LOCAL'],
      placeholderEixoY: ['COMPRIMENTO TOTAL', 'COMPRIMENTO', 'METROS'],
      descricao: 'Comprimento total pintado agrupado por bairro',
      ordem: 1,
      categoria: 'Operacional',
      isContagem: false,
      cor: '#3b82f6',
    },
    {
      key: 'sarjetas_por_bairro',
      tipo: 'barra',
      titulo: 'Sarjetas por Bairro',
      placeholderEixoX: ['BAIRRO', 'REGIAO', 'SETOR', 'LOCAL'],
      placeholderEixoY: ['NUMERO DE SARJETAS EXECUTADAS', 'NUMERO DE SARJETAS', 'SARJETAS', 'NRO SARJETAS', 'QTDE SARJETAS'],
      descricao: 'Quantidade de sarjetas executadas agrupada por bairro',
      ordem: 2,
      categoria: 'Operacional',
      isContagem: false,
      cor: '#f59e0b',
    },
    {
      key: 'evolucao_da_pintura',
      tipo: 'linha',
      titulo: 'Evolução do Comprimento Pintado',
      placeholderEixoX: ['DATA', 'DIA'],
      placeholderEixoY: ['COMPRIMENTO TOTAL', 'COMPRIMENTO', 'METROS'],
      descricao: 'Comprimento pintado ao longo do tempo',
      ordem: 3,
      categoria: 'Temporal',
      isContagem: false,
      cor: '#06b6d4',
    },
    {
      key: 'evolucao_sarjetas',
      tipo: 'linha',
      titulo: 'Evolução das Sarjetas Executadas',
      placeholderEixoX: ['DATA', 'DIA'],
      placeholderEixoY: ['NUMERO DE SARJETAS EXECUTADAS', 'NUMERO DE SARJETAS', 'SARJETAS', 'NRO SARJETAS', 'QTDE SARJETAS'],
      descricao: 'Quantidade de sarjetas executadas ao longo do tempo',
      ordem: 4,
      categoria: 'Temporal',
      isContagem: false,
      cor: '#22c55e',
    },
    {
      key: 'comprimento_por_logradouro',
      tipo: 'barra',
      titulo: 'Comprimento Pintado por Logradouro',
      placeholderEixoX: ['NOME', 'AVENIDA / RUA', 'AV/RUA', 'RUA', 'AVENIDA', 'LOGRADOURO'],
      placeholderEixoY: ['COMPRIMENTO TOTAL', 'COMPRIMENTO', 'METROS'],
      descricao: 'Comprimento total pintado agrupado por logradouro',
      ordem: 5,
      categoria: 'Operacional',
      isContagem: false,
      cor: '#14b8a6',
    },
    {
      key: 'sarjetas_por_logradouro',
      tipo: 'barra',
      titulo: 'Sarjetas por Logradouro',
      placeholderEixoX: ['NOME', 'AVENIDA / RUA', 'AV/RUA', 'RUA', 'AVENIDA', 'LOGRADOURO'],
      placeholderEixoY: ['NUMERO DE SARJETAS EXECUTADAS', 'NUMERO DE SARJETAS', 'SARJETAS', 'NRO SARJETAS', 'QTDE SARJETAS'],
      descricao: 'Quantidade de sarjetas executadas agrupada por logradouro',
      ordem: 6,
      categoria: 'Operacional',
      isContagem: false,
      cor: '#f97316',
    },
    {
      key: 'distribuicao_por_bairro',
      tipo: 'pizza',
      titulo: 'Distribuição por Bairro',
      placeholderEixoX: ['BAIRRO', 'REGIAO', 'SETOR', 'LOCAL'],
      placeholderEixoY: [],
      descricao: 'Quantidade de registros por bairro',
      ordem: 7,
      categoria: 'Geográfico',
      isContagem: true,
      cor: '#8b5cf6',
    },
    {
      key: 'media_sarjetas_por_bairro',
      tipo: 'barra',
      titulo: 'Média de Sarjetas por Bairro',
      placeholderEixoX: ['BAIRRO', 'REGIAO', 'SETOR', 'LOCAL'],
      placeholderEixoY: ['NUMERO DE SARJETAS EXECUTADAS', 'NUMERO DE SARJETAS', 'SARJETAS'],
      descricao: 'Média de sarjetas executadas por bairro',
      ordem: 8,
      categoria: 'Qualidade',
      isContagem: false,
      cor: '#ec4899',
    },
    {
      key: 'comprimento_por_dia',
      tipo: 'area',
      titulo: 'Comprimento Pintado por Dia',
      placeholderEixoX: ['DATA', 'DIA'],
      placeholderEixoY: ['COMPRIMENTO TOTAL', 'COMPRIMENTO', 'METROS'],
      descricao: 'Comprimento pintado por dia (área acumulada)',
      ordem: 9,
      categoria: 'Temporal',
      isContagem: false,
      cor: '#6366f1',
    },
    {
      key: 'distribuicao_por_logradouro',
      tipo: 'pizza',
      titulo: 'Distribuição por Logradouro',
      placeholderEixoX: ['NOME', 'AVENIDA / RUA', 'AV/RUA', 'RUA', 'AVENIDA', 'LOGRADOURO'],
      placeholderEixoY: [],
      descricao: 'Quantidade de registros por logradouro',
      ordem: 10,
      categoria: 'Geográfico',
      isContagem: true,
      cor: '#a855f7',
    },
  ],

  // ═══════════════════════════════════════════════
  // REMOCAO — 10 gráficos
  // ═══════════════════════════════════════════════
  [TipoServico.REMOCAO]: [
    {
      key: 'remocoes_por_setor',
      tipo: 'pizza',
      titulo: 'Remoções por Setor',
      placeholderEixoX: ['SETOR', 'BAIRRO', 'REGIAO', 'DISTRITO'],
      placeholderEixoY: [],
      descricao: 'Quantidade de remoções realizadas por setor/bairro',
      ordem: 1,
      categoria: 'Geográfico',
      isContagem: true,
      cor: '#22c55e',
    },
    {
      key: 'remocoes_por_tipo',
      tipo: 'pizza',
      titulo: 'Remoções por Tipo',
      placeholderEixoX: ['DESCRICAO DO SERVICO', 'DESCRICAO', 'SERVICO', 'TIPO', 'DESCRIÇÃO DO SERVIÇO'],
      placeholderEixoY: [],
      descricao: 'Distribuição dos tipos de remoção realizados',
      ordem: 2,
      categoria: 'Operacional',
      isContagem: true,
      cor: '#8b5cf6',
    },
    {
      key: 'remocoes_ao_longo_do_tempo',
      tipo: 'linha',
      titulo: 'Remoções ao Longo do Tempo',
      placeholderEixoX: ['DIA', 'DATA'],
      placeholderEixoY: [],
      descricao: 'Evolução do número de remoções ao longo do tempo',
      ordem: 3,
      categoria: 'Temporal',
      isContagem: true,
      cor: '#06b6d4',
    },
    {
      key: 'evolucao_por_setor',
      tipo: 'linha',
      titulo: 'Evolução por Setor',
      placeholderEixoX: ['DIA', 'DATA'],
      placeholderEixoY: ['SETOR', 'BAIRRO', 'REGIAO', 'DISTRITO'],
      descricao: 'Evolução das remoções ao longo do tempo por setor',
      ordem: 4,
      categoria: 'Temporal',
      isContagem: true,
      cor: '#3b82f6',
    },
    {
      key: 'ruas_com_mais_remocoes',
      tipo: 'barra',
      titulo: 'Ruas com Mais Remoções',
      placeholderEixoX: ['AVENIDA / RUA', 'AV/RUA', 'RUA', 'AVENIDA', 'LOGRADOURO'],
      placeholderEixoY: [],
      descricao: 'Ruas/avenidas com maior número de remoções realizadas',
      ordem: 5,
      categoria: 'Geográfico',
      isContagem: true,
      cor: '#f59e0b',
    },
    {
      key: 'remocoes_por_setor_barra',
      tipo: 'barra',
      titulo: 'Remoções por Setor (Barra)',
      placeholderEixoX: ['SETOR', 'BAIRRO', 'REGIAO', 'DISTRITO'],
      placeholderEixoY: [],
      descricao: 'Quantidade de remoções por setor em barras',
      ordem: 6,
      categoria: 'Geográfico',
      isContagem: true,
      cor: '#14b8a6',
    },
    {
      key: 'distribuicao_por_complemento',
      tipo: 'pizza',
      titulo: 'Distribuição por Complemento',
      placeholderEixoX: ['COMPLEMENTO', 'OBS', 'OBSERVACAO', 'OBSERVAÇÃO'],
      placeholderEixoY: [],
      descricao: 'Distribuição dos complementos de remoção',
      ordem: 7,
      categoria: 'Operacional',
      isContagem: true,
      cor: '#ec4899',
    },
    {
      key: 'remocoes_acumuladas',
      tipo: 'area',
      titulo: 'Remoções Acumuladas',
      placeholderEixoX: ['DIA', 'DATA'],
      placeholderEixoY: [],
      descricao: 'Total acumulado de remoções ao longo do tempo',
      ordem: 8,
      categoria: 'Temporal',
      isContagem: true,
      cor: '#6366f1',
    },
    {
      key: 'remocoes_por_bairro',
      tipo: 'barra',
      titulo: 'Remoções por Bairro',
      placeholderEixoX: ['BAIRRO', 'REGIAO', 'SETOR', 'DISTRITO'],
      placeholderEixoY: [],
      descricao: 'Quantidade de remoções por bairro',
      ordem: 9,
      categoria: 'Geográfico',
      isContagem: true,
      cor: '#f97316',
    },
    {
      key: 'media_remocoes_por_dia',
      tipo: 'linha',
      titulo: 'Média de Remoções por Dia',
      placeholderEixoX: ['DIA', 'DATA'],
      placeholderEixoY: [],
      descricao: 'Média móvel de remoções por dia',
      ordem: 10,
      categoria: 'Temporal',
      isContagem: true,
      cor: '#a855f7',
    },
  ],

  // ═══════════════════════════════════════════════
  // GERAL — 8 gráficos genéricos
  // ═══════════════════════════════════════════════
  [TipoServico.GERAL]: [
    {
      key: 'distribuicao_por_categoria',
      tipo: 'pizza',
      titulo: 'Distribuição por Categoria',
      placeholderEixoX: ['CATEGORIA', 'TIPO', 'CLASSE', 'GRUPO', 'SETOR', 'BAIRRO'],
      placeholderEixoY: [],
      descricao: 'Distribuição por categoria',
      ordem: 1,
      categoria: 'Operacional',
      isContagem: true,
      cor: '#8b5cf6',
    },
    {
      key: 'total_por_categoria',
      tipo: 'barra',
      titulo: 'Total por Categoria',
      placeholderEixoX: ['CATEGORIA', 'TIPO', 'CLASSE', 'GRUPO', 'SETOR', 'BAIRRO'],
      placeholderEixoY: ['TOTAL', 'VALOR', 'QUANTIDADE', 'NUMERO'],
      descricao: 'Soma total agrupada por categoria',
      ordem: 2,
      categoria: 'Operacional',
      isContagem: false,
      cor: '#3b82f6',
    },
    {
      key: 'total_ao_longo_do_tempo',
      tipo: 'linha',
      titulo: 'Evolução Total ao Longo do Tempo',
      placeholderEixoX: ['DATA', 'DIA', 'MES', 'ANO'],
      placeholderEixoY: ['TOTAL', 'VALOR', 'QUANTIDADE', 'NUMERO'],
      descricao: 'Evolução do total ao longo do tempo',
      ordem: 3,
      categoria: 'Temporal',
      isContagem: false,
      cor: '#06b6d4',
    },
    {
      key: 'top_por_categoria',
      tipo: 'barra',
      titulo: 'Top por Categoria',
      placeholderEixoX: ['CATEGORIA', 'TIPO', 'CLASSE', 'GRUPO', 'SETOR', 'BAIRRO'],
      placeholderEixoY: [],
      descricao: 'Quantidade de registros por categoria (Top)',
      ordem: 4,
      categoria: 'Operacional',
      isContagem: true,
      cor: '#f59e0b',
    },
    {
      key: 'distribuicao_por_funcionario',
      tipo: 'pizza',
      titulo: 'Distribuição por Funcionário',
      placeholderEixoX: ['FUNCIONARIO', 'NOME', 'OPERADOR', 'EQUIPE'],
      placeholderEixoY: [],
      descricao: 'Quantidade de registros por funcionário',
      ordem: 5,
      categoria: 'Operacional',
      isContagem: true,
      cor: '#14b8a6',
    },
    {
      key: 'evolucao_quantidade',
      tipo: 'linha',
      titulo: 'Evolução da Quantidade',
      placeholderEixoX: ['DATA', 'DIA', 'MES', 'ANO'],
      placeholderEixoY: [],
      descricao: 'Número de registros ao longo do tempo',
      ordem: 6,
      categoria: 'Temporal',
      isContagem: true,
      cor: '#22c55e',
    },
    {
      key: 'distribuicao_por_status',
      tipo: 'pizza',
      titulo: 'Distribuição por Status',
      placeholderEixoX: ['STATUS', 'SITUACAO', 'SITUAÇÃO', 'ESTADO', 'CONDICAO', 'CONDIÇÃO'],
      placeholderEixoY: [],
      descricao: 'Distribuição por status/situação',
      ordem: 7,
      categoria: 'Operacional',
      isContagem: true,
      cor: '#ec4899',
    },
    {
      key: 'total_acumulado',
      tipo: 'area',
      titulo: 'Total Acumulado',
      placeholderEixoX: ['DATA', 'DIA', 'MES', 'ANO'],
      placeholderEixoY: ['TOTAL', 'VALOR', 'QUANTIDADE', 'NUMERO'],
      descricao: 'Total acumulado ao longo do tempo',
      ordem: 8,
      categoria: 'Temporal',
      isContagem: false,
      cor: '#6366f1',
    },
  ],
};

// ─── FUNÇÕES AUXILIARES ───

/**
 * Retorna os gráficos padrão para um tipo de serviço
 */
export function getGraficosPorTipo(tipo: string): GraficoPadrao[] {
  return GRAFICOS_PADRAO[tipo] || GRAFICOS_PADRAO[TipoServico.GERAL] || [];
}

/**
 * Retorna todos os tipos de serviço que têm gráficos cadastrados
 */
export function getTiposComGraficos(): string[] {
  return Object.keys(GRAFICOS_PADRAO).filter(t => GRAFICOS_PADRAO[t].length > 0);
}

/**
 * Retorna estatísticas do catálogo de gráficos por tipo de serviço
 */
export function getEstatisticasGraficos(): Record<string, { total: number; porCategoria: Record<string, number> }> {
  const stats: Record<string, { total: number; porCategoria: Record<string, number> }> = {};
  for (const [tipo, graficos] of Object.entries(GRAFICOS_PADRAO)) {
    const porCategoria: Record<string, number> = {};
    for (const g of graficos) {
      porCategoria[g.categoria] = (porCategoria[g.categoria] || 0) + 1;
    }
    stats[tipo] = { total: graficos.length, porCategoria };
  }
  return stats;
}

/**
 * Resolve placeholders de um gráfico com base nas colunas reais da planilha.
 * Retorna null se não encontrar coluna compatível.
 */
export function resolverGrafico(
  grafico: GraficoPadrao,
  colunasDisponiveis: string[]
): { eixoX: string; eixoY: string; resolvido: boolean } | null {
  const colunasNorm = colunasDisponiveis.map(c => ({
    original: c,
    norm: normalizarChave(c),
  }));

  // Função para encontrar coluna real a partir de placeholders
  const encontrarColuna = (placeholders: string[]): string => {
    if (placeholders.length === 0) return '';

    // Primeiro: match exato (normalizado)
    for (const ph of placeholders) {
      const phNorm = normalizarChave(ph);
      for (const cn of colunasNorm) {
        if (cn.norm === phNorm) return cn.original;
      }
    }

    // Segundo: match parcial (contém)
    for (const ph of placeholders) {
      const phNorm = normalizarChave(ph);
      for (const cn of colunasNorm) {
        if (cn.norm.includes(phNorm) || phNorm.includes(cn.norm)) return cn.original;
      }
    }

    return '';
  };

  const eixoX = encontrarColuna(grafico.placeholderEixoX);
  const eixoY = encontrarColuna(grafico.placeholderEixoY);

  if (!eixoX) return null;

  // Para gráficos de contagem, eixoY é opcional
  if (grafico.isContagem) {
    return { eixoX, eixoY, resolvido: true };
  }

  // Para gráficos de barra/linha/area, precisa de eixoY
  if (!eixoY) return null;

  return { eixoX, eixoY, resolvido: true };
}

/**
 * Gera a configuração de gráficos padrão para um serviço,
 * resolvendo placeholders com as colunas reais da planilha.
 * 
 * ⭐ Quando NÃO há colunas disponíveis, gera gráficos com placeholders
 * (marcados como `placeholderNaoResolvido: true`) para que sejam
 * re-resolvidos automaticamente quando a planilha for enviada.
 * 
 * @param tipoServico - Tipo de serviço (ex: "coleta_caminhao")
 * @param colunasNomes - Nomes das colunas da planilha para resolver placeholders
 * @param keysAtivas - Lista de keys de gráficos ativos na biblioteca (se undefined, considera todos)
 * 
 * Retorna todos os gráficos do tipo de serviço que estão ativos na biblioteca.
 */
export function gerarConfigGraficosPadrao(
  tipoServico: string,
  colunasNomes: string[],
  keysAtivas?: string[]
): any[] {
  let graficos = getGraficosPorTipo(tipoServico);

  // ⭐ Filtrar apenas gráficos ativos na biblioteca, se informado
  if (keysAtivas && keysAtivas.length > 0) {
    graficos = graficos.filter(g => keysAtivas.includes(g.key));
  }

  const configs: any[] = [];
  const semColunas = !colunasNomes || colunasNomes.length === 0;

  for (const g of graficos) {
    const resolvido = resolverGrafico(g, colunasNomes);

    if (resolvido) {
      // Gráfico resolvido com colunas reais
      configs.push({
        id: `padrao_${g.key}_${Date.now()}`,
        tipo: g.tipo,
        titulo: g.titulo,
        eixoX: resolvido.eixoX,
        eixoY: resolvido.eixoY,
        key: g.key,
        ativo: true,
        automatico: true,
        padrao: true,
        placeholderNaoResolvido: false,
        placeholdersOriginais: {
          eixoX: g.placeholderEixoX,
          eixoY: g.placeholderEixoY,
        },
        categoria: g.categoria,
        descricao: g.descricao,
        ordem: g.ordem,
        cor: g.cor,
      });
    } else if (semColunas) {
      // ═══ FALLBACK: sem colunas → gerar com placeholders como nome das colunas ═══
      // Assim o usuário já vê os gráficos mesmo antes do upload
      configs.push({
        id: `padrao_${g.key}_${Date.now()}`,
        tipo: g.tipo,
        titulo: g.titulo,
        // Usa o primeiro placeholder como nome da coluna (será re-resolvido depois)
        eixoX: g.placeholderEixoX[0] || '',
        eixoY: g.placeholderEixoY[0] || '',
        key: g.key,
        ativo: true,
        automatico: true,
        padrao: true,
        placeholderNaoResolvido: true,
        placeholdersOriginais: {
          eixoX: g.placeholderEixoX,
          eixoY: g.placeholderEixoY,
        },
        categoria: g.categoria,
        descricao: g.descricao,
        ordem: g.ordem,
        cor: g.cor,
      });
    }
    // Se tem colunas mas não resolveu este gráfico específico, pula
  }

  // Ordenar por ordem
  configs.sort((a, b) => a.ordem - b.ordem);

  return configs;
}

/**
 * Re-resolve os placeholders de gráficos existentes com base nas colunas reais.
 * 
 * ⭐ Chamado automaticamente após upload de planilha ou manualmente via endpoint.
 * 
 * @param graficosAtuais - Lista de gráficos atuais (pode conter placeholders)
 * @param colunasNomes - Colunas reais disponíveis na planilha
 * @returns Lista de gráficos com placeholders re-resolvidos (se possível)
 */
export function reResolverGraficos(
  graficosAtuais: any[],
  colunasNomes: string[]
): any[] {
  if (!graficosAtuais || graficosAtuais.length === 0) return [];
  if (!colunasNomes || colunasNomes.length === 0) return graficosAtuais;

  return graficosAtuais.map(grafico => {
    // Só tenta re-resolver gráficos marcados como placeholder ou que têm placeholdersOriginais
    if (!grafico.placeholderNaoResolvido && !grafico.placeholdersOriginais) {
      return grafico; // já resolvido ou manual, mantém
    }

    const ph = grafico.placeholdersOriginais;
    if (!ph || !ph.eixoX || ph.eixoX.length === 0) {
      // Marca como resolvido (não tem placeholders para resolver)
      return { ...grafico, placeholderNaoResolvido: false };
    }

    // Criar um GraficoPadrao fake para usar o resolver existente
    const graficoPadrao: GraficoPadrao = {
      key: grafico.key || '',
      tipo: grafico.tipo || 'barra',
      titulo: grafico.titulo || '',
      placeholderEixoX: ph.eixoX,
      placeholderEixoY: ph.eixoY || [],
      descricao: grafico.descricao || '',
      ordem: grafico.ordem || 99,
      categoria: grafico.categoria || '',
      isContagem: !ph.eixoY || ph.eixoY.length === 0,
      cor: grafico.cor || '#6366f1',
    };

    const resolvido = resolverGrafico(graficoPadrao, colunasNomes);

    if (resolvido) {
      return {
        ...grafico,
        eixoX: resolvido.eixoX,
        eixoY: resolvido.eixoY,
        placeholderNaoResolvido: false,
        reResolvidoEm: new Date().toISOString(),
        reResolvido: true,
      };
    }

    // Não conseguiu re-resolver — mantém como está (com placeholder)
    return grafico;
  });
}
