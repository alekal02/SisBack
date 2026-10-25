import 'reflect-metadata';
import AppDataSource from './data-source';
import { KpiUniversal, PlaceholderKpi } from '../entities/KpiUniversal';
import { TipoServico } from '../enums/TipoServico';
import { KPIS_UNIVERSAIS_REMOVIDOS_COLETA } from '../services/kpiDeduplicacaoService';
import { renomearKpiSistema, upsertKpiSistema } from './kpiUniversalSeedUtils';

/**
 * Seed complementar de KPIs Universais.
 * Adiciona MAIS KPIs aos já existentes, sem duplicar.
 * 
 * Executar: npx ts-node src/database/seedKpiUniversalExtra.ts
 */
/** Catálogo canônico do seed complementar (sem gravar no banco). */
export function buildKpisUniversaisExtraNovos(): Partial<KpiUniversal>[] {
  // ─── Placeholders (reaproveitados do seed principal) ───

  const PH_PESO: PlaceholderKpi = {
    nome: 'PESO_PLACEHOLDER',
    label: 'Coluna de Peso',
    colunasCandidatas: ['PESO TOTAL', 'PESO', 'PESOTOTAL', 'PESO_BRUTO', 'PESO COLETADO', 'PESO (KG)', 'PESO COLETA'],
  };

  const PH_KM: PlaceholderKpi = {
    nome: 'KM_PLACEHOLDER',
    label: 'Coluna de KM',
    colunasCandidatas: ['KM TOTAL', 'KM', 'KMTOTAL', 'KM_TOTAL', 'QUILOMETRO', 'DISTANCIA', 'KM RODADO'],
  };

  const PH_PLACA: PlaceholderKpi = {
    nome: 'PLACA_PLACEHOLDER',
    label: 'Coluna de Placa/Veículo',
    colunasCandidatas: ['PLACA', 'CAMINHAO', 'VEICULO', 'COLETOR', 'COLETORA', 'EQUIPAMENTO'],
  };

  const PH_TIPO: PlaceholderKpi = {
    nome: 'TIPO_PLACEHOLDER',
    label: 'Coluna de Tipo de Caminhão',
    colunasCandidatas: ['TIPO DE CAMINHÃO', 'TIPO CAMINHAO', 'TIPO_CAMINHAO', 'CAMINHAO', 'TIPO DE CAMINHAO', 'TIPODECAMINHAO'],
  };

  const PH_HORA: PlaceholderKpi = {
    nome: 'HORA_PLACEHOLDER',
    label: 'Coluna de Hora',
    colunasCandidatas: ['HORA SAIDA', 'HORA', 'HORASAIDA', 'HORA_SAIDA', 'HR SAIDA BASE', 'HORAS PRODUTIVAS', 'HORAS', 'DURACAO'],
  };

  const PH_HORA_FORA: PlaceholderKpi = {
    nome: 'HORA_FORA_PLACEHOLDER',
    label: 'Coluna de Horas Fora da Unidade',
    colunasCandidatas: ['HORAS QUE FICA FORA DA UNIDADE', 'HORAS FORA UNIDADE', 'HORAS FORA DA UNIDADE', 'TEMPO FORA DA UNIDADE'],
  };

  const PH_MOTORISTA: PlaceholderKpi = {
    nome: 'MOTORISTA_PLACEHOLDER',
    label: 'Coluna de Motorista',
    colunasCandidatas: ['MOTORISTA', 'NOME', 'OPERADOR', 'FUNCIONARIO', 'EQUIPE'],
  };

  const PH_COLETOR_NUM: PlaceholderKpi = {
    nome: 'COLETOR_NUM_PLACEHOLDER',
    label: 'Coluna de Nº de Coletores',
    colunasCandidatas: ['Nº DE COLETORES', 'NUMERO DE COLETORES', 'NÚMERO DE COLETORES', 'COLETORES', 'NR COLETORES'],
  };

  const PH_DISTRITO: PlaceholderKpi = {
    nome: 'DISTRITO_PLACEHOLDER',
    label: 'Coluna de Distrito',
    colunasCandidatas: ['DISTRITO', 'BAIRRO', 'LOCAL', 'SETOR'],
  };

  const PH_REGIONAL: PlaceholderKpi = {
    nome: 'REGIONAL_PLACEHOLDER',
    label: 'Coluna de Regional',
    colunasCandidatas: ['REGIONAL', 'REGIAO', 'REGIÃO', 'ZONA'],
  };

  const PH_TURNO: PlaceholderKpi = {
    nome: 'TURNO_PLACEHOLDER',
    label: 'Coluna de Turno',
    colunasCandidatas: ['TURNO', 'TURNO BASE', 'PERIODO', 'TURNO_BASE', 'TURNO_BASE\r\n'],
  };

  const PH_VIAGENS: PlaceholderKpi = {
    nome: 'VIAGENS_PLACEHOLDER',
    label: 'Coluna de Nº de Viagens',
    colunasCandidatas: ['Nº DE VIAGENS', 'NUMERO DE VIAGENS', 'NÚMERO DE VIAGENS', 'VIAGENS', 'CONTADOR DE VIAGENS', 'CONTADOR VIAGENS'],
  };

  const PH_PESO1: PlaceholderKpi = {
    nome: 'PESO1_PLACEHOLDER',
    label: 'Coluna de Peso 1 (1ª pesagem)',
    colunasCandidatas: ['PESO 1', 'PESO1', 'PRIMEIRA PESAGEM', 'PESO INICIAL'],
  };

  const PH_PESO4: PlaceholderKpi = {
    nome: 'PESO4_PLACEHOLDER',
    label: 'Coluna de Peso 4 (última pesagem na planilha padrão)',
    colunasCandidatas: ['PESO 4', 'PESO4', 'ULTIMA PESAGEM', 'PESO FINAL'],
  };

  const PH_KM_SAIDA: PlaceholderKpi = {
    nome: 'KM_SAIDA_PLACEHOLDER',
    label: 'Coluna de KM Saída',
    colunasCandidatas: ['KM SAIDA', 'KM SAIDA BASE', 'KM SAÍDA', 'KM SAÍDA BASE', 'KM SAIDA\r\nBASE', 'KM SAIDA BASE\r\nBASE'],
  };

  const PH_KM_CHEGADA: PlaceholderKpi = {
    nome: 'KM_CHEGADA_PLACEHOLDER',
    label: 'Coluna de KM Chegada',
    colunasCandidatas: ['KM CHEGADA', 'KM CHEGADA BASE', 'KM CHEGADA ROTA 01', 'KM CHEGADA\r\nBASE', 'KM CHEGADA BASE\r\nBASE'],
  };

  const PH_PESO_MEDIO: PlaceholderKpi = {
    nome: 'PESO_MEDIO_PLACEHOLDER',
    label: 'Coluna de Peso Médio por pesagem',
    colunasCandidatas: ['PESO 2', 'PESO2', 'PESO 3', 'PESO3', 'PESO 4', 'PESO4'],
  };

  // ════════════════════════════════════════════════════════════════
  // NOVOS KPIs — COLETA_CAMINHAO (usando colunas da planilha padrão)
  // ════════════════════════════════════════════════════════════════

  const novosKpisColeta: Partial<KpiUniversal>[] = [
    // ─── Frota e Equipe ───
    {
      nome: 'Total de Motoristas',
      label: 'Total de Motoristas',
      formula: 'COUNT(DISTINCT MOTORISTA_PLACEHOLDER)',
      agregacao: 'count',
      formato: 'numero',
      unidade: 'motoristas',
      categoria: 'Equipe',
      cor: '#0ea5e9',
      descricao: 'Quantidade de motoristas únicos que realizaram coletas no período',
      metaSugerida: null,
      tipoServico: TipoServico.COLETA_CAMINHAO,
      placeholders: [PH_MOTORISTA],
    },
    {
      nome: 'Distritos Atendidos',
      label: 'Distritos Atendidos',
      formula: 'COUNT(DISTINCT DISTRITO_PLACEHOLDER)',
      agregacao: 'count',
      formato: 'numero',
      unidade: 'distritos',
      categoria: 'Cobertura',
      cor: '#a855f7',
      descricao: 'Quantidade de distritos/bairros distintos onde houve coleta',
      metaSugerida: null,
      tipoServico: TipoServico.COLETA_CAMINHAO,
      placeholders: [PH_DISTRITO],
    },
    {
      nome: 'Regionais Atendidas',
      label: 'Regionais Atendidas',
      formula: 'COUNT(DISTINCT REGIONAL_PLACEHOLDER)',
      agregacao: 'count',
      formato: 'numero',
      unidade: 'regionais',
      categoria: 'Cobertura',
      cor: '#d946ef',
      descricao: 'Quantidade de regionais distintas onde houve coleta',
      metaSugerida: null,
      tipoServico: TipoServico.COLETA_CAMINHAO,
      placeholders: [PH_REGIONAL],
    },
    {
      nome: 'Turnos Realizados',
      label: 'Turnos Realizados',
      formula: 'COUNT(DISTINCT TURNO_PLACEHOLDER)',
      agregacao: 'count',
      formato: 'numero',
      unidade: 'turnos',
      categoria: 'Operacional',
      cor: '#f59e0b',
      descricao: 'Quantidade de turnos distintos (manhã, tarde, noite) com registros',
      metaSugerida: null,
      tipoServico: TipoServico.COLETA_CAMINHAO,
      placeholders: [PH_TURNO],
    },

    // ─── Eficiência e Produtividade ───
    {
      nome: 'Horas Produtivas por Viagem',
      label: 'Horas Produtivas por Viagem',
      formula: 'DIVIDE(HORAS_PRODUTIVAS(HORA SÁIDA BASE, HORA CHEGADA BASE), VIAGENS_POR_ROTA())',
      agregacao: 'avg',
      formato: 'numero',
      unidade: 'h/viagem',
      categoria: 'Produtividade',
      cor: '#0891b2',
      descricao: 'Média de horas produtivas (base) por viagem (CONTADOR DE VIAGENS ou rotas 01–04)',
      metaSugerida: null,
      tipoServico: TipoServico.COLETA_CAMINHAO,
      placeholders: [PH_VIAGENS],
    },
    {
      nome: 'KM por Hora Produtiva',
      label: 'KM por Hora Produtiva',
      formula: 'DIVIDE(SUM(KM_PLACEHOLDER), HORAS_PRODUTIVAS(HORA SÁIDA BASE, HORA CHEGADA BASE))',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'km/h',
      categoria: 'Eficiência',
      cor: '#3b82f6',
      descricao: 'KM TOTAL dividido pelas horas produtivas (HORA SÁIDA BASE → HORA CHEGADA BASE)',
      metaSugerida: null,
      tipoServico: TipoServico.COLETA_CAMINHAO,
      placeholders: [PH_KM],
    },
    {
      nome: 'Toneladas por Hora Produtiva',
      label: 'Ton. por Hora Produtiva',
      formula: 'DIVIDE(SUM(PESO_PLACEHOLDER) / 1000, HORAS_PRODUTIVAS(HORA SÁIDA BASE, HORA CHEGADA BASE))',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'ton/h',
      categoria: 'Eficiência',
      cor: '#10b981',
      descricao: 'Tonelagem total dividida pelas horas produtivas da base',
      metaSugerida: null,
      tipoServico: TipoServico.COLETA_CAMINHAO,
      placeholders: [PH_PESO],
    },
    {
      nome: 'KM por Tonelada',
      label: 'KM/Ton',
      formula: 'DIVIDE(SUM(KM_PLACEHOLDER), SUM(PESO_PLACEHOLDER) / 1000)',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'km/t',
      categoria: 'Eficiência',
      cor: '#0ea5e9',
      descricao: 'KM TOTAL dividido pela tonelagem total — quilômetros rodados por tonelada transportada',
      metaSugerida: null,
      tipoServico: TipoServico.COLETA_CAMINHAO,
      placeholders: [PH_KM, PH_PESO],
    },

    // ─── Carga por Viagem ───
    {
      nome: 'Carga Média por Viagem',
      label: 'Carga Média/Viagem',
      formula: 'DIVIDE(SUM(PESO_PLACEHOLDER), VIAGENS_POR_ROTA())',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'kg/viagem',
      categoria: 'Operacional',
      cor: '#22c55e',
      descricao: 'Peso médio por viagem (usa CONTADOR DE VIAGENS ou rotas 01–04)',
      metaSugerida: null,
      tipoServico: TipoServico.COLETA_CAMINHAO,
      placeholders: [PH_PESO, PH_VIAGENS],
    },
    {
      nome: 'Média de Viagens por Registro',
      label: 'Viagens/Registro',
      formula: 'DIVIDE(VIAGENS_POR_ROTA(), COUNT(*))',
      agregacao: 'avg',
      formato: 'numero',
      unidade: 'viagens/reg',
      categoria: 'Operacional',
      cor: '#2dd4bf',
      descricao: 'Média de viagens por registro — CONTADOR DE VIAGENS ou rotas 01–04 dividido pelo número de linhas',
      metaSugerida: null,
      tipoServico: TipoServico.COLETA_CAMINHAO,
      placeholders: [PH_VIAGENS],
    },

    // ─── Análise de Carga por Coletor ───
    {
      nome: 'Peso por Coletor (kg)',
      label: 'Ton/Coletor',
      formula: 'DIVIDE(SUM(PESO_PLACEHOLDER) / 1000, PLACAS_UNICAS())',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'ton/coletor',
      categoria: 'Frota',
      cor: '#8b5cf6',
      descricao: 'Tonelagem total do período dividida pelos coletores únicos (nomes ou placas)',
      metaSugerida: null,
      tipoServico: TipoServico.COLETA_CAMINHAO,
      placeholders: [PH_PESO, PH_COLETOR_NUM],
    },
    {
      nome: 'KM por Coletor',
      label: 'KM/Coletor',
      formula: 'DIVIDE(SUM(KM_PLACEHOLDER), SUM(COLETOR_NUM_PLACEHOLDER))',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'km/coletor',
      categoria: 'Frota',
      cor: '#6366f1',
      descricao: 'KM total dividido pelo número de coletores — deslocamento por coletor',
      metaSugerida: null,
      tipoServico: TipoServico.COLETA_CAMINHAO,
      placeholders: [PH_KM, PH_COLETOR_NUM],
    },
    {
      nome: 'Média de Coletores por Viagem',
      label: 'Média Coletores',
      formula: 'AVG(COLETOR_NUM_PLACEHOLDER)',
      agregacao: 'avg',
      formato: 'numero',
      unidade: 'coletores',
      categoria: 'Frota',
      cor: '#4f46e5',
      descricao: 'Média do número de coletores por registro/viagem',
      metaSugerida: null,
      tipoServico: TipoServico.COLETA_CAMINHAO,
      placeholders: [PH_COLETOR_NUM],
    },

    // ─── Análise de Pesos Individuais ───
    {
      nome: 'Variação entre Peso 1 e Peso 4',
      label: 'Variação Peso1→Peso4',
      formula: 'AVG(PESO4_PLACEHOLDER) - AVG(PESO1_PLACEHOLDER)',
      agregacao: 'avg',
      formato: 'numero',
      unidade: 'kg',
      categoria: 'Qualidade',
      cor: '#f43f5e',
      descricao: 'Diferença média entre PESO 1 e PESO 4 (última pesagem na planilha padrão)',
      metaSugerida: null,
      tipoServico: TipoServico.COLETA_CAMINHAO,
      placeholders: [PH_PESO1, PH_PESO4],
    },
    {
      nome: 'Peso Máximo Coletado',
      label: 'Peso Máximo',
      formula: 'MAX(PESO_PLACEHOLDER)',
      agregacao: 'max',
      formato: 'numero',
      unidade: 'kg',
      categoria: 'Qualidade',
      cor: '#ef4444',
      descricao: 'Maior peso registrado em uma única coleta',
      metaSugerida: null,
      tipoServico: TipoServico.COLETA_CAMINHAO,
      placeholders: [PH_PESO],
    },
    {
      nome: 'Peso Mínimo Coletado',
      label: 'Peso Mínimo',
      formula: 'MIN(PESO_PLACEHOLDER)',
      agregacao: 'min',
      formato: 'numero',
      unidade: 'kg',
      categoria: 'Qualidade',
      cor: '#22c55e',
      descricao: 'Menor peso registrado em uma única coleta',
      metaSugerida: null,
      tipoServico: TipoServico.COLETA_CAMINHAO,
      placeholders: [PH_PESO],
    },
    // ─── Análise por Tipo de Caminhão ───
    {
      nome: 'Média de Peso por Tipo',
      label: 'Peso Médio por Tipo',
      formula: 'AVG(PESO_PLACEHOLDER)',
      agregacao: 'avg',
      formato: 'numero',
      unidade: 'kg',
      categoria: 'Frota',
      cor: '#0d9488',
      descricao: 'Peso médio geral — útil combinado com filtro por tipo de caminhão',
      metaSugerida: null,
      tipoServico: TipoServico.COLETA_CAMINHAO,
      placeholders: [PH_PESO],
    },
    // ─── Horas produtivas por rota (01–04) ───
    {
      nome: 'Horas Produtivas Rota 01',
      label: 'Horas Produtivas Rota 01',
      formula: 'ROUND(HORAS_PRODUTIVAS(HORA CHEGADA ROTA 01, HORA SAÍDA ROTA 01), 2)',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'h',
      categoria: 'Produtividade',
      cor: '#f59e0b',
      descricao: 'Horas dentro da Rota 01 (HORA CHEGADA ROTA 01 → HORA SAÍDA ROTA 01, com virada de dia)',
      metaSugerida: null,
      tipoServico: TipoServico.COLETA_CAMINHAO,
      placeholders: [],
    },
    {
      nome: 'Horas Produtivas Rota 02',
      label: 'Horas Produtivas Rota 02',
      formula: 'ROUND(HORAS_PRODUTIVAS(HORA CHEGADA ROTA 02, HORA SAÍDA ROTA 02), 2)',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'h',
      categoria: 'Produtividade',
      cor: '#3b82f6',
      descricao: 'Horas dentro da Rota 02 (HORA CHEGADA ROTA 02 → HORA SAÍDA ROTA 02, com virada de dia)',
      metaSugerida: null,
      tipoServico: TipoServico.COLETA_CAMINHAO,
      placeholders: [],
    },
    {
      nome: 'Horas Produtivas Rota 03',
      label: 'Horas Produtivas Rota 03',
      formula: 'ROUND(HORAS_PRODUTIVAS(HORA CHEGADA ROTA 03, HORA SAÍDA ROTA 03), 2)',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'h',
      categoria: 'Produtividade',
      cor: '#8b5cf6',
      descricao: 'Horas dentro da Rota 03 (HORA CHEGADA/CHEGA ROTA 03 → HORA SAÍDA ROTA 03, com virada de dia)',
      metaSugerida: null,
      tipoServico: TipoServico.COLETA_CAMINHAO,
      placeholders: [],
    },
    {
      nome: 'Horas Produtivas Rota 04',
      label: 'Horas Produtivas Rota 04',
      formula: 'ROUND(HORAS_PRODUTIVAS(HORA CHEGADA ROTA 04, HORA SAÍDA ROTA 04), 2)',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'h',
      categoria: 'Produtividade',
      cor: '#ec4899',
      descricao: 'Horas dentro da Rota 04 (HORA CHEGADA ROTA 04 → HORA SAÍDA ROTA 04, com virada de dia)',
      metaSugerida: null,
      tipoServico: TipoServico.COLETA_CAMINHAO,
      placeholders: [],
    },
    {
      nome: 'Horas nas Rotas (total)',
      label: 'Horas nas Rotas (total)',
      formula: 'ROUND(HORAS_PRODUTIVAS(HORA CHEGADA ROTA 01, HORA SAÍDA ROTA 01) + HORAS_PRODUTIVAS(HORA CHEGADA ROTA 02, HORA SAÍDA ROTA 02) + HORAS_PRODUTIVAS(HORA CHEGADA ROTA 03, HORA SAÍDA ROTA 03) + HORAS_PRODUTIVAS(HORA CHEGADA ROTA 04, HORA SAÍDA ROTA 04), 1)',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'h',
      categoria: 'Produtividade',
      cor: '#0ea5e9',
      descricao: 'Soma das horas produtivas nas rotas 01–04 (colunas de hora da planilha padrão)',
      metaSugerida: null,
      tipoServico: TipoServico.COLETA_CAMINHAO,
      placeholders: [],
    },
  ];

  // ════════════════════════════════════════════════════════════════
  // NOVOS KPIs — VARRICAO
  // ════════════════════════════════════════════════════════════════

  const novosKpisVarricao: Partial<KpiUniversal>[] = [
    {
      nome: 'Registros de Varrição',
      label: 'Registros',
      formula: 'COUNT(*)',
      agregacao: 'count',
      formato: 'numero',
      unidade: 'registros',
      categoria: 'Geral',
      cor: '#64748b',
      descricao: 'Total de registros de varrição',
      metaSugerida: null,
      tipoServico: TipoServico.VARRICAO,
      placeholders: [],
    },
    {
      nome: 'Turnos de Varrição',
      label: 'Turnos Realizados',
      formula: 'COUNT(DISTINCT TURNO_PLACEHOLDER)',
      agregacao: 'count',
      formato: 'numero',
      unidade: 'turnos',
      categoria: 'Operacional',
      cor: '#f59e0b',
      descricao: 'Quantidade de turnos distintos com varrição',
      metaSugerida: null,
      tipoServico: TipoServico.VARRICAO,
      placeholders: [PH_TURNO],
    },
    {
      nome: 'Bairros Varridos',
      label: 'Bairros Varridos',
      formula: 'COUNT(DISTINCT DISTRITO_PLACEHOLDER)',
      agregacao: 'count',
      formato: 'numero',
      unidade: 'bairros',
      categoria: 'Cobertura',
      cor: '#a855f7',
      descricao: 'Quantidade de bairros distintos com varrição',
      metaSugerida: null,
      tipoServico: TipoServico.VARRICAO,
      placeholders: [PH_DISTRITO],
    },
  ];

  // ════════════════════════════════════════════════════════════════
  // NOVOS KPIs — PODA
  // ════════════════════════════════════════════════════════════════

  const novosKpisPoda: Partial<KpiUniversal>[] = [
    {
      nome: 'Turnos de Poda',
      label: 'Turnos Realizados',
      formula: 'COUNT(DISTINCT TURNO_PLACEHOLDER)',
      agregacao: 'count',
      formato: 'numero',
      unidade: 'turnos',
      categoria: 'Operacional',
      cor: '#f59e0b',
      descricao: 'Quantidade de turnos distintos com atividades de poda',
      metaSugerida: null,
      tipoServico: TipoServico.PODA,
      placeholders: [PH_TURNO],
    },
    {
      nome: 'Distritos com Poda',
      label: 'Distritos Atendidos',
      formula: 'COUNT(DISTINCT DISTRITO_PLACEHOLDER)',
      agregacao: 'count',
      formato: 'numero',
      unidade: 'distritos',
      categoria: 'Cobertura',
      cor: '#a855f7',
      descricao: 'Quantidade de distritos com atividades de poda',
      metaSugerida: null,
      tipoServico: TipoServico.PODA,
      placeholders: [PH_DISTRITO],
    },
    {
      nome: 'Média de KM por Registro',
      label: 'KM Médio/Registro',
      formula: 'AVG(KM_PLACEHOLDER)',
      agregacao: 'avg',
      formato: 'numero',
      unidade: 'km',
      categoria: 'Operacional',
      cor: '#06b6d4',
      descricao: 'Média de KM rodados por registro de poda',
      metaSugerida: null,
      tipoServico: TipoServico.PODA,
      placeholders: [PH_KM],
    },
    {
      nome: 'Peso Médio por Registro',
      label: 'Peso Médio',
      formula: 'AVG(PESO_PLACEHOLDER)',
      agregacao: 'avg',
      formato: 'numero',
      unidade: 'kg',
      categoria: 'Operacional',
      cor: '#22c55e',
      descricao: 'Média de peso por registro (se aplicável)',
      metaSugerida: null,
      tipoServico: TipoServico.PODA,
      placeholders: [PH_PESO],
    },
  ];

  // ════════════════════════════════════════════════════════════════
  // NOVOS KPIs — REMOCAO
  // ════════════════════════════════════════════════════════════════

  const novosKpisRemocao: Partial<KpiUniversal>[] = [
    {
      nome: 'Peso Total Removido',
      label: 'Peso Total Removido',
      formula: 'SUM(PESO_PLACEHOLDER) / 1000',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'ton',
      categoria: 'Operacional',
      cor: '#f43f5e',
      descricao: 'Peso total removido em toneladas',
      metaSugerida: null,
      tipoServico: TipoServico.REMOCAO,
      placeholders: [PH_PESO],
    },
    {
      nome: 'KM Total Remoção',
      label: 'KM Rodados',
      formula: 'SUM(KM_PLACEHOLDER)',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'km',
      categoria: 'Operacional',
      cor: '#f97316',
      descricao: 'Total de KM rodados nas remoções',
      metaSugerida: null,
      tipoServico: TipoServico.REMOCAO,
      placeholders: [PH_KM],
    },
    {
      nome: 'Distritos Atendidos (Remoção)',
      label: 'Distritos',
      formula: 'COUNT(DISTINCT DISTRITO_PLACEHOLDER)',
      agregacao: 'count',
      formato: 'numero',
      unidade: 'distritos',
      categoria: 'Cobertura',
      cor: '#a855f7',
      descricao: 'Quantidade de distritos com remoções',
      metaSugerida: null,
      tipoServico: TipoServico.REMOCAO,
      placeholders: [PH_DISTRITO],
    },
  ];

  const PH_DATA_SAIDA: PlaceholderKpi = {
    nome: 'DATA_SAIDA',
    label: 'Coluna de Data',
    colunasCandidatas: ['DATA SAIDA', 'DATA', 'DATA DE SAIDA', 'DATA SAÍDA', 'DIA', 'DATA_BASE'],
  };

  // ════════════════════════════════════════════════════════════════
  // NOVOS KPIs — GERAL (disponível para todos os tipos)
  // ════════════════════════════════════════════════════════════════

  const novosKpisGerais: Partial<KpiUniversal>[] = [
    {
      nome: 'Média de Registros por Dia',
      label: 'Média Registros/Dia',
      formula: 'DIVIDE(COUNT(*), COUNT(DISTINCT DATA_SAIDA))',
      agregacao: 'count',
      formato: 'numero',
      unidade: 'reg/dia',
      categoria: 'Operacional',
      cor: '#6366f1',
      descricao: 'Média de registros por dia no período analisado',
      metaSugerida: null,
      tipoServico: TipoServico.GERAL,
      placeholders: [PH_DATA_SAIDA],
    },
    {
      nome: 'Dias com Atividades',
      label: 'Dias com Atividades',
      formula: 'COUNT(DISTINCT DATA_SAIDA)',
      agregacao: 'count',
      formato: 'numero',
      unidade: 'dias',
      categoria: 'Operacional',
      cor: '#8b5cf6',
      descricao: 'Quantidade de dias com registros no período',
      metaSugerida: null,
      tipoServico: TipoServico.GERAL,
      placeholders: [PH_DATA_SAIDA],
    },
  ];

  return [
    ...novosKpisColeta,
    ...novosKpisVarricao,
    ...novosKpisPoda,
    ...novosKpisRemocao,
    ...novosKpisGerais,
  ];
}

export async function seedKpisUniversaisExtra(): Promise<void> {
  const repo = AppDataSource.getRepository(KpiUniversal);
  const todosNovos = buildKpisUniversaisExtraNovos();

  const renomeacoes: Array<{ antigo: string; novo: string; patch?: Partial<KpiUniversal> }> = [
    {
      antigo: 'KM por Viagem Individual',
      novo: 'Horas nas Rotas (total)',
      patch: {
        label: 'Horas nas Rotas (total)',
        descricao: 'Soma das horas produtivas nas rotas 01–04 (colunas de hora da planilha padrão)',
      },
    },
    {
      antigo: 'Média de Horas Fora por Viagem',
      novo: 'Horas Produtivas por Viagem',
      patch: {
        label: 'Horas Produtivas por Viagem',
        descricao: 'Média de horas produtivas (base) por viagem (CONTADOR DE VIAGENS ou rotas 01–04)',
      },
    },
    { antigo: 'KM por Hora Fora', novo: 'KM por Hora Produtiva', patch: { label: 'KM por Hora Produtiva' } },
    { antigo: 'Toneladas por Hora Fora', novo: 'Toneladas por Hora Produtiva', patch: { label: 'Ton. por Hora Produtiva' } },
    {
      antigo: 'Variação entre Peso 1 e Peso 5',
      novo: 'Variação entre Peso 1 e Peso 4',
      patch: {
        label: 'Variação Peso1→Peso4',
        descricao: 'Diferença média entre PESO 1 e PESO 4 (última pesagem na planilha padrão)',
      },
    },
  ];

  for (const { antigo, novo, patch } of renomeacoes) {
    await renomearKpiSistema(repo, antigo, novo, TipoServico.COLETA_CAMINHAO, patch);
  }

  for (const nomeRemovido of KPIS_UNIVERSAIS_REMOVIDOS_COLETA) {
    const obsoletos = await repo.find({
      where: { nome: nomeRemovido, tipoServico: TipoServico.COLETA_CAMINHAO },
    });
    for (const obs of obsoletos) {
      await repo.remove(obs);
    }
  }

  let criados = 0;
  let atualizados = 0;
  for (const kpiData of todosNovos) {
    if (KPIS_UNIVERSAIS_REMOVIDOS_COLETA.includes(kpiData.nome as typeof KPIS_UNIVERSAIS_REMOVIDOS_COLETA[number])) {
      continue;
    }
    const resultado = await upsertKpiSistema(repo, kpiData);
    if (resultado === 'created') criados++;
    if (resultado === 'updated') atualizados++;
  }

  console.log(`[seedKpisUniversaisExtra] ✅ ${criados} novos, ${atualizados} atualizados.`);
}

// Executar diretamente (apenas quando chamado como script)
if (require.main === module) {
  (async function main() {
    try {
      console.log('📦 Conectando ao banco de dados...');
      await AppDataSource.initialize();
      console.log('✅ Conectado!');
      await seedKpisUniversaisExtra();
      await AppDataSource.destroy();
      console.log('🔒 Conexão encerrada. Seed concluído!');
      process.exit(0);
    } catch (err) {
      console.error('[seedKpisUniversaisExtra] Erro:', err);
      process.exit(1);
    }
  })();
}
