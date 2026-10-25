import 'reflect-metadata';
import AppDataSource from './data-source';
import { KpiUniversal, PlaceholderKpi } from '../entities/KpiUniversal';
import { TipoServico } from '../enums/TipoServico';

/**
 * Seed de KPIs Universais baseados nas planilhas modelo.
 * Adiciona KPIs com placeholders ajustados para as colunas
 * exatas de cada planilha padrão.
 *
 * Executar: npx ts-node src/database/seed_kpis_modelos.ts
 */
export async function seedKpisModelos(): Promise<void> {
  const repo = AppDataSource.getRepository(KpiUniversal);

  // ════════════════════════════════════════════
  // PLACEHOLDERS — ajustados para as planilhas modelo
  // ════════════════════════════════════════════

  // ─── Varrição ───
  const PH_KM_LINEAR: PlaceholderKpi = {
    nome: 'KM_LINEAR_PLACEHOLDER',
    label: 'Coluna de KM Linear (Varrição)',
    colunasCandidatas: ['KM Linear', 'KM_LINEAR', 'KM LINEAR', 'QUILOMETROS_VARRIDOS', 'KM VARRIDOS', 'KM VAR'],
  };

  const PH_EQUIPE: PlaceholderKpi = {
    nome: 'EQUIPE_PLACEHOLDER',
    label: 'Coluna de Equipe',
    colunasCandidatas: ['Equipe', 'EQUIPE', 'FUNCIONARIO', 'FUNCIONÁRIO', 'NOME', 'OPERADOR', 'MOTORISTA'],
  };

  // ─── Roçada ───
  const PH_AREA_M2: PlaceholderKpi = {
    nome: 'AREA_M2_PLACEHOLDER',
    label: 'Coluna de Área m²',
    colunasCandidatas: ['Area m²', 'AREA M2', 'AREA M²', 'AREA', 'AREA_ROCADA', 'AREA_CAPINADA', 'METRAGEM', 'M2'],
  };

  const PH_EQUIPAMENTO: PlaceholderKpi = {
    nome: 'EQUIPAMENTO_PLACEHOLDER',
    label: 'Coluna de Equipamento',
    colunasCandidatas: ['Equipamento', 'EQUIPAMENTO', 'TRATOR', 'MAQUINA', 'VEICULO', 'COLETOR'],
  };

  const PH_OPERADOR: PlaceholderKpi = {
    nome: 'OPERADOR_PLACEHOLDER',
    label: 'Coluna de Operador',
    colunasCandidatas: ['Operador', 'OPERADOR', 'FUNCIONARIO', 'FUNCIONÁRIO', 'NOME', 'MOTORISTA'],
  };

  // ─── Poda ───
  const PH_QTD_ARVORE: PlaceholderKpi = {
    nome: 'QTD_ARVORE_PLACEHOLDER',
    label: 'Coluna de Quantidade de Árvores',
    colunasCandidatas: ['Quantidade de Arvore', 'QUANTIDADE DE ARVORE', 'QUANTIDADE ARVORE', 'ARVORES_PODADAS', 'QTDE ARVORES', 'ARVORES', 'Nº ARVORES', 'QUANTIDADE'],
  };

  const PH_AVENIDA_RUA: PlaceholderKpi = {
    nome: 'AVENIDA_RUA_PLACEHOLDER',
    label: 'Coluna de Logradouro',
    colunasCandidatas: ['Avenida / Rua', 'AVENIDA/RUA', 'AVENIDA RUA', 'RUA', 'AVENIDA', 'LOGRADOURO', 'ENDERECO'],
  };

  const PH_TIPO_SERVICO: PlaceholderKpi = {
    nome: 'TIPO_SERVICO_PLACEHOLDER',
    label: 'Coluna de Tipo de Serviço',
    colunasCandidatas: ['Tipo de serviço', 'TIPO DE SERVICO', 'TIPO SERVICO', 'TIPO_SERVICO', 'SERVICO', 'DESCRICAO'],
  };

  const PH_SETOR: PlaceholderKpi = {
    nome: 'SETOR_PLACEHOLDER',
    label: 'Coluna de Setor/Bairro',
    colunasCandidatas: ['Setor', 'SETOR', 'BAIRRO', 'LOCAL', 'DISTRITO', 'REGIAO', 'REGIONAL'],
  };

  // ─── Remoção ───
  const PH_DESCRICAO_SERVICO: PlaceholderKpi = {
    nome: 'DESCRICAO_SERVICO_PLACEHOLDER',
    label: 'Coluna de Descrição do Serviço',
    colunasCandidatas: ['Descrição do serviço', 'DESCRICAO DO SERVICO', 'DESCRICAO SERVICO', 'DESCRIÇÃO DO SERVIÇO', 'DESCRICAO', 'TIPO SERVICO'],
  };

  // ════════════════════════════════════════════
  // NOVOS KPIs — VARRICAO
  // ════════════════════════════════════════════

  const kpisVarricao: Partial<KpiUniversal>[] = [
    {
      nome: 'Total KM Linear',
      label: 'Total KM Linear',
      formula: 'SUM(KM_LINEAR_PLACEHOLDER)',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'km',
      categoria: 'Produtividade',
      cor: '#06b6d4',
      descricao: 'Total de quilômetros lineares varridos no período',
      metaSugerida: null,
      tipoServico: TipoServico.VARRICAO,
      placeholders: [PH_KM_LINEAR],
    },
    {
      nome: 'KM Linear por Equipe',
      label: 'KM Linear/Equipe',
      formula: 'DIVIDE(SUM(KM_LINEAR_PLACEHOLDER), COUNT(DISTINCT EQUIPE_PLACEHOLDER))',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'km/equipe',
      categoria: 'Produtividade',
      cor: '#22d3ee',
      descricao: 'Média de KM linear varrido por equipe de varrição',
      metaSugerida: null,
      tipoServico: TipoServico.VARRICAO,
      placeholders: [PH_KM_LINEAR, PH_EQUIPE],
    },
    {
      nome: 'Equipes de Varrição Ativas',
      label: 'Equipes Ativas',
      formula: 'COUNT(DISTINCT EQUIPE_PLACEHOLDER)',
      agregacao: 'count',
      formato: 'numero',
      unidade: 'equipes',
      categoria: 'Equipe',
      cor: '#67e8f9',
      descricao: 'Quantidade de equipes únicas que realizaram varrição',
      metaSugerida: null,
      tipoServico: TipoServico.VARRICAO,
      placeholders: [PH_EQUIPE],
    },
    {
      nome: 'KM Linear por Bairro',
      label: 'KM Linear/Bairro',
      formula: 'DIVIDE(SUM(KM_LINEAR_PLACEHOLDER), COUNT(DISTINCT BAIRRO))',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'km/bairro',
      categoria: 'Cobertura',
      cor: '#a5f3fc',
      descricao: 'Média de KM linear varrido por bairro atendido',
      metaSugerida: null,
      tipoServico: TipoServico.VARRICAO,
      placeholders: [PH_KM_LINEAR],
    },
    {
      nome: 'Média KM Linear por Dia',
      label: 'Média KM/Dia',
      formula: 'DIVIDE(SUM(KM_LINEAR_PLACEHOLDER), COUNT(DISTINCT DATA))',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'km/dia',
      categoria: 'Produtividade',
      cor: '#cffafe',
      descricao: 'Média de KM linear varrido por dia de trabalho',
      metaSugerida: null,
      tipoServico: TipoServico.VARRICAO,
      placeholders: [PH_KM_LINEAR],
    },
  ];

  // ════════════════════════════════════════════
  // NOVOS KPIs — ROCADEIRA (Roçada)
  // ════════════════════════════════════════════

  const kpisRocadeira: Partial<KpiUniversal>[] = [
    {
      nome: 'Total Área Roçada',
      label: 'Área Roçada (m²)',
      formula: 'SUM(AREA_M2_PLACEHOLDER)',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'm²',
      categoria: 'Produtividade',
      cor: '#22c55e',
      descricao: 'Total de área roçada em metros quadrados',
      metaSugerida: null,
      tipoServico: TipoServico.ROCADEIRA,
      placeholders: [PH_AREA_M2],
    },
    {
      nome: 'M² por Equipe (Roçada)',
      label: 'M² por Equipe',
      formula: 'DIVIDE(SUM(AREA_M2_PLACEHOLDER), COUNT(DISTINCT EQUIPE_PLACEHOLDER))',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'm²/equipe',
      categoria: 'Produtividade',
      cor: '#16a34a',
      descricao: 'Média de m² roçados por equipe',
      metaSugerida: null,
      tipoServico: TipoServico.ROCADEIRA,
      placeholders: [PH_AREA_M2, PH_EQUIPE],
    },
    {
      nome: 'M² por Operador',
      label: 'M² por Operador',
      formula: 'DIVIDE(SUM(AREA_M2_PLACEHOLDER), COUNT(DISTINCT OPERADOR_PLACEHOLDER))',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'm²/operador',
      categoria: 'Produtividade',
      cor: '#15803d',
      descricao: 'Média de m² roçados por operador',
      metaSugerida: null,
      tipoServico: TipoServico.ROCADEIRA,
      placeholders: [PH_AREA_M2, PH_OPERADOR],
    },
    {
      nome: 'Operadores Ativos (Roçada)',
      label: 'Operadores Ativos',
      formula: 'COUNT(DISTINCT OPERADOR_PLACEHOLDER)',
      agregacao: 'count',
      formato: 'numero',
      unidade: 'operadores',
      categoria: 'Equipe',
      cor: '#4ade80',
      descricao: 'Quantidade de operadores únicos que realizaram roçagem',
      metaSugerida: null,
      tipoServico: TipoServico.ROCADEIRA,
      placeholders: [PH_OPERADOR],
    },
    {
      nome: 'Equipes de Roçada Ativas',
      label: 'Equipes Ativas',
      formula: 'COUNT(DISTINCT EQUIPE_PLACEHOLDER)',
      agregacao: 'count',
      formato: 'numero',
      unidade: 'equipes',
      categoria: 'Equipe',
      cor: '#86efac',
      descricao: 'Quantidade de equipes únicas em operação de roçagem',
      metaSugerida: null,
      tipoServico: TipoServico.ROCADEIRA,
      placeholders: [PH_EQUIPE],
    },
    {
      nome: 'M² por Equipamento',
      label: 'M² por Equipamento',
      formula: 'DIVIDE(SUM(AREA_M2_PLACEHOLDER), COUNT(DISTINCT EQUIPAMENTO_PLACEHOLDER))',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'm²/equip.',
      categoria: 'Produtividade',
      cor: '#bbf7d0',
      descricao: 'Média de m² roçados por tipo de equipamento',
      metaSugerida: null,
      tipoServico: TipoServico.ROCADEIRA,
      placeholders: [PH_AREA_M2, PH_EQUIPAMENTO],
    },
    {
      nome: 'Equipamentos Utilizados',
      label: 'Equipamentos Utilizados',
      formula: 'COUNT(DISTINCT EQUIPAMENTO_PLACEHOLDER)',
      agregacao: 'count',
      formato: 'numero',
      unidade: 'equip.',
      categoria: 'Equipe',
      cor: '#dcfce7',
      descricao: 'Quantidade de equipamentos distintos utilizados na roçagem',
      metaSugerida: null,
      tipoServico: TipoServico.ROCADEIRA,
      placeholders: [PH_EQUIPAMENTO],
    },
  ];

  // ════════════════════════════════════════════
  // NOVOS KPIs — PODA
  // ════════════════════════════════════════════

  const kpisPoda: Partial<KpiUniversal>[] = [
    {
      nome: 'Total Árvores Atendidas',
      label: 'Árvores Atendidas',
      formula: 'SUM(QTD_ARVORE_PLACEHOLDER)',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'árvores',
      categoria: 'Produtividade',
      cor: '#8b5cf6',
      descricao: 'Total de árvores podadas ou extirpadas no período',
      metaSugerida: null,
      tipoServico: TipoServico.PODA,
      placeholders: [PH_QTD_ARVORE],
    },
    {
      nome: 'Árvores por Setor',
      label: 'Árvores/Setor',
      formula: 'DIVIDE(SUM(QTD_ARVORE_PLACEHOLDER), COUNT(DISTINCT SETOR_PLACEHOLDER))',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'árv./setor',
      categoria: 'Cobertura',
      cor: '#a78bfa',
      descricao: 'Média de árvores atendidas por setor',
      metaSugerida: null,
      tipoServico: TipoServico.PODA,
      placeholders: [PH_QTD_ARVORE, PH_SETOR],
    },
    {
      nome: 'Árvores por Equipe (Poda)',
      label: 'Árvores/Equipe',
      formula: 'DIVIDE(SUM(QTD_ARVORE_PLACEHOLDER), COUNT(DISTINCT EQUIPE_PLACEHOLDER))',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'árv./equipe',
      categoria: 'Produtividade',
      cor: '#c4b5fd',
      descricao: 'Média de árvores atendidas por equipe de poda',
      metaSugerida: null,
      tipoServico: TipoServico.PODA,
      placeholders: [PH_QTD_ARVORE, PH_EQUIPE],
    },
    {
      nome: 'Setores com Poda',
      label: 'Setores Atendidos',
      formula: 'COUNT(DISTINCT SETOR_PLACEHOLDER)',
      agregacao: 'count',
      formato: 'numero',
      unidade: 'setores',
      categoria: 'Cobertura',
      cor: '#ddd6fe',
      descricao: 'Quantidade de setores distintos que receberam poda',
      metaSugerida: null,
      tipoServico: TipoServico.PODA,
      placeholders: [PH_SETOR],
    },
    {
      nome: 'Equipes de Poda Ativas',
      label: 'Equipes Ativas',
      formula: 'COUNT(DISTINCT EQUIPE_PLACEHOLDER)',
      agregacao: 'count',
      formato: 'numero',
      unidade: 'equipes',
      categoria: 'Equipe',
      cor: '#ede9fe',
      descricao: 'Quantidade de equipes únicas em operação de poda',
      metaSugerida: null,
      tipoServico: TipoServico.PODA,
      placeholders: [PH_EQUIPE],
    },
    {
      nome: 'Árvores por Tipo de Serviço',
      label: 'Árv./Tipo Serv.',
      formula: 'DIVIDE(SUM(QTD_ARVORE_PLACEHOLDER), COUNT(DISTINCT TIPO_SERVICO_PLACEHOLDER))',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'árv./tipo',
      categoria: 'Analítico',
      cor: '#f5f3ff',
      descricao: 'Média de árvores por tipo de serviço (Poda vs Extirpação)',
      metaSugerida: null,
      tipoServico: TipoServico.PODA,
      placeholders: [PH_QTD_ARVORE, PH_TIPO_SERVICO],
    },
    {
      nome: 'Tipos de Serviço (Poda)',
      label: 'Tipos de Serviço',
      formula: 'COUNT(DISTINCT TIPO_SERVICO_PLACEHOLDER)',
      agregacao: 'count',
      formato: 'numero',
      unidade: 'tipos',
      categoria: 'Analítico',
      cor: '#faf5ff',
      descricao: 'Quantidade de tipos de serviço distintos (poda, extirpação, etc.)',
      metaSugerida: null,
      tipoServico: TipoServico.PODA,
      placeholders: [PH_TIPO_SERVICO],
    },
    {
      nome: 'Árvores por Dia (Poda)',
      label: 'Árv./Dia',
      formula: 'DIVIDE(SUM(QTD_ARVORE_PLACEHOLDER), COUNT(DISTINCT DIA))',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'árv./dia',
      categoria: 'Produtividade',
      cor: '#e9d5ff',
      descricao: 'Média de árvores atendidas por dia de trabalho',
      metaSugerida: null,
      tipoServico: TipoServico.PODA,
      placeholders: [PH_QTD_ARVORE],
    },
  ];

  // ════════════════════════════════════════════
  // NOVOS KPIs — REMOCAO
  // ════════════════════════════════════════════

  const kpisRemocao: Partial<KpiUniversal>[] = [
    {
      nome: 'Total Remoções Realizadas',
      label: 'Remoções',
      formula: 'COUNT(*)',
      agregacao: 'count',
      formato: 'numero',
      unidade: 'remoções',
      categoria: 'Produtividade',
      cor: '#ef4444',
      descricao: 'Número total de remoções realizadas',
      metaSugerida: null,
      tipoServico: TipoServico.REMOCAO,
      placeholders: [],
    },
    {
      nome: 'Peso Total Removido (kg)',
      label: 'Peso Total (kg)',
      formula: 'SUM(Peso)',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'kg',
      categoria: 'Operacional',
      cor: '#f87171',
      descricao: 'Peso total removido em quilogramas',
      metaSugerida: null,
      tipoServico: TipoServico.REMOCAO,
      placeholders: [],
    },
    {
      nome: 'Peso por Remoção (kg)',
      label: 'Peso/Remoção',
      formula: 'DIVIDE(SUM(Peso), COUNT(*))',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'kg/rem.',
      categoria: 'Operacional',
      cor: '#fca5a5',
      descricao: 'Peso médio removido por serviço/viagem',
      metaSugerida: null,
      tipoServico: TipoServico.REMOCAO,
      placeholders: [],
    },
    {
      nome: 'Remoções por Setor',
      label: 'Rem./Setor',
      formula: 'DIVIDE(COUNT(*), COUNT(DISTINCT SETOR_PLACEHOLDER))',
      agregacao: 'count',
      formato: 'numero',
      unidade: 'rem./setor',
      categoria: 'Cobertura',
      cor: '#fecaca',
      descricao: 'Média de remoções por setor atendido',
      metaSugerida: null,
      tipoServico: TipoServico.REMOCAO,
      placeholders: [PH_SETOR],
    },
    {
      nome: 'Setores com Remoção',
      label: 'Setores Atendidos',
      formula: 'COUNT(DISTINCT SETOR_PLACEHOLDER)',
      agregacao: 'count',
      formato: 'numero',
      unidade: 'setores',
      categoria: 'Cobertura',
      cor: '#fee2e2',
      descricao: 'Quantidade de setores distintos que receberam remoção',
      metaSugerida: null,
      tipoServico: TipoServico.REMOCAO,
      placeholders: [PH_SETOR],
    },
    {
      nome: 'Veículos em Remoção',
      label: 'Veículos Utilizados',
      formula: 'COUNT(DISTINCT Placa)',
      agregacao: 'count',
      formato: 'numero',
      unidade: 'veículos',
      categoria: 'Frota',
      cor: '#fef2f2',
      descricao: 'Quantidade de veículos/equipamentos utilizados nas remoções',
      metaSugerida: null,
      tipoServico: TipoServico.REMOCAO,
      placeholders: [],
    },
    {
      nome: 'Peso por Veículo',
      label: 'Peso/Veículo',
      formula: 'DIVIDE(SUM(Peso), COUNT(DISTINCT Placa))',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'kg/veic.',
      categoria: 'Frota',
      cor: '#ffcaca',
      descricao: 'Média de peso removido por veículo utilizado',
      metaSugerida: null,
      tipoServico: TipoServico.REMOCAO,
      placeholders: [],
    },
    {
      nome: 'Tipos de Serviço (Remoção)',
      label: 'Tipos de Serviço',
      formula: 'COUNT(DISTINCT DESCRICAO_SERVICO_PLACEHOLDER)',
      agregacao: 'count',
      formato: 'numero',
      unidade: 'tipos',
      categoria: 'Analítico',
      cor: '#fecdd3',
      descricao: 'Quantidade de tipos de serviço distintos nas remoções',
      metaSugerida: null,
      tipoServico: TipoServico.REMOCAO,
      placeholders: [PH_DESCRICAO_SERVICO],
    },
    {
      nome: 'Peso por Equipamento',
      label: 'Peso/Equipamento',
      formula: 'DIVIDE(SUM(Peso), COUNT(DISTINCT Equipamento))',
      agregacao: 'sum',
      formato: 'numero',
      unidade: 'kg/equip.',
      categoria: 'Frota',
      cor: '#fbd5d5',
      descricao: 'Média de peso removido por equipamento',
      metaSugerida: null,
      tipoServico: TipoServico.REMOCAO,
      placeholders: [],
    },
    {
      nome: 'Equipamentos em Remoção',
      label: 'Equipamentos',
      formula: 'COUNT(DISTINCT Equipamento)',
      agregacao: 'count',
      formato: 'numero',
      unidade: 'equip.',
      categoria: 'Frota',
      cor: '#fce4e4',
      descricao: 'Quantidade de equipamentos distintos utilizados nas remoções',
      metaSugerida: null,
      tipoServico: TipoServico.REMOCAO,
      placeholders: [],
    },
  ];

  // ════════════════════════════════════════════
  // SALVAR (apenas os que não existem)
  // ════════════════════════════════════════════

  const todosKpis = [
    ...kpisVarricao,
    ...kpisRocadeira,
    ...kpisPoda,
    ...kpisRemocao,
  ];

  let criados = 0;
  for (const kpiData of todosKpis) {
    const existente = await repo.findOne({
      where: {
        nome: kpiData.nome,
        tipoServico: kpiData.tipoServico,
      },
    });
    if (!existente) {
      const kpi = new KpiUniversal();
      Object.assign(kpi, kpiData);
      kpi.isPersonalizado = false;
      await repo.save(kpi);
      criados++;
    }
  }

  console.log(`[seedKpisModelos] ✅ ${criados} novos KPIs criados com sucesso!`);
  console.log(`   Varrição: ${kpisVarricao.length} KPIs`);
  console.log(`   Roçada: ${kpisRocadeira.length} KPIs`);
  console.log(`   Poda: ${kpisPoda.length} KPIs`);
  console.log(`   Remoção: ${kpisRemocao.length} KPIs`);
}

// Executar diretamente
async function main() {
  try {
    console.log('📦 Conectando ao banco de dados...');
    await AppDataSource.initialize();
    console.log('✅ Conectado!');
    await seedKpisModelos();
    await AppDataSource.destroy();
    console.log('🔒 Conexão encerrada. Seed concluído!');
    process.exit(0);
  } catch (err) {
    console.error('[seedKpisModelos] Erro:', err);
    process.exit(1);
  }
}

main();
