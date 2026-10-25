import AppDataSource from './data-source';
import { KpiUniversal, PlaceholderKpi } from '../entities/KpiUniversal';
import { TipoServico } from '../enums/TipoServico';
import { upsertKpiSistema } from './kpiUniversalSeedUtils';

/**
 * Seed da biblioteca de KPIs Universais.
 * Popula o banco com 15+ KPIs distribuídos em 3+ tipos de serviço.
 */
/** Catálogo canônico do seed principal (sem gravar no banco). */
export function buildKpisUniversaisPrincipais(): Partial<KpiUniversal>[] {
  // ─── Placeholders reutilizáveis ───

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

  const PH_HORA_CHEGADA: PlaceholderKpi = {
    nome: 'HORA_CHEGADA_PLACEHOLDER',
    label: 'Coluna de Hora Chegada',
    colunasCandidatas: ['HORA CHEGADA', 'HORACHEGADA', 'HORA_CHEGADA', 'HR CHEGA BASE', 'HORA CHEGADA BASE'],
  };

  const PH_VOLUME: PlaceholderKpi = {
    nome: 'VOLUME_PLACEHOLDER',
    label: 'Coluna de Volume',
    colunasCandidatas: ['VOLUME', 'VOLUME M3', 'VOLUME_M3', 'M3', 'METRO CUBICO'],
  };

  const PH_COLETOR_NUM: PlaceholderKpi = {
    nome: 'COLETOR_NUM_PLACEHOLDER',
    label: 'Nº de Coletores',
    colunasCandidatas: ['Nº DE COLETORES', 'NUMERO DE COLETORES', 'NÚMERO DE COLETORES', 'QTDE COLETORES', 'NRO COLETORES', 'QTD COLETORES'],
  };

  const PH_FUNCIONARIO: PlaceholderKpi = {
    nome: 'FUNCIONARIO_PLACEHOLDER',
    label: 'Coluna de Funcionário',
    colunasCandidatas: ['FUNCIONARIO', 'NOME', 'OPERADOR', 'MOTORISTA', 'EQUIPE', 'FUNCIONÁRIO'],
  };

  const PH_AREA: PlaceholderKpi = {
    nome: 'AREA_PLACEHOLDER',
    label: 'Coluna de Área',
    colunasCandidatas: ['AREA_ROCADA', 'AREA_CAPINADA', 'AREA', 'METRAGEM', 'M2'],
  };

  const PH_BAIRRO: PlaceholderKpi = {
    nome: 'BAIRRO_PLACEHOLDER',
    label: 'Coluna de Bairro/Local',
    colunasCandidatas: ['BAIRRO', 'LOCAL', 'REGIONAL', 'REGIAO', 'SETOR', 'ROTA', 'DESTINO'],
  };

  const PH_ARVORES: PlaceholderKpi = {
    nome: 'ARVORES_PLACEHOLDER',
    label: 'Coluna de Árvores Podadas',
    colunasCandidatas: ['ARVORES_PODADAS', 'QTDE ARVORES', 'ARVORES', 'Nº ARVORES', 'QUANTIDADE'],
  };

  const PH_COMPRIMENTO: PlaceholderKpi = {
    nome: 'COMPRIMENTO_PLACEHOLDER',
    label: 'Coluna de Comprimento',
    colunasCandidatas: ['COMPRIMENTO', 'COMPRIMENTO TOTAL', 'METRAGEM', 'EXTENSÃO'],
  };

  const PH_KM_VARRIDOS: PlaceholderKpi = {
    nome: 'KM_VARRIDOS_PLACEHOLDER',
    label: 'Coluna de KM Varridos',
    colunasCandidatas: ['QUILOMETROS_VARRIDOS', 'KM VARRIDOS', 'KM VARRIÇÃO', 'KM VARRICAO', 'KM Linear', 'KM LINEAR'],
  };

  const PH_METRO_LINEAR: PlaceholderKpi = {
    nome: 'METRO_LINEAR_PLACEHOLDER',
    label: 'Coluna de Metro Linear',
    colunasCandidatas: ['Metro Linear', 'METRO LINEAR', 'COMPRIMENTO', 'METRAGEM', 'KM Linear'],
  };

  // ════════════════ TIPO: COLETA_CAMINHAO ════════════════
  const coletaKpis: Partial<KpiUniversal>[] = [
    {
      nome: 'Tonelagem Total',
      label: 'Tonelagem Total',
      formula: 'SUM(PESO_PLACEHOLDER) / 1000',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'ton',
      categoria: 'Peso e Volume',
      cor: '#6366f1',
      descricao: 'Soma o peso de todas as coletas e converte para toneladas',
      metaSugerida: null,
      tipoServico: TipoServico.COLETA_CAMINHAO,
      placeholders: [PH_PESO],
    },
    {
      nome: 'Peso Médio por Coleta',
      label: 'Peso Médio por Coleta',
      formula: 'AVG(PESO_PLACEHOLDER) / 1000',
      agregacao: 'avg',
      formato: 'numero',
      unidade: 'ton',
      categoria: 'Peso e Volume',
      cor: '#8b5cf6',
      descricao: 'Média do peso por registro de coleta, convertido para toneladas',
      metaSugerida: null,
      tipoServico: TipoServico.COLETA_CAMINHAO,
      placeholders: [PH_PESO],
    },
    {
      nome: 'Volume Total Estimado',
      label: 'Volume Total Estimado',
      formula: 'SUM(VOLUME_PLACEHOLDER)',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'm³',
      categoria: 'Peso e Volume',
      cor: '#a78bfa',
      descricao: 'Opcional — planilha padrão não tem volume; calcula só se existir coluna VOLUME/M³',
      metaSugerida: null,
      tipoServico: TipoServico.COLETA_CAMINHAO,
      placeholders: [PH_VOLUME],
    },
    {
      nome: 'Viagens Totais',
      label: 'Viagens Totais',
      formula: 'VIAGENS_POR_ROTA()',
      agregacao: 'count',
      formato: 'numero',
      unidade: 'viagens',
      categoria: 'Produtividade',
      cor: '#f59e0b',
      descricao: 'Quantidade de viagens: CONTADOR DE VIAGENS da planilha (rotas feitas); se vazio, conta rotas 01–04',
      metaSugerida: null,
      tipoServico: TipoServico.COLETA_CAMINHAO,
      placeholders: [],
    },
    {
      nome: 'KM Total Rodado',
      label: 'KM Total Rodado',
      formula: 'SUM(KM_PLACEHOLDER)',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'km',
      categoria: 'Produtividade',
      cor: '#eab308',
      descricao: 'Soma da distância percorrida em todas as viagens',
      metaSugerida: null,
      tipoServico: TipoServico.COLETA_CAMINHAO,
      placeholders: [PH_KM],
    },
    {
      nome: 'KM Médio por Viagem',
      label: 'KM Médio por Viagem',
      formula: 'DIVIDE(SUM(KM_PLACEHOLDER), VIAGENS_POR_ROTA())',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'km',
      categoria: 'Produtividade',
      cor: '#facc15',
      descricao: 'Média de KM rodados por viagem',
      metaSugerida: null,
      tipoServico: TipoServico.COLETA_CAMINHAO,
      placeholders: [PH_KM],
    },
    {
      nome: 'Coletores Ativos',
      label: 'Coletores Ativos (Placas)',
      formula: 'COUNT(DISTINCT PLACA_PLACEHOLDER)',
      agregacao: 'count',
      formato: 'numero',
      unidade: 'veículos',
      categoria: 'Frota',
      cor: '#06b6d4',
      descricao: 'Quantidade de placas/veículos únicos (coluna PLACA)',
      metaSugerida: null,
      tipoServico: TipoServico.COLETA_CAMINHAO,
      placeholders: [PH_PLACA],
    },
    {
      nome: 'Coletas por Coletor',
      label: 'Viagens por Veículo',
      formula: 'DIVIDE(VIAGENS_POR_ROTA(), COUNT(DISTINCT PLACA_PLACEHOLDER))',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'viagens/veículo',
      categoria: 'Frota',
      cor: '#0891b2',
      descricao: 'Viagens (CONTADOR DE VIAGENS ou rotas 01–04) dividido pelo número de placas únicas',
      metaSugerida: null,
      tipoServico: TipoServico.COLETA_CAMINHAO,
      placeholders: [PH_PLACA],
    },
    {
      nome: 'Faturamento Estimado',
      label: 'Faturamento Estimado',
      formula: 'FATURAMENTO_EST(PESO_PLACEHOLDER, TIPO_PLACEHOLDER)',
      agregacao: 'sum',
      formato: 'moeda',
      unidade: 'R$',
      categoria: 'Financeiro',
      cor: '#10b981',
      descricao: 'Faturamento estimado com base no peso e tipo de caminhão (usa valores do contrato)',
      metaSugerida: null,
      tipoServico: TipoServico.COLETA_CAMINHAO,
      placeholders: [PH_PESO, PH_TIPO],
    },
    {
      nome: 'Ticket Médio',
      label: 'Ticket Médio',
      formula: 'DIVIDE(FATURAMENTO_EST(PESO_PLACEHOLDER, TIPO_PLACEHOLDER), VIAGENS_POR_ROTA())',
      agregacao: 'sum',
      formato: 'moeda',
      unidade: 'R$',
      categoria: 'Financeiro',
      cor: '#34d399',
      descricao: 'Valor médio por viagem/coleta',
      metaSugerida: null,
      tipoServico: TipoServico.COLETA_CAMINHAO,
      placeholders: [PH_PESO, PH_TIPO],
    },
    {
      nome: 'Tonelada por KM',
      label: 'Ton. por KM',
      formula: 'DIVIDE(SUM(PESO_PLACEHOLDER) / 1000, SUM(KM_PLACEHOLDER))',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'ton/km',
      categoria: 'Eficiência',
      cor: '#f97316',
      descricao: 'Relação entre tonelagem total e KM total rodado',
      metaSugerida: 0.05,
      tipoServico: TipoServico.COLETA_CAMINHAO,
      placeholders: [PH_PESO, PH_KM],
    },
    {
      nome: 'Índice de Variação',
      label: 'Índice de Variação',
      formula: 'SUBTRACT(MAX(PESO_PLACEHOLDER), MIN(PESO_PLACEHOLDER))',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'kg',
      categoria: 'Eficiência',
      cor: '#ef4444',
      descricao: 'Diferença entre o peso máximo e mínimo das coletas',
      metaSugerida: null,
      tipoServico: TipoServico.COLETA_CAMINHAO,
      placeholders: [PH_PESO],
    },
    {
      nome: 'Produtividade por Coletor',
      label: 'Média Ton/Coletor por Viagem',
      formula: 'MEDIA_TON_POR_COLETOR()',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 't/coletor/viagem',
      categoria: 'Frota',
      cor: '#0ea5e9',
      descricao: 'Média de toneladas por coletor em cada viagem (PESO TOTAL ÷ Nº DE COLETORES)',
      metaSugerida: null,
      tipoServico: TipoServico.COLETA_CAMINHAO,
      placeholders: [PH_PESO],
    },
  ];

  // ════════════════ TIPO: VARRICAO ════════════════
  const varricaoKpis: Partial<KpiUniversal>[] = [
    {
      nome: 'KM Varridos Total',
      label: 'KM Varridos Total',
      formula: 'SUM(KM_VARRIDOS_PLACEHOLDER)',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'km',
      categoria: 'Produtividade',
      cor: '#14b8a6',
      descricao: 'Total de quilômetros varridos no período',
      metaSugerida: null,
      tipoServico: TipoServico.VARRICAO,
      placeholders: [PH_KM_VARRIDOS],
    },
    {
      nome: 'Funcionários Ativos',
      label: 'Funcionários Ativos',
      formula: 'COUNT(DISTINCT FUNCIONARIO_PLACEHOLDER)',
      agregacao: 'count',
      formato: 'numero',
      unidade: 'func.',
      categoria: 'Equipe',
      cor: '#0d9488',
      descricao: 'Número de funcionários únicos que realizaram varrição',
      metaSugerida: null,
      tipoServico: TipoServico.VARRICAO,
      placeholders: [PH_FUNCIONARIO],
    },
    {
      nome: 'KM Médio por Funcionário',
      label: 'KM Médio por Func.',
      formula: 'DIVIDE(SUM(KM_VARRIDOS_PLACEHOLDER), COUNT(DISTINCT FUNCIONARIO_PLACEHOLDER))',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'km/func.',
      categoria: 'Produtividade',
      cor: '#2dd4bf',
      descricao: 'Média de KM varridos por funcionário',
      metaSugerida: null,
      tipoServico: TipoServico.VARRICAO,
      placeholders: [PH_KM_VARRIDOS, PH_FUNCIONARIO],
    },
  ];

  // ════════════════ TIPO: PODA ════════════════
  const podaKpis: Partial<KpiUniversal>[] = [
    {
      nome: 'Árvores Podadas Total',
      label: 'Árvores Podadas',
      formula: 'SUM(ARVORES_PLACEHOLDER)',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'árvores',
      categoria: 'Produtividade',
      cor: '#22c55e',
      descricao: 'Total de árvores podadas no período',
      metaSugerida: null,
      tipoServico: TipoServico.PODA,
      placeholders: [PH_ARVORES],
    },
    {
      nome: 'Equipes Ativas',
      label: 'Equipes Ativas',
      formula: 'COUNT(DISTINCT FUNCIONARIO_PLACEHOLDER)',
      agregacao: 'count',
      formato: 'numero',
      unidade: 'equipes',
      categoria: 'Equipe',
      cor: '#16a34a',
      descricao: 'Número de equipes/funcionários únicos',
      metaSugerida: null,
      tipoServico: TipoServico.PODA,
      placeholders: [PH_FUNCIONARIO],
    },
    {
      nome: 'Média por Equipe',
      label: 'Árvores por Equipe',
      formula: 'DIVIDE(SUM(ARVORES_PLACEHOLDER), COUNT(DISTINCT FUNCIONARIO_PLACEHOLDER))',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'árv./equipe',
      categoria: 'Produtividade',
      cor: '#4ade80',
      descricao: 'Média de árvores podadas por equipe',
      metaSugerida: null,
      tipoServico: TipoServico.PODA,
      placeholders: [PH_ARVORES, PH_FUNCIONARIO],
    },
    {
      nome: 'Horas Produtivas',
      label: 'Horas Produtivas',
      formula: 'SUM(HORA_PLACEHOLDER)',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'h',
      categoria: 'Produtividade',
      cor: '#06b6d4',
      descricao: 'Total de horas trabalhadas nas atividades de poda',
      metaSugerida: null,
      tipoServico: TipoServico.PODA,
      placeholders: [PH_HORA],
    },
    {
      nome: 'Produtividade por Hora',
      label: 'Árv./Hora',
      formula: 'DIVIDE(SUM(ARVORES_PLACEHOLDER), SUM(HORA_PLACEHOLDER))',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'árv./h',
      categoria: 'Eficiência',
      cor: '#22c55e',
      descricao: 'Média de árvores podadas por hora trabalhada',
      metaSugerida: null,
      tipoServico: TipoServico.PODA,
      placeholders: [PH_ARVORES, PH_HORA],
    },
    {
      nome: 'KM Total Rodado',
      label: 'KM Rodado',
      formula: 'SUM(KM_PLACEHOLDER)',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'km',
      categoria: 'Produtividade',
      cor: '#f59e0b',
      descricao: 'Total de quilômetros rodados nas atividades de poda',
      metaSugerida: null,
      tipoServico: TipoServico.PODA,
      placeholders: [PH_KM],
    },
    {
      nome: 'Bairros Atendidos',
      label: 'Bairros Atendidos',
      formula: 'COUNT(DISTINCT BAIRRO_PLACEHOLDER)',
      agregacao: 'count',
      formato: 'numero',
      unidade: 'bairros',
      categoria: 'Cobertura',
      cor: '#a855f7',
      descricao: 'Quantidade de bairros/locais distintos onde houve poda',
      metaSugerida: null,
      tipoServico: TipoServico.PODA,
      placeholders: [PH_BAIRRO],
    },
    {
      nome: 'Média Horas por Equipe',
      label: 'Horas/Equipe',
      formula: 'DIVIDE(SUM(HORA_PLACEHOLDER), COUNT(DISTINCT FUNCIONARIO_PLACEHOLDER))',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'h/equipe',
      categoria: 'Equipe',
      cor: '#0ea5e9',
      descricao: 'Média de horas trabalhadas por equipe nas atividades de poda',
      metaSugerida: null,
      tipoServico: TipoServico.PODA,
      placeholders: [PH_HORA, PH_FUNCIONARIO],
    },
    {
      nome: 'KM por Árvore',
      label: 'KM/Árv.',
      formula: 'DIVIDE(SUM(KM_PLACEHOLDER), SUM(ARVORES_PLACEHOLDER))',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'km/árv.',
      categoria: 'Eficiência',
      cor: '#f97316',
      descricao: 'Relação de KM rodado por árvore podada (eficiência logística)',
      metaSugerida: null,
      tipoServico: TipoServico.PODA,
      placeholders: [PH_KM, PH_ARVORES],
    },
    {
      nome: 'Média Árvores por Bairro',
      label: 'Árv./Bairro',
      formula: 'DIVIDE(SUM(ARVORES_PLACEHOLDER), COUNT(DISTINCT BAIRRO_PLACEHOLDER))',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'árv./bairro',
      categoria: 'Cobertura',
      cor: '#d946ef',
      descricao: 'Média de árvores podadas por bairro atendido',
      metaSugerida: null,
      tipoServico: TipoServico.PODA,
      placeholders: [PH_ARVORES, PH_BAIRRO],
    },
    {
      nome: 'Registros de Poda',
      label: 'Registros',
      formula: 'COUNT(*)',
      agregacao: 'count',
      formato: 'numero',
      unidade: 'registros',
      categoria: 'Geral',
      cor: '#64748b',
      descricao: 'Total de registros de atividades de poda',
      metaSugerida: null,
      tipoServico: TipoServico.PODA,
      placeholders: [],
    },
  ];

  // ════════════════ TIPO: ROCADEIRA ════════════════
  const rocadeiraKpis: Partial<KpiUniversal>[] = [
    {
      nome: 'Área Roçada Total',
      label: 'Área Roçada',
      formula: 'SUM(AREA_PLACEHOLDER)',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'm²',
      categoria: 'Produtividade',
      cor: '#84cc16',
      descricao: 'Total de área roçada em metros quadrados',
      metaSugerida: null,
      tipoServico: TipoServico.ROCADEIRA,
      placeholders: [PH_AREA],
    },
    {
      nome: 'Horas Produtivas',
      label: 'Horas Produtivas',
      formula: 'SUM(HORA_PLACEHOLDER)',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'h',
      categoria: 'Produtividade',
      cor: '#65a30d',
      descricao: 'Total de horas produtivas registradas',
      metaSugerida: null,
      tipoServico: TipoServico.ROCADEIRA,
      placeholders: [PH_HORA],
    },
  ];

  // ════════════════ TIPO: PINTURA_MEIO_FIO ════════════════
  const pinturaKpis: Partial<KpiUniversal>[] = [
    {
      nome: 'Comprimento Total Pintado',
      label: 'Comprimento Pintado',
      formula: 'SUM(COMPRIMENTO_PLACEHOLDER)',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'm',
      categoria: 'Produtividade',
      cor: '#ec4899',
      descricao: 'Total de comprimento de meio-fio pintado em metros',
      metaSugerida: null,
      tipoServico: TipoServico.PINTURA_MEIO_FIO,
      placeholders: [PH_COMPRIMENTO],
    },
  ];

  // ════════════════ TIPO: CAPINA ════════════════
  const capinaKpis: Partial<KpiUniversal>[] = [
    {
      nome: 'Metro Linear Capinado',
      label: 'Metro Linear Capinado',
      formula: 'SUM(METRO_LINEAR_PLACEHOLDER)',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'm',
      categoria: 'Produtividade',
      cor: '#a3e635',
      descricao: 'Total de metro linear capinado conforme coluna da planilha padrão',
      metaSugerida: null,
      tipoServico: TipoServico.CAPINA,
      placeholders: [PH_METRO_LINEAR],
    },
  ];

  // ════════════════ TIPO: REMOCAO ════════════════
  const remocaoKpis: Partial<KpiUniversal>[] = [
    {
      nome: 'Remoções Total',
      label: 'Remoções Realizadas',
      formula: 'COUNT(*)',
      agregacao: 'count',
      formato: 'numero',
      unidade: 'remoções',
      categoria: 'Produtividade',
      cor: '#f43f5e',
      descricao: 'Número total de remoções realizadas',
      metaSugerida: null,
      tipoServico: TipoServico.REMOCAO,
      placeholders: [],
    },
  ];

  // ════════════════ TIPO: GERAL ════════════════
  const geralKpis: Partial<KpiUniversal>[] = [
    {
      nome: 'Registros Total',
      label: 'Total de Registros',
      formula: 'COUNT(*)',
      agregacao: 'count',
      formato: 'numero',
      unidade: 'registros',
      categoria: 'Geral',
      cor: '#64748b',
      descricao: 'Contagem total de registros carregados',
      metaSugerida: null,
      tipoServico: TipoServico.GERAL,
      placeholders: [],
    },
  ];

  return [
    ...coletaKpis,
    ...varricaoKpis,
    ...podaKpis,
    ...rocadeiraKpis,
    ...pinturaKpis,
    ...capinaKpis,
    ...remocaoKpis,
    ...geralKpis,
  ];
}

export async function seedKpisUniversais(): Promise<void> {
  const repo = AppDataSource.getRepository(KpiUniversal);
  const todosKpis = buildKpisUniversaisPrincipais();
  let criados = 0;
  let atualizados = 0;

  // Migração: capina passou de área (m²) para metro linear
  const capinaAreaLegado = await repo.findOne({
    where: { nome: 'Área Capinada Total', tipoServico: TipoServico.CAPINA },
  });
  if (capinaAreaLegado && !capinaAreaLegado.isPersonalizado) {
    await repo.remove(capinaAreaLegado);
  }

  for (const kpiData of todosKpis) {
    const resultado = await upsertKpiSistema(repo, kpiData);
    if (resultado === 'created') criados++;
    if (resultado === 'updated') atualizados++;
  }

  const total = await repo.count();
  console.log(`[seedKpisUniversais] ✅ ${criados} novos, ${atualizados} atualizados (${total} na biblioteca).`);
}
