import { encontrarValorColuna } from './FormulaEngine';
import { calcularHorasProdutivasTotal } from './horasProdutivasService';
import { contarViagensValidadas } from './viagensPorRotaService';
import { calcularMediaTonPorColetorViagem } from './coletoresUnicosService';
import { resolverValorUnitarioPorTipo } from '../config/pesoMaximoCaminhao';

export function detectarColuna(dados: Record<string, unknown>[], candidatos: string[]): string {
  if (!dados || dados.length === 0) return '';
  const chaves = Object.keys(dados[0]);
  for (const candidato of candidatos) {
    const norm = candidato.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
    for (const chave of chaves) {
      const chaveNorm = chave.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
      if (chaveNorm === norm) return chave;
    }
  }
  for (const chave of chaves) {
    const chaveNorm = chave.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
    for (const candidato of candidatos) {
      const norm = candidato.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
      if (chaveNorm.includes(norm) || norm.includes(chaveNorm)) return chave;
    }
  }
  return '';
}

const colunasDetectadasCache = new Map<string, Record<string, string>>();

export function detectarTodasColunas(dados: Record<string, unknown>[], servicoId: string): Record<string, string> {
  if (!dados || dados.length === 0) return {};

  const cacheKey = `${servicoId}:${dados.length}`;
  const cached = colunasDetectadasCache.get(cacheKey);
  if (cached) return cached;

  const resultado: Record<string, string> = {};
  const categorias: Record<string, string[]> = {
    colPeso: ['PESO TOTAL', 'PESO', 'PESOTOTAL', 'PESO_TOTAL', 'pesoTotal'],
    colKm: ['KM TOTAL', 'KM', 'KMTOTAL', 'KM_TOTAL', 'kmTotal', 'QUILOMETRO', 'DISTANCIA'],
    colPlaca: ['PLACA', 'CAMINHAO', 'VEICULO', 'COLETOR', 'COLETORA', 'EQUIPAMENTO', 'placa'],
    colTipo: ['TIPO DE CAMINHÃO', 'TIPO DE CAMINHAO', 'TIPO CAMINHAO', 'TIPO_CAMINHAO', 'tipoCaminhao', 'TIPODECAMINHAO', 'CAMINHAO', 'CAMINHÃO'],
    colHora: ['HORA SAIDA', 'HORA', 'HORASAIDA', 'HORA_SAIDA', 'horaSaida', 'HR SAIDA BASE', 'HR_SAIDA_BASE', 'HRSAIDABASE', 'SAIDA BASE', 'HORA SÁIDA BASE', 'HORASAIDABASE', 'HORA SAIDA BASE'],
    colHoraChegada: ['HORA CHEGADA', 'HORACHEGADA', 'HORA_CHEGADA', 'horaChegada', 'HR CHEGA BASE', 'HR_CHEGA_BASE', 'HRCHEGABASE', 'CHEGADA BASE', 'HR CHEGADA BASE', 'HORA CHEGADA BASE', 'HORACHEGADABASE'],
    colNroColetores: ['Nº DE COLETORES', 'NDECOLETORES', 'NUMERO DE COLETORES', 'NÚMERO DE COLETORES', 'QTDE COLETORES', 'NRO COLETORES', 'QTD COLETORES'],
    colData: ['DATA SAIDA', 'DATA', 'DATA_SAIDA', 'DIA', 'dataSaida'],
    colMotorista: ['MOTORISTA', 'NOME MOTORISTA', 'NOME_MOTORISTA', 'NOME', 'OPERADOR', 'FUNCIONARIO'],
  };

  for (const [categoria, candidatos] of Object.entries(categorias)) {
    resultado[categoria] = detectarColuna(dados, candidatos);
  }

  colunasDetectadasCache.set(cacheKey, resultado);
  return resultado;
}

export interface MetricaExecutivaCalc {
  viagens: number;
  qtdColetores: number;
  pesoTotalTon: number;
  kmTotal: number;
  horasProdutivas: number;
  faturamento: number;
  fatPorTipo: Record<string, number>;
  tonKm: number;
  prodColetor: number;
  kmMedioViagem: number;
  tonMediaColeta: number;
  receitaKm: number;
  receitaHora: number;
  temValor: boolean;
  colunasDetectadas: Record<string, string>;
}

export function calcularMetricaExecutivaDeDados(
  dadosNorm: Record<string, unknown>[],
  valoresFixos: Record<string, number>,
  servicoId: string,
  cfgFat?: { ativo?: boolean; colunaQuantidade?: string; colunaTipoCaminhao?: string } | null,
): MetricaExecutivaCalc {
  const colunasDetectadas = detectarTodasColunas(dadosNorm, servicoId);
  const colPeso = (cfgFat?.ativo && cfgFat?.colunaQuantidade)
    ? cfgFat.colunaQuantidade
    : colunasDetectadas.colPeso;
  const colKm = colunasDetectadas.colKm;
  const colPlaca = colunasDetectadas.colPlaca;
  const colTipo = (cfgFat?.ativo && cfgFat?.colunaTipoCaminhao)
    ? cfgFat.colunaTipoCaminhao
    : colunasDetectadas.colTipo;
  const temValor = Object.keys(valoresFixos).length > 0;
  const FALLBACK_VALOR_TONELADA = 80;

  const viagens = contarViagensValidadas(dadosNorm);

  const coletoresSet = new Set<string>();
  for (const d of dadosNorm) {
    const v = encontrarValorColuna(d, colPlaca);
    if (v !== undefined && v !== null && v !== '') coletoresSet.add(String(v).trim());
  }
  const qtdColetores = coletoresSet.size;

  let kmTotal = 0;
  let pesoTotalKg = 0;
  for (const d of dadosNorm) {
    kmTotal += Number(encontrarValorColuna(d, colKm)) || 0;
    pesoTotalKg += Number(encontrarValorColuna(d, colPeso)) || 0;
  }
  const pesoTotalTon = pesoTotalKg / 1000;
  const horasProdutivas = calcularHorasProdutivasTotal(dadosNorm);

  let faturamento = 0;
  const fatPorTipo: Record<string, number> = {};
  if (temValor && colPeso) {
    for (const d of dadosNorm) {
      const tipoRaw = colTipo ? String(encontrarValorColuna(d, colTipo) || '').toUpperCase().trim() : '';
      if (/^\d+$/.test(tipoRaw)) continue;
      const peso = Number(encontrarValorColuna(d, colPeso)) || 0;
      if (peso <= 0) continue;
      const toneladas = peso / 1000;
      const valorUnitario = temValor
        ? (resolverValorUnitarioPorTipo(tipoRaw, valoresFixos, FALLBACK_VALOR_TONELADA) || FALLBACK_VALOR_TONELADA)
        : FALLBACK_VALOR_TONELADA;
      const receita = toneladas * valorUnitario;
      faturamento += receita;
      if (tipoRaw.length > 0) fatPorTipo[tipoRaw] = (fatPorTipo[tipoRaw] || 0) + receita;
    }
    if (faturamento === 0) {
      faturamento = pesoTotalKg / 1000 * (valoresFixos.VALOR_TONELADA || FALLBACK_VALOR_TONELADA);
    }
  } else if (colPeso) {
    faturamento = pesoTotalKg / 1000 * FALLBACK_VALOR_TONELADA;
  }

  const tonKm = kmTotal > 0 ? Math.round((pesoTotalTon / kmTotal) * 10000) / 10000 : 0;
  const prodColetor = calcularMediaTonPorColetorViagem(dadosNorm);
  const kmMedioViagem = viagens > 0 ? Math.round((kmTotal / viagens) * 100) / 100 : 0;
  const tonMediaColeta = viagens > 0 ? Math.round((pesoTotalTon / viagens) * 100) / 100 : 0;
  const receitaKm = kmTotal > 0 ? Math.round((faturamento / kmTotal) * 100) / 100 : 0;
  const receitaHora = horasProdutivas > 0
    ? Math.round((faturamento / horasProdutivas) * 100) / 100
    : 0;

  return {
    viagens,
    qtdColetores,
    pesoTotalTon: Math.round(pesoTotalTon * 100) / 100,
    kmTotal: Math.round(kmTotal * 100) / 100,
    horasProdutivas: Math.round(horasProdutivas * 100) / 100,
    faturamento: Math.round(faturamento * 100) / 100,
    fatPorTipo,
    tonKm,
    prodColetor,
    kmMedioViagem,
    tonMediaColeta,
    receitaKm,
    receitaHora,
    temValor,
    colunasDetectadas,
  };
}

export function agregarMetricasExecutivas(
  metricas: MetricaExecutivaCalc[],
  coletoresUnicos: number,
): MetricaExecutivaCalc {
  if (metricas.length === 0) {
    return {
      viagens: 0, qtdColetores: 0, pesoTotalTon: 0, kmTotal: 0, horasProdutivas: 0,
      faturamento: 0, fatPorTipo: {}, tonKm: 0, prodColetor: 0, kmMedioViagem: 0,
      tonMediaColeta: 0, receitaKm: 0, receitaHora: 0, temValor: false, colunasDetectadas: {},
    };
  }

  const viagens = metricas.reduce((s, m) => s + m.viagens, 0);
  const pesoTotalTon = metricas.reduce((s, m) => s + m.pesoTotalTon, 0);
  const kmTotal = metricas.reduce((s, m) => s + m.kmTotal, 0);
  const horasProdutivas = metricas.reduce((s, m) => s + m.horasProdutivas, 0);
  const faturamento = metricas.reduce((s, m) => s + m.faturamento, 0);
  const fatPorTipo: Record<string, number> = {};
  for (const m of metricas) {
    for (const [tipo, val] of Object.entries(m.fatPorTipo)) {
      fatPorTipo[tipo] = (fatPorTipo[tipo] || 0) + val;
    }
  }
  const temValor = metricas.some(m => m.temValor);
  const tonKm = kmTotal > 0 ? Math.round((pesoTotalTon / kmTotal) * 10000) / 10000 : 0;
  const kmMedioViagem = viagens > 0 ? Math.round((kmTotal / viagens) * 100) / 100 : 0;
  const tonMediaColeta = viagens > 0 ? Math.round((pesoTotalTon / viagens) * 100) / 100 : 0;
  const receitaKm = kmTotal > 0 ? Math.round((faturamento / kmTotal) * 100) / 100 : 0;
  const receitaHora = horasProdutivas > 0 ? Math.round((faturamento / horasProdutivas) * 100) / 100 : 0;
  const prodColetor = metricas.reduce((s, m) => s + m.prodColetor, 0) / metricas.length;

  return {
    viagens,
    qtdColetores: coletoresUnicos,
    pesoTotalTon: Math.round(pesoTotalTon * 100) / 100,
    kmTotal: Math.round(kmTotal * 100) / 100,
    horasProdutivas: Math.round(horasProdutivas * 100) / 100,
    faturamento: Math.round(faturamento * 100) / 100,
    fatPorTipo,
    tonKm,
    prodColetor: Math.round(prodColetor * 100) / 100,
    kmMedioViagem,
    tonMediaColeta,
    receitaKm,
    receitaHora,
    temValor,
    colunasDetectadas: metricas[0]?.colunasDetectadas || {},
  };
}
