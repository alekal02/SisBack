import * as XLSX from 'xlsx';
import { isNomeColunaInvalido } from './PadraoPlanilhaDetector';
import { analisarKmRotaExcessivoPreview, MAX_KM_ROTA } from './kmRotaValidacaoService';
import { excelSerialDataInvalido, formatarDataPlanilha, parseDataPlanilha } from '../utils/formatarDataPlanilha';

/* ═══════════════════════════════════════════════════════
   QUALIDADE PLANILHA PREVIEW SERVICE
   Analisa a qualidade de uma planilha Excel ANTES da
   importação, detectando problemas como:
   - Células vazias em colunas críticas
   - Linhas totalmente vazias
   - Dados/lixo no final da planilha
   - Cabeçalhos inconsistentes
   - Datas inválidas
   - Valores inconsistentes
   - Duplicatas na própria planilha
   - Colunas com alto % de preenchimento faltante
   ═══════════════════════════════════════════════════════ */

/* ─── TIPOS ─── */
export interface ProblemaPreview {
  tipo: string;
  label: string;
  descricao: string;
  gravidade: 'crítico' | 'alto' | 'médio' | 'baixo';
  quantidade: number;
  detalhes?: string[];
}

export interface ColunaInfo {
  nome: string;
  tipo: string;
  totalCelulas: number;
  celulasPreenchidas: number;
  celulasVazias: number;
  percentualPreenchimento: number;
  amostraValores: any[];
}

export interface RelatorioQualidadePreview {
  nomeArquivo: string;
  aba: string;
  totalLinhas: number;
  totalColunas: number;
  linhasComDados: number;
  linhasTotalmenteVazias: number;
  linhasVaziasNoFinal: number;
  linhasVaziasNoMeio: number;
  colunas: ColunaInfo[];
  problemas: ProblemaPreview[];
  pontuacaoQualidade: number;
  pontuacaoLegenda: string;
  resumo: {
    registrosValidos: number;
    celulasPreenchidas: number;
    celulasVazias: number;
    percentualGeralPreenchimento: number;
    colunasCriticasFaltantes: string[];
  };
  recomendacoes: string[];
}

/* ─── COLUNAS CRÍTICAS (obrigatórias) ─── */
const COLUNAS_CRITICAS = [
  'DATA SAIDA', 'PLACA', 'MOTORISTA', 'KM SAIDA',
  'KM CHEGADA', 'PESO TOTAL', 'KM TOTAL'
];

const COLUNAS_NOME_ALTERNATIVO: Record<string, string[]> = {
  'DATA SAIDA': ['DATA SAIDA', 'DATA SAÍDA', 'DATA DE SAIDA', 'DATA', 'DIA', 'DATA DE SAÍDA'],
  'PLACA': ['PLACA', 'VEICULO', 'VEÍCULO', 'CAMINHAO', 'CAMINHÃO'],
  'MOTORISTA': ['MOTORISTA', 'OPERADOR', 'NOME MOTORISTA'],
  'KM SAIDA': ['KM SAIDA', 'KM SAÍDA', 'KM SAIDA BASE', 'KM DE SAIDA'],
  'KM CHEGADA': ['KM CHEGADA', 'KM DE CHEGADA', 'KM CHEGADA BASE'],
  'PESO TOTAL': ['PESO TOTAL', 'PESO', 'PESO BRUTO'],
  'KM TOTAL': ['KM TOTAL', 'KM PERCORRIDO', 'DISTANCIA', 'DISTÂNCIA'],
};

function normalizarChave(chave: string): string {
  return chave
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[^A-Z0-9\s]/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function encontrarColunaNoCabecalho(
  cabecalhos: string[],
  nomesAlternativos: string[]
): string | null {
  for (const h of cabecalhos) {
    const hNorm = normalizarChave(h);
    for (const alt of nomesAlternativos) {
      const altNorm = normalizarChave(alt);
      if (hNorm === altNorm || hNorm.includes(altNorm) || altNorm.includes(hNorm)) {
        return h;
      }
    }
  }
  return null;
}

/* ═══════════════════════════════════════════════════════════
   FUNÇÃO PRINCIPAL — Analisa a planilha bruta
   ═══════════════════════════════════════════════════════════ */
export function analisarQualidadePlanilha(
  buffer: Buffer,
  nomeArquivo: string
): RelatorioQualidadePreview {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false, cellNF: false, cellStyles: false });
  const nomeAba = workbook.SheetNames[0];
  const sheet = workbook.Sheets[nomeAba];

  // ─── 1. Converter para array de arrays (bruto, sem pular vazias) ───
  const dadosBrutos: any[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    blankrows: true,
    raw: true,
  });

  if (dadosBrutos.length === 0) {
    return {
      nomeArquivo,
      aba: nomeAba,
      totalLinhas: 0,
      totalColunas: 0,
      linhasComDados: 0,
      linhasTotalmenteVazias: 0,
      linhasVaziasNoFinal: 0,
      linhasVaziasNoMeio: 0,
      colunas: [],
      problemas: [{ tipo: 'planilha_vazia', label: 'Planilha Vazia', descricao: 'A planilha não contém nenhuma linha com dados.', gravidade: 'crítico', quantidade: 1 }],
      pontuacaoQualidade: 0,
      pontuacaoLegenda: 'Crítico',
      resumo: { registrosValidos: 0, celulasPreenchidas: 0, celulasVazias: 0, percentualGeralPreenchimento: 0, colunasCriticasFaltantes: COLUNAS_CRITICAS.slice() },
      recomendacoes: ['A planilha está vazia. Verifique se o arquivo contém dados na primeira aba.'],
    };
  }

  // ─── 2. Extrair cabeçalho (primeira linha) ───
  const cabecalhoRaw = dadosBrutos[0] || [];
  const cabecalho: string[] = cabecalhoRaw.map((v: any) =>
    v !== null && v !== undefined ? String(v).trim() : ''
  );

  // Cabeçalhos válidos — ignora células vazias e artefatos __EMPTY do Excel
  const indicesValidos: number[] = cabecalho
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => !isNomeColunaInvalido(h))
    .map(({ i }) => i);
  const cabecalhoLimpo: string[] = indicesValidos.map(i => cabecalho[i]);

  // Colunas extras no final da planilha (cabeçalho em branco / formatação residual)
  let ultimoIndiceValido = -1;
  for (let i = cabecalho.length - 1; i >= 0; i--) {
    if (!isNomeColunaInvalido(cabecalho[i])) {
      ultimoIndiceValido = i;
      break;
    }
  }
  const colunasExtrasSemCabecalho = ultimoIndiceValido >= 0
    ? cabecalho.length - 1 - ultimoIndiceValido
    : 0;

  // ─── 3. Dados (linhas 1+) ───
  const linhas = dadosBrutos.slice(1);

  // ─── 4. Analisar cada linha ───
  const problemas: ProblemaPreview[] = [];
  const linhasTotalmenteVazias: number[] = [];
  const linhasComDados: number[] = [];
  const linhasVaziasNoMeio: number[] = [];
  const linhasVaziasNoFinal: number[] = [];
  const celulasPreenchidasPorColuna: Map<number, number> = new Map();
  const celulasVaziasPorColuna: Map<number, number> = new Map();
  const amostrasPorColuna: Map<number, any[]> = new Map();

  // Inicializar contadores
  for (let i = 0; i < cabecalhoLimpo.length; i++) {
    celulasPreenchidasPorColuna.set(i, 0);
    celulasVaziasPorColuna.set(i, 0);
    amostrasPorColuna.set(i, []);
  }

  let ultimaLinhaComDadosIndex = -1;

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    const valores = indicesValidos.map(idx => linha[idx] !== undefined ? linha[idx] : null);
    const temAlgumValor = valores.some(v => v !== null && v !== '' && v !== undefined);

    if (!temAlgumValor) {
      linhasTotalmenteVazias.push(i);
    } else {
      linhasComDados.push(i);
      ultimaLinhaComDadosIndex = i;

      for (let j = 0; j < indicesValidos.length; j++) {
        const idx = indicesValidos[j];
        const valor = linha[idx];
        if (j >= cabecalhoLimpo.length) break;

        if (valor !== null && valor !== '' && valor !== undefined) {
          celulasPreenchidasPorColuna.set(
            j, (celulasPreenchidasPorColuna.get(j) || 0) + 1
          );
          const amostra = amostrasPorColuna.get(j) || [];
          if (amostra.length < 3) {
            amostra.push(valor);
            amostrasPorColuna.set(j, amostra);
          }
        } else {
          celulasVaziasPorColuna.set(
            j, (celulasVaziasPorColuna.get(j) || 0) + 1
          );
        }
      }
    }
  }

  // ─── Classificar linhas vazias ───
  // Após a última linha com dados = vazias no final
  // Antes/entre os dados = vazias no meio
  for (const i of linhasTotalmenteVazias) {
    if (i > ultimaLinhaComDadosIndex) {
      linhasVaziasNoFinal.push(i);
    } else {
      linhasVaziasNoMeio.push(i);
    }
  }

  // ─── 5. Problema: Linhas vazias no final ───
  if (linhasVaziasNoFinal.length > 0) {
    problemas.push({
      tipo: 'linhas_vazias_final',
      label: 'Linhas Vazias no Final',
      descricao: `${linhasVaziasNoFinal.length} linha(s) totalmente vazia(s) encontrada(s) no FINAL da planilha, após a última linha com dados. Podem ser resquícios de dados apagados ou formatação residual.`,
      gravidade: linhasVaziasNoFinal.length > 10 ? 'médio' : 'baixo',
      quantidade: linhasVaziasNoFinal.length,
    });
  }

  // ─── 6. Problema: Linhas vazias no meio ───
  if (linhasVaziasNoMeio.length > 0) {
    problemas.push({
      tipo: 'linhas_vazias_meio',
      label: 'Linhas Vazias no Meio',
      descricao: `${linhasVaziasNoMeio.length} linha(s) vazia(s) no MEIO dos dados. Isso pode indicar quebras na sequência de registros.`,
      gravidade: linhasVaziasNoMeio.length > 3 ? 'alto' : 'médio',
      quantidade: linhasVaziasNoMeio.length,
    });
  }

  // ─── 7. Mapear colunas críticas e verificar preenchimento ───
  const colunasInfo: ColunaInfo[] = [];
  const colunasCriticasFaltantes: string[] = [];

  for (let j = 0; j < cabecalhoLimpo.length; j++) {
    const nomeColuna = cabecalhoLimpo[j];
    const totalCelulas = linhasComDados.length;
    const preenchidas = celulasPreenchidasPorColuna.get(j) || 0;
    const vazias = celulasVaziasPorColuna.get(j) || 0;
    const percentual = totalCelulas > 0 ? Math.round((preenchidas / totalCelulas) * 1000) / 10 : 0;
    const amostra = amostrasPorColuna.get(j) || [];

    // Inferir tipo baseado na amostra
    let tipoColuna = 'texto';
    if (amostra.length > 0) {
      const nums = amostra.filter(v => typeof v === 'number' && !isNaN(v));
      const strings = amostra.filter(v => typeof v === 'string');
      if (nums.length > strings.length && nums.length >= 2) {
        tipoColuna = 'numero';
      }
      // Verificar se parece data (serial Excel entre 40000 e 60000)
      if (nums.some(v => v > 40000 && v < 60000)) {
        tipoColuna = 'data';
      }
    }

    colunasInfo.push({
      nome: nomeColuna,
      tipo: tipoColuna,
      totalCelulas,
      celulasPreenchidas: preenchidas,
      celulasVazias: vazias,
      percentualPreenchimento: percentual,
      amostraValores: tipoColuna === 'data'
        ? amostra.map(v => formatarDataPlanilha(v) ?? v)
        : amostra,
    });

    // Verificar se é coluna crítica
    const ehColunaCritica = COLUNAS_CRITICAS.some(crit => {
      const alternativos = COLUNAS_NOME_ALTERNATIVO[crit] || [crit];
      return alternativos.some(alt => normalizarChave(alt) === normalizarChave(nomeColuna));
    });

    // Problema: coluna com baixo preenchimento
    if (ehColunaCritica && percentual < 100 && totalCelulas > 0) {
      const vaziasNestaColuna = totalCelulas - preenchidas;
      if (vaziasNestaColuna > 0) {
        const gravidade = vaziasNestaColuna > totalCelulas * 0.5 ? 'crítico'
          : vaziasNestaColuna > totalCelulas * 0.2 ? 'alto' : 'médio';

        problemas.push({
          tipo: `coluna_vazia_${normalizarChave(nomeColuna)}`,
          label: `"${nomeColuna}" com Dados Faltantes`,
          descricao: `${vaziasNestaColuna} de ${totalCelulas} células vazias (${100 - percentual}%) na coluna "${nomeColuna}". Esta é uma coluna crítica para análise.`,
          gravidade,
          quantidade: vaziasNestaColuna,
        });
      }
    }

    // Problema: coluna com 100% vazia
    if (totalCelulas > 0 && percentual === 0 && !nomeColuna.startsWith('__EMPTY')) {
      problemas.push({
        tipo: `coluna_totalmente_vazia_${normalizarChave(nomeColuna)}`,
        label: `"${nomeColuna}" Totalmente Vazia`,
        descricao: `A coluna "${nomeColuna}" está 100% vazia em todas as ${totalCelulas} linhas com dados. Pode ser uma coluna desnecessária ou dados que não foram preenchidos.`,
        gravidade: 'baixo',
        quantidade: totalCelulas,
      });
    }
  }

  // ─── 8. Verificar colunas críticas que não existem no cabeçalho ───
  for (const colCritica of COLUNAS_CRITICAS) {
    const alternativos = COLUNAS_NOME_ALTERNATIVO[colCritica] || [colCritica];
    const encontrada = colunasInfo.some(c =>
      alternativos.some(alt => normalizarChave(alt) === normalizarChave(c.nome))
    );
    if (!encontrada) {
      colunasCriticasFaltantes.push(colCritica);
      problemas.push({
        tipo: `coluna_faltando_${normalizarChave(colCritica)}`,
        label: `Coluna "${colCritica}" Ausente`,
        descricao: `A coluna "${colCritica}" não foi encontrada no cabeçalho da planilha. Pode estar com nome diferente ou realmente ausente.`,
        gravidade: 'crítico',
        quantidade: 1,
      });
    }
  }

  // ─── 9. Detectar duplicatas na planilha ───
  // Usar DATA SAIDA + PLACA como chave
  const colData = encontrarColunaNoCabecalho(cabecalhoLimpo, COLUNAS_NOME_ALTERNATIVO['DATA SAIDA']);
  const colPlaca = encontrarColunaNoCabecalho(cabecalhoLimpo, COLUNAS_NOME_ALTERNATIVO['PLACA']);
  const colMotorista = encontrarColunaNoCabecalho(cabecalhoLimpo, COLUNAS_NOME_ALTERNATIVO['MOTORISTA']);

  if (colData && colPlaca) {
    const idxData = cabecalhoLimpo.indexOf(colData);
    const idxPlaca = cabecalhoLimpo.indexOf(colPlaca);
    const idxMotorista = colMotorista ? cabecalhoLimpo.indexOf(colMotorista) : -1;

    const visto = new Map<string, number[]>();
    for (const i of linhasComDados) {
      const linha = linhas[i];
      const data = linha[indicesValidos[idxData]];
      const placa = linha[indicesValidos[idxPlaca]];
      const motorista = idxMotorista >= 0 ? linha[indicesValidos[idxMotorista]] : null;

      if (data && placa) {
        const chave = `${data}|${placa}`;
        if (!visto.has(chave)) {
          visto.set(chave, []);
        }
        visto.get(chave)!.push(i);
      }
    }

    let totalDuplicatas = 0;
    const linhasDuplicadas: string[] = [];
    for (const [chave, linhas] of visto.entries()) {
      if (linhas.length > 1) {
        totalDuplicatas += linhas.length - 1;
        if (linhasDuplicadas.length < 5) {
          const [data, placa] = chave.split('|');
          linhasDuplicadas.push(`Data: ${formatarDataPlanilha(data) ?? data}, Placa: ${placa} (${linhas.length}x)`);
        }
      }
    }

    if (totalDuplicatas > 0) {
      problemas.push({
        tipo: 'duplicatas_planilha',
        label: 'Registros Duplicados na Planilha',
        descricao: `${totalDuplicatas} registro(s) duplicado(s) encontrado(s) na própria planilha (mesma DATA + PLACA). Podem causar distorções nos totais do dashboard.`,
        gravidade: totalDuplicatas > 10 ? 'alto' : 'médio',
        quantidade: totalDuplicatas,
        detalhes: linhasDuplicadas,
      });
    }
  }

  // ─── 10. Detectar valores negativos em campos numéricos ───
  const colunasNumericas = ['KM SAIDA', 'KM CHEGADA', 'KM TOTAL', 'PESO TOTAL', 'PESO 1', 'PESO 2'];
  let totalNegativos = 0;
  const detalhesNegativos: string[] = [];

  for (const nomeNumerico of colunasNumericas) {
    const colEncontrada = encontrarColunaNoCabecalho(cabecalhoLimpo, COLUNAS_NOME_ALTERNATIVO[nomeNumerico] || [nomeNumerico]);
    if (!colEncontrada) continue;

    const idx = cabecalhoLimpo.indexOf(colEncontrada);
    if (idx < 0) continue;
    const idxReal = indicesValidos[idx];

    let negativos = 0;
    for (const i of linhasComDados) {
      const valor = linhas[i][idxReal];
      if (typeof valor === 'number' && valor < 0) {
        negativos++;
      }
    }

    if (negativos > 0) {
      totalNegativos += negativos;
      detalhesNegativos.push(`${nomeNumerico}: ${negativos} negativo(s)`);
    }
  }

  if (totalNegativos > 0) {
    problemas.push({
      tipo: 'valores_negativos',
      label: 'Valores Negativos em Campos Numéricos',
      descricao: `${totalNegativos} campo(s) com valor negativo encontrado(s). KM ou peso negativo indicam erro de digitação ou leitura.`,
      gravidade: 'crítico',
      quantidade: totalNegativos,
      detalhes: detalhesNegativos,
    });
  }

  // ─── 11. Detectar datas inválidas ───
  if (colData) {
    const idx = cabecalhoLimpo.indexOf(colData);
    const idxReal = indicesValidos[idx];
    let datasInvalidas = 0;

    for (const i of linhasComDados) {
      const valor = linhas[i][idxReal];
      if (valor !== null && valor !== undefined && valor !== '') {
        if (typeof valor === 'number') {
          if (excelSerialDataInvalido(valor)) datasInvalidas++;
        } else if (typeof valor === 'string') {
          const trimmed = valor.trim();
          if (trimmed.length > 0 && !parseDataPlanilha(trimmed)) datasInvalidas++;
        }
      }
    }

    if (datasInvalidas > 0) {
      problemas.push({
        tipo: 'datas_invalidas',
        label: 'Datas Inválidas ou Fora do Esperado',
        descricao: `${datasInvalidas} registro(s) com data inválida, muito antiga ou muito futura. Verifique as células de data.`,
        gravidade: 'alto',
        quantidade: datasInvalidas,
      });
    }
  }

  // ─── 12. Detectar linha de cabeçalho extra ou dados inconsistentes ───
  // Verificar se a segunda linha parece ser outro cabeçalho (strings curtas)
  if (linhasComDados.length >= 1) {
    const primeiraLinhaDados = linhas[linhasComDados[0]];
    const valoresPrimeiraLinha = indicesValidos
      .map(idx => primeiraLinhaDados[idx])
      .filter(v => v !== null && v !== '' && v !== undefined);

    // Se a primeira linha tem muitos valores textuais que parecem cabeçalho
    const textosLongos = valoresPrimeiraLinha.filter(v => typeof v === 'string' && v.length > 3);
    const numeros = valoresPrimeiraLinha.filter(v => typeof v === 'number');

    if (textosLongos.length > numeros.length && textosLongos.length >= 3 && linhasComDados.length > 1) {
      // Pode ser um sub-cabeçalho ou linha de totais
      problemas.push({
        tipo: 'possivel_cabecalho_extra',
        label: 'Possível Cabeçalho Extra ou Linha de Total',
        descricao: 'A primeira linha de dados contém principalmente texto, o que pode indicar um sub-cabeçalho ou linha de total. Verifique se não há uma linha de totais sendo tratada como dado.',
        gravidade: 'médio',
        quantidade: 1,
      });
    }
  }

  // ─── 13. Colunas extras sem cabeçalho (artefato Excel / formatação residual) ───
  if (colunasExtrasSemCabecalho > 0) {
    problemas.push({
      tipo: 'colunas_extras_sem_cabecalho',
      label: 'Colunas Extras sem Cabeçalho',
      descricao: `${colunasExtrasSemCabecalho} coluna(s) no final da planilha sem nome no cabeçalho (células vazias após a última coluna válida). Essas colunas foram ignoradas e não serão importadas.`,
      gravidade: colunasExtrasSemCabecalho > 10 ? 'médio' : 'baixo',
      quantidade: colunasExtrasSemCabecalho,
    });
  }

  // ─── 14. KM da rota acima do limite operacional ───
  const analiseKmRota = analisarKmRotaExcessivoPreview(
    cabecalhoLimpo,
    indicesValidos,
    linhas,
    linhasComDados,
  );
  if (analiseKmRota.registrosAfetados > 0) {
    problemas.push({
      tipo: 'km_rota_alto',
      label: `KM da Rota acima de ${MAX_KM_ROTA} km`,
      descricao: `${analiseKmRota.registrosAfetados} registro(s) com quilometragem de rota superior a ${MAX_KM_ROTA} km (${analiseKmRota.totalOcorrencias} ocorrência(s)). Verifique distâncias por rota (01 a 04) ou diferença KM CHEGADA − KM SAÍDA.`,
      gravidade: analiseKmRota.registrosAfetados > 5 ? 'alto' : 'médio',
      quantidade: analiseKmRota.registrosAfetados,
      detalhes: analiseKmRota.detalhes,
    });
  }

  // ─── 15. Cálculo de pontuação de qualidade ───
  let pontuacao = 100;
  const totalCelulasGeral = colunasInfo.reduce((acc, c) => acc + c.totalCelulas, 0);
  const totalPreenchidasGeral = colunasInfo.reduce((acc, c) => acc + c.celulasPreenchidas, 0);
  const totalVaziasGeral = colunasInfo.reduce((acc, c) => acc + c.celulasVazias, 0);

  for (const p of problemas) {
    const fator = Math.min(p.quantidade / Math.max(linhasComDados.length, 1), 1);
    switch (p.gravidade) {
      case 'crítico': pontuacao -= 20 * fator; break;
      case 'alto': pontuacao -= 12 * fator; break;
      case 'médio': pontuacao -= 6 * fator; break;
      case 'baixo': pontuacao -= 2 * fator; break;
    }
  }

  // Penalidade adicional por baixo preenchimento geral
  const percGeral = totalCelulasGeral > 0
    ? Math.round((totalPreenchidasGeral / totalCelulasGeral) * 1000) / 10
    : 0;

  pontuacao = Math.max(0, Math.min(100, Math.round(pontuacao)));

  const pontuacaoLegenda =
    pontuacao >= 90 ? 'Excelente' :
    pontuacao >= 70 ? 'Boa' :
    pontuacao >= 50 ? 'Regular' : 'Crítico';

  // ─── 15. Recomendações ───
  const recomendacoes: string[] = [];

  if (colunasCriticasFaltantes.length > 0) {
    recomendacoes.push(`Adicione as colunas obrigatórias ausentes: ${colunasCriticasFaltantes.join(', ')}.`);
  }

  const colunasBaixoPreenchimento = colunasInfo.filter(
    c => c.percentualPreenchimento < 100 && c.percentualPreenchimento > 0 &&
    COLUNAS_CRITICAS.some(crit => {
      const alternativos = COLUNAS_NOME_ALTERNATIVO[crit] || [crit];
      return alternativos.some(alt => normalizarChave(alt) === normalizarChave(c.nome));
    })
  );

  if (colunasBaixoPreenchimento.length > 0) {
    recomendacoes.push(`Preencha os campos vazios nas colunas: ${colunasBaixoPreenchimento.map(c => `"${c.nome}" (${100 - c.percentualPreenchimento}%)`).join(', ')}.`);
  }

  if (linhasVaziasNoFinal.length > 0) {
    recomendacoes.push(`Remova as ${linhasVaziasNoFinal.length} linhas vazias no final da planilha para evitar processamento desnecessário.`);
  }

  const probDuplicatas = problemas.find(p => p.tipo === 'duplicatas_planilha');
  if (probDuplicatas) {
    recomendacoes.push('Remova os registros duplicados (mesma DATA + PLACA) para evitar distorções nos totais.');
  }

  const probNegativos = problemas.find(p => p.tipo === 'valores_negativos');
  if (probNegativos) {
    recomendacoes.push('Corrija os valores negativos de KM e Peso — eles indicam erro de digitação ou leitura do hodômetro.');
  }

  const probKmRota = problemas.find(p => p.tipo === 'km_rota_alto');
  if (probKmRota) {
    recomendacoes.push(
      `Revise registros com KM de rota acima de ${MAX_KM_ROTA} km — confira se a coluna traz distância da rota e não leitura do hodômetro.`,
    );
  }

  if (percGeral < 80) {
    recomendacoes.push(`A planilha tem apenas ${percGeral}% de preenchimento geral. Revise os dados antes de importar.`);
  }

  // Ordenar problemas por gravidade
  const ordemGravidade: Record<string, number> = { crítico: 0, alto: 1, médio: 2, baixo: 3 };
  problemas.sort((a, b) => ordemGravidade[a.gravidade] - ordemGravidade[b.gravidade]);

  return {
    nomeArquivo,
    aba: nomeAba,
    totalLinhas: dadosBrutos.length - 1, // menos cabeçalho
    totalColunas: cabecalhoLimpo.length,
    linhasComDados: linhasComDados.length,
    linhasTotalmenteVazias: linhasTotalmenteVazias.length,
    linhasVaziasNoFinal: linhasVaziasNoFinal.length,
    linhasVaziasNoMeio: linhasVaziasNoMeio.length,
    colunas: colunasInfo,
    problemas,
    pontuacaoQualidade: pontuacao,
    pontuacaoLegenda,
    resumo: {
      registrosValidos: linhasComDados.length, // linhas com algum dado (pré-importação)
      celulasPreenchidas: totalPreenchidasGeral,
      celulasVazias: totalVaziasGeral,
      percentualGeralPreenchimento: percGeral,
      colunasCriticasFaltantes,
    },
    recomendacoes,
  };
}
