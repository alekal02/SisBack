/**
 * Tipos de serviço suportados pelo sistema.
 * Cada tipo determina:
 * - O schema esperado da planilha (colunas obrigatórias)
 * - Os KPIs padrão do dashboard
 * - Os gráficos sugeridos
 * - A métrica principal de destaque
 */
export enum TipoServico {
  /** Coleta de resíduos com caminhão (schema atual) */
  COLETA_CAMINHAO = 'coleta_caminhao',
  /** Roçadeira / limpeza mecanizada de terrenos */
  ROCADEIRA = 'rocadeira',
  /** Poda de árvores */
  PODA = 'poda',
  /** Varrição de ruas e logradouros */
  VARRICAO = 'varricao',
  /** Pintura de meio-fio / sarjetas */
  PINTURA_MEIO_FIO = 'pintura_meio_fio',
  /** Remoção de entulho / materiais */
  REMOCAO = 'remocao',
  /** Capina / limpeza manual de terrenos e vias */
  CAPINA = 'capina',
  /** Coleta seletiva (toneladas), layout CONSOLIDADO */
  COLETA_SELETIVA = 'coleta_seletiva',
  /** Viagens ao aterro, layout CONSOLIDADO */
  ATERRO = 'aterro',
  /** Tipo genérico para serviços não mapeados */
  GERAL = 'geral',
}

export const TIPOS_SERVICO_VALORES: string[] = Object.values(TipoServico);

/** Metadados de cada tipo de serviço: label, ícone, descrição */
export const TIPOS_SERVICO_META: Record<string, { label: string; icone: string; descricao: string; colunasEsperadas: string[] }> = {
  [TipoServico.COLETA_CAMINHAO]: {
    label: '🚛 Coleta com Caminhão',
    icone: '🚛',
    descricao: 'Coleta de resíduos com roteiro de caminhão, motorista, peso, km e horários. Modelo com até 4 rotas, hodômetro e pesos individuais.',
    colunasEsperadas: [
      'PLACA', 'MOTORISTA', 'PESO TOTAL', 'KM TOTAL', 'TIPO DE CAMINHÃO',
      'HORA SÁIDA BASE', 'HORA CHEGADA BASE',
      'DATA SAIDA', 'TURNO', 'REGIONAL', 'DISTRITO',
      'Nº DE COLETORES', 'CONTADOR DE VIAGENS',
      ' KM SAIDA BASE ', ' KM CHEGADA BASE ',
      'HORA SAÍDA ROTA 01', 'HORA CHEGADA ROTA 01',
      'COLETOR 01', 'COLETOR 02',
    ],
  },
  [TipoServico.ROCADEIRA]: {
    label: '🌿 Roçada',
    icone: '🌿',
    descricao: 'Serviço de roçagem manual ou mecanizada com funcionários e equipamentos',
    colunasEsperadas: ['DATA', 'BAIRRO', 'Equipamento', 'Operador', 'Equipe', 'Area m²'],
  },
  [TipoServico.PODA]: {
    label: '✂️ Poda',
    icone: '✂️',
    descricao: 'Poda de árvores, galhos e vegetação em vias públicas',
    colunasEsperadas: ['Dia', 'Setor', 'Avenida / Rua', 'Tipo de serviço', 'Equipe', 'Quantidade de Arvore'],
  },
  [TipoServico.VARRICAO]: {
    label: '🧹 Varrição',
    icone: '🧹',
    descricao: 'Varrição manual de ruas, avenidas e espaços públicos',
    colunasEsperadas: ['DATA', 'BAIRRO', 'Equipe', 'KM Linear'],
  },
  [TipoServico.PINTURA_MEIO_FIO]: {
    label: '🎨 Pintura',
    icone: '🎨',
    descricao: 'Pintura de meio-fio e sarjetas com medição de comprimento e quantidade',
    colunasEsperadas: ['DATA', 'BAIRRO', 'NOME', 'COMPRIMENTO', 'NÚMERO DE SARJETAS EXECUTADAS', 'COMPRIMENTO TOTAL'],
  },
  [TipoServico.REMOCAO]: {
    label: '🚛 Remoção',
    icone: '🚛',
    descricao: 'Remoção de entulho, materiais e resíduos diversos',
    colunasEsperadas: ['Dia', 'Setor', 'Equipamento', 'Placa', 'Peso', 'Descrição do serviço'],
  },
  [TipoServico.CAPINA]: {
    label: '🌱 Capina',
    icone: '🌱',
    descricao: 'Capina manual ou mecanizada de terrenos, vias e logradouros públicos — medido por metro linear',
    colunasEsperadas: ['DATA', 'BAIRRO', 'Equipe', 'Funcionario', 'Metro Linear'],
  },
  [TipoServico.COLETA_SELETIVA]: {
    label: '♻️ Coleta seletiva',
    icone: '♻️',
    descricao: 'Coleta seletiva medida em toneladas, a partir da planilha de produção',
    colunasEsperadas: ['DATA', 'LOCAL', 'QUANTIDADE', 'UNIDADE', 'TIPO DE EQUIPAMENTO'],
  },
  [TipoServico.ATERRO]: {
    label: '🏭 Aterro',
    icone: '🏭',
    descricao: 'Viagens destinadas ao aterro, a partir da planilha de produção',
    colunasEsperadas: ['DATA', 'LOCAL', 'TIPO DE EQUIPAMENTO', 'QUANTIDADE', 'OBSERVAÇÃO'],
  },
  [TipoServico.GERAL]: {
    label: '📋 Geral',
    icone: '📋',
    descricao: 'Tipo genérico — usar quando nenhum tipo específico se aplicar',
    colunasEsperadas: [],
  },
};
