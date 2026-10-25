import 'reflect-metadata';
import dotenv from 'dotenv';
dotenv.config();

console.log('Conectando em:', process.env.DATABASE_HOST || 'localhost', ':', process.env.DATABASE_PORT || '5432');

import AppDataSource from '../database/data-source';
import { KpiUniversal, PlaceholderKpi } from '../entities/KpiUniversal';
import { TipoServico } from '../enums/TipoServico';

async function seedModelos() {
  const repo = AppDataSource.getRepository(KpiUniversal);

  const PH_KM_LINEAR: PlaceholderKpi = {
    nome: 'KM_LINEAR_PLACEHOLDER',
    label: 'Coluna de KM Linear (Varricao)',
    colunasCandidatas: ['KM Linear', 'KM_LINEAR', 'KM LINEAR', 'QUILOMETROS_VARRIDOS', 'KM VARRIDOS', 'KM VAR'],
  };

  const PH_EQUIPE: PlaceholderKpi = {
    nome: 'EQUIPE_PLACEHOLDER',
    label: 'Coluna de Equipe',
    colunasCandidatas: ['Equipe', 'EQUIPE', 'FUNCIONARIO', 'FUNCIONARIO', 'NOME', 'OPERADOR', 'MOTORISTA'],
  };

  const PH_AREA_M2: PlaceholderKpi = {
    nome: 'AREA_M2_PLACEHOLDER',
    label: 'Coluna de Area m2',
    colunasCandidatas: ['Area m2', 'AREA M2', 'AREA M2', 'AREA', 'AREA_ROCADA', 'AREA_CAPINADA', 'METRAGEM', 'M2'],
  };

  const PH_EQUIPAMENTO: PlaceholderKpi = {
    nome: 'EQUIPAMENTO_PLACEHOLDER',
    label: 'Coluna de Equipamento',
    colunasCandidatas: ['Equipamento', 'EQUIPAMENTO', 'TRATOR', 'MAQUINA', 'VEICULO', 'COLETOR'],
  };

  const PH_OPERADOR: PlaceholderKpi = {
    nome: 'OPERADOR_PLACEHOLDER',
    label: 'Coluna de Operador',
    colunasCandidatas: ['Operador', 'OPERADOR', 'FUNCIONARIO', 'FUNCIONARIO', 'NOME', 'MOTORISTA'],
  };

  const PH_QTD_ARVORE: PlaceholderKpi = {
    nome: 'QTD_ARVORE_PLACEHOLDER',
    label: 'Coluna de Quantidade de Arvores',
    colunasCandidatas: ['Quantidade de Arvore', 'QUANTIDADE DE ARVORE', 'QUANTIDADE ARVORE', 'ARVORES_PODADAS', 'QTDE ARVORES', 'ARVORES', 'N?ARVORES', 'QUANTIDADE'],
  };

  const PH_AVENIDA_RUA: PlaceholderKpi = {
    nome: 'AVENIDA_RUA_PLACEHOLDER',
    label: 'Coluna de Logradouro',
    colunasCandidatas: ['Avenida / Rua', 'AVENIDA/RUA', 'AVENIDA RUA', 'RUA', 'AVENIDA', 'LOGRADOURO', 'ENDERECO'],
  };

  const PH_TIPO_SERVICO: PlaceholderKpi = {
    nome: 'TIPO_SERVICO_PLACEHOLDER',
    label: 'Coluna de Tipo de Servico',
    colunasCandidatas: ['Tipo de servico', 'TIPO DE SERVICO', 'TIPO SERVICO', 'TIPO_SERVICO', 'SERVICO', 'DESCRICAO'],
  };

  const PH_SETOR: PlaceholderKpi = {
    nome: 'SETOR_PLACEHOLDER',
    label: 'Coluna de Setor/Bairro',
    colunasCandidatas: ['Setor', 'SETOR', 'BAIRRO', 'LOCAL', 'DISTRITO', 'REGIAO', 'REGIONAL'],
  };

  const PH_DESCRICAO_SERVICO: PlaceholderKpi = {
    nome: 'DESCRICAO_SERVICO_PLACEHOLDER',
    label: 'Coluna de Descricao do Servico',
    colunasCandidatas: ['Descricao do servico', 'DESCRICAO DO SERVICO', 'DESCRICAO SERVICO', 'DESCRICAO', 'TIPO SERVICO'],
  };

  const kpisVarricao: Partial<KpiUniversal>[] = [
    {
      nome: 'Total KM Linear',
      label: 'Total KM Linear',
      formula: 'SUM(KM_LINEAR_PLACEHOLDER)',
      agregacao: 'sum', formato: 'numero', unidade: 'km',
      categoria: 'Produtividade', cor: '#06b6d4',
      descricao: 'Total de quilometros lineares varridos no periodo',
      metaSugerida: null, tipoServico: TipoServico.VARRICAO,
      placeholders: [PH_KM_LINEAR],
    },
    {
      nome: 'KM Linear por Equipe',
      label: 'KM Linear/Equipe',
      formula: 'DIVIDE(SUM(KM_LINEAR_PLACEHOLDER), COUNT(DISTINCT EQUIPE_PLACEHOLDER))',
      agregacao: 'sum', formato: 'numero', unidade: 'km/equipe',
      categoria: 'Produtividade', cor: '#22d3ee',
      descricao: 'Media de KM linear varrido por equipe de varricao',
      metaSugerida: null, tipoServico: TipoServico.VARRICAO,
      placeholders: [PH_KM_LINEAR, PH_EQUIPE],
    },
    {
      nome: 'Equipes de Varricao Ativas',
      label: 'Equipes Ativas',
      formula: 'COUNT(DISTINCT EQUIPE_PLACEHOLDER)',
      agregacao: 'count', formato: 'numero', unidade: 'equipes',
      categoria: 'Equipe', cor: '#67e8f9',
      descricao: 'Quantidade de equipes unicas que realizaram varricao',
      metaSugerida: null, tipoServico: TipoServico.VARRICAO,
      placeholders: [PH_EQUIPE],
    },
    {
      nome: 'KM Linear por Bairro',
      label: 'KM Linear/Bairro',
      formula: 'DIVIDE(SUM(KM_LINEAR_PLACEHOLDER), COUNT(DISTINCT BAIRRO))',
      agregacao: 'sum', formato: 'numero', unidade: 'km/bairro',
      categoria: 'Cobertura', cor: '#a5f3fc',
      descricao: 'Media de KM linear varrido por bairro atendido',
      metaSugerida: null, tipoServico: TipoServico.VARRICAO,
      placeholders: [PH_KM_LINEAR],
    },
    {
      nome: 'Media KM Linear por Dia',
      label: 'Media KM/Dia',
      formula: 'DIVIDE(SUM(KM_LINEAR_PLACEHOLDER), COUNT(DISTINCT DATA))',
      agregacao: 'sum', formato: 'numero', unidade: 'km/dia',
      categoria: 'Produtividade', cor: '#cffafe',
      descricao: 'Media de KM linear varrido por dia de trabalho',
      metaSugerida: null, tipoServico: TipoServico.VARRICAO,
      placeholders: [PH_KM_LINEAR],
    },
  ];

  const kpisRocadeira: Partial<KpiUniversal>[] = [
    {
      nome: 'Total Area Rocada',
      label: 'Area Rocada (m2)',
      formula: 'SUM(AREA_M2_PLACEHOLDER)',
      agregacao: 'sum', formato: 'numero', unidade: 'm2',
      categoria: 'Produtividade', cor: '#22c55e',
      descricao: 'Total de area rocada em metros quadrados',
      metaSugerida: null, tipoServico: TipoServico.ROCADEIRA,
      placeholders: [PH_AREA_M2],
    },
    {
      nome: 'M2 por Equipe (Rocada)',
      label: 'M2 por Equipe',
      formula: 'DIVIDE(SUM(AREA_M2_PLACEHOLDER), COUNT(DISTINCT EQUIPE_PLACEHOLDER))',
      agregacao: 'sum', formato: 'numero', unidade: 'm2/equipe',
      categoria: 'Produtividade', cor: '#16a34a',
      descricao: 'Media de m2 rocados por equipe',
      metaSugerida: null, tipoServico: TipoServico.ROCADEIRA,
      placeholders: [PH_AREA_M2, PH_EQUIPE],
    },
    {
      nome: 'M2 por Operador',
      label: 'M2 por Operador',
      formula: 'DIVIDE(SUM(AREA_M2_PLACEHOLDER), COUNT(DISTINCT OPERADOR_PLACEHOLDER))',
      agregacao: 'sum', formato: 'numero', unidade: 'm2/operador',
      categoria: 'Produtividade', cor: '#15803d',
      descricao: 'Media de m2 rocados por operador',
      metaSugerida: null, tipoServico: TipoServico.ROCADEIRA,
      placeholders: [PH_AREA_M2, PH_OPERADOR],
    },
    {
      nome: 'Operadores Ativos (Rocada)',
      label: 'Operadores Ativos',
      formula: 'COUNT(DISTINCT OPERADOR_PLACEHOLDER)',
      agregacao: 'count', formato: 'numero', unidade: 'operadores',
      categoria: 'Equipe', cor: '#4ade80',
      descricao: 'Quantidade de operadores unicos que realizaram rocagem',
      metaSugerida: null, tipoServico: TipoServico.ROCADEIRA,
      placeholders: [PH_OPERADOR],
    },
    {
      nome: 'Equipes de Rocada Ativas',
      label: 'Equipes Ativas',
      formula: 'COUNT(DISTINCT EQUIPE_PLACEHOLDER)',
      agregacao: 'count', formato: 'numero', unidade: 'equipes',
      categoria: 'Equipe', cor: '#86efac',
      descricao: 'Quantidade de equipes unicas em operacao de rocagem',
      metaSugerida: null, tipoServico: TipoServico.ROCADEIRA,
      placeholders: [PH_EQUIPE],
    },
    {
      nome: 'M2 por Equipamento',
      label: 'M2 por Equipamento',
      formula: 'DIVIDE(SUM(AREA_M2_PLACEHOLDER), COUNT(DISTINCT EQUIPAMENTO_PLACEHOLDER))',
      agregacao: 'sum', formato: 'numero', unidade: 'm2/equip.',
      categoria: 'Produtividade', cor: '#bbf7d0',
      descricao: 'Media de m2 rocados por tipo de equipamento',
      metaSugerida: null, tipoServico: TipoServico.ROCADEIRA,
      placeholders: [PH_AREA_M2, PH_EQUIPAMENTO],
    },
    {
      nome: 'Equipamentos Utilizados',
      label: 'Equipamentos Utilizados',
      formula: 'COUNT(DISTINCT EQUIPAMENTO_PLACEHOLDER)',
      agregacao: 'count', formato: 'numero', unidade: 'equip.',
      categoria: 'Equipe', cor: '#dcfce7',
      descricao: 'Quantidade de equipamentos distintos utilizados na rocagem',
      metaSugerida: null, tipoServico: TipoServico.ROCADEIRA,
      placeholders: [PH_EQUIPAMENTO],
    },
  ];

  const kpisPoda: Partial<KpiUniversal>[] = [
    {
      nome: 'Total Arvores Atendidas',
      label: 'Arvores Atendidas',
      formula: 'SUM(QTD_ARVORE_PLACEHOLDER)',
      agregacao: 'sum', formato: 'numero', unidade: 'arvores',
      categoria: 'Produtividade', cor: '#8b5cf6',
      descricao: 'Total de arvores podadas ou extirpadas no periodo',
      metaSugerida: null, tipoServico: TipoServico.PODA,
      placeholders: [PH_QTD_ARVORE],
    },
    {
      nome: 'Arvores por Setor',
      label: 'Arvores/Setor',
      formula: 'DIVIDE(SUM(QTD_ARVORE_PLACEHOLDER), COUNT(DISTINCT SETOR_PLACEHOLDER))',
      agregacao: 'sum', formato: 'numero', unidade: 'arv./setor',
      categoria: 'Cobertura', cor: '#a78bfa',
      descricao: 'Media de arvores atendidas por setor',
      metaSugerida: null, tipoServico: TipoServico.PODA,
      placeholders: [PH_QTD_ARVORE, PH_SETOR],
    },
    {
      nome: 'Arvores por Equipe (Poda)',
      label: 'Arvores/Equipe',
      formula: 'DIVIDE(SUM(QTD_ARVORE_PLACEHOLDER), COUNT(DISTINCT EQUIPE_PLACEHOLDER))',
      agregacao: 'sum', formato: 'numero', unidade: 'arv./equipe',
      categoria: 'Produtividade', cor: '#c4b5fd',
      descricao: 'Media de arvores atendidas por equipe de poda',
      metaSugerida: null, tipoServico: TipoServico.PODA,
      placeholders: [PH_QTD_ARVORE, PH_EQUIPE],
    },
    {
      nome: 'Setores com Poda',
      label: 'Setores Atendidos',
      formula: 'COUNT(DISTINCT SETOR_PLACEHOLDER)',
      agregacao: 'count', formato: 'numero', unidade: 'setores',
      categoria: 'Cobertura', cor: '#ddd6fe',
      descricao: 'Quantidade de setores distintos que receberam poda',
      metaSugerida: null, tipoServico: TipoServico.PODA,
      placeholders: [PH_SETOR],
    },
    {
      nome: 'Equipes de Poda Ativas',
      label: 'Equipes Ativas',
      formula: 'COUNT(DISTINCT EQUIPE_PLACEHOLDER)',
      agregacao: 'count', formato: 'numero', unidade: 'equipes',
      categoria: 'Equipe', cor: '#ede9fe',
      descricao: 'Quantidade de equipes unicas em operacao de poda',
      metaSugerida: null, tipoServico: TipoServico.PODA,
      placeholders: [PH_EQUIPE],
    },
    {
      nome: 'Arvores por Tipo de Servico',
      label: 'Arv./Tipo Serv.',
      formula: 'DIVIDE(SUM(QTD_ARVORE_PLACEHOLDER), COUNT(DISTINCT TIPO_SERVICO_PLACEHOLDER))',
      agregacao: 'sum', formato: 'numero', unidade: 'arv./tipo',
      categoria: 'Analitico', cor: '#f5f3ff',
      descricao: 'Media de arvores por tipo de servico (Poda vs Extirpacao)',
      metaSugerida: null, tipoServico: TipoServico.PODA,
      placeholders: [PH_QTD_ARVORE, PH_TIPO_SERVICO],
    },
    {
      nome: 'Tipos de Servico (Poda)',
      label: 'Tipos de Servico',
      formula: 'COUNT(DISTINCT TIPO_SERVICO_PLACEHOLDER)',
      agregacao: 'count', formato: 'numero', unidade: 'tipos',
      categoria: 'Analitico', cor: '#faf5ff',
      descricao: 'Quantidade de tipos de servico distintos (poda, extirpacao, etc.)',
      metaSugerida: null, tipoServico: TipoServico.PODA,
      placeholders: [PH_TIPO_SERVICO],
    },
    {
      nome: 'Arvores por Dia (Poda)',
      label: 'Arv./Dia',
      formula: 'DIVIDE(SUM(QTD_ARVORE_PLACEHOLDER), COUNT(DISTINCT DIA))',
      agregacao: 'sum', formato: 'numero', unidade: 'arv./dia',
      categoria: 'Produtividade', cor: '#e9d5ff',
      descricao: 'Media de arvores atendidas por dia de trabalho',
      metaSugerida: null, tipoServico: TipoServico.PODA,
      placeholders: [PH_QTD_ARVORE],
    },
  ];

  const kpisRemocao: Partial<KpiUniversal>[] = [
    {
      nome: 'Total Remocoes Realizadas',
      label: 'Remocoes',
      formula: 'COUNT(*)',
      agregacao: 'count', formato: 'numero', unidade: 'remocoes',
      categoria: 'Produtividade', cor: '#ef4444',
      descricao: 'Numero total de remocoes realizadas',
      metaSugerida: null, tipoServico: TipoServico.REMOCAO,
      placeholders: [],
    },
    {
      nome: 'Peso Total Removido (kg)',
      label: 'Peso Total (kg)',
      formula: 'SUM(Peso)',
      agregacao: 'sum', formato: 'numero', unidade: 'kg',
      categoria: 'Operacional', cor: '#f87171',
      descricao: 'Peso total removido em quilogramas',
      metaSugerida: null, tipoServico: TipoServico.REMOCAO,
      placeholders: [],
    },
    {
      nome: 'Peso por Remocao (kg)',
      label: 'Peso/Remocao',
      formula: 'DIVIDE(SUM(Peso), COUNT(*))',
      agregacao: 'sum', formato: 'numero', unidade: 'kg/rem.',
      categoria: 'Operacional', cor: '#fca5a5',
      descricao: 'Peso medio removido por servico/viagem',
      metaSugerida: null, tipoServico: TipoServico.REMOCAO,
      placeholders: [],
    },
    {
      nome: 'Remocoes por Setor',
      label: 'Rem./Setor',
      formula: 'DIVIDE(COUNT(*), COUNT(DISTINCT SETOR_PLACEHOLDER))',
      agregacao: 'count', formato: 'numero', unidade: 'rem./setor',
      categoria: 'Cobertura', cor: '#fecaca',
      descricao: 'Media de remocoes por setor atendido',
      metaSugerida: null, tipoServico: TipoServico.REMOCAO,
      placeholders: [PH_SETOR],
    },
    {
      nome: 'Setores com Remocao',
      label: 'Setores Atendidos',
      formula: 'COUNT(DISTINCT SETOR_PLACEHOLDER)',
      agregacao: 'count', formato: 'numero', unidade: 'setores',
      categoria: 'Cobertura', cor: '#fee2e2',
      descricao: 'Quantidade de setores distintos que receberam remocao',
      metaSugerida: null, tipoServico: TipoServico.REMOCAO,
      placeholders: [PH_SETOR],
    },
    {
      nome: 'Veiculos em Remocao',
      label: 'Veiculos Utilizados',
      formula: 'COUNT(DISTINCT Placa)',
      agregacao: 'count', formato: 'numero', unidade: 'veiculos',
      categoria: 'Frota', cor: '#fef2f2',
      descricao: 'Quantidade de veiculos/equipamentos utilizados nas remocoes',
      metaSugerida: null, tipoServico: TipoServico.REMOCAO,
      placeholders: [],
    },
    {
      nome: 'Peso por Veiculo',
      label: 'Peso/Veiculo',
      formula: 'DIVIDE(SUM(Peso), COUNT(DISTINCT Placa))',
      agregacao: 'sum', formato: 'numero', unidade: 'kg/veic.',
      categoria: 'Frota', cor: '#ffcaca',
      descricao: 'Media de peso removido por veiculo utilizado',
      metaSugerida: null, tipoServico: TipoServico.REMOCAO,
      placeholders: [],
    },
    {
      nome: 'Tipos de Servico (Remocao)',
      label: 'Tipos de Servico',
      formula: 'COUNT(DISTINCT DESCRICAO_SERVICO_PLACEHOLDER)',
      agregacao: 'count', formato: 'numero', unidade: 'tipos',
      categoria: 'Analitico', cor: '#fecdd3',
      descricao: 'Quantidade de tipos de servico distintos nas remocoes',
      metaSugerida: null, tipoServico: TipoServico.REMOCAO,
      placeholders: [PH_DESCRICAO_SERVICO],
    },
    {
      nome: 'Peso por Equipamento',
      label: 'Peso/Equipamento',
      formula: 'DIVIDE(SUM(Peso), COUNT(DISTINCT Equipamento))',
      agregacao: 'sum', formato: 'numero', unidade: 'kg/equip.',
      categoria: 'Frota', cor: '#fbd5d5',
      descricao: 'Media de peso removido por equipamento',
      metaSugerida: null, tipoServico: TipoServico.REMOCAO,
      placeholders: [],
    },
    {
      nome: 'Equipamentos em Remocao',
      label: 'Equipamentos',
      formula: 'COUNT(DISTINCT Equipamento)',
      agregacao: 'count', formato: 'numero', unidade: 'equip.',
      categoria: 'Frota', cor: '#fce4e4',
      descricao: 'Quantidade de equipamentos distintos utilizados nas remocoes',
      metaSugerida: null, tipoServico: TipoServico.REMOCAO,
      placeholders: [],
    },
  ];

  const todosKpis = [...kpisVarricao, ...kpisRocadeira, ...kpisPoda, ...kpisRemocao];

  let criados = 0;
  for (const kpiData of todosKpis) {
    const existente = await repo.findOne({
      where: { nome: kpiData.nome, tipoServico: kpiData.tipoServico },
    });
    if (!existente) {
      const kpi = new KpiUniversal();
      Object.assign(kpi, kpiData);
      kpi.isPersonalizado = false;
      await repo.save(kpi);
      criados++;
    }
  }

  console.log(`Seed modelos: ${criados} KPIs criados`);
}

async function updatePlaceholders() {
  const repo = AppDataSource.getRepository(KpiUniversal);

  // Varricao
  const varricaoKpis = await repo.find({ where: { tipoServico: TipoServico.VARRICAO } });
  for (const kpi of varricaoKpis) {
    if (!kpi.placeholders) continue;
    let alterado = false;
    for (const ph of kpi.placeholders) {
      if (ph.nome === 'KM_VARRIDOS_PLACEHOLDER' && !ph.colunasCandidatas.includes('KM Linear')) {
        ph.colunasCandidatas.push('KM Linear', 'KM_LINEAR', 'KM LINEAR');
        alterado = true;
      }
      if (ph.nome === 'FUNCIONARIO_PLACEHOLDER' && !ph.colunasCandidatas.includes('Equipe')) {
        ph.colunasCandidatas.push('Equipe', 'EQUIPE');
        alterado = true;
      }
    }
    if (alterado) { await repo.save(kpi); console.log('  Placeholder atualizado: ' + kpi.nome); }
  }

  // Poda
  const podaKpis = await repo.find({ where: { tipoServico: TipoServico.PODA } });
  for (const kpi of podaKpis) {
    if (!kpi.placeholders) continue;
    let alterado = false;
    for (const ph of kpi.placeholders) {
      if (ph.nome === 'ARVORES_PLACEHOLDER' && !ph.colunasCandidatas.includes('Quantidade de Arvore')) {
        ph.colunasCandidatas.push('Quantidade de Arvore', 'QUANTIDADE DE ARVORE');
        alterado = true;
      }
      if (ph.nome === 'FUNCIONARIO_PLACEHOLDER' && !ph.colunasCandidatas.includes('Equipe')) {
        ph.colunasCandidatas.push('Equipe', 'EQUIPE');
        alterado = true;
      }
      if (ph.nome === 'BAIRRO_PLACEHOLDER' && !ph.colunasCandidatas.includes('Setor')) {
        ph.colunasCandidatas.push('Setor', 'SETOR');
        alterado = true;
      }
    }
    if (alterado) { await repo.save(kpi); console.log('  Placeholder atualizado: ' + kpi.nome); }
  }

  // Rocadeira
  const rocadeiraKpis = await repo.find({ where: { tipoServico: TipoServico.ROCADEIRA } });
  for (const kpi of rocadeiraKpis) {
    if (!kpi.placeholders) continue;
    let alterado = false;
    for (const ph of kpi.placeholders) {
      if (ph.nome === 'AREA_PLACEHOLDER' && !ph.colunasCandidatas.includes('Area m2')) {
        ph.colunasCandidatas.push('Area m2', 'AREA M2');
        alterado = true;
      }
      if (ph.nome === 'FUNCIONARIO_PLACEHOLDER' && !ph.colunasCandidatas.includes('Equipe')) {
        ph.colunasCandidatas.push('Equipe', 'EQUIPE');
        alterado = true;
      }
      if (ph.nome === 'FUNCIONARIO_PLACEHOLDER' && !ph.colunasCandidatas.includes('Operador')) {
        ph.colunasCandidatas.push('Operador', 'OPERADOR');
        alterado = true;
      }
    }
    if (alterado) { await repo.save(kpi); console.log('  Placeholder atualizado: ' + kpi.nome); }
  }

  console.log('Update placeholders concluido');
}

async function main() {
  try {
    await AppDataSource.initialize();
    console.log('Conectado ao banco: ' + process.env.DATABASE_HOST + ':' + process.env.DATABASE_PORT);
    await seedModelos();
    await updatePlaceholders();
    await AppDataSource.destroy();
    console.log('Finalizado!');
    process.exit(0);
  } catch (err) {
    console.error('Erro:', err);
    process.exit(1);
  }
}

main();
