/**
 * PlaceholderResolver — Resolve placeholders de KPIs universais em fórmulas
 * 
 * Problema: KPIs universais usam placeholders (ex: PESO_PLACEHOLDER) que precisam
 * ser substituídos pelos nomes reais das colunas da planilha.
 * 
 * Este serviço fornece:
 * 1. resolvePlaceholdersNaFormula()  → Resolve placeholders em tempo real
 * 2. Dicionário PH_MAP com todas as candidatas de cada placeholder
 */

interface ResolverConfig {
  colunasServico: string[];
}

const PH_MAP: Record<string, string[]> = {
  // ─── COLETA_CAMINHAO ───
  'PESO_PLACEHOLDER': ['PESO TOTAL', 'PESO', 'PESOTOTAL', 'PESO_TOTAL', 'PESO_BRUTO', 'PESO COLETADO', 'PESO (KG)', 'PESO COLETA'],
  'KM_PLACEHOLDER': ['KM TOTAL', 'KM', 'KMTOTAL', 'KM_TOTAL', 'QUILOMETRO', 'DISTANCIA', 'KM RODADO'],
  'PLACA_PLACEHOLDER': ['PLACA', 'CAMINHAO', 'VEICULO', 'COLETOR', 'COLETORA', 'EQUIPAMENTO'],
  'TIPO_PLACEHOLDER': ['TIPO CAMINHAO', 'TIPO_CAMINHAO', 'CAMINHAO', 'TIPO DE CAMINHAO', 'TIPODECAMINHAO', 'TIPO DE CAMINHÃO'],
  'HORA_PLACEHOLDER': ['HORA SAIDA', 'HORA', 'HORASAIDA', 'HORA_SAIDA', 'HR SAIDA BASE', 'HORAS PRODUTIVAS', 'HORAS', 'DURACAO', 'TEMPO'],
  'HORA_CHEGADA_PLACEHOLDER': ['HORA CHEGADA', 'HORACHEGADA', 'HORA_CHEGADA', 'HR CHEGA BASE', 'HORA CHEGADA BASE', 'HORA CHEGADA ROTA 01'],
  'HORA_FORA_PLACEHOLDER': ['HORAS QUE FICA FORA DA UNIDADE', 'HORAS FORA UNIDADE', 'HORAS FORA DA UNIDADE', 'TEMPO FORA DA UNIDADE'],
  'VOLUME_PLACEHOLDER': ['VOLUME', 'VOLUME M3', 'VOLUME_M3', 'M3', 'METRO CUBICO'],
  'COLETOR_NUM_PLACEHOLDER': ['Nº DE COLETORES', 'NUMERO DE COLETORES', 'NÚMERO DE COLETORES', 'COLETORES', 'NR COLETORES'],
  'VIAGENS_PLACEHOLDER': ['Nº DE VIAGENS', 'NUMERO DE VIAGENS', 'NÚMERO DE VIAGENS', 'VIAGENS', 'CONTADOR DE VIAGENS', 'CONTADOR VIAGENS'],
  'MOTORISTA_PLACEHOLDER': ['MOTORISTA', 'NOME', 'COLETOR', 'OPERADOR', 'FUNCIONARIO', 'EQUIPE'],
  'DISTRITO_PLACEHOLDER': ['DISTRITO', 'BAIRRO', 'LOCAL', 'SETOR'],
  'REGIONAL_PLACEHOLDER': ['REGIONAL', 'REGIAO', 'REGIÃO', 'ZONA'],
  'TURNO_PLACEHOLDER': ['TURNO', 'TURNO BASE', 'PERIODO', 'TURNO_BASE'],
  'PESO1_PLACEHOLDER': ['PESO 1', 'PESO1', 'PRIMEIRA PESAGEM', 'PESO INICIAL'],
  'PESO4_PLACEHOLDER': ['PESO 4', 'PESO4', 'ULTIMA PESAGEM', 'PESO FINAL'],
  'PESO5_PLACEHOLDER': ['PESO 5', 'PESO5', 'ULTIMA PESAGEM', 'PESO FINAL'],
  'PESO_MEDIO_PLACEHOLDER': ['PESO 2', 'PESO2', 'PESO 3', 'PESO3', 'PESO 4', 'PESO4'],
  'KM_SAIDA_PLACEHOLDER': ['KM SAIDA', 'KM SAIDA BASE', 'KM SAÍDA', 'KM SAÍDA BASE', 'KM SAIDA BASE'],
  'KM_CHEGADA_PLACEHOLDER': ['KM CHEGADA', 'KM CHEGADA BASE', 'KM CHEGADA ROTA 01', 'KM CHEGADA BASE'],

  // ─── COLETA / FROTA ───
  'COLETOR_PLACEHOLDER': ['COLETOR', 'MOTORISTA', 'FUNCIONARIO', 'NOME'],
  'ROTA_PLACEHOLDER': ['ROTA', 'BAIRRO', 'REGIAO', 'SETOR', 'LOCAL', 'REGIONAL', 'DESTINO'],

  // ─── PODA ───
  'ARVORES_PLACEHOLDER': ['Quantidade de Arvore', 'QTD_ARVORE', 'ARVORES_PODADAS', 'QTDE ARVORES', 'ARVORES', 'N ARVORES', 'QUANTIDADE', 'QUANTITATIVO'],
  'QTD_ARVORE_PLACEHOLDER': ['Quantidade de Arvore', 'QUANTIDADE DE ARVORE', 'QUANTIDADE ARVORE', 'QTD_ARVORE', 'ARVORES_PODADAS', 'QTDE ARVORES', 'ARVORES', 'Nº ARVORES', 'QUANTIDADE', 'QUANTITATIVO'],
  'SETOR_PLACEHOLDER': ['Setor', 'SETOR', 'BAIRRO', 'LOCAL', 'DISTRITO', 'REGIAO', 'REGIONAL'],
  'TIPO_SERVICO_PLACEHOLDER': ['Tipo de serviço', 'TIPO DE SERVICO', 'TIPO SERVICO', 'TIPO_SERVICO', 'TIPO DE SERVIÇO', 'SERVICO', 'DESCRICAO'],
  'AVENIDA_RUA_PLACEHOLDER': ['Avenida / Rua', 'AVENIDA/RUA', 'AVENIDA RUA', 'RUA', 'AVENIDA', 'LOGRADOURO', 'ENDERECO'],
  'BAIRRO_PLACEHOLDER': ['BAIRRO', 'LOCAL', 'REGIONAL', 'REGIAO', 'SETOR', 'ROTA', 'DESTINO'],

  // ─── ROCADEIRA ───
  'AREA_PLACEHOLDER': ['Area m²', 'AREA_M2', 'AREA_ROCADA', 'AREA_CAPINADA', 'AREA', 'METRAGEM', 'M2', 'QUANTITATIVO'],
  'AREA_M2_PLACEHOLDER': ['Area m²', 'AREA M2', 'AREA M²', 'AREA_M2', 'AREA', 'AREA_ROCADA', 'AREA_CAPINADA', 'METRAGEM', 'M2', 'Area m2', 'QUANTITATIVO'],
  'EQUIPE_PLACEHOLDER': ['Equipe', 'EQUIPE', 'FUNCIONARIO', 'FUNCIONÁRIO', 'NOME', 'OPERADOR', 'MOTORISTA'],
  'EQUIPAMENTO_PLACEHOLDER': ['Equipamento', 'EQUIPAMENTO', 'TRATOR', 'MAQUINA', 'VEICULO', 'COLETOR'],
  'OPERADOR_PLACEHOLDER': ['Operador', 'OPERADOR', 'FUNCIONARIO', 'FUNCIONÁRIO', 'NOME', 'MOTORISTA'],

  // ─── VARRICAO / CAPINA ───
  'KM_VARRIDOS_PLACEHOLDER': ['KM Linear', 'KM_LINEAR', 'QUILOMETROS_VARRIDOS', 'KM VARRIDOS', 'KM VARRIÇÃO', 'KM VARRICAO', 'KM', 'QUANTITATIVO'],
  'KM_LINEAR_PLACEHOLDER': ['KM Linear', 'KM_LINEAR', 'KM LINEAR', 'QUILOMETROS_VARRIDOS', 'KM VARRIDOS', 'KM VAR', 'QUANTITATIVO'],
  'METRO_LINEAR_PLACEHOLDER': ['Metro Linear', 'METRO_LINEAR', 'METRO LINEAR', 'COMPRIMENTO', 'COMPRIMENTO (METROS)', 'METROS', 'QUANTITATIVO'],

  // ─── GERAL ───
  'FUNCIONARIO_PLACEHOLDER': ['Funcionario', 'FUNCIONARIO', 'NOME', 'OPERADOR', 'MOTORISTA', 'EQUIPE', 'FUNCIONÁRIO'],
  'COMPRIMENTO_PLACEHOLDER': ['Metro Linear', 'METRO_LINEAR', 'COMPRIMENTO', 'COMPRIMENTO TOTAL', 'METRAGEM', 'EXTENSAO', 'QUANTITATIVO'],
  'DATA_SAIDA': ['DATA SAIDA', 'DATA', 'DATA DE SAIDA', 'DATA SAÍDA', 'DIA', 'DATA_BASE'],
  'DESCRICAO_SERVICO_PLACEHOLDER': ['Descrição do serviço', 'DESCRICAO DO SERVICO', 'DESCRICAO SERVICO', 'DESCRIÇÃO DO SERVIÇO', 'DESCRICAO', 'TIPO SERVICO'],
};

function normalizar(s: string): string {
  return s.trim().toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '');
}

/**
 * Detecta se uma fórmula contém placeholders não resolvidos
 */
export function temPlaceholders(formula: string): boolean {
  return /[A-Z_]+_PLACEHOLDER/g.test(formula);
}

/**
 * Resolve placeholders em uma fórmula, substituindo pelos nomes reais das colunas.
 * Se não conseguir resolver algum placeholder, mantém o original.
 */
export function resolvePlaceholdersNaFormula(
  formula: string,
  config: ResolverConfig
): string {
  if (!temPlaceholders(formula)) return formula;

  const colunasNorm = config.colunasServico.map(c => ({
    original: c,
    norm: normalizar(c),
  }));

  let resultado = formula;

  for (const [phNome, candidatas] of Object.entries(PH_MAP)) {
    if (!resultado.includes(phNome)) continue;

    // Buscar coluna real que corresponda
    let colunaReal = '';
    for (const cand of candidatas) {
      const candNorm = normalizar(cand);
      for (const cn of colunasNorm) {
        if (cn.norm === candNorm || cn.norm.includes(candNorm) || candNorm.includes(cn.norm)) {
          colunaReal = cn.original;
          break;
        }
      }
      if (colunaReal) break;
    }

    if (colunaReal) {
      const regex = new RegExp(phNome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      resultado = resultado.replace(regex, colunaReal);
    }
  }

  return resultado;
}

export default {
  temPlaceholders,
  resolvePlaceholdersNaFormula,
  PH_MAP,
};
