/* ============================================
   AutoIndicatorService — Geracao Automatica de KPIs e Graficos

   Analisa colunas da planilha e gera indicadores inteligentes:
   - Colunas numericas → soma, media, minimo, maximo
   - Colunas de texto com < 50 valores unicos → COUNT DISTINCT
   - Colunas de data → periodo coberto
   - Colunas de hora → total de horas
   - Colunas financeiras → faturamento estimado (se contrato tiver valores)
   - Colunas de performance → ton/km, km/viagem, etc.
   - Graficos: pizza (texto < 20 unicos), linha (numerico + data)
   - POR TIPO DE SERVICO: presets especificos (coleta_caminhao, rocadeira, etc.)
   ============================================ */

import { Repository } from 'typeorm';
import AppDataSource from '../database/data-source';
import { Servico } from '../entities/Servico';
import { Contract } from '../entities/Contract';
import PlanilhaService from './PlanilhaService';
import { obterDadosServicoComCache } from './servicoDadosCache';
import { normalizarChave } from './FormulaEngine';
import { TipoServico } from '../enums/TipoServico';

// ─── Tipos Publicos ───

export type TipoColuna = 'numero' | 'texto' | 'data' | 'hora' | 'desconhecido';
export type AgregacaoSugerida = 'sum' | 'avg' | 'min' | 'max' | 'count_distinct' | 'count' | 'periodo' | 'soma_horas';
export type FormatoSugerido = 'numero' | 'moeda' | 'porcentagem';

export interface ColunaInfo {
  nome: string;
  tipo: TipoColuna;
  valoresUnicos: number;
  amostras: (string | number | null)[];
  nulos: number;
}

export interface IndicadorSugerido {
  coluna: string;
  operacao: AgregacaoSugerida;
  nomeSugerido: string;
  formato: FormatoSugerido;
  categoria?: string;
  descricao?: string;
  expressao?: string;
  unidade?: string;
  financeiro?: boolean;
  performance?: boolean;
  cor?: string;
}

export interface GraficoSugerido {
  tipo: 'barra' | 'linha' | 'pizza';
  titulo: string;
  eixoX: string;
  eixoY: string;
  descricao?: string;
  automatico: boolean;
}

export interface AnaliseAutoIndicadores {
  servicoId: string;
  servicoNome: string;
  totalRegistros: number;
  colunas: ColunaInfo[];
  indicadoresSugeridos: IndicadorSugerido[];
  graficosSugeridos: GraficoSugerido[];
  colunasOriginais: string[];
  temColunasNovas?: boolean;
  colunasRemovidas?: string[];
  colunasAdicionadas?: string[];
}

// ─── Constantes de busca de colunas ───

const COL_PESO = ['PESO TOTAL', 'PESO', 'PESOTOTAL', 'PESO_TOTAL', 'TONELADA', 'TON', 'TONELADAS', 'KG', 'QUILO'];
const COL_KM = ['KM TOTAL', 'KM', 'KMTOTAL', 'KM_TOTAL', 'QUILOMETRO', 'DISTANCIA', 'DISTANCIA', 'KILOMETRO'];
const COL_CAMINHAO = ['CAMINHAO', 'CAMINHAO', 'TIPO CAMINHAO', 'TIPO_CAMINHAO', 'TIPO CAMINHAO', 'VEICULO', 'VEICULO', 'PLACA', 'COLETOR', 'COLETORA', 'EQUIPAMENTO'];
const COL_TIPO = ['CAMINHAO', 'CAMINHAO', 'TIPO CAMINHAO', 'TIPO_CAMINHAO', 'TIPO CAMINHAO', 'TIPO'];
const COL_DATA = ['DATA SAIDA', 'DATA SAIDA', 'DATA', 'DIA', 'DATA DE SAIDA', 'DATA DE SAIDA', 'DATA COLETA'];
const COL_HORA = ['HORA SAIDA', 'HORA SAIDA', 'HORA', 'HORA DE SAIDA', 'HORA DE SAIDA', 'HORASAIDA', 'HORA_SAIDA', 'HORA SAIDA BASE', 'HORASAIDABASE', 'HORA SAIDA BASE', 'HR SAIDA BASE', 'HR_SAIDA_BASE', 'HRSAIDABASE', 'SAIDA BASE'];
const COL_HORA_CHEGADA = ['HORA CHEGADA', 'HORA DE CHEGADA', 'HORACHEGADA', 'HORA_CHEGADA', 'HORA RETORNO', 'HORA CHEGADA BASE', 'HORACHEGADABASE', 'HR CHEGA BASE', 'HR_CHEGA_BASE', 'HRCHEGABASE', 'CHEGADA BASE'];
const COL_MOTORISTA = ['MOTORISTA', 'OPERADOR', 'NOME', 'NOME MOTORISTA', 'NOME DO MOTORISTA'];
const COL_PLACA = ['PLACA', 'CAMINHAO', 'CAMINHAO', 'VEICULO', 'VEICULO', 'COLETOR'];
const COL_VIAGENS = ['N.DE VIAGENS', 'NUMERO DE VIAGENS', 'NUMERO DE VIAGENS', 'VIAGENS', 'VIAGEM', 'QTD VIAGENS'];
const COL_NRO_COLETORES = ['N.DE COLETORES', 'NDECOLETORES', 'NUMERO DE COLETORES', 'NUMERO DE COLETORES', 'QTDE COLETORES', 'NRO COLETORES', 'QTD COLETORES'];
const COL_CUSTO = ['CUSTO', 'VALOR', 'CUSTO TOTAL', 'CUSTO_TOTAL', 'DESPESA', 'GASTO'];
const COL_FATURAMENTO = ['FATURAMENTO', 'RECEITA', 'VALOR TOTAL', 'VALOR_TOTAL', 'TOTAL R$'];

function colunaKmEhHodometro(nome: string): boolean {
  const n = normalizarChave(nome);
  return n.includes('KM') && (n.includes('SAIDA') || n.includes('CHEGADA') || n.includes('ROTA') || n.includes('BASE'));
}

function candidatoBuscaKmDistancia(norm: string): boolean {
  if (norm.includes('SAIDA') || norm.includes('CHEGADA') || norm.includes('ROTA') || norm.includes('BASE')) return false;
  return norm.includes('KM') || norm.includes('QUILOMET') || norm.includes('KILOMET') || norm.includes('DISTANCIA') || norm.includes('VARRID');
}

/** Escolhe coluna de KM de distância, sem hodômetro de saída/chegada/rota. */
export function encontrarColunaKmDistancia(colunas: Pick<ColunaInfo, 'nome'>[], candidatos: string[]): string {
  return encontrarColuna(colunas as ColunaInfo[], candidatos);
}

function encontrarColuna(colunas: ColunaInfo[], candidatos: string[]): string {
  for (const candidato of candidatos) {
    const norm = normalizarChave(candidato);
    for (const col of colunas) {
      if (candidatoBuscaKmDistancia(norm) && colunaKmEhHodometro(col.nome)) continue;
      if (normalizarChave(col.nome) === norm) return col.nome;
    }
  }
  for (const candidato of candidatos) {
    const norm = normalizarChave(candidato);
    if (norm.length < 4) continue;
    for (const col of colunas) {
      if (candidatoBuscaKmDistancia(norm) && colunaKmEhHodometro(col.nome)) continue;
      const colNorm = normalizarChave(col.nome);
      if (colNorm.includes(norm) || norm.includes(colNorm)) return col.nome;
    }
  }
  return '';
}

function encontrarColunas(colunas: ColunaInfo[], candidatos: string[]): string[] {
  return candidatos.map(c => {
    const norm = normalizarChave(c);
    return colunas.find(col => normalizarChave(col.nome) === norm)?.nome;
  }).filter(Boolean) as string[];
}

function colunasQueContem(colunas: ColunaInfo[], termo: string): ColunaInfo[] {
  const norm = normalizarChave(termo);
  return colunas.filter(c => normalizarChave(c.nome).includes(norm));
}

function corDaCategoria(categoria: string): string {
  const cores: Record<string, string> = {
    'Financeiro': '#059669',
    'Produtividade': '#3b82f6',
    'Operacional': '#f59e0b',
    'Custo': '#ef4444',
    'Qualidade': '#a855f7',
    'Eficiencia': '#14b8a6',
    'Outro': '#64748b',
  };
  return cores[categoria] || '#64748b';
}

/* ============================================================
   Classe Principal
   ============================================================ */

export class AutoIndicatorService {
  private get servicoRepo(): Repository<Servico> {
    return AppDataSource.getRepository(Servico);
  }

  private get contractRepo(): Repository<Contract> {
    return AppDataSource.getRepository(Contract);
  }

  async analisar(
    servicoId: string,
    contractId: string,
    colunasDetectadas?: ColunaInfo[],
    dadosBrutos?: Record<string, any>[]
  ): Promise<AnaliseAutoIndicadores> {
    const servico = await this.servicoRepo.findOne({ where: { id: servicoId } });
    if (!servico) throw new Error('Servico nao encontrado');

    const contract = await this.contractRepo.findOne({ where: { id: contractId } });
    const valoresFixos = this.extrairValoresFixos(contract);

    let colunas: ColunaInfo[] = colunasDetectadas || [];
    if (colunas.length === 0 && servico.padraoPlanilha?.colunas) {
      colunas = servico.padraoPlanilha.colunas.map((c: any) => ({
        nome: c.nome,
        tipo: c.tipo as TipoColuna,
        valoresUnicos: c.valoresUnicos || 0,
        amostras: c.amostras || [],
        nulos: c.nulos || 0,
      }));
    }

    let dados = dadosBrutos || [];
    if (dados.length === 0) {
      try {
        dados = await obterDadosServicoComCache(servicoId);
      } catch { /* sem dados */ }
    }

    const indicadores: IndicadorSugerido[] = [];
    const graficos: GraficoSugerido[] = [];
    const colunasOriginais = colunas.map(c => c.nome);

    const colunasNum = colunas.filter(c => c.tipo === 'numero');
    const colunasTexto = colunas.filter(c => c.tipo === 'texto');
    const colunasData = colunas.filter(c => c.tipo === 'data');
    const colunasHora = colunas.filter(c => c.tipo === 'hora');

    const colPeso = encontrarColuna(colunas, COL_PESO);
    const colKm = encontrarColuna(colunas, COL_KM);
    const colCaminhao = encontrarColuna(colunas, COL_CAMINHAO);
    const colTipo = encontrarColuna(colunas, COL_TIPO);
    const colData = encontrarColuna(colunas, COL_DATA);
    const colunasSemRota = colunas.filter((c) => !normalizarChave(c.nome).includes('ROTA'));
    const colHora = encontrarColuna(colunasSemRota, COL_HORA);
    const colHoraChegada = encontrarColuna(colunasSemRota, COL_HORA_CHEGADA);
    const colMotorista = encontrarColuna(colunas, COL_MOTORISTA);
    const colPlaca = encontrarColuna(colunas, COL_PLACA);
    const colViagens = encontrarColuna(colunas, COL_VIAGENS);
    const colNroColetores = encontrarColuna(colunas, COL_NRO_COLETORES);
    const colCusto = encontrarColuna(colunas, COL_CUSTO);
    const colFaturamento = encontrarColuna(colunas, COL_FATURAMENTO);

    const colDataUsar = colData || colunasData[0]?.nome || '';
    const temValorCaminhao = Object.values(valoresFixos).some(v => v > 0);
    const totalRegistros = dados.length || colunasNum[0]?.valoresUnicos || 0;

    // ==============================================================
    // 1. INDICADORES PARA COLUNAS NUMERICAS
    // ==============================================================
    for (const col of colunasNum) {
      const nomeLimp = col.nome.trim();
      const norm = normalizarChave(nomeLimp);

      if (/^(ID|COD|CODIGO|CODIGO|NUM|NUMERO|INDEX|LINHA|ORDEM)$/i.test(nomeLimp) && col.valoresUnicos > 50) continue;
      if (norm.includes('DIASEMANA') || norm.includes('DIADASEMANA') || norm === 'ANO' || norm === 'MES' || norm === 'MES') continue;
      if (col.valoresUnicos <= 1) continue;
      if (/^[a-z_]+(_id|Id)$/i.test(nomeLimp)) continue;

      const eMetrica = (
        norm.includes('PESO') || norm.includes('TONELADA') || norm.includes('KG') ||
        norm.includes('KM') || norm.includes('QUILOMETRO') || norm.includes('DISTANCIA') ||
        norm.includes('VALOR') || norm.includes('CUSTO') || norm.includes('RECEITA') ||
        norm.includes('FATURAMENTO') || norm.includes('HORA') || norm.includes('TEMPO') ||
        norm.includes('DURACAO') || norm.includes('VIAGEM') || norm.includes('LITRO') ||
        norm.includes('PRECO') || norm.includes('PRECO')
      );

      indicadores.push({
        coluna: nomeLimp,
        operacao: 'sum',
        nomeSugerido: nomeLimp + ' — Total',
        formato: 'numero',
        categoria: 'Operacional',
        descricao: 'Soma total de ' + nomeLimp,
        unidade: norm.includes('PESO') || norm.includes('TONELADA') ? 'ton' : norm.includes('KM') ? 'km' : '',
        cor: corDaCategoria('Operacional'),
      });

      if (eMetrica) {
        indicadores.push({
          coluna: nomeLimp, operacao: 'avg', nomeSugerido: nomeLimp + ' — Media',
          formato: 'numero', categoria: 'Operacional', descricao: 'Valor medio de ' + nomeLimp, unidade: '',
          cor: corDaCategoria('Operacional'),
        });
        indicadores.push({
          coluna: nomeLimp, operacao: 'min', nomeSugerido: nomeLimp + ' — Minimo',
          formato: 'numero', categoria: 'Operacional', descricao: 'Valor minimo de ' + nomeLimp, unidade: '',
          cor: corDaCategoria('Operacional'),
        });
        indicadores.push({
          coluna: nomeLimp, operacao: 'max', nomeSugerido: nomeLimp + ' — Maximo',
          formato: 'numero', categoria: 'Operacional', descricao: 'Valor maximo de ' + nomeLimp, unidade: '',
          cor: corDaCategoria('Operacional'),
        });
      }
    }

    // ==============================================================
    // 2. INDICADORES PARA COLUNAS DE TEXTO (< 50 unicos)
    // ==============================================================
    for (const col of colunasTexto) {
      if (col.valoresUnicos >= 50) continue;
      const nomeLimp = col.nome.trim();
      const norm = normalizarChave(nomeLimp);

      let nomeAmigavel = '';
      if (norm.includes('CAMINHAO') || norm.includes('VEICULO') || norm.includes('COLETOR')) nomeAmigavel = 'Caminhoes';
      else if (norm.includes('MOTORISTA') || norm.includes('OPERADOR')) nomeAmigavel = 'Coletores';
      else if (norm.includes('PLACA')) nomeAmigavel = 'Caminhoes';
      else if (norm.includes('REGIONAL') || norm.includes('REGIAO')) nomeAmigavel = 'Regionais';
      else if (norm.includes('DISTRITO') || norm.includes('BAIRRO')) nomeAmigavel = 'Distritos';
      else if (norm.includes('TURNO')) nomeAmigavel = 'Turnos';
      else if (norm.includes('TIPO')) nomeAmigavel = 'Tipos';
      else nomeAmigavel = nomeLimp;

      indicadores.push({
        coluna: nomeLimp, operacao: 'count_distinct',
        nomeSugerido: 'Quantidade de ' + nomeAmigavel,
        formato: 'numero', categoria: 'Operacional',
        descricao: 'Contagem distinta de ' + nomeLimp + ' (' + col.valoresUnicos + ' valores unicos)',
        unidade: '', cor: corDaCategoria('Operacional'),
      });
    }

    // ==============================================================
    // 3. INDICADORES PARA COLUNAS DE HORA
    // ==============================================================
    for (const col of colunasHora) {
      const nomeLimp = col.nome.trim();
      const norm = normalizarChave(nomeLimp);
      let nomeSugerido = 'Total de Horas — ' + nomeLimp;
      let unidade = 'h';
      let categoria = 'Operacional';
      if (norm.includes('SAIDA') || norm.includes('INICIO') || norm.includes('INICIO')) {
        nomeSugerido = 'Total de Horas Produtivas'; categoria = 'Produtividade';
      } else if (norm.includes('CHEGADA') || norm.includes('RETORNO')) {
        nomeSugerido = 'Total de Horas de Retorno';
      } else if (norm.includes('FORA') || norm.includes('AUSENCIA') || norm.includes('AUSENCIA')) {
        nomeSugerido = 'Total de Horas Fora da Unidade'; categoria = 'Produtividade';
      }
      indicadores.push({
        coluna: nomeLimp, operacao: 'soma_horas', nomeSugerido,
        formato: 'numero', categoria, descricao: 'Soma total de ' + nomeLimp + ' em horas',
        unidade, cor: corDaCategoria(categoria),
      });
    }

    // ==============================================================
    // 4. PERIODO COBERTO
    // ==============================================================
    if (colDataUsar) {
      indicadores.push({
        coluna: colDataUsar, operacao: 'periodo', nomeSugerido: 'Periodo Coberto',
        formato: 'numero', categoria: 'Operacional',
        descricao: 'Data da primeira e ultima ocorrencia', unidade: '', cor: corDaCategoria('Operacional'),
      });
    }

    // Horas nas Rotas (ate 4 rotas)
    var rotasEncontradas = 0;
    var partesFormulaRotas: string[] = [];
    for (var r = 1; r <= 4; r++) {
      var colChegRota = encontrarColuna(colunas, ['HORA CHEGADA ROTA 0' + r, 'HORA CHEGA ROTA 0' + r]);
      var colSaiRota = encontrarColuna(colunas, ['HORA SAIDA ROTA 0' + r, 'HORA SAIDA ROTA 0' + r]);
      if (colChegRota && colSaiRota) {
        rotasEncontradas++;
        if (partesFormulaRotas.length > 0) partesFormulaRotas.push(' + ');
        partesFormulaRotas.push('SUM(' + colSaiRota + ') - SUM(' + colChegRota + ')');
      }
    }
    if (rotasEncontradas > 0) {
      var expressaoTotalRotas = 'ROUND((' + partesFormulaRotas.join('') + ') * 24, 1)';
      indicadores.push({
        coluna: 'ROTAS', operacao: 'soma_horas', nomeSugerido: 'Total de Horas nas Rotas',
        formato: 'numero', categoria: 'Produtividade',
        descricao: 'Soma total de horas em todas as rotas (ate 4). Calcula HORA SAIDA - HORA CHEGADA de cada rota, soma tudo e converte serial Excel para horas (*24).',
        expressao: expressaoTotalRotas, unidade: 'h', cor: corDaCategoria('Produtividade'),
      });
      var expressaoMediaRotas = 'ROUND(DIVIDE(' + partesFormulaRotas.join('') + ', VIAGENS_POR_ROTA()) * 24, 1)';
      indicadores.push({
        coluna: 'ROTAS', operacao: 'avg', nomeSugerido: 'Media de Horas por Rota',
        formato: 'numero', categoria: 'Produtividade',
        descricao: 'Media de horas em todas as rotas (ate 4) por viagem. Calcula (HORA SAIDA - HORA CHEGADA) / VIAGENS_POR_ROTA() e converte para horas (*24).',
        expressao: expressaoMediaRotas, unidade: 'h/viagem', cor: corDaCategoria('Produtividade'),
      });
    }

    // ==============================================================
    // 5. INDICADORES FINANCEIROS AUTOMATICOS
    // ==============================================================
    if (colPeso && temValorCaminhao) {
      const colTipoUsar = colTipo || colCaminhao || '';
      const colFaturamentoExpr = colTipoUsar
        ? 'FATURAMENTO_EST(' + colPeso + ', ' + colTipoUsar + ')'
        : 'SUM(' + colPeso + ') / 1000 * VALOR_TONELADA';
      indicadores.push({
        coluna: colPeso, operacao: 'sum', nomeSugerido: 'Faturamento Estimado',
        formato: 'moeda', categoria: 'Financeiro',
        descricao: 'Faturamento estimado baseado em peso e valores do contrato',
        expressao: colFaturamentoExpr, unidade: 'R$', financeiro: true, cor: corDaCategoria('Financeiro'),
      });
    }
    if (colPeso && colTipo && temValorCaminhao) {
      indicadores.push({
        coluna: colTipo, operacao: 'count_distinct', nomeSugerido: 'Faturamento por Tipo',
        formato: 'moeda', categoria: 'Financeiro', descricao: 'Distribuicao de faturamento por tipo de caminhao',
        financeiro: true, cor: corDaCategoria('Financeiro'),
      });
    }
    if (colPeso && colKm && temValorCaminhao) {
      indicadores.push({
        coluna: colKm, operacao: 'avg', nomeSugerido: 'Receita por KM',
        formato: 'moeda', categoria: 'Financeiro',
        descricao: 'Receita media por quilometro rodado',
        expressao: 'DIVIDE(FATURAMENTO_EST(' + colPeso + ', ' + (colTipo || colCaminhao || 'PLACA') + '), SUM(' + colKm + '))',
        unidade: 'R$/km', financeiro: true, performance: true, cor: corDaCategoria('Financeiro'),
      });
    }
    if (colKm && colCusto) {
      indicadores.push({
        coluna: colKm, operacao: 'avg', nomeSugerido: 'Custo por KM',
        formato: 'moeda', categoria: 'Custo', descricao: 'Custo medio por quilometro rodado',
        expressao: 'DIVIDE(SUM(' + colCusto + '), SUM(' + colKm + '))',
        unidade: 'R$/km', financeiro: true, cor: corDaCategoria('Custo'),
      });
    }

    // ==============================================================
    // 6. INDICADORES DE PERFORMANCE
    // ==============================================================
    if (colPeso && colKm) {
      indicadores.push({
        coluna: colPeso, operacao: 'avg', nomeSugerido: 'Tonelada por KM',
        formato: 'numero', categoria: 'Produtividade',
        descricao: 'Toneladas transportadas por quilometro (eficiencia de carga)',
        expressao: 'DIVIDE(SUM(' + colPeso + ') / 1000, SUM(' + colKm + '))',
        unidade: 'ton/km', performance: true, cor: corDaCategoria('Produtividade'),
      });
    }
    if (colKm) {
      const colViagemUsar = colViagens || '';
      if (colViagemUsar) {
        indicadores.push({
          coluna: colKm, operacao: 'avg', nomeSugerido: 'KM por Viagem',
          formato: 'numero', categoria: 'Produtividade',
          descricao: 'Quilometragem media por viagem (contagem pelas rotas 01–04)',
          expressao: 'DIVIDE(SUM(' + colKm + '), VIAGENS_POR_ROTA())',
          unidade: 'km', performance: true, cor: corDaCategoria('Produtividade'),
        });
      } else {
        indicadores.push({
          coluna: colKm, operacao: 'avg', nomeSugerido: 'KM por Viagem',
          formato: 'numero', categoria: 'Produtividade',
          descricao: 'Quilometragem media por registro',
          expressao: 'AVG(' + colKm + ')', unidade: 'km', performance: true, cor: corDaCategoria('Produtividade'),
        });
      }
    }
    if (colPeso) {
      indicadores.push({
        coluna: colPeso, operacao: 'avg', nomeSugerido: 'Peso Medio por Coleta',
        formato: 'numero', categoria: 'Produtividade',
        descricao: 'Peso medio coletado por registro',
        expressao: 'AVG(' + colPeso + ') / 1000', unidade: 'ton', performance: true, cor: corDaCategoria('Produtividade'),
      });
    }

    // Horas por Coleta
    var partesFormulaHoraColeta: string[] = [];
    for (var r = 1; r <= 4; r++) {
      var colChegadaRota = encontrarColuna(colunas, ['HORA CHEGADA ROTA 0' + r, 'HORA CHEGA ROTA 0' + r]);
      var colSaidaRota = encontrarColuna(colunas, ['HORA SAIDA ROTA 0' + r, 'HORA SAIDA ROTA 0' + r]);
      if (colChegadaRota && colSaidaRota) {
        if (partesFormulaHoraColeta.length > 0) partesFormulaHoraColeta.push(' + ');
        partesFormulaHoraColeta.push('SUM(' + colSaidaRota + ') - SUM(' + colChegadaRota + ')');
      }
    }
    if (partesFormulaHoraColeta.length > 0) {
      indicadores.push({
        coluna: 'ROTA 01', operacao: 'avg', nomeSugerido: 'Horas por Coleta',
        formato: 'numero', categoria: 'Produtividade',
        descricao: 'Tempo medio por coleta em horas, baseado nas horas das rotas (ate 4 rotas)',
        expressao: 'ROUND(DIVIDE(' + partesFormulaHoraColeta.join('') + ', VIAGENS_POR_ROTA()) * 24, 1)',
        unidade: 'h', performance: true, cor: corDaCategoria('Produtividade'),
      });
    } else if (colHora) {
      indicadores.push({
        coluna: colHora, operacao: 'avg', nomeSugerido: 'Horas por Coleta',
        formato: 'numero', categoria: 'Produtividade', descricao: 'Tempo medio por coleta em horas',
        expressao: 'AVG(' + colHora + ')', unidade: 'h', performance: true, cor: corDaCategoria('Produtividade'),
      });
    }

    // Produtividade por Coletor
    if (colPeso) {
      const expressaoProdColetor = colNroColetores
        ? 'SUM(' + colPeso + ') / 1000 / SUM(' + colNroColetores + ')'
        : colPlaca ? 'SUM(' + colPeso + ') / 1000 / COUNT DISTINCT(' + colPlaca + ')' : null;
      if (expressaoProdColetor) {
        indicadores.push({
          coluna: colPeso, operacao: 'avg', nomeSugerido: 'Produtividade por Coletor',
          formato: 'numero', categoria: 'Produtividade',
          descricao: colNroColetores ? 'Peso total (ton) dividido pela soma total de coletores' : 'Peso total (ton) dividido pela quantidade de coletores (por placa)',
          expressao: expressaoProdColetor, unidade: colNroColetores ? 't/coletor' : 't/veiculo',
          performance: true, cor: corDaCategoria('Produtividade'),
        });
      }
    }

    // Receita por Hora Produtiva
    if (colPeso && temValorCaminhao) {
      const formulaHoras = (colHora && colHoraChegada)
        ? 'SUM(' + colHoraChegada + ') - SUM(' + colHora + ')'
        : colHora ? 'SUM(' + colHora + ')' : null;
      if (formulaHoras) {
        indicadores.push({
          coluna: formulaHoras, operacao: 'avg', nomeSugerido: 'Receita por Hora',
          formato: 'moeda', categoria: 'Financeiro',
          descricao: colHora && colHoraChegada ? 'Receita por hora produtiva (HR CHEGA BASE - HR SAIDA BASE)' : 'Receita estimada por hora trabalhada',
          expressao: 'DIVIDE(FATURAMENTO_EST(' + colPeso + ', ' + (colTipo || colCaminhao || 'PLACA') + '), ' + formulaHoras + ')',
          unidade: 'R$/h', financeiro: true, performance: true, cor: corDaCategoria('Financeiro'),
        });
      }
    }

    // ==============================================================
    // 7. GERACAO AUTOMATICA DE GRAFICOS
    // ==============================================================
    for (const col of colunasTexto) {
      if (col.valoresUnicos >= 20 || col.valoresUnicos < 2) continue;
      const nomeLimp = col.nome.trim();
      graficos.push({
        tipo: 'pizza', titulo: 'Distribuicao por ' + nomeLimp,
        eixoX: nomeLimp, eixoY: '',
        descricao: 'Distribuicao dos valores de ' + nomeLimp, automatico: true,
      });
    }
    if (colDataUsar && colPeso && temValorCaminhao) {
      graficos.push({
        tipo: 'linha', titulo: 'Tendencia de Faturamento', eixoX: colDataUsar, eixoY: colPeso,
        descricao: 'Faturamento estimado ao longo do tempo', automatico: true,
      });
    }
    if (colDataUsar && colPeso) {
      graficos.push({
        tipo: 'linha', titulo: 'Evolucao do Peso Coletado', eixoX: colDataUsar, eixoY: colPeso,
        descricao: 'Peso total coletado ao longo do tempo', automatico: true,
      });
    }
    if (colTipo) {
      graficos.push({
        tipo: 'pizza', titulo: 'Distribuicao por Tipo de Caminhao', eixoX: colTipo, eixoY: '',
        descricao: 'Quantidade de registros por tipo de caminhao', automatico: true,
      });
    }
    const primeiraColTexto = colunasTexto.find(c => c.valoresUnicos >= 2 && c.valoresUnicos <= 20);
    if (colKm && primeiraColTexto) {
      graficos.push({
        tipo: 'barra', titulo: 'KM por ' + primeiraColTexto.nome, eixoX: primeiraColTexto.nome, eixoY: colKm,
        descricao: 'Total de KM agrupado por ' + primeiraColTexto.nome, automatico: true,
      });
    }
    if (colPeso && primeiraColTexto && primeiraColTexto.nome !== colTipo) {
      graficos.push({
        tipo: 'barra', titulo: 'Peso por ' + primeiraColTexto.nome, eixoX: primeiraColTexto.nome, eixoY: colPeso,
        descricao: 'Peso total agrupado por ' + primeiraColTexto.nome, automatico: true,
      });
    }

    // ==============================================================
    // 9. INDICADORES POR TIPO DE SERVICO (PRESETS ESPECIFICOS)
    // ==============================================================
    const jaTemInd = (nome: string) => indicadores.some(i => i.nomeSugerido === nome);

    // ─── COLETA_CAMINHAO ───
    if (servico.tipo === TipoServico.COLETA_CAMINHAO) {
      const cPeso = colPeso || 'PESO TOTAL';
      const cKm = colKm || 'KM TOTAL';
      const cTipo = colTipo || colCaminhao || 'TIPO CAMINHAO';
      const cHora = colHora || 'HORA SAIDA';
      const cHoraCheg = colHoraChegada || 'HORA CHEGADA';
      const cPlaca = colPlaca || colCaminhao || 'PLACA';
      const cNroCol = colNroColetores || '';
      const cMotorista = colMotorista || '';
      const colTurno = encontrarColuna(colunas, ['TURNO']);

      if (!jaTemInd('Peso Total')) {
        indicadores.push({
          coluna: cPeso, operacao: 'sum', nomeSugerido: 'Peso Total',
          formato: 'numero', categoria: 'Operacional', descricao: 'Peso total transportado em toneladas',
          expressao: 'SUM(' + cPeso + ') / 1000', unidade: 't', cor: '#3b82f6',
        });
      }
      if (!jaTemInd('Peso Total por Tipo de Caminhao') && colPeso && cTipo) {
        indicadores.push({
          coluna: cPeso, operacao: 'sum', nomeSugerido: 'Peso Total por Tipo de Caminhao',
          formato: 'numero', categoria: 'Operacional', descricao: 'Peso total agrupado por tipo de caminhao',
          expressao: 'SUM(' + cPeso + ') / 1000', unidade: 't', cor: '#3b82f6',
        });
      }
      if (!jaTemInd('Peso Minimo por Tipo de Caminhao') && colPeso && cTipo) {
        indicadores.push({
          coluna: cPeso, operacao: 'min', nomeSugerido: 'Peso Minimo por Tipo de Caminhao',
          formato: 'numero', categoria: 'Operacional', descricao: 'Peso minimo registrado por tipo de caminhao',
          expressao: 'MIN(' + cPeso + ') / 1000', unidade: 't', cor: '#6366f1',
        });
      }
      if (!jaTemInd('Peso Maximo por Tipo de Caminhao') && colPeso && cTipo) {
        indicadores.push({
          coluna: cPeso, operacao: 'max', nomeSugerido: 'Peso Maximo por Tipo de Caminhao',
          formato: 'numero', categoria: 'Operacional', descricao: 'Peso maximo registrado por tipo de caminhao',
          expressao: 'MAX(' + cPeso + ') / 1000', unidade: 't', cor: '#6366f1',
        });
      }
      if (!jaTemInd('Tonelada Media por Tipo de Caminhao') && colPeso && cTipo) {
        indicadores.push({
          coluna: cPeso, operacao: 'avg', nomeSugerido: 'Tonelada Media por Tipo de Caminhao',
          formato: 'numero', categoria: 'Produtividade', descricao: 'Peso medio transportado por tipo de caminhao',
          expressao: 'AVG(' + cPeso + ') / 1000', unidade: 't', cor: '#8b5cf6',
        });
      }
      if (!jaTemInd('Receita por KM') && colPeso && colKm && temValorCaminhao) {
        indicadores.push({
          coluna: cKm, operacao: 'avg', nomeSugerido: 'Receita por KM',
          formato: 'moeda', categoria: 'Financeiro', descricao: 'Faturamento dividido pelos km rodados',
          expressao: 'DIVIDE(FATURAMENTO_EST(' + cPeso + ', ' + cTipo + '), SUM(' + cKm + '))',
          unidade: 'R$/km', financeiro: true, performance: true, cor: '#a855f7',
        });
      }
      if (!jaTemInd('Receita por Hora') && colPeso && temValorCaminhao) {
        const formulaHoras = (colHora && colHoraChegada)
          ? 'HORAS_PRODUTIVAS(' + cHora + ', ' + cHoraCheg + ')'
          : null;
        if (formulaHoras) {
          indicadores.push({
            coluna: cHoraCheg || cHora, operacao: 'avg', nomeSugerido: 'Receita por Hora',
            formato: 'moeda', categoria: 'Financeiro', descricao: 'Faturamento dividido pelas horas trabalhadas',
            expressao: 'DIVIDE(FATURAMENTO_EST(' + cPeso + ', ' + cTipo + '), ' + formulaHoras + ')',
            unidade: 'R$/h', financeiro: true, performance: true, cor: '#ec4899',
          });
        }
      }
      if (!jaTemInd('Receita por Hora Produtiva') && colPeso && colHora && colHoraChegada && temValorCaminhao) {
        indicadores.push({
          coluna: cHoraCheg, operacao: 'avg', nomeSugerido: 'Receita por Hora Produtiva',
          formato: 'moeda', categoria: 'Financeiro', descricao: 'Receita total dividida pelas horas produtivas (HR CHEGADA - HR SAIDA)',
          expressao: 'DIVIDE(FATURAMENTO_EST(' + cPeso + ', ' + cTipo + '), HORAS_PRODUTIVAS(' + cHora + ', ' + cHoraCheg + '))',
          unidade: 'R$/h', financeiro: true, performance: true, cor: '#be185d',
        });
      }
      if (!jaTemInd('Producao por Coletor') && colPeso) {
        const expr = cNroCol ? 'SUM(' + cPeso + ') / 1000 / SUM(' + cNroCol + ')' : (cPlaca ? 'SUM(' + cPeso + ') / 1000 / COUNT DISTINCT(' + cPlaca + ')' : null);
        if (expr) {
          indicadores.push({
            coluna: cPeso, operacao: 'avg', nomeSugerido: 'Producao por Coletor',
            formato: 'numero', categoria: 'Produtividade', descricao: 'Peso total (ton) dividido pela quantidade de coletores',
            expressao: expr, unidade: cNroCol ? 't/coletor' : 't/veiculo', performance: true, cor: '#2563eb',
          });
        }
      }
      if (!jaTemInd('KM Rodado por Tonelada') && colPeso && colKm) {
        indicadores.push({
          coluna: cKm, operacao: 'avg', nomeSugerido: 'KM Rodado por Tonelada',
          formato: 'numero', categoria: 'Produtividade', descricao: 'Quilometros rodados por tonelada transportada',
          expressao: 'DIVIDE(SUM(' + cKm + '), SUM(' + cPeso + ') / 1000)', unidade: 'km/t', performance: true, cor: '#84cc16',
        });
      }
      if (!jaTemInd('Media Quantidade de Coletores') && colNroColetores) {
        indicadores.push({
          coluna: cNroCol, operacao: 'avg', nomeSugerido: 'Media Quantidade de Coletores',
          formato: 'numero', categoria: 'Operacional', descricao: 'Numero medio de coletores por viagem',
          expressao: 'AVG(' + cNroCol + ')', unidade: 'un', cor: '#14b8a6',
        });
      }

      // Hora Produtiva por Viagem (com rotas)
      if (!jaTemInd('Hora Produtiva por Viagem')) {
        var partesFormulaRota: string[] = [];
        for (var r = 1; r <= 4; r++) {
          var colChegada = encontrarColuna(colunas, ['HORA CHEGADA ROTA 0' + r, 'HORA CHEGA ROTA 0' + r]);
          var colSaida = encontrarColuna(colunas, ['HORA SAIDA ROTA 0' + r, 'HORA SAIDA ROTA 0' + r]);
          if (colChegada && colSaida) {
            if (partesFormulaRota.length > 0) partesFormulaRota.push(' + ');
            partesFormulaRota.push('HORAS_PRODUTIVAS(' + colChegada + ', ' + colSaida + ')');
          }
        }
        if (partesFormulaRota.length > 0) {
          var expressaoHoraRota = 'ROUND(DIVIDE(' + partesFormulaRota.join('') + ', VIAGENS_POR_ROTA()), 1)';
          indicadores.push({
            coluna: 'ROTA 01', operacao: 'avg', nomeSugerido: 'Hora Produtiva por Viagem',
            formato: 'numero', categoria: 'Produtividade',
            descricao: 'Tempo medio produtivo por viagem baseado nas horas das rotas (ate 4 rotas): soma de (HORA SAIDA - HORA CHEGADA) de cada rota / VIAGENS_POR_ROTA(). Converte serial Excel para horas (*24).',
            expressao: expressaoHoraRota, unidade: 'h', performance: true, cor: '#f97316',
          });
        } else if (colHora && colHoraChegada) {
          indicadores.push({
            coluna: cHoraCheg, operacao: 'avg', nomeSugerido: 'Hora Produtiva por Viagem',
            formato: 'numero', categoria: 'Produtividade', descricao: 'Tempo medio produtivo (HR CHEGADA - HR SAIDA) por viagem',
            expressao: 'DIVIDE(HORAS_PRODUTIVAS(' + cHora + ', ' + cHoraCheg + '), VIAGENS_POR_ROTA())', unidade: 'h', performance: true, cor: '#f97316',
          });
        }
      }

      // Coletores Distintos
      if (!jaTemInd('Coletores Distintos')) {
        var colColetor01 = encontrarColuna(colunas, ['COLETOR 01']);
        if (colColetor01) {
          indicadores.push({
            coluna: colColetor01, operacao: 'count_distinct', nomeSugerido: 'Coletores Distintos',
            formato: 'numero', categoria: 'Operacional', descricao: 'Quantidade de coletores unicos a partir dos nomes individuais (COLETOR 01 a COLETOR 04)',
            unidade: 'coletores', cor: '#7c3aed',
          });
        }
      }

      // Contador de Viagens
      if (!jaTemInd('Contador de Viagens')) {
        var colContadorViagens = encontrarColuna(colunas, ['CONTADOR DE VIAGENS', 'CONTADOR VIAGENS', 'NR VIAGENS', 'NUMERO VIAGENS']);
        if (colContadorViagens) {
          indicadores.push({
            coluna: colContadorViagens, operacao: 'sum', nomeSugerido: 'Contador de Viagens',
            formato: 'numero', categoria: 'Operacional', descricao: 'Soma do contador de viagens — total de viagens contabilizadas',
            unidade: 'viagens', cor: '#06b6d4',
          });
          indicadores.push({
            coluna: colContadorViagens, operacao: 'avg', nomeSugerido: 'Media de Viagens por Linha',
            formato: 'numero', categoria: 'Operacional', descricao: 'Media de viagens por registro da planilha',
            unidade: 'viagens/linha', cor: '#3b82f6',
          });
        }
      }

      // KM por Hora Produtiva
      if (!jaTemInd('KM por Hora Produtiva') && colKm && colHora && colHoraChegada) {
        indicadores.push({
          coluna: cKm, operacao: 'avg', nomeSugerido: 'KM por Hora Produtiva',
          formato: 'numero', categoria: 'Eficiencia', descricao: 'KM rodados por hora produtiva — eficiencia de deslocamento',
          expressao: 'DIVIDE(SUM(' + cKm + '), HORAS_PRODUTIVAS(' + cHora + ', ' + cHoraCheg + '))',
          unidade: 'km/h', performance: true, cor: '#14b8a6',
        });
      }

      // Percentual de Hora Produtiva = horas dentro das rotas ÷ jornada base→base
      if (!jaTemInd('Percentual de Hora Produtiva') && colHora && colHoraChegada) {
        const partesRota: string[] = [];
        for (let r = 1; r <= 4; r++) {
          const colChegada = encontrarColuna(colunas, ['HORA CHEGADA ROTA 0' + r, 'HORA CHEGA ROTA 0' + r]);
          const colSaida = encontrarColuna(colunas, ['HORA SAIDA ROTA 0' + r, 'HORA SAÍDA ROTA 0' + r]);
          if (colChegada && colSaida) partesRota.push('HORAS_PRODUTIVAS(' + colChegada + ', ' + colSaida + ')');
        }
        if (partesRota.length > 0) {
          indicadores.push({
            coluna: cHoraCheg, operacao: 'avg', nomeSugerido: 'Percentual de Hora Produtiva',
            formato: 'porcentagem', categoria: 'Produtividade',
            descricao: 'Horas dentro das rotas divididas pela jornada base→base',
            expressao: 'DIVIDE(' + partesRota.join(' + ') + ', HORAS_PRODUTIVAS(' + cHora + ', ' + cHoraCheg + ')) * 100',
            unidade: '%', performance: true, cor: '#f59e0b',
          });
        }
      }

      // Faturamento por Coletor
      if (!jaTemInd('Faturamento por Coletor') && colPeso && cNroCol && temValorCaminhao) {
        indicadores.push({
          coluna: cPeso, operacao: 'avg', nomeSugerido: 'Faturamento por Coletor',
          formato: 'moeda', categoria: 'Financeiro', descricao: 'Faturamento total dividido pela soma de coletores',
          expressao: 'DIVIDE(FATURAMENTO_EST(' + cPeso + ', ' + cTipo + '), SUM(' + cNroCol + '))',
          unidade: 'R$/coletor', financeiro: true, performance: true, cor: '#a855f7',
        });
      }

      // Graficos Coleta
      if (colunas.some(function(c) { return normalizarChave(c.nome).includes('DISTRITO'); }) && !graficos.some(function(g) { return g.titulo === 'Distribuicao por Distrito'; })) {
        graficos.push({
          tipo: 'pizza', titulo: 'Distribuicao por Distrito', eixoX: 'DISTRITO', eixoY: '',
          descricao: 'Quantidade de registros por distrito', automatico: true,
        });
      }
      if (colMotorista && !graficos.some(function(g) { return g.titulo === 'Distribuicao por Motorista'; })) {
        graficos.push({
          tipo: 'pizza', titulo: 'Distribuicao por Motorista', eixoX: colMotorista, eixoY: '',
          descricao: 'Quantidade de registros por motorista', automatico: true,
        });
      }
      if (colTurno && colPeso && !graficos.some(function(g) { return g.titulo === 'Peso por Turno'; })) {
        graficos.push({
          tipo: 'barra', titulo: 'Peso por Turno', eixoX: colTurno, eixoY: cPeso,
          descricao: 'Peso total coletado agrupado por turno', automatico: true,
        });
      }
    }

    // ─── ROCADEIRA ───
    else if (servico.tipo === TipoServico.ROCADEIRA) {
      const colEquipamento = encontrarColuna(colunas, ['EQUIPAMENTO', 'MAQUINA', 'MAQUINA', 'TRATOR', 'ROCADA']);
      const colArea = encontrarColuna(colunas, ['AREA_ROCADA', 'AREA ROUPADA', 'AREA', 'AREA', 'M2', 'METROS QUADRADOS', 'HECTARE']);
      const colEquipe = encontrarColuna(colunas, ['EQUIPE', 'FUNCIONARIO', 'FUNCIONARIO', 'OPERADOR', 'NOME']);
      const colData = encontrarColuna(colunas, ['DATA', 'DIA']);
      const colHoras = encontrarColuna(colunas, ['HORAS TRABALHADAS', 'HORAS', 'HORAS TRAB', 'HORA', 'HRS TRABALHADAS']);

      if (colEquipamento && !jaTemInd('Equipamentos')) {
        indicadores.push({
          coluna: colEquipamento, operacao: 'count_distinct', nomeSugerido: 'Equipamentos',
          formato: 'numero', categoria: 'Operacional', descricao: 'Quantidade de equipamentos em operacao',
          unidade: 'un', cor: '#3b82f6',
        });
      }
      if (colArea && !jaTemInd('Area Total Roupada')) {
        indicadores.push({
          coluna: colArea, operacao: 'sum', nomeSugerido: 'Area Total Roupada',
          formato: 'numero', categoria: 'Operacional', descricao: 'Area total roupada no periodo',
          unidade: 'm2', cor: '#06b6d4',
        });
      }
      if (colArea && !jaTemInd('Area Media Roupada')) {
        indicadores.push({
          coluna: colArea, operacao: 'avg', nomeSugerido: 'Area Media Roupada',
          formato: 'numero', categoria: 'Operacional', descricao: 'Area media roupada por registro',
          unidade: 'm2', cor: '#3b82f6',
        });
      }
      if (colEquipe && !jaTemInd('Total de Equipes')) {
        indicadores.push({
          coluna: colEquipe, operacao: 'count_distinct', nomeSugerido: 'Total de Equipes',
          formato: 'numero', categoria: 'Operacional', descricao: 'Quantidade de equipes alocadas',
          unidade: 'equipes', cor: '#8b5cf6',
        });
      }
      if (colEquipamento && colEquipe && !jaTemInd('Equipes por Equipamento')) {
        indicadores.push({
          coluna: colEquipamento, operacao: 'avg', nomeSugerido: 'Equipes por Equipamento',
          formato: 'numero', categoria: 'Produtividade', descricao: 'Media de equipes por equipamento',
          expressao: 'DIVIDE(COUNT DISTINCT(' + colEquipe + '), COUNT DISTINCT(' + colEquipamento + '))',
          unidade: 'eq/equip', performance: true, cor: '#14b8a6',
        });
      }
      if (colHoras) {
        indicadores.push({
          coluna: colHoras, operacao: 'sum', nomeSugerido: 'Total de Horas Trabalhadas',
          formato: 'numero', categoria: 'Operacional', descricao: 'Soma total de horas trabalhadas no periodo',
          unidade: 'h', cor: '#f59e0b',
        });
      }
      if (colHoras && colArea && !jaTemInd('Produtividade por Hora')) {
        indicadores.push({
          coluna: colArea, operacao: 'avg', nomeSugerido: 'Produtividade por Hora',
          formato: 'numero', categoria: 'Produtividade', descricao: 'Area roupada por hora de trabalho',
          expressao: 'DIVIDE(SUM(' + colArea + '), SUM(' + colHoras + '))',
          unidade: 'm2/h', performance: true, cor: '#84cc16',
        });
      }
      if (valoresFixos['VALOR_HORA_ROCADA'] && colHoras && !jaTemInd('Faturamento Estimado')) {
        indicadores.push({
          coluna: colHoras, operacao: 'sum', nomeSugerido: 'Faturamento Estimado',
          formato: 'moeda', categoria: 'Financeiro', descricao: 'Faturamento estimado: horas trabalhadas x VALOR_HORA_ROCADA do contrato',
          expressao: 'SUM(' + colHoras + ') * VALOR_HORA_ROCADA', unidade: 'R$', financeiro: true, cor: '#059669',
        });
      }
      if (colData && colArea && !graficos.some(function(g) { return g.titulo === 'Area Roupada ao Longo do Tempo'; })) {
        graficos.push({
          tipo: 'linha', titulo: 'Area Roupada ao Longo do Tempo', eixoX: colData, eixoY: colArea,
          descricao: 'Evolucao da area roupada ao longo do tempo', automatico: true,
        });
      }
    }

    // ─── PODA ───
    else if (servico.tipo === TipoServico.PODA) {
      const colSetor = encontrarColuna(colunas, ['SETOR', 'BAIRRO', 'REGIAO', 'REGIAO', 'DISTRITO']);
      const colDescricao = encontrarColuna(colunas, ['DESCRICAO DO SERVICO', 'DESCRICAO', 'SERVICO', 'TIPO', 'DESCRIÇÃO DO SERVIÇO', 'DESCRIÇÃO']);
      const colRua = encontrarColuna(colunas, ['AVENIDA / RUA', 'AV/RUA', 'RUA', 'AVENIDA', 'LOGRADOURO']);
      const colComplemento = encontrarColuna(colunas, ['COMPLEMENTO']);
      const colDia = encontrarColuna(colunas, ['DIA', 'DATA']);
      const colArvore = encontrarColuna(colunas, [
        'QUANTIDADE DE ARVORE', 'QTD_ARVORE', 'ARVORES_PODADAS', 'ARVORES PODADAS',
      ]);

      if (colArvore && !jaTemInd('Podas Realizadas') && !jaTemInd('Total Arvores')) {
        indicadores.push({
          coluna: colArvore, operacao: 'sum', nomeSugerido: 'Podas Realizadas',
          formato: 'numero', categoria: 'Operacional', descricao: 'Soma da Quantidade de Arvore no periodo',
          unidade: 'arvores', cor: '#22c55e',
          expressao: 'SUM(' + colArvore + ')',
        });
      }
      if (colSetor && !jaTemInd('Setores Atendidos')) {
        indicadores.push({
          coluna: colSetor, operacao: 'count_distinct', nomeSugerido: 'Setores Atendidos',
          formato: 'numero', categoria: 'Operacional', descricao: 'Quantidade de setores/bairros onde houve poda',
          unidade: 'bairros', cor: '#3b82f6',
        });
      }
      if (colDescricao && !jaTemInd('Tipos de Poda')) {
        indicadores.push({
          coluna: colDescricao, operacao: 'count_distinct', nomeSugerido: 'Tipos de Poda',
          formato: 'numero', categoria: 'Operacional', descricao: 'Quantidade de tipos de servico de poda realizados (ex: Poda de Arvore, Poda de Galho)',
          unidade: 'tipos', cor: '#8b5cf6',
        });
      }
      if (colRua && !jaTemInd('Ruas Atendidas')) {
        indicadores.push({
          coluna: colRua, operacao: 'count_distinct', nomeSugerido: 'Ruas Atendidas',
          formato: 'numero', categoria: 'Operacional', descricao: 'Quantidade de ruas/avenidas com servicos de poda',
          unidade: 'ruas', cor: '#06b6d4',
        });
      }
      if (colSetor && !jaTemInd('Media de Podas por Setor')) {
        indicadores.push({
          coluna: colSetor, operacao: 'avg', nomeSugerido: 'Media de Podas por Setor',
          formato: 'numero', categoria: 'Produtividade', descricao: 'Media de podas realizadas por setor',
          expressao: colArvore
            ? 'DIVIDE(SUM(' + colArvore + '), COUNT DISTINCT(' + colSetor + '))'
            : 'DIVIDE(COUNT(*), COUNT DISTINCT(' + colSetor + '))', unidade: 'podas/setor', performance: true, cor: '#14b8a6',
        });
      }
      if (valoresFixos['VALOR_PODA'] && !jaTemInd('Faturamento Estimado')) {
        indicadores.push({
          coluna: '*', operacao: 'count', nomeSugerido: 'Faturamento Estimado',
          formato: 'moeda', categoria: 'Financeiro', descricao: 'Faturamento estimado: total de podas x VALOR_PODA do contrato',
          expressao: colArvore
            ? 'SUM(' + colArvore + ') * VALOR_PODA'
            : 'COUNT(*) * VALOR_PODA', unidade: 'R$', financeiro: true, cor: '#059669',
        });
      }
      if (colSetor && valoresFixos['VALOR_PODA'] && !jaTemInd('Faturamento por Setor')) {
        indicadores.push({
          coluna: colSetor, operacao: 'count_distinct', nomeSugerido: 'Faturamento por Setor',
          formato: 'moeda', categoria: 'Financeiro', descricao: 'Distribuicao de faturamento estimado por setor',
          unidade: 'R$', financeiro: true, cor: '#10b981',
        });
      }
      if (colSetor && !graficos.some(function(g) { return g.titulo === 'Podas por Setor'; })) {
        graficos.push({
          tipo: 'pizza', titulo: 'Podas por Setor', eixoX: colSetor, eixoY: '',
          descricao: 'Quantidade de podas por setor/bairro', automatico: true,
        });
      }
      if (colDescricao && !graficos.some(function(g) { return g.titulo === 'Podas por Tipo'; })) {
        graficos.push({
          tipo: 'pizza', titulo: 'Podas por Tipo', eixoX: colDescricao, eixoY: '',
          descricao: 'Distribuicao dos tipos de poda realizados', automatico: true,
        });
      }
      if (colDia && !graficos.some(function(g) { return g.titulo === 'Podas ao Longo do Tempo'; })) {
        graficos.push({
          tipo: 'linha', titulo: 'Podas ao Longo do Tempo', eixoX: colDia, eixoY: '',
          descricao: 'Evolucao do numero de podas ao longo do tempo', automatico: true,
        });
      }
    }

    // ─── CAPINA ───
    else if (servico.tipo === TipoServico.CAPINA) {
      const colComprimento = encontrarColuna(colunas, ['COMPRIMENTO (METROS)', 'COMPRIMENTO', 'METROS', 'AREA_CAPINADA', 'AREA', 'AREA', 'M2']);
      const colBairro = encontrarColuna(colunas, ['BAIRRO', 'REGIAO', 'REGIAO', 'SETOR', 'DISTRITO']);
      const colRua = encontrarColuna(colunas, ['AV/RUA', 'AVENIDA / RUA', 'RUA', 'AVENIDA', 'LOGRADOURO', 'NOME']);
      const colData = encontrarColuna(colunas, ['DATA', 'DIA']);

      if (colComprimento && !jaTemInd('Metragem Total Capinada')) {
        indicadores.push({
          coluna: colComprimento, operacao: 'sum', nomeSugerido: 'Metragem Total Capinada',
          formato: 'numero', categoria: 'Operacional', descricao: 'Comprimento total (metros) de capina realizada no periodo',
          unidade: 'm', cor: '#06b6d4',
        });
      }
      if (colComprimento && !jaTemInd('Media por Trecho')) {
        indicadores.push({
          coluna: colComprimento, operacao: 'avg', nomeSugerido: 'Media por Trecho',
          formato: 'numero', categoria: 'Operacional', descricao: 'Comprimento medio em metros por trecho capinado',
          unidade: 'm', cor: '#3b82f6',
        });
      }
      if (colBairro && !jaTemInd('Bairros Atendidos')) {
        indicadores.push({
          coluna: colBairro, operacao: 'count_distinct', nomeSugerido: 'Bairros Atendidos',
          formato: 'numero', categoria: 'Operacional', descricao: 'Quantidade de bairros onde houve capina',
          unidade: 'bairros', cor: '#8b5cf6',
        });
      }
      if (colRua && !jaTemInd('Ruas Capinadas')) {
        indicadores.push({
          coluna: colRua, operacao: 'count_distinct', nomeSugerido: 'Ruas Capinadas',
          formato: 'numero', categoria: 'Operacional', descricao: 'Quantidade de ruas/avenidas com servico de capina',
          unidade: 'ruas', cor: '#14b8a6',
        });
      }
      if (colComprimento && !jaTemInd('Maior Trecho Capinado')) {
        indicadores.push({
          coluna: colComprimento, operacao: 'max', nomeSugerido: 'Maior Trecho Capinado',
          formato: 'numero', categoria: 'Operacional', descricao: 'Maior comprimento registrado em um unico trecho',
          unidade: 'm', cor: '#f97316',
        });
      }
      if (colComprimento && colBairro && !jaTemInd('Media por Bairro')) {
        indicadores.push({
          coluna: colComprimento, operacao: 'avg', nomeSugerido: 'Media por Bairro',
          formato: 'numero', categoria: 'Produtividade', descricao: 'Comprimento medio capinado por bairro',
          expressao: 'DIVIDE(SUM(' + colComprimento + '), COUNT DISTINCT(' + colBairro + '))',
          unidade: 'm/bairro', performance: true, cor: '#84cc16',
        });
      }
      if (valoresFixos['VALOR_METRO_CAPINA'] && colComprimento && !jaTemInd('Faturamento Estimado')) {
        indicadores.push({
          coluna: colComprimento, operacao: 'sum', nomeSugerido: 'Faturamento Estimado',
          formato: 'moeda', categoria: 'Financeiro', descricao: 'Faturamento: metragem total x VALOR_METRO_CAPINA do contrato',
          expressao: 'SUM(' + colComprimento + ') * VALOR_METRO_CAPINA', unidade: 'R$', financeiro: true, cor: '#059669',
        });
      }
      if (colBairro && colComprimento && !graficos.some(function(g) { return g.titulo === 'Capina por Bairro'; })) {
        graficos.push({
          tipo: 'barra', titulo: 'Capina por Bairro', eixoX: colBairro, eixoY: colComprimento,
          descricao: 'Metragem capinada por bairro', automatico: true,
        });
      }
      if (colData && colComprimento && !graficos.some(function(g) { return g.titulo === 'Evolucao da Capina'; })) {
        graficos.push({
          tipo: 'linha', titulo: 'Evolucao da Capina', eixoX: colData, eixoY: colComprimento,
          descricao: 'Metragem capinada ao longo do tempo', automatico: true,
        });
      }
    }

    // ─── VARRICAO ───
    else if (servico.tipo === TipoServico.VARRICAO) {
      const colKmVarridos = encontrarColuna(colunas, ['KM LINEAR', 'KM_LINEAR', 'QUILOMETROS_VARRIDOS', 'KM VARRIDOS', 'KM VARRICAO', 'KM VARRIÇÃO']);
      const colFuncionario = encontrarColuna(colunas, ['FUNCIONARIO', 'FUNCIONARIO', 'OPERADOR', 'NOME', 'EQUIPE', 'GARI']);
      const colData = encontrarColuna(colunas, ['DATA', 'DIA']);
      const colBairro = encontrarColuna(colunas, ['BAIRRO', 'REGIAO', 'REGIAO', 'SETOR', 'DISTRITO']);

      if (colKmVarridos && !jaTemInd('KM Varridos')) {
        indicadores.push({
          coluna: colKmVarridos, operacao: 'sum', nomeSugerido: 'KM Varridos',
          formato: 'numero', categoria: 'Operacional', descricao: 'Total de quilometros varridos no periodo',
          unidade: 'km', cor: '#06b6d4',
        });
      }
      if (colFuncionario && !jaTemInd('Funcionarios')) {
        indicadores.push({
          coluna: colFuncionario, operacao: 'count_distinct', nomeSugerido: 'Funcionarios',
          formato: 'numero', categoria: 'Operacional', descricao: 'Quantidade de funcionarios alocados',
          unidade: 'un', cor: '#3b82f6',
        });
      }
      if (colKmVarridos && !jaTemInd('Media KM por Funcionario') && colFuncionario) {
        indicadores.push({
          coluna: colKmVarridos, operacao: 'avg', nomeSugerido: 'Media KM por Funcionario',
          formato: 'numero', categoria: 'Produtividade', descricao: 'KM medio varrido por funcionario',
          expressao: 'DIVIDE(SUM(' + colKmVarridos + '), COUNT DISTINCT(' + colFuncionario + '))',
          unidade: 'km/func', performance: true, cor: '#84cc16',
        });
      }
      if (colBairro && !jaTemInd('Bairros Atendidos')) {
        indicadores.push({
          coluna: colBairro, operacao: 'count_distinct', nomeSugerido: 'Bairros Atendidos',
          formato: 'numero', categoria: 'Operacional', descricao: 'Quantidade de bairros com varricao',
          unidade: 'bairros', cor: '#8b5cf6',
        });
      }
      if (colKmVarridos && !jaTemInd('Media KM por Bairro') && colBairro) {
        indicadores.push({
          coluna: colKmVarridos, operacao: 'avg', nomeSugerido: 'Media KM por Bairro',
          formato: 'numero', categoria: 'Produtividade', descricao: 'KM medio varrido por bairro',
          expressao: 'DIVIDE(SUM(' + colKmVarridos + '), COUNT DISTINCT(' + colBairro + '))',
          unidade: 'km/bairro', performance: true, cor: '#14b8a6',
        });
      }
      if (valoresFixos['VALOR_KM_VARRICAO'] && colKmVarridos && !jaTemInd('Faturamento Estimado')) {
        indicadores.push({
          coluna: colKmVarridos, operacao: 'sum', nomeSugerido: 'Faturamento Estimado',
          formato: 'moeda', categoria: 'Financeiro', descricao: 'Faturamento: km varridos x VALOR_KM_VARRICAO do contrato',
          expressao: 'SUM(' + colKmVarridos + ') * VALOR_KM_VARRICAO', unidade: 'R$', financeiro: true, cor: '#059669',
        });
      }
      if (colKmVarridos && colBairro && !graficos.some(function(g) { return g.titulo === 'KM Varridos por Bairro'; })) {
        graficos.push({
          tipo: 'barra', titulo: 'KM Varridos por Bairro', eixoX: colBairro, eixoY: colKmVarridos,
          descricao: 'Quilometros varridos por bairro', automatico: true,
        });
      }
      if (colData && colKmVarridos && !graficos.some(function(g) { return g.titulo === 'Evolucao da Varricao'; })) {
        graficos.push({
          tipo: 'linha', titulo: 'Evolucao da Varricao', eixoX: colData, eixoY: colKmVarridos,
          descricao: 'KM varridos ao longo do tempo', automatico: true,
        });
      }
    }

    // ─── PINTURA_MEIO_FIO ───
    else if (servico.tipo === TipoServico.PINTURA_MEIO_FIO) {
      const colComprimentoTotal = encontrarColuna(colunas, ['COMPRIMENTO TOTAL', 'COMPRIMENTO', 'METROS']);
      const colSarjetas = encontrarColuna(colunas, ['NUMERO DE SARJETAS EXECUTADAS', 'NUMERO DE SARJETAS', 'SARJETAS', 'NRO SARJETAS', 'QTDE SARJETAS']);
      const colComprimento = encontrarColuna(colunas, ['COMPRIMENTO', 'COMPRIMENTO TOTAL', 'METROS']);
      const colBairro = encontrarColuna(colunas, ['BAIRRO', 'REGIAO', 'REGIAO', 'SETOR', 'LOCAL']);
      const colNome = encontrarColuna(colunas, ['NOME', 'AVENIDA / RUA', 'AV/RUA', 'RUA', 'AVENIDA', 'LOGRADOURO']);
      const colData = encontrarColuna(colunas, ['DATA', 'DIA']);

      if (colComprimentoTotal && !jaTemInd('Comprimento Total Pintado')) {
        indicadores.push({
          coluna: colComprimentoTotal, operacao: 'sum', nomeSugerido: 'Comprimento Total Pintado',
          formato: 'numero', categoria: 'Operacional', descricao: 'Comprimento total de meio-fio pintado em metros',
          unidade: 'm', cor: '#06b6d4',
        });
      }
      if (colComprimento && !jaTemInd('Comprimento Medio por Trecho')) {
        indicadores.push({
          coluna: colComprimento, operacao: 'avg', nomeSugerido: 'Comprimento Medio por Trecho',
          formato: 'numero', categoria: 'Operacional', descricao: 'Comprimento medio pintado por trecho/registro',
          unidade: 'm', cor: '#3b82f6',
        });
      }
      if (colSarjetas && !jaTemInd('Sarjetas Executadas')) {
        indicadores.push({
          coluna: colSarjetas, operacao: 'sum', nomeSugerido: 'Sarjetas Executadas',
          formato: 'numero', categoria: 'Operacional', descricao: 'Numero total de sarjetas executadas no periodo',
          unidade: 'un', cor: '#f59e0b',
        });
      }
      if (colBairro && !jaTemInd('Bairros Atendidos')) {
        indicadores.push({
          coluna: colBairro, operacao: 'count_distinct', nomeSugerido: 'Bairros Atendidos',
          formato: 'numero', categoria: 'Operacional', descricao: 'Quantidade de bairros com pintura de meio-fio',
          unidade: 'bairros', cor: '#8b5cf6',
        });
      }
      if (colNome && !jaTemInd('Logradouros Pintados')) {
        indicadores.push({
          coluna: colNome, operacao: 'count_distinct', nomeSugerido: 'Logradouros Pintados',
          formato: 'numero', categoria: 'Operacional', descricao: 'Quantidade de ruas/avenidas com pintura de meio-fio',
          unidade: 'logradouros', cor: '#14b8a6',
        });
      }
      if (colSarjetas && colComprimento && !jaTemInd('Media por Sarjeta')) {
        indicadores.push({
          coluna: colComprimento, operacao: 'avg', nomeSugerido: 'Media por Sarjeta',
          formato: 'numero', categoria: 'Produtividade', descricao: 'Comprimento medio pintado por sarjeta',
          expressao: 'DIVIDE(SUM(' + colComprimento + '), SUM(' + colSarjetas + '))',
          unidade: 'm/sarjeta', performance: true, cor: '#14b8a6',
        });
      }
      if (colComprimentoTotal && colSarjetas && !jaTemInd('Produtividade por Sarjeta')) {
        indicadores.push({
          coluna: colComprimentoTotal, operacao: 'avg', nomeSugerido: 'Produtividade por Sarjeta',
          formato: 'numero', categoria: 'Produtividade', descricao: 'Comprimento total medio por sarjeta executada',
          expressao: 'DIVIDE(SUM(' + colComprimentoTotal + '), SUM(' + colSarjetas + '))',
          unidade: 'm/sarjeta', performance: true, cor: '#84cc16',
        });
      }
      if (valoresFixos['VALOR_METRO_LINEAR'] && colComprimentoTotal && !jaTemInd('Faturamento Estimado')) {
        indicadores.push({
          coluna: colComprimentoTotal, operacao: 'sum', nomeSugerido: 'Faturamento Estimado',
          formato: 'moeda', categoria: 'Financeiro', descricao: 'Faturamento: comprimento total x VALOR_METRO_LINEAR do contrato',
          expressao: 'SUM(' + colComprimentoTotal + ') * VALOR_METRO_LINEAR', unidade: 'R$', financeiro: true, cor: '#059669',
        });
      }
      if (valoresFixos['VALOR_SARJETA'] && colSarjetas && !jaTemInd('Faturamento por Sarjeta')) {
        indicadores.push({
          coluna: colSarjetas, operacao: 'sum', nomeSugerido: 'Faturamento por Sarjeta',
          formato: 'moeda', categoria: 'Financeiro', descricao: 'Faturamento: total de sarjetas x VALOR_SARJETA do contrato',
          expressao: 'SUM(' + colSarjetas + ') * VALOR_SARJETA', unidade: 'R$', financeiro: true, cor: '#10b981',
        });
      }
      if (colComprimentoTotal && valoresFixos['VALOR_METRO_LINEAR'] && !jaTemInd('Receita por Bairro')) {
        indicadores.push({
          coluna: colComprimentoTotal, operacao: 'sum', nomeSugerido: 'Receita por Bairro',
          formato: 'moeda', categoria: 'Financeiro', descricao: 'Distribuicao de receita estimada por bairro',
          unidade: 'R$', financeiro: true, cor: '#10b981',
        });
      }
      if (colBairro && !graficos.some(function(g) { return g.titulo === 'Pintura por Bairro'; })) {
        graficos.push({
          tipo: 'barra', titulo: 'Pintura por Bairro', eixoX: colBairro,
          eixoY: colComprimentoTotal || colComprimento || '',
          descricao: 'Comprimento total pintado por bairro', automatico: true,
        });
      }
      if (colData && colComprimentoTotal && !graficos.some(function(g) { return g.titulo === 'Evolucao da Pintura'; })) {
        graficos.push({
          tipo: 'linha', titulo: 'Evolucao da Pintura', eixoX: colData, eixoY: colComprimentoTotal,
          descricao: 'Comprimento pintado ao longo do tempo', automatico: true,
        });
      }
    }

    // ─── REMOCAO ───
    else if (servico.tipo === TipoServico.REMOCAO) {
      const colSetor = encontrarColuna(colunas, ['SETOR', 'BAIRRO', 'REGIAO', 'REGIAO', 'DISTRITO']);
      const colDescricao = encontrarColuna(colunas, ['DESCRICAO DO SERVICO', 'DESCRICAO', 'SERVICO', 'TIPO', 'DESCRIÇÃO DO SERVIÇO', 'DESCRIÇÃO']);
      const colRua = encontrarColuna(colunas, ['AVENIDA / RUA', 'AV/RUA', 'RUA', 'AVENIDA', 'LOGRADOURO']);
      const colComplemento = encontrarColuna(colunas, ['COMPLEMENTO']);
      const colDia = encontrarColuna(colunas, ['DIA', 'DATA']);

      if (!jaTemInd('Remocoes')) {
        indicadores.push({
          coluna: '*', operacao: 'count', nomeSugerido: 'Remocoes',
          formato: 'numero', categoria: 'Operacional', descricao: 'Numero total de remocoes realizadas no periodo',
          unidade: 'un', cor: '#14b8a6',
        });
      }
      if (colSetor && !jaTemInd('Setores Atendidos')) {
        indicadores.push({
          coluna: colSetor, operacao: 'count_distinct', nomeSugerido: 'Setores Atendidos',
          formato: 'numero', categoria: 'Operacional', descricao: 'Quantidade de setores/bairros onde houve remocao',
          unidade: 'bairros', cor: '#3b82f6',
        });
      }
      if (colDescricao && !jaTemInd('Tipos de Servico')) {
        indicadores.push({
          coluna: colDescricao, operacao: 'count_distinct', nomeSugerido: 'Tipos de Servico',
          formato: 'numero', categoria: 'Operacional', descricao: 'Quantidade de tipos de remocao realizados (ex: Entulho, Podas, Moveis)',
          unidade: 'tipos', cor: '#8b5cf6',
        });
      }
      if (colRua && !jaTemInd('Ruas Atendidas')) {
        indicadores.push({
          coluna: colRua, operacao: 'count_distinct', nomeSugerido: 'Ruas Atendidas',
          formato: 'numero', categoria: 'Operacional', descricao: 'Quantidade de ruas/avenidas com servicos de remocao',
          unidade: 'ruas', cor: '#06b6d4',
        });
      }
      if (colSetor && !jaTemInd('Media de Remocoes por Setor')) {
        indicadores.push({
          coluna: colSetor, operacao: 'avg', nomeSugerido: 'Media de Remocoes por Setor',
          formato: 'numero', categoria: 'Produtividade', descricao: 'Media de remocoes realizadas por setor',
          expressao: 'DIVIDE(COUNT(*), COUNT DISTINCT(' + colSetor + '))', unidade: 'rem/setor', performance: true, cor: '#14b8a6',
        });
      }
      if (valoresFixos['VALOR_REMOCAO'] && !jaTemInd('Faturamento Estimado')) {
        indicadores.push({
          coluna: '*', operacao: 'count', nomeSugerido: 'Faturamento Estimado',
          formato: 'moeda', categoria: 'Financeiro', descricao: 'Faturamento: total de remocoes x VALOR_REMOCAO do contrato',
          expressao: 'COUNT(*) * VALOR_REMOCAO', unidade: 'R$', financeiro: true, cor: '#059669',
        });
      }
      if (colSetor && valoresFixos['VALOR_REMOCAO'] && !jaTemInd('Faturamento por Setor')) {
        indicadores.push({
          coluna: colSetor, operacao: 'count_distinct', nomeSugerido: 'Faturamento por Setor',
          formato: 'moeda', categoria: 'Financeiro', descricao: 'Distribuicao de faturamento por setor',
          unidade: 'R$', financeiro: true, cor: '#10b981',
        });
      }
      if (colSetor && !graficos.some(function(g) { return g.titulo === 'Remocoes por Setor'; })) {
        graficos.push({
          tipo: 'pizza', titulo: 'Remocoes por Setor', eixoX: colSetor, eixoY: '',
          descricao: 'Quantidade de remocoes por setor/bairro', automatico: true,
        });
      }
      if (colDescricao && !graficos.some(function(g) { return g.titulo === 'Remocoes por Tipo'; })) {
        graficos.push({
          tipo: 'pizza', titulo: 'Remocoes por Tipo', eixoX: colDescricao, eixoY: '',
          descricao: 'Distribuicao dos tipos de remocao realizados', automatico: true,
        });
      }
      if (colDia && !graficos.some(function(g) { return g.titulo === 'Remocoes ao Longo do Tempo'; })) {
        graficos.push({
          tipo: 'linha', titulo: 'Remocoes ao Longo do Tempo', eixoX: colDia, eixoY: '',
          descricao: 'Evolucao do numero de remocoes ao longo do tempo', automatico: true,
        });
      }
    }

    // ==============================================================
    // 10. VERIFICAR COLUNAS NOVAS VS ANTERIORES
    // ==============================================================
    let colunasAdicionadas: string[] = [];
    let colunasRemovidas: string[] = [];

    const colunasAnteriores: string[] = servico.padraoPlanilha?.colunasOriginais || [];
    if (colunasAnteriores.length > 0) {
      colunasAdicionadas = colunasOriginais.filter(c => !colunasAnteriores.includes(c));
      colunasRemovidas = colunasAnteriores.filter(c => !colunasOriginais.includes(c));
    }

    return {
      servicoId: servico.id,
      servicoNome: servico.nome,
      totalRegistros: dados.length,
      colunas: colunas.map(c => ({
        nome: c.nome, tipo: c.tipo,
        valoresUnicos: c.valoresUnicos,
        amostras: c.amostras, nulos: c.nulos,
      })),
      indicadoresSugeridos: indicadores,
      graficosSugeridos: graficos,
      colunasOriginais,
      temColunasNovas: colunasAdicionadas.length > 0,
      colunasRemovidas,
      colunasAdicionadas,
    };
  }

  converterParaKpiConfig(sugeridos: IndicadorSugerido[]): any[] {
    return sugeridos.map((s, idx) => ({
      id: 'auto_' + idx + '_' + Date.now(),
      nome: s.coluna,
      label: s.nomeSugerido,
      descricao: s.descricao || '',
      unidade: s.unidade || '',
      categoria: s.categoria || 'Operacional',
      cor: s.cor || '#64748b',
      meta: null,
      alerta: null,
      agregacao: this.mapearAgregacao(s.operacao),
      formato: s.formato,
      ativo: true,
      operacao: s.operacao,
      coluna2: s.coluna,
      expressao: s.expressao || '',
      colunasUsadas: s.expressao ? [s.coluna] : [s.coluna],
      valoresFixos: {},
      automatico: true,
      visivelNoExecutivo: true,
    }));
  }

  converterParaGraficoConfig(sugeridos: GraficoSugerido[]): any[] {
    return sugeridos.map((g, idx) => ({
      id: 'auto_g_' + idx + '_' + Date.now(),
      tipo: g.tipo,
      titulo: g.titulo,
      eixoX: g.eixoX,
      eixoY: g.eixoY,
      ativo: true,
      automatico: true,
      descricao: g.descricao || '',
    }));
  }

  private extrairValoresFixos(contract: Contract | null): Record<string, number> {
    const fixos: Record<string, number> = {};
    if (!contract) return fixos;
    if (contract.valorTonelada !== null && contract.valorTonelada !== undefined) fixos['VALOR_TONELADA'] = Number(contract.valorTonelada);
    if (contract.valorMini !== null && contract.valorMini !== undefined) fixos['VALOR_MINI'] = Number(contract.valorMini);
    if (contract.valorTruck !== null && contract.valorTruck !== undefined) fixos['VALOR_TRUCK'] = Number(contract.valorTruck);
    if (contract.valorToco !== null && contract.valorToco !== undefined) fixos['VALOR_TOCO'] = Number(contract.valorToco);
    if (contract.valorBasculante !== null && contract.valorBasculante !== undefined) {
      fixos['VALOR_BASCULANTE'] = Number(contract.valorBasculante);
    }
    return fixos;
  }

  private mapearAgregacao(operacao: AgregacaoSugerida): 'sum' | 'avg' | 'count' | 'min' | 'max' {
    switch (operacao) {
      case 'sum': return 'sum';
      case 'avg': return 'avg';
      case 'min': return 'min';
      case 'max': return 'max';
      case 'count_distinct': return 'count';
      case 'count': return 'count';
      case 'soma_horas': return 'sum';
      case 'periodo': return 'count';
      default: return 'sum';
    }
  }
}

export default new AutoIndicatorService();
