/** Cabeçalhos que o executivo lê de verdade (métricas, horas, rotas, coletores). */
const COLUNAS_FIXAS = [
  'DATA SAIDA', 'DATA SAÍDA', 'DATA DE SAIDA', 'DATA DE SAÍDA', 'DIA', 'Data',
  'TURNO', 'REGIONAL', 'REGIAO', 'REGIÃO', 'DISTRITO', 'BAIRRO', 'SETOR',
  'PLACA', 'VEICULO', 'VEÍCULO', 'CAMINHAO', 'CAMINHÃO', 'CARRO',
  'MOTORISTA', 'OPERADOR', 'NOME', 'Operador',
  'Nº DE COLETORES', 'NUMERO DE COLETORES', 'NÚMERO DE COLETORES', 'COLETORES',
  'KM SAIDA', 'KM SAÍDA', 'KM SAIDA BASE', 'KM SAÍDA BASE', ' KM SAIDA BASE ',
  'HORA SAIDA', 'HORA SÁIDA', 'HORA SAIDA BASE', 'HORA SÁIDA BASE', 'HORA DE SAIDA', 'HORA DE SAÍDA',
  'KM CHEGADA', 'KM DE CHEGADA', 'KM CHEGADA BASE',
  'HORA CHEGADA', 'HORA DE CHEGADA', 'HORA CHEGADA BASE',
  'HORA ULTIMO TÉRMINO DO CARREGAMENTO', 'HORA ÚLTIMO TÉRMINO DO CARREGAMENTO',
  'PESO 1', 'PESO 2', 'PESO 3', 'PESO 4', 'PESO 5', 'PESO TOTAL', 'PESO',
  'TEMPO FORA DA UNIDADE', 'HORAS QUE FICA FORA DA UNIDADE', 'HORAS FORA UNIDADE',
  'TIPO DE CAMINHÃO', 'TIPO CAMINHAO', 'TIPO DE CAMINHAO', 'TIPO VEICULO', 'TIPO VEÍCULO',
  'KM TOTAL',
  'CONTADOR DE VIAGENS', 'CONTADOR VIAGENS', 'Nº DE VIAGENS', 'NUMERO DE VIAGENS',
  'NÚMERO DE VIAGENS', 'NR VIAGENS', 'NUMERO VIAGENS', 'VIAGENS POR ROTA',
  'KM ROTA 01', 'KM CHEGADA ROTA 01', 'HORA ROTA 01', 'HORA CHEGADA ROTA 01', 'HORA SAÍDA ROTA 01',
  'KM ROTA 02', 'KM CHEGADA ROTA 02', 'HORA ROTA 02', 'HORA CHEGADA ROTA 02', 'HORA SAÍDA ROTA 02',
  'KM ROTA 03', 'KM CHEGADA ROTA 03', 'HORA ROTA 03', 'HORA CHEGADA ROTA 03', 'HORA CHEGA ROTA 03',
  'KM ROTA 04', 'KM CHEGADA ROTA 04', 'HORA ROTA 04', 'HORA CHEGADA ROTA 04', 'HORA SAÍDA ROTA 04',
  'DIA DA SEMANA',
  'COLETOR 01', 'COLETOR 02', 'COLETOR 03', 'COLETOR 04',
  'PESO1', 'PESO2', 'PESO3', 'PESO4', 'PESO5', 'PESOTOTAL', 'KMTOTAL',
];

export interface KpiComColunas {
  expressao?: string | null;
  formula?: string | null;
  coluna?: string | null;
  coluna2?: string | null;
}

function citar(texto: string, destino: Set<string>): void {
  const limpo = texto.trim();
  if (!limpo || limpo === '*' || limpo.length > 80) return;
  if (/[+\-*/()]/.test(limpo)) return;
  destino.add(limpo);
}

/** Nomes de coluna citados nas fórmulas dos KPIs ativos. */
export function colunasCitadasNaFormula(expressao: string): string[] {
  const destino = new Set<string>();
  const expr = expressao || '';
  const agregada = /\b(?:SUM|AVG|MIN|MAX|COUNT)\s*\(\s*(?:DISTINCT\s+)?([^)]+?)\s*\)/gi;
  const distinta = /\bCOUNT\s+DISTINCT\s*\(\s*([^)]+?)\s*\)/gi;
  const faturamento = /\bFATURAMENTO_EST\s*\(\s*([^,)]+)\s*,\s*([^)]+?)\s*\)/gi;
  for (const match of expr.matchAll(agregada)) citar(match[1].split(/\s+SE\s+/i)[0], destino);
  for (const match of expr.matchAll(distinta)) citar(match[1], destino);
  for (const match of expr.matchAll(faturamento)) {
    citar(match[1], destino);
    citar(match[2], destino);
  }
  return [...destino];
}

/**
 * Chaves do JSON `dados` que o executivo usa.
 * O restante da linha da planilha não viaja para o Node.
 */
export function colunasJsonDoExecutivo(
  kpis: KpiComColunas[] = [],
  extras: Array<string | null | undefined> = [],
): string[] {
  const destino = new Set<string>(COLUNAS_FIXAS);
  for (const extra of extras) {
    if (extra && extra.trim()) destino.add(extra.trim());
  }
  for (const kpi of kpis) {
    for (const nome of [kpi.coluna, kpi.coluna2]) {
      if (nome && nome.trim()) destino.add(nome.trim());
    }
    for (const expr of [kpi.expressao, kpi.formula]) {
      if (!expr) continue;
      for (const coluna of colunasCitadasNaFormula(expr)) destino.add(coluna);
    }
  }
  return [...destino];
}
