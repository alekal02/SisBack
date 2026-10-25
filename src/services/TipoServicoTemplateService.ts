import {
  getKpisTemplateColeta,
  getGraficosTemplateColeta,
} from '../config/dashboardPadraoColeta';

/* ============================================
   TipoServicoTemplateService — Catálogo Central
   ═══════════════════════════════════════════
   Catálogo único de KPIs, colunas esperadas,
   modelos de planilha e cores por tipo de serviço.
   
   Organizado em categorias visuais para o seletor.
   ============================================ */

export interface ColunaEsperada {
  nome: string;
  tipo: 'texto' | 'numero' | 'data' | 'hora';
  obrigatorio: boolean;
  descricao: string;
  exemplos?: string[];
}

export interface KpiTemplate {
  nome: string;
  label: string;
  expressao: string;
  formato: 'numero' | 'moeda' | 'porcentagem';
  descricao: string;
  unidade: string;
  cor: string;
  categoria: string; // 'financeiro' | 'operacional' | 'analise'
  colunasUsadas: string[];
  grafico?: {
    tipo: 'barra' | 'linha' | 'pizza';
    titulo: string;
    eixoX: string;
    eixoY: string;
  };
}

export interface GraficoTemplate {
  tipo: 'barra' | 'linha' | 'pizza';
  titulo: string;
  eixoX: string;
  eixoY: string;
  descricao: string;
}

export interface TipoServicoTemplate {
  id: string;
  label: string;
  categoria: string;
  categoriaLabel: string;
  cor: string;
  icone: string;
  descricao: string;
  colunas: ColunaEsperada[];
  kpis: KpiTemplate[];
  graficos: GraficoTemplate[];
}

export interface CategoriaTipo {
  id: string;
  label: string;
  cor: string;
  tipos: { id: string; label: string; cor: string; icone: string }[];
}

/* ═══════════════════════════════════════
   CATEGORIAS — Organização Visual
   ═══════════════════════════════════════ */
export const CATEGORIAS: CategoriaTipo[] = [
  {
    id: 'coleta',
    label: '🧺 Coleta',
    cor: '#6366f1',
    tipos: [
      { id: 'coleta_caminhao', label: 'Coleta com Caminhão', cor: '#6366f1', icone: '🚛' },
    ],
  },
  {
    id: 'limpeza_urbana',
    label: '🧹 Limpeza Urbana',
    cor: '#22c55e',
    tipos: [
      { id: 'rocadeira', label: 'Roçada', cor: '#22c55e', icone: '🌿' },
      { id: 'capina', label: 'Capina', cor: '#84cc16', icone: '🌱' },
      { id: 'varricao', label: 'Varrição', cor: '#06b6d4', icone: '🧹' },
    ],
  },
  {
    id: 'poda',
    label: '✂️ Poda',
    cor: '#8b5cf6',
    tipos: [
      { id: 'poda', label: 'Poda', cor: '#8b5cf6', icone: '✂️' },
    ],
  },
  {
    id: 'infraestrutura',
    label: '🏗️ Infraestrutura',
    cor: '#f59e0b',
    tipos: [
      { id: 'pintura_meio_fio', label: 'Pintura', cor: '#f59e0b', icone: '🎨' },
    ],
  },
  {
    id: 'remocao',
    label: '🚛 Remoção',
    cor: '#ef4444',
    tipos: [
      { id: 'remocao', label: 'Remoção', cor: '#ef4444', icone: '🚛' },
    ],
  },
  {
    id: 'geral',
    label: '📋 Geral',
    cor: '#94a3b8',
    tipos: [
      { id: 'geral', label: 'Geral', cor: '#94a3b8', icone: '📋' },
    ],
  },
];

/* ═══════════════════════════════════════
   TEMPLATES POR TIPO
   ═══════════════════════════════════════ */

const TEMPLATES: Record<string, TipoServicoTemplate> = {
  /* ─── COLETA COM CAMINHÃO ─── */
  coleta_caminhao: {
    id: 'coleta_caminhao',
    label: 'Coleta com Caminhão',
    categoria: 'coleta',
    categoriaLabel: '🧺 Coleta',
    cor: '#6366f1',
    icone: '🚛',
    descricao: 'Coleta de residuos com roteiro de caminhao, motorista, peso, km e horarios. Otimizado para planilha com multiplas rotas (01 a 04), turno, regional e coletores.',
    colunas: [
      { nome: 'DATA SAIDA', tipo: 'data', obrigatorio: false, descricao: 'Data da coleta', exemplos: ['46107', '01/01/2026'] },
      { nome: 'TURNO', tipo: 'texto', obrigatorio: false, descricao: 'Turno do servico', exemplos: ['DIURNO', 'NOTURNO'] },
      { nome: 'REGIONAL', tipo: 'texto', obrigatorio: false, descricao: 'Regional de atendimento', exemplos: ['LESTE', 'NORTE', 'SUL', 'OESTE'] },
      { nome: 'DISTRITO', tipo: 'texto', obrigatorio: false, descricao: 'Distrito da coleta', exemplos: ['MC1B-L', 'MC2B-L'] },
      { nome: 'PLACA', tipo: 'texto', obrigatorio: true, descricao: 'Placa ou identificacao do veiculo coletor', exemplos: ['RJB2A13', 'RKL2D37'] },
      { nome: 'MOTORISTA', tipo: 'texto', obrigatorio: false, descricao: 'Nome do motorista/operador', exemplos: ['LINDOMAR PINTO DE ARAUJO'] },
      { nome: 'COLETOR 01', tipo: 'texto', obrigatorio: false, descricao: 'Nome do coletor 1', exemplos: ['ANDERSON'] },
      { nome: 'COLETOR 02', tipo: 'texto', obrigatorio: false, descricao: 'Nome do coletor 2', exemplos: ['FLAVIO'] },
      { nome: 'COLETOR 03', tipo: 'texto', obrigatorio: false, descricao: 'Nome do coletor 3', exemplos: ['PEDRO'] },
      { nome: 'COLETOR 04', tipo: 'texto', obrigatorio: false, descricao: 'Nome do coletor 4', exemplos: ['KATARINA'] },
      { nome: 'N║ DE COLETORES', tipo: 'numero', obrigatorio: false, descricao: 'Numero total de coletores na equipe', exemplos: ['3', '4'] },
      { nome: 'KM SAIDA BASE', tipo: 'numero', obrigatorio: false, descricao: 'Odometro na saida da base', exemplos: ['111334'] },
      { nome: 'HORA SAIDA BASE', tipo: 'hora', obrigatorio: false, descricao: 'Horario de saida da base (decimal Excel)', exemplos: ['0.33', '0.49'] },
      { nome: 'HORA CHEGADA BASE', tipo: 'hora', obrigatorio: false, descricao: 'Horario de chegada na base (decimal Excel)', exemplos: ['0.58', '0.68'] },
      { nome: 'KM CHEGADA BASE', tipo: 'numero', obrigatorio: false, descricao: 'Odometro na chegada a base', exemplos: ['111390', '94319'] },
      { nome: 'PESO 1', tipo: 'numero', obrigatorio: false, descricao: 'Peso coletado na rota 1 (kg)', exemplos: ['4010'] },
      { nome: 'PESO 2', tipo: 'numero', obrigatorio: false, descricao: 'Peso coletado na rota 2 (kg)', exemplos: [''] },
      { nome: 'PESO 3', tipo: 'numero', obrigatorio: false, descricao: 'Peso coletado na rota 3 (kg)', exemplos: [''] },
      { nome: 'PESO 4', tipo: 'numero', obrigatorio: false, descricao: 'Peso coletado na rota 4 (kg)', exemplos: [''] },
      { nome: 'PESO TOTAL', tipo: 'numero', obrigatorio: true, descricao: 'Peso total coletado em kg (soma de PESO 1~4)', exemplos: ['4010', '3630'] },
      { nome: 'TIPO DE CAMINHAO', tipo: 'texto', obrigatorio: false, descricao: 'Tipo do caminhao (TRUCK, TOCO, MINI)', exemplos: ['MINI', 'TRUCK'] },
      { nome: 'KM TOTAL', tipo: 'numero', obrigatorio: true, descricao: 'Quilometragem total rodada', exemplos: ['56', '41'] },
      { nome: 'CONTADOR DE VIAGENS', tipo: 'numero', obrigatorio: false, descricao: 'Numero de viagens/rotas realizadas', exemplos: ['1', '2'] },
      { nome: 'DIA DA SEMANA', tipo: 'numero', obrigatorio: false, descricao: 'Dia da semana (1=domingo a 7=sabado)', exemplos: ['5'] },
    ],
    kpis: [
      // ─── OPERACIONAIS BASICOS ───
      {
        nome: 'Viagens',
        label: 'Viagens Realizadas',
        expressao: 'VIAGENS_VALIDADAS()',
        formato: 'numero',
        descricao: 'Total de viagens validadas no dashboard (linhas com KM, peso e rota completos)',
        unidade: 'viagens',
        cor: '#14b8a6',
        categoria: 'operacional',
        colunasUsadas: [],
      },
      {
        nome: 'Tonelagem Total',
        label: 'Tonelagem Total',
        expressao: 'SUM(PESO TOTAL) / 1000',
        formato: 'numero',
        descricao: 'Peso total transportado em toneladas',
        unidade: 't',
        cor: '#6366f1',
        categoria: 'operacional',
        colunasUsadas: ['PESO TOTAL'],
      },
      {
        nome: 'KM Rodados',
        label: 'KM Rodados',
        expressao: 'SUM(KM TOTAL)',
        formato: 'numero',
        descricao: 'Quilometragem total rodada no periodo',
        unidade: 'km',
        cor: '#06b6d4',
        categoria: 'operacional',
        colunasUsadas: ['KM TOTAL'],
      },
      {
        nome: 'Peso Total KG',
        label: 'Peso Total (kg)',
        expressao: 'SUM(PESO TOTAL)',
        formato: 'numero',
        descricao: 'Peso total coletado em quilogramas',
        unidade: 'kg',
        cor: '#818cf8',
        categoria: 'operacional',
        colunasUsadas: ['PESO TOTAL'],
      },
      // ─── FROTA ───
      {
        nome: 'Qtd Coletores',
        label: 'Coletores Ativos',
        expressao: 'COUNT DISTINCT(PLACA)',
        formato: 'numero',
        descricao: 'Quantidade de veiculos/coletores em operacao',
        unidade: 'coletores',
        cor: '#a855f7',
        categoria: 'operacional',
        colunasUsadas: ['PLACA'],
      },
      {
        nome: 'Motoristas Ativos',
        label: 'Motoristas Ativos',
        expressao: 'COUNT DISTINCT(MOTORISTA)',
        formato: 'numero',
        descricao: 'Quantidade de motoristas diferentes em operacao',
        unidade: 'motoristas',
        cor: '#d946ef',
        categoria: 'operacional',
        colunasUsadas: ['MOTORISTA'],
      },
      {
        nome: 'Total Coletores Equipe',
        label: 'Total Coletores na Equipe',
        expressao: 'COLETORES_UNICOS()',
        formato: 'numero',
        descricao: 'Coletores únicos (COLETOR 01–04): mesma pessoa em várias viagens conta apenas uma vez',
        unidade: 'coletores',
        cor: '#c084fc',
        categoria: 'operacional',
        colunasUsadas: ['COLETOR 01', 'COLETOR 02', 'COLETOR 03', 'COLETOR 04', 'Nº DE COLETORES'],
      },
      // ─── COBERTURA ───
      {
        nome: 'Regionais',
        label: 'Regionais Atendidas',
        expressao: 'COUNT DISTINCT(REGIONAL)',
        formato: 'numero',
        descricao: 'Quantidade de regionais atendidas',
        unidade: 'regionais',
        cor: '#f43f5e',
        categoria: 'analise',
        colunasUsadas: ['REGIONAL'],
      },
      {
        nome: 'Distritos',
        label: 'Distritos Atendidos',
        expressao: 'COUNT DISTINCT(DISTRITO)',
        formato: 'numero',
        descricao: 'Quantidade de distritos atendidos',
        unidade: 'distritos',
        cor: '#e11d48',
        categoria: 'analise',
        colunasUsadas: ['DISTRITO'],
      },
      // ─── MEDIAS E EFICIENCIA ───
      {
        nome: 'Media Peso Viagem',
        label: 'Peso Medio por Viagem (kg)',
        expressao: 'DIVIDE(SUM(PESO TOTAL), VIAGENS_POR_ROTA())',
        formato: 'numero',
        descricao: 'Peso medio coletado por viagem em kg',
        unidade: 'kg/viagem',
        cor: '#fb923c',
        categoria: 'operacional',
        colunasUsadas: ['PESO TOTAL'],
      },
      {
        nome: 'Media Ton Viagem',
        label: 'Tonelagem Media por Viagem',
        expressao: 'DIVIDE(SUM(PESO TOTAL) / 1000, VIAGENS_POR_ROTA())',
        formato: 'numero',
        descricao: 'Media de toneladas transportadas por viagem',
        unidade: 't/viagem',
        cor: '#f59e0b',
        categoria: 'operacional',
        colunasUsadas: ['PESO TOTAL'],
      },
      {
        nome: 'Media Km Viagem',
        label: 'KM Medio por Viagem',
        expressao: 'DIVIDE(SUM(KM TOTAL), VIAGENS_POR_ROTA())',
        formato: 'numero',
        descricao: 'Quilometragem media rodada por viagem',
        unidade: 'km/viagem',
        cor: '#84cc16',
        categoria: 'operacional',
        colunasUsadas: ['KM TOTAL'],
      },
      {
        nome: 'Ton/Km',
        label: 'Eficiencia (Ton/Km)',
        expressao: 'DIVIDE(SUM(PESO TOTAL) / 1000, SUM(KM TOTAL))',
        formato: 'numero',
        descricao: 'Toneladas transportadas por quilometro rodado',
        unidade: 't/km',
        cor: '#22c55e',
        categoria: 'operacional',
        colunasUsadas: ['PESO TOTAL', 'KM TOTAL'],
      },
      {
        nome: 'KM/Ton',
        label: 'KM por Tonelada',
        expressao: 'DIVIDE(SUM(KM TOTAL), SUM(PESO TOTAL) / 1000)',
        formato: 'numero',
        descricao: 'Quilometragem total dividida pela tonelagem total (KM TOTAL ÷ ton)',
        unidade: 'km/t',
        cor: '#0ea5e9',
        categoria: 'operacional',
        colunasUsadas: ['KM TOTAL', 'PESO TOTAL'],
      },
      {
        nome: 'Prod Coletor',
        label: 'Média Ton/Coletor por Viagem',
        expressao: 'MEDIA_TON_POR_COLETOR()',
        formato: 'numero',
        descricao: 'Média de toneladas por coletor em cada viagem (PESO TOTAL ÷ Nº DE COLETORES da planilha)',
        unidade: 't/coletor/viagem',
        cor: '#34d399',
        categoria: 'operacional',
        colunasUsadas: ['PESO TOTAL', 'N║ DE COLETORES'],
      },
      // ─── FINANCEIRO ───
      {
        nome: 'Faturamento',
        label: 'Faturamento Estimado',
        expressao: 'FATURAMENTO_EST(PESO TOTAL, TIPO DE CAMINHAO)',
        formato: 'moeda',
        descricao: 'Faturamento estimado baseado em peso x valor por tipo de caminhao',
        unidade: 'R$',
        cor: '#059669',
        categoria: 'financeiro',
        colunasUsadas: ['PESO TOTAL', 'TIPO DE CAMINHAO'],
      },
      {
        nome: 'Receita/Km',
        label: 'Receita por Km',
        expressao: 'DIVIDE(FATURAMENTO_EST(PESO TOTAL, TIPO DE CAMINHAO), SUM(KM TOTAL))',
        formato: 'moeda',
        descricao: 'Faturamento dividido pelos km rodados',
        unidade: 'R$/km',
        cor: '#ec4899',
        categoria: 'financeiro',
        colunasUsadas: ['PESO TOTAL', 'TIPO DE CAMINHAO', 'KM TOTAL'],
      },
      {
        nome: 'Receita/Hora',
        label: 'Receita por Hora',
        expressao: 'DIVIDE(FATURAMENTO_EST(PESO TOTAL, TIPO DE CAMINHAO), HORAS_PRODUTIVAS(HORA SAIDA BASE, HORA CHEGADA BASE))',
        formato: 'moeda',
        descricao: 'Faturamento dividido pelas horas produtivas (HORA CHEGADA BASE - HORA SAIDA BASE por registro, com correcao de virada de dia)',
        unidade: 'R$/h',
        cor: '#f472b6',
        categoria: 'financeiro',
        colunasUsadas: ['PESO TOTAL', 'TIPO DE CAMINHAO', 'HORA SAIDA BASE', 'HORA CHEGADA BASE'],
      },
      // ─── TEMPO ───
      {
        nome: 'Horas Produtivas',
        label: 'Horas Produtivas',
        expressao: 'HORAS_PRODUTIVAS(HORA SAIDA BASE, HORA CHEGADA BASE)',
        formato: 'numero',
        descricao: 'Total de horas em operacao - soma de (HORA CHEGADA BASE - HORA SAIDA BASE) por registro, com correcao de virada de dia',
        unidade: 'h',
        cor: '#f97316',
        categoria: 'operacional',
        colunasUsadas: ['HORA SAIDA BASE', 'HORA CHEGADA BASE'],
      },
      {
        nome: 'Media Horas Viagem',
        label: 'Media de Horas por Viagem',
        expressao: 'DIVIDE(HORAS_PRODUTIVAS(HORA SAIDA BASE, HORA CHEGADA BASE), VIAGENS_POR_ROTA())',
        formato: 'numero',
        descricao: 'Media de horas em operacao por viagem',
        unidade: 'h/viagem',
        cor: '#fdba74',
        categoria: 'operacional',
        colunasUsadas: ['HORA SAIDA BASE', 'HORA CHEGADA BASE'],
      },
      // ─── ROTAS ───
      {
        nome: 'Total Viagens Contador',
        label: 'Total de Viagens (Contador)',
        expressao: 'VIAGENS_POR_ROTA()',
        formato: 'numero',
        descricao: 'Total de viagens: soma do CONTADOR DE VIAGENS (rotas feitas)',
        unidade: 'viagens',
        cor: '#2dd4bf',
        categoria: 'operacional',
        colunasUsadas: ['CONTADOR DE VIAGENS'],
      },
    ],
    graficos: [
      {
        tipo: 'barra',
        titulo: 'Tonelagem por Coletor (PLACA)',
        eixoX: 'PLACA',
        eixoY: 'PESO TOTAL',
        descricao: 'Distribuicao de tonelagem entre os coletores',
      },
      {
        tipo: 'pizza',
        titulo: 'Distribuicao por Tipo de Caminhao',
        eixoX: 'TIPO DE CAMINHAO',
        eixoY: '',
        descricao: 'Proporcao de viagens por tipo de caminhao',
      },
      {
        tipo: 'barra',
        titulo: 'KM Rodados por Coletor',
        eixoX: 'PLACA',
        eixoY: 'KM TOTAL',
        descricao: 'Quilometragem rodada por coletor',
      },
      {
        tipo: 'pizza',
        titulo: 'Viagens por Regional',
        eixoX: 'REGIONAL',
        eixoY: '',
        descricao: 'Distribuicao das viagens por regional',
      },
      {
        tipo: 'pizza',
        titulo: 'Viagens por Turno',
        eixoX: 'TURNO',
        eixoY: '',
        descricao: 'Distribuicao por turno (diurno/noturno)',
      },
      {
        tipo: 'barra',
        titulo: 'Peso Total por Distrito',
        eixoX: 'DISTRITO',
        eixoY: 'PESO TOTAL',
        descricao: 'Peso coletado por distrito',
      },
      {
        tipo: 'barra',
        titulo: 'Tonelagem por Motorista',
        eixoX: 'MOTORISTA',
        eixoY: 'PESO TOTAL',
        descricao: 'Produtividade por motorista',
      },
    ],
  },

  /* ─── ROCADA ─── */
  rocadeira: {
    id: 'rocadeira',
    label: 'Rocada',
    categoria: 'limpeza_urbana',
    categoriaLabel: '🧹 Limpeza Urbana',
    cor: '#22c55e',
    icone: '🌿',
    descricao: 'Servico de rocagem manual ou mecanizada. Acompanhamento de area rocada (m2) por operador, equipe e equipamento.',
    colunas: [
      { nome: 'DATA', tipo: 'data', obrigatorio: false, descricao: 'Data do servico', exemplos: ['01/05/2026'] },
      { nome: 'BAIRRO', tipo: 'texto', obrigatorio: true, descricao: 'Bairro ou localidade', exemplos: ['Ceu azul', 'Esplanada V'] },
      { nome: 'Equipamento', tipo: 'texto', obrigatorio: true, descricao: 'Equipamento utilizado', exemplos: ['Trator', 'Rocadeira', 'Giro-Zero'] },
      { nome: 'Operador', tipo: 'texto', obrigatorio: true, descricao: 'Nome do operador do equipamento', exemplos: ['Joao', 'Leonardo', 'Davi'] },
      { nome: 'Equipe', tipo: 'texto', obrigatorio: true, descricao: 'Nome da equipe', exemplos: ['Equipe 1', 'Equipe 2'] },
      { nome: 'Area m²', tipo: 'numero', obrigatorio: true, descricao: 'Area rocada em metros quadrados', exemplos: ['856.45', '746.99'] },
    ],
    kpis: [
      {
        nome: 'Total M2 Rocados',
        label: 'Total Area Rocada',
        expressao: 'SUM(Area m²)',
        formato: 'numero',
        descricao: 'Total de metros quadrados rocados no periodo',
        unidade: 'm2',
        cor: '#22c55e',
        categoria: 'operacional',
        colunasUsadas: ['Area m²'],
      },
      {
        nome: 'M2 por Equipe',
        label: 'M2 por Equipe',
        expressao: 'DIVIDE(SUM(Area m²), COUNT DISTINCT(Equipe))',
        formato: 'numero',
        descricao: 'Media de m2 rocados por equipe',
        unidade: 'm2/equipe',
        cor: '#16a34a',
        categoria: 'operacional',
        colunasUsadas: ['Area m²', 'Equipe'],
      },
      {
        nome: 'M2 por Operador',
        label: 'M2 por Operador',
        expressao: 'DIVIDE(SUM(Area m²), COUNT DISTINCT(Operador))',
        formato: 'numero',
        descricao: 'Media de m2 rocados por operador',
        unidade: 'm2/operador',
        cor: '#15803d',
        categoria: 'operacional',
        colunasUsadas: ['Area m²', 'Operador'],
      },
      {
        nome: 'Equipes Ativas',
        label: 'Equipes Ativas',
        expressao: 'COUNT DISTINCT(Equipe)',
        formato: 'numero',
        descricao: 'Quantidade de equipes em operacao',
        unidade: 'equipes',
        cor: '#4ade80',
        categoria: 'operacional',
        colunasUsadas: ['Equipe'],
      },
      {
        nome: 'Operadores Ativos',
        label: 'Operadores Ativos',
        expressao: 'COUNT DISTINCT(Operador)',
        formato: 'numero',
        descricao: 'Quantidade de operadores que realizaram rocagem',
        unidade: 'operadores',
        cor: '#86efac',
        categoria: 'operacional',
        colunasUsadas: ['Operador'],
      },
      {
        nome: 'Bairros Atendidos',
        label: 'Bairros Atendidos',
        expressao: 'COUNT DISTINCT(BAIRRO)',
        formato: 'numero',
        descricao: 'Quantidade de bairros que receberam rocagem',
        unidade: 'bairros',
        cor: '#bbf7d0',
        categoria: 'analise',
        colunasUsadas: ['BAIRRO'],
      },
      // ─── FINANCEIRO ───
      {
        nome: 'Faturamento',
        label: 'Faturamento Estimado',
        expressao: 'SUM(Area m²) * VALOR_M2',
        formato: 'moeda',
        descricao: 'Faturamento estimado baseado em m² rocados x valor por m²',
        unidade: 'R$',
        cor: '#059669',
        categoria: 'financeiro',
        colunasUsadas: ['Area m²'],
      },
      {
        nome: 'Receita por Equipe',
        label: 'Receita por Equipe',
        expressao: 'DIVIDE(SUM(Area m²) * VALOR_M2, COUNT DISTINCT(Equipe))',
        formato: 'moeda',
        descricao: 'Faturamento dividido pelo numero de equipes',
        unidade: 'R$/equipe',
        cor: '#34d399',
        categoria: 'financeiro',
        colunasUsadas: ['Area m²', 'Equipe'],
      },
    ],
    graficos: [
      {
        tipo: 'barra',
        titulo: 'M2 por Equipe',
        eixoX: 'Equipe',
        eixoY: 'Area m²',
        descricao: 'Produtividade por equipe de rocagem',
      },
      {
        tipo: 'barra',
        titulo: 'M2 por Bairro',
        eixoX: 'BAIRRO',
        eixoY: 'Area m²',
        descricao: 'Distribuicao do servico por bairro',
      },
      {
        tipo: 'barra',
        titulo: 'M2 por Equipamento',
        eixoX: 'Equipamento',
        eixoY: 'Area m²',
        descricao: 'Desempenho por tipo de equipamento',
      },
    ],
  },

  /* ─── PODA ─── */
  poda: {
    id: 'poda',
    label: 'Poda',
    categoria: 'poda',
    categoriaLabel: '✂️ Poda',
    cor: '#8b5cf6',
    icone: '✂️',
    descricao: 'Poda e extirpacao de arvores em vias publicas. Acompanhamento por setor, rua, tipo de servico e equipe.',
    colunas: [
      { nome: 'Dia', tipo: 'data', obrigatorio: false, descricao: 'Data do servico', exemplos: ['27/04/2026'] },
      { nome: 'Setor', tipo: 'texto', obrigatorio: true, descricao: 'Setor ou bairro do servico', exemplos: ['Independencia Mansoes', 'Parque Veiga Jardim'] },
      { nome: 'Avenida / Rua', tipo: 'texto', obrigatorio: false, descricao: 'Logradouro onde foi realizada a poda', exemplos: ['Rua 56', 'Rua Osvaldo Monclar'] },
      { nome: 'Tipo de serviço', tipo: 'texto', obrigatorio: true, descricao: 'Tipo de servico (Poda, Extirpacao, etc.)', exemplos: ['Poda', 'Extirpacao'] },
      { nome: 'Equipe', tipo: 'texto', obrigatorio: true, descricao: 'Nome da equipe responsavel', exemplos: ['Equipe 1', 'Equipe 2'] },
      { nome: 'Quantidade de Arvore', tipo: 'numero', obrigatorio: true, descricao: 'Quantidade de arvores atendidas', exemplos: ['20'] },
    ],
    kpis: [
      {
        nome: 'Total Arvores',
        label: 'Total Arvores Atendidas',
        expressao: 'SUM(Quantidade de Arvore)',
        formato: 'numero',
        descricao: 'Total de arvores podadas/extirpadas no periodo',
        unidade: 'arvores',
        cor: '#8b5cf6',
        categoria: 'operacional',
        colunasUsadas: ['Quantidade de Arvore'],
      },
      {
        nome: 'Arvores por Equipe',
        label: 'Arvores por Equipe',
        expressao: 'DIVIDE(SUM(Quantidade de Arvore), COUNT DISTINCT(Equipe))',
        formato: 'numero',
        descricao: 'Media de arvores atendidas por equipe',
        unidade: 'arv/equipe',
        cor: '#a78bfa',
        categoria: 'operacional',
        colunasUsadas: ['Quantidade de Arvore', 'Equipe'],
      },
      {
        nome: 'Arvores por Setor',
        label: 'Arvores por Setor',
        expressao: 'DIVIDE(SUM(Quantidade de Arvore), COUNT DISTINCT(Setor))',
        formato: 'numero',
        descricao: 'Media de arvores atendidas por setor',
        unidade: 'arv/setor',
        cor: '#c4b5fd',
        categoria: 'operacional',
        colunasUsadas: ['Quantidade de Arvore', 'Setor'],
      },
      {
        nome: 'Arvores por Tipo',
        label: 'Arvores por Tipo de Servico',
        expressao: 'DIVIDE(SUM(Quantidade de Arvore), COUNT DISTINCT(Tipo de serviço))',
        formato: 'numero',
        descricao: 'Media de arvores por tipo de servico (poda vs extirpacao)',
        unidade: 'arv/tipo',
        cor: '#ddd6fe',
        categoria: 'analise',
        colunasUsadas: ['Quantidade de Arvore', 'Tipo de serviço'],
      },
      {
        nome: 'Equipes Ativas',
        label: 'Equipes Ativas',
        expressao: 'COUNT DISTINCT(Equipe)',
        formato: 'numero',
        descricao: 'Quantidade de equipes em operacao',
        unidade: 'equipes',
        cor: '#ede9fe',
        categoria: 'operacional',
        colunasUsadas: ['Equipe'],
      },
      {
        nome: 'Setores Atendidos',
        label: 'Setores Atendidos',
        expressao: 'COUNT DISTINCT(Setor)',
        formato: 'numero',
        descricao: 'Quantidade de setores que receberam poda',
        unidade: 'setores',
        cor: '#f5f3ff',
        categoria: 'analise',
        colunasUsadas: ['Setor'],
      },
      // ─── FINANCEIRO ───
      {
        nome: 'Faturamento',
        label: 'Faturamento Estimado',
        expressao: 'SUM(Quantidade de Arvore) * VALOR_POR_ARVORE',
        formato: 'moeda',
        descricao: 'Faturamento estimado baseado em arvores atendidas x valor por arvore',
        unidade: 'R$',
        cor: '#059669',
        categoria: 'financeiro',
        colunasUsadas: ['Quantidade de Arvore'],
      },
      {
        nome: 'Receita por Equipe',
        label: 'Receita por Equipe',
        expressao: 'DIVIDE(SUM(Quantidade de Arvore) * VALOR_POR_ARVORE, COUNT DISTINCT(Equipe))',
        formato: 'moeda',
        descricao: 'Faturamento dividido pelo numero de equipes',
        unidade: 'R$/equipe',
        cor: '#34d399',
        categoria: 'financeiro',
        colunasUsadas: ['Quantidade de Arvore', 'Equipe'],
      },
    ],
    graficos: [
      {
        tipo: 'barra',
        titulo: 'Arvores por Equipe',
        eixoX: 'Equipe',
        eixoY: 'Quantidade de Arvore',
        descricao: 'Produtividade por equipe de poda',
      },
      {
        tipo: 'barra',
        titulo: 'Arvores por Setor',
        eixoX: 'Setor',
        eixoY: 'Quantidade de Arvore',
        descricao: 'Distribuicao do servico por setor',
      },
      {
        tipo: 'pizza',
        titulo: 'Por Tipo de Servico',
        eixoX: 'Tipo de serviço',
        eixoY: '',
        descricao: 'Proporcao entre poda e extirpacao',
      },
    ],
  },

  /* ─── CAPINA ─── */
  capina: {
    id: 'capina',
    label: 'Capina',
    categoria: 'limpeza_urbana',
    categoriaLabel: '🧹 Limpeza Urbana',
    cor: '#84cc16',
    icone: '🌱',
    descricao: 'Capina manual ou mecanizada em vias publicas, calcadas e espacos urbanos. Acompanhamento por metro linear executado, equipe e bairro.',
    colunas: [
      { nome: 'DATA', tipo: 'data', obrigatorio: false, descricao: 'Data do servico', exemplos: ['01/05/2026'] },
      { nome: 'BAIRRO', tipo: 'texto', obrigatorio: true, descricao: 'Bairro ou localidade do servico', exemplos: ['Centro', 'Jardim America'] },
      { nome: 'Equipe', tipo: 'texto', obrigatorio: true, descricao: 'Nome da equipe de capina', exemplos: ['Equipe 1', 'Equipe 2'] },
      { nome: 'Funcionario', tipo: 'texto', obrigatorio: false, descricao: 'Nome do funcionario/operador', exemplos: ['Carlos', 'Maria'] },
      { nome: 'Metro Linear', tipo: 'numero', obrigatorio: true, descricao: 'Metros lineares capinados', exemplos: ['856.45', '746.99'] },
    ],
    kpis: [
      {
        nome: 'Total Metro Linear',
        label: 'Total Capinado (m linear)',
        expressao: 'SUM(Metro Linear)',
        formato: 'numero',
        descricao: 'Total de metros lineares capinados no periodo',
        unidade: 'm linear',
        cor: '#84cc16',
        categoria: 'operacional',
        colunasUsadas: ['Metro Linear'],
      },
      {
        nome: 'ML por Equipe',
        label: 'Metro Linear por Equipe',
        expressao: 'DIVIDE(SUM(Metro Linear), COUNT DISTINCT(Equipe))',
        formato: 'numero',
        descricao: 'Media de metros lineares capinados por equipe',
        unidade: 'm/equipe',
        cor: '#65a30d',
        categoria: 'operacional',
        colunasUsadas: ['Metro Linear', 'Equipe'],
      },
      {
        nome: 'ML por Funcionario',
        label: 'Metro Linear por Funcionario',
        expressao: 'DIVIDE(SUM(Metro Linear), COUNT DISTINCT(Funcionario))',
        formato: 'numero',
        descricao: 'Media de metros lineares capinados por funcionario',
        unidade: 'm/func',
        cor: '#4d7c0f',
        categoria: 'operacional',
        colunasUsadas: ['Metro Linear', 'Funcionario'],
      },
      {
        nome: 'Equipes Ativas',
        label: 'Equipes Ativas',
        expressao: 'COUNT DISTINCT(Equipe)',
        formato: 'numero',
        descricao: 'Quantidade de equipes em operacao',
        unidade: 'equipes',
        cor: '#a3e635',
        categoria: 'operacional',
        colunasUsadas: ['Equipe'],
      },
      {
        nome: 'Bairros Atendidos',
        label: 'Bairros Atendidos',
        expressao: 'COUNT DISTINCT(BAIRRO)',
        formato: 'numero',
        descricao: 'Quantidade de bairros que receberam capina',
        unidade: 'bairros',
        cor: '#d9f99d',
        categoria: 'analise',
        colunasUsadas: ['BAIRRO'],
      },
      {
        nome: 'Total Registros',
        label: 'Total de Registros',
        expressao: 'COUNT(*)',
        formato: 'numero',
        descricao: 'Numero total de registros lancados',
        unidade: 'registros',
        cor: '#bef264',
        categoria: 'operacional',
        colunasUsadas: [],
      },
      // ─── FINANCEIRO ───
      {
        nome: 'Faturamento',
        label: 'Faturamento Estimado',
        expressao: 'SUM(Metro Linear) * VALOR_KM_LINEAR',
        formato: 'moeda',
        descricao: 'Faturamento estimado baseado em metros lineares capinados x valor por metro',
        unidade: 'R$',
        cor: '#059669',
        categoria: 'financeiro',
        colunasUsadas: ['Metro Linear'],
      },
      {
        nome: 'Receita por Equipe',
        label: 'Receita por Equipe',
        expressao: 'DIVIDE(SUM(Metro Linear) * VALOR_KM_LINEAR, COUNT DISTINCT(Equipe))',
        formato: 'moeda',
        descricao: 'Faturamento dividido pelo numero de equipes',
        unidade: 'R$/equipe',
        cor: '#34d399',
        categoria: 'financeiro',
        colunasUsadas: ['Metro Linear', 'Equipe'],
      },
    ],
    graficos: [
      {
        tipo: 'barra',
        titulo: 'Metro Linear por Equipe',
        eixoX: 'Equipe',
        eixoY: 'Metro Linear',
        descricao: 'Produtividade por equipe de capina',
      },
      {
        tipo: 'barra',
        titulo: 'Metro Linear por Bairro',
        eixoX: 'BAIRRO',
        eixoY: 'Metro Linear',
        descricao: 'Cobertura do servico por bairro',
      },
      {
        tipo: 'pizza',
        titulo: 'Distribuicao por Bairro',
        eixoX: 'BAIRRO',
        eixoY: '',
        descricao: 'Proporcao do servico entre bairros',
      },
    ],
  },

  /* ─── VARRICAO ─── */
  varricao: {
    id: 'varricao',
    label: 'Varricao',
    categoria: 'limpeza_urbana',
    categoriaLabel: '🧹 Limpeza Urbana',
    cor: '#06b6d4',
    icone: '🧹',
    descricao: 'Varricao manual de ruas, avenidas e espacos publicos. Acompanhamento de KM linear varrido por equipe e bairro.',
    colunas: [
      { nome: 'DATA', tipo: 'data', obrigatorio: false, descricao: 'Data do servico', exemplos: ['01/05/2026'] },
      { nome: 'BAIRRO', tipo: 'texto', obrigatorio: true, descricao: 'Bairro do servico', exemplos: ['Ceu azul', 'Esplanada V'] },
      { nome: 'Equipe', tipo: 'texto', obrigatorio: true, descricao: 'Nome da equipe de varricao', exemplos: ['Equipe 1', 'Equipe 2'] },
      { nome: 'KM Linear', tipo: 'numero', obrigatorio: true, descricao: 'Quilometros lineares varridos', exemplos: ['856.45', '746.99'] },
    ],
    kpis: [
      {
        nome: 'Total KM Linear',
        label: 'Total KM Linear',
        expressao: 'SUM(KM Linear)',
        formato: 'numero',
        descricao: 'Total de quilometros lineares varridos no periodo',
        unidade: 'km',
        cor: '#06b6d4',
        categoria: 'operacional',
        colunasUsadas: ['KM Linear'],
      },
      {
        nome: 'KM por Equipe',
        label: 'KM por Equipe',
        expressao: 'DIVIDE(SUM(KM Linear), COUNT DISTINCT(Equipe))',
        formato: 'numero',
        descricao: 'Media de km lineares varridos por equipe',
        unidade: 'km/equipe',
        cor: '#22d3ee',
        categoria: 'operacional',
        colunasUsadas: ['KM Linear', 'Equipe'],
      },
      {
        nome: 'Equipes Ativas',
        label: 'Equipes Ativas',
        expressao: 'COUNT DISTINCT(Equipe)',
        formato: 'numero',
        descricao: 'Quantidade de equipes em operacao',
        unidade: 'equipes',
        cor: '#67e8f9',
        categoria: 'operacional',
        colunasUsadas: ['Equipe'],
      },
      {
        nome: 'KM por Bairro',
        label: 'KM por Bairro',
        expressao: 'DIVIDE(SUM(KM Linear), COUNT DISTINCT(BAIRRO))',
        formato: 'numero',
        descricao: 'Media de km varridos por bairro',
        unidade: 'km/bairro',
        cor: '#a5f3fc',
        categoria: 'analise',
        colunasUsadas: ['KM Linear', 'BAIRRO'],
      },
      {
        nome: 'Bairros Atendidos',
        label: 'Bairros Atendidos',
        expressao: 'COUNT DISTINCT(BAIRRO)',
        formato: 'numero',
        descricao: 'Quantidade de bairros que receberam varricao',
        unidade: 'bairros',
        cor: '#cffafe',
        categoria: 'analise',
        colunasUsadas: ['BAIRRO'],
      },
      // ─── FINANCEIRO ───
      {
        nome: 'Faturamento',
        label: 'Faturamento Estimado',
        expressao: 'SUM(KM Linear) * VALOR_KM_LINEAR',
        formato: 'moeda',
        descricao: 'Faturamento estimado baseado em km lineares varridos x valor por km',
        unidade: 'R$',
        cor: '#059669',
        categoria: 'financeiro',
        colunasUsadas: ['KM Linear'],
      },
      {
        nome: 'Receita por Equipe',
        label: 'Receita por Equipe',
        expressao: 'DIVIDE(SUM(KM Linear) * VALOR_KM_LINEAR, COUNT DISTINCT(Equipe))',
        formato: 'moeda',
        descricao: 'Faturamento dividido pelo numero de equipes',
        unidade: 'R$/equipe',
        cor: '#34d399',
        categoria: 'financeiro',
        colunasUsadas: ['KM Linear', 'Equipe'],
      },
    ],
    graficos: [
      {
        tipo: 'barra',
        titulo: 'KM Linear por Equipe',
        eixoX: 'Equipe',
        eixoY: 'KM Linear',
        descricao: 'Produtividade das equipes de varricao',
      },
      {
        tipo: 'barra',
        titulo: 'KM Linear por Bairro',
        eixoX: 'BAIRRO',
        eixoY: 'KM Linear',
        descricao: 'Cobertura por bairro',
      },
    ],
  },

  /* ─── PINTURA MEIO-FIO ─── */
  pintura_meio_fio: {
    id: 'pintura_meio_fio',
    label: 'Pintura',
    categoria: 'infraestrutura',
    categoriaLabel: '🏗️ Infraestrutura',
    cor: '#f59e0b',
    icone: '🎨',
    descricao: 'Pintura de meio-fio e sarjetas com medicao de comprimento e quantidade. Ideal para contratos de conservacao urbana.',
    colunas: [
      { nome: 'DATA', tipo: 'data', obrigatorio: false, descricao: 'Data do servico' },
      { nome: 'BAIRRO', tipo: 'texto', obrigatorio: true, descricao: 'Bairro do servico' },
      { nome: 'NOME', tipo: 'texto', obrigatorio: true, descricao: 'Nome do funcionario/pintor' },
      { nome: 'COMPRIMENTO', tipo: 'numero', obrigatorio: true, descricao: 'Comprimento total pintado (m)', exemplos: ['500', '1000'] },
      { nome: 'SARJETAS', tipo: 'numero', obrigatorio: false, descricao: 'Numero de sarjetas executadas', exemplos: ['20', '45'] },
    ],
    kpis: [
      {
        nome: 'Total Metros Pintados',
        label: 'Total Metros Pintados',
        expressao: 'SUM(COMPRIMENTO)',
        formato: 'numero',
        descricao: 'Total de metros lineares de meio-fio pintados',
        unidade: 'm',
        cor: '#f59e0b',
        categoria: 'operacional',
        colunasUsadas: ['COMPRIMENTO'],
      },
      {
        nome: 'Metros por Funcionario',
        label: 'Metros por Funcionario',
        expressao: 'DIVIDE(SUM(COMPRIMENTO), COUNT DISTINCT(NOME))',
        formato: 'numero',
        descricao: 'Media de metros pintados por funcionario',
        unidade: 'm/func',
        cor: '#fbbf24',
        categoria: 'operacional',
        colunasUsadas: ['COMPRIMENTO', 'NOME'],
      },
      {
        nome: 'Total Sarjetas',
        label: 'Sarjetas Executadas',
        expressao: 'SUM(SARJETAS)',
        formato: 'numero',
        descricao: 'Total de sarjetas executadas',
        unidade: 'sarjetas',
        cor: '#fde68a',
        categoria: 'operacional',
        colunasUsadas: ['SARJETAS'],
      },
      {
        nome: 'Bairros Atendidos',
        label: 'Bairros Atendidos',
        expressao: 'COUNT DISTINCT(BAIRRO)',
        formato: 'numero',
        descricao: 'Quantidade de bairros que receberam pintura',
        unidade: 'bairros',
        cor: '#fef3c7',
        categoria: 'analise',
        colunasUsadas: ['BAIRRO'],
      },
      // ─── FINANCEIRO ───
      {
        nome: 'Faturamento',
        label: 'Faturamento Estimado',
        expressao: 'SUM(COMPRIMENTO) * VALOR_KM_LINEAR',
        formato: 'moeda',
        descricao: 'Faturamento estimado baseado em metros pintados x valor por metro',
        unidade: 'R$',
        cor: '#059669',
        categoria: 'financeiro',
        colunasUsadas: ['COMPRIMENTO'],
      },
      {
        nome: 'Receita por Funcionario',
        label: 'Receita por Funcionario',
        expressao: 'DIVIDE(SUM(COMPRIMENTO) * VALOR_KM_LINEAR, COUNT DISTINCT(NOME))',
        formato: 'moeda',
        descricao: 'Faturamento dividido pelo numero de funcionarios',
        unidade: 'R$/func',
        cor: '#34d399',
        categoria: 'financeiro',
        colunasUsadas: ['COMPRIMENTO', 'NOME'],
      },
    ],
    graficos: [
      {
        tipo: 'barra',
        titulo: 'Metros Pintados por Funcionario',
        eixoX: 'NOME',
        eixoY: 'COMPRIMENTO',
        descricao: 'Produtividade individual na pintura',
      },
      {
        tipo: 'barra',
        titulo: 'Metros Pintados por Bairro',
        eixoX: 'BAIRRO',
        eixoY: 'COMPRIMENTO',
        descricao: 'Cobertura por bairro',
      },
    ],
  },

  /* ─── REMOCAO ─── */
  remocao: {
    id: 'remocao',
    label: 'Remocao',
    categoria: 'remocao',
    categoriaLabel: '🚛 Remocao',
    cor: '#ef4444',
    icone: '🚛',
    descricao: 'Remocao de entulho e materiais com caminhao. Acompanhamento de peso por setor, equipamento e placa.',
    colunas: [
      { nome: 'Dia', tipo: 'data', obrigatorio: false, descricao: 'Data do servico', exemplos: ['27/04/2026'] },
      { nome: 'Setor', tipo: 'texto', obrigatorio: true, descricao: 'Setor ou bairro do servico', exemplos: ['Vila Alzira', 'Jardim Olimpico'] },
      { nome: 'Equipamento', tipo: 'texto', obrigatorio: true, descricao: 'Equipamento utilizado na remocao', exemplos: ['Cacamba'] },
      { nome: 'Placa', tipo: 'texto', obrigatorio: true, descricao: 'Placa do veiculo/equipamento', exemplos: ['DFV0I23'] },
      { nome: 'Peso', tipo: 'numero', obrigatorio: true, descricao: 'Peso removido em kg', exemplos: ['1240', '1230'] },
      { nome: 'Descrição do serviço', tipo: 'texto', obrigatorio: false, descricao: 'Descricao do tipo de material removido', exemplos: ['Entulho/Remocao'] },
    ],
    kpis: [
      {
        nome: 'Total Remocoes',
        label: 'Total Remocoes',
        expressao: 'COUNT(*)',
        formato: 'numero',
        descricao: 'Numero total de remocoes realizadas',
        unidade: 'remocoes',
        cor: '#ef4444',
        categoria: 'operacional',
        colunasUsadas: [],
      },
      {
        nome: 'Peso Total KG',
        label: 'Peso Total Removido',
        expressao: 'SUM(Peso)',
        formato: 'numero',
        descricao: 'Peso total removido em kg',
        unidade: 'kg',
        cor: '#f87171',
        categoria: 'operacional',
        colunasUsadas: ['Peso'],
      },
      {
        nome: 'Peso por Remocao',
        label: 'Peso Medio por Remocao',
        expressao: 'DIVIDE(SUM(Peso), COUNT(*))',
        formato: 'numero',
        descricao: 'Peso medio removido por viagem/servico',
        unidade: 'kg/remocao',
        cor: '#fca5a5',
        categoria: 'operacional',
        colunasUsadas: ['Peso'],
      },
      {
        nome: 'Peso por Setor',
        label: 'Peso por Setor',
        expressao: 'DIVIDE(SUM(Peso), COUNT DISTINCT(Setor))',
        formato: 'numero',
        descricao: 'Media de peso removido por setor',
        unidade: 'kg/setor',
        cor: '#fecaca',
        categoria: 'analise',
        colunasUsadas: ['Peso', 'Setor'],
      },
      {
        nome: 'Setores Atendidos',
        label: 'Setores Atendidos',
        expressao: 'COUNT DISTINCT(Setor)',
        formato: 'numero',
        descricao: 'Quantidade de setores que receberam remocao',
        unidade: 'setores',
        cor: '#fee2e2',
        categoria: 'analise',
        colunasUsadas: ['Setor'],
      },
      {
        nome: 'Veiculos Ativos',
        label: 'Veiculos Utilizados',
        expressao: 'COUNT DISTINCT(Placa)',
        formato: 'numero',
        descricao: 'Quantidade de veiculos/equipamentos utilizados',
        unidade: 'veiculos',
        cor: '#fef2f2',
        categoria: 'operacional',
        colunasUsadas: ['Placa'],
      },
      // ─── FINANCEIRO ───
      {
        nome: 'Faturamento',
        label: 'Faturamento Estimado',
        expressao: 'SUM(Peso) / 1000 * VALOR_TONELADA',
        formato: 'moeda',
        descricao: 'Faturamento estimado baseado em toneladas removidas x valor por tonelada',
        unidade: 'R$',
        cor: '#059669',
        categoria: 'financeiro',
        colunasUsadas: ['Peso'],
      },
      {
        nome: 'Receita por Equipamento',
        label: 'Receita por Equipamento',
        expressao: 'DIVIDE(SUM(Peso) / 1000 * VALOR_TONELADA, COUNT DISTINCT(Equipamento))',
        formato: 'moeda',
        descricao: 'Faturamento dividido pelo numero de equipamentos',
        unidade: 'R$/equip',
        cor: '#34d399',
        categoria: 'financeiro',
        colunasUsadas: ['Peso', 'Equipamento'],
      },
    ],
    graficos: [
      {
        tipo: 'barra',
        titulo: 'Peso por Setor',
        eixoX: 'Setor',
        eixoY: 'Peso',
        descricao: 'Distribuicao do peso removido por setor',
      },
      {
        tipo: 'barra',
        titulo: 'Remocoes por Setor',
        eixoX: 'Setor',
        eixoY: '',
        descricao: 'Quantidade de remocoes por setor',
      },
      {
        tipo: 'pizza',
        titulo: 'Por Tipo de Servico',
        eixoX: 'Descrição do serviço',
        eixoY: '',
        descricao: 'Proporcao por tipo de material removido',
      },
    ],
  },

  /* ─── COLETA SELETIVA (planilha de produção) ─── */
  coleta_seletiva: {
    id: 'coleta_seletiva',
    label: 'Coleta seletiva',
    categoria: 'coleta',
    categoriaLabel: '♻️ Coleta seletiva',
    cor: '#16a34a',
    icone: '♻️',
    descricao: 'Coleta seletiva da planilha de produção, medida em toneladas.',
    colunas: [
      { nome: 'DATA', tipo: 'data', obrigatorio: false, descricao: 'Data', exemplos: ['01/10/2026'] },
      { nome: 'LOCAL', tipo: 'texto', obrigatorio: false, descricao: 'Local', exemplos: ['UNAÍ'] },
      { nome: 'QUANTIDADE', tipo: 'numero', obrigatorio: true, descricao: 'Toneladas', exemplos: ['500'] },
      { nome: 'Toneladas', tipo: 'numero', obrigatorio: false, descricao: 'Toneladas', exemplos: ['500'] },
    ],
    kpis: [
      {
        nome: 'Toneladas',
        label: 'Toneladas',
        expressao: 'SUM(Toneladas)',
        formato: 'numero',
        descricao: 'Toneladas de coleta seletiva no período',
        unidade: 't',
        cor: '#16a34a',
        categoria: 'operacional',
        colunasUsadas: ['Toneladas'],
      },
      {
        nome: 'Lancamentos',
        label: 'Lançamentos',
        expressao: 'COUNT(*)',
        formato: 'numero',
        descricao: 'Quantidade de lançamentos',
        unidade: 'lançamentos',
        cor: '#22c55e',
        categoria: 'operacional',
        colunasUsadas: [],
      },
      {
        nome: 'Dias',
        label: 'Dias com coleta',
        expressao: 'COUNT DISTINCT(DATA)',
        formato: 'numero',
        descricao: 'Dias com lançamento',
        unidade: 'dias',
        cor: '#4ade80',
        categoria: 'operacional',
        colunasUsadas: ['DATA'],
      },
    ],
    graficos: [],
  },

  /* ─── ATERRO (planilha de produção) ─── */
  aterro: {
    id: 'aterro',
    label: 'Aterro',
    categoria: 'remocao',
    categoriaLabel: '🏭 Aterro',
    cor: '#78716c',
    icone: '🏭',
    descricao: 'Viagens ao aterro da planilha de produção.',
    colunas: [
      { nome: 'DATA', tipo: 'data', obrigatorio: false, descricao: 'Data', exemplos: ['01/10/2026'] },
      { nome: 'LOCAL', tipo: 'texto', obrigatorio: false, descricao: 'Local', exemplos: ['UNAÍ'] },
      { nome: 'TIPO DE EQUIPAMENTO', tipo: 'texto', obrigatorio: false, descricao: 'Caminhão', exemplos: ['CAMINHÃO TOCO'] },
      { nome: 'OBSERVAÇÃO', tipo: 'texto', obrigatorio: false, descricao: 'Observação', exemplos: ['ENTULHO'] },
    ],
    kpis: [
      {
        nome: 'Viagens',
        label: 'Viagens ao aterro',
        expressao: 'COUNT(*)',
        formato: 'numero',
        descricao: 'Viagens lançadas para o aterro',
        unidade: 'viagens',
        cor: '#78716c',
        categoria: 'operacional',
        colunasUsadas: [],
      },
      {
        nome: 'Dias',
        label: 'Dias com viagem',
        expressao: 'COUNT DISTINCT(DATA)',
        formato: 'numero',
        descricao: 'Dias com viagem ao aterro',
        unidade: 'dias',
        cor: '#a8a29e',
        categoria: 'operacional',
        colunasUsadas: ['DATA'],
      },
      {
        nome: 'Equipamentos',
        label: 'Tipos de equipamento',
        expressao: 'COUNT DISTINCT(TIPO DE EQUIPAMENTO)',
        formato: 'numero',
        descricao: 'Tipos de caminhão que foram ao aterro',
        unidade: 'tipos',
        cor: '#d6d3d1',
        categoria: 'analise',
        colunasUsadas: ['TIPO DE EQUIPAMENTO'],
      },
    ],
    graficos: [],
  },

  /* ─── GERAL ─── */
  geral: {
    id: 'geral',
    label: 'Geral',
    categoria: 'geral',
    categoriaLabel: '📋 Geral',
    cor: '#94a3b8',
    icone: '📋',
    descricao: 'Tipo generico para servicos nao categorizados. Os KPIs serao detectados automaticamente apos o upload.',
    colunas: [],
    kpis: [],
    graficos: [],
  },
};

/* ═══════════════════════════════════════
   SERVICOS EXPORTADOS
   ═══════════════════════════════════════ */

/** Retorna todos os tipos organizados por categoria */
export function listarCategorias(): CategoriaTipo[] {
  return CATEGORIAS;
}

/** Retorna template completo de um tipo */
export function getTemplate(tipoId: string): TipoServicoTemplate | null {
  return TEMPLATES[tipoId] || null;
}

/** Retorna KPIs padrao de um tipo */
export function getKpisPadrao(tipoId: string): KpiTemplate[] {
  if (tipoId === 'coleta_caminhao') {
    return getKpisTemplateColeta() as KpiTemplate[];
  }
  const template = TEMPLATES[tipoId];
  return template?.kpis || [];
}

/** Retorna graficos padrao de um tipo */
export function getGraficosPadrao(tipoId: string): GraficoTemplate[] {
  if (tipoId === 'coleta_caminhao') {
    return getGraficosTemplateColeta() as GraficoTemplate[];
  }
  const template = TEMPLATES[tipoId];
  return template?.graficos || [];
}

/** Retorna colunas esperadas de um tipo */
export function getColunasEsperadas(tipoId: string): ColunaEsperada[] {
  const template = TEMPLATES[tipoId];
  return template?.colunas || [];
}

/** Gera modelo de planilha baseado no tipo */
export function gerarModeloPlanilha(tipoId: string): { headers: string[]; linhas: string[][]; nome: string; descricao: string } {
  const template = TEMPLATES[tipoId];
  if (!template || template.colunas.length === 0) {
    return {
      headers: ['DATA', 'DESCRICAO', 'VALOR'],
      linhas: [
        ['01/01/2024', 'Exemplo de lancamento 1', '100'],
        ['02/01/2024', 'Exemplo de lancamento 2', '200'],
      ],
      nome: 'modelo_geral',
      descricao: 'Modelo generico para servicos nao categorizados',
    };
  }

  const headers = template.colunas.map(c => c.nome);
  const linhaExemplo: string[] = template.colunas.map(c => {
    if (c.exemplos && c.exemplos.length > 0) return c.exemplos[0];
    if (c.tipo === 'numero') return '0';
    if (c.tipo === 'data') return '01/01/2024';
    if (c.tipo === 'hora') return '08:00';
    return 'Exemplo';
  });

  return {
    headers,
    linhas: [linhaExemplo, linhaExemplo.map(() => '')],
    nome: `modelo_${template.id}`,
    descricao: `Modelo de planilha para ${template.label}`,
  };
}

/** Valida colunas de um upload contra as esperadas */
export function validarColunasEsperadas(
  tipoId: string,
  colunasEncontradas: string[]
): {
  valido: boolean;
  colunasObrigatorias: ColunaEsperada[];
  colunasEncontradas: string[];
  colunasAusentes: string[];
  colunasAdicionais: string[];
  pontuacao: number; // 0-100
} {
  const template = TEMPLATES[tipoId];
  if (!template || template.colunas.length === 0) {
    return {
      valido: true,
      colunasObrigatorias: [],
      colunasEncontradas,
      colunasAusentes: [],
      colunasAdicionais: [],
      pontuacao: 100,
    };
  }

  const normalizar = (s: string) => s.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s\-_]+/g, '');

  const colunasNorm = colunasEncontradas.map(normalizar);
  const obrigatorias = template.colunas.filter(c => c.obrigatorio);
  const todasColunas = template.colunas;

  const colunasAusentes = obrigatorias.filter(c => {
    const norm = normalizar(c.nome);
    return !colunasNorm.some(cn => cn === norm || cn.includes(norm) || norm.includes(cn));
  });

  const colunasAusentesAll = todasColunas.filter(c => {
    const norm = normalizar(c.nome);
    return !colunasNorm.some(cn => cn === norm || cn.includes(norm) || norm.includes(cn));
  });

  const colunasAdicionais = colunasEncontradas.filter(c => {
    const norm = normalizar(c);
    return !todasColunas.some(tc => {
      const tcNorm = normalizar(tc.nome);
      return norm === tcNorm || norm.includes(tcNorm) || tcNorm.includes(norm);
    });
  });

  // Pontuacao: 100 - penalidade por ausentes (cada obrigatoria -20)
  const penalidadeObrigatorias = colunasAusentes.length * 20;
  const pontuacao = Math.max(0, 100 - penalidadeObrigatorias);

  return {
    valido: colunasAusentes.length === 0,
    colunasObrigatorias: obrigatorias,
    colunasEncontradas,
    colunasAusentes: colunasAusentesAll.map(c => c.nome),
    colunasAdicionais,
    pontuacao,
  };
}

/** Converte KPIs do template para formato KpiConfig (usado no configDashboard) */
export function converterKpisParaConfig(tipoId: string): any[] {
  const kpis = getKpisPadrao(tipoId);
  return kpis.map((k, i) => ({
    id: `template_${tipoId}_${i}`,
    nome: k.nome,
    label: k.label,
    expressao: k.expressao,
    formato: k.formato,
    agregacao: 'sum',
    ativo: true,
    descricao: k.descricao,
    unidade: k.unidade,
    cor: k.cor,
    categoria: k.categoria,
    colunasUsadas: k.colunasUsadas,
    valoresFixos: {},
    automatico: true,
    origemTemplate: true,
    templateTipo: tipoId,
  }));
}

/** Converte graficos do template para formato GraficoConfig */
export function converterGraficosParaConfig(tipoId: string): any[] {
  const graficos = getGraficosPadrao(tipoId);
  return graficos.map((g, i) => ({
    id: `grafico_template_${tipoId}_${i}`,
    tipo: g.tipo,
    titulo: g.titulo,
    eixoX: g.eixoX,
    eixoY: g.eixoY,
    ativo: true,
    descricao: g.descricao,
    origemTemplate: true,
    templateTipo: tipoId,
  }));
}

export default {
  listarCategorias,
  getTemplate,
  getKpisPadrao,
  getGraficosPadrao,
  getColunasEsperadas,
  gerarModeloPlanilha,
  validarColunasEsperadas,
  converterKpisParaConfig,
  converterGraficosParaConfig,
  CATEGORIAS,
  TEMPLATES,
};
