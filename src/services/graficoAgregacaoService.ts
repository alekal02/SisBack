import { formatarDataPlanilha, parseDataPlanilha } from '../utils/formatarDataPlanilha';

export interface GraficoAgregacaoInput {
  eixoX: string;
  eixoY?: string;
  tipo?: 'barra' | 'linha' | 'pizza';
  topN?: number;
}

export interface GraficoAgregacaoResultado {
  dados: { name: string; value: number }[];
  total: number;
  processados: number;
}

function normalizarChave(s: string): string {
  return s.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
}

function encontrarValor(dado: Record<string, any>, nomeColuna: string): any {
  if (!dado || !nomeColuna) return undefined;
  if (dado[nomeColuna] !== undefined && dado[nomeColuna] !== null) return dado[nomeColuna];

  const chaveNorm = normalizarChave(nomeColuna);
  for (const [k, v] of Object.entries(dado)) {
    if (v !== null && v !== undefined && normalizarChave(k) === chaveNorm) return v;
  }
  return undefined;
}

function serialParaMinutos(v: any): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'string' && /^\d{1,2}:\d{2}/.test(v)) {
    const [h, m] = v.split(':').map(Number);
    return h * 60 + (m || 0);
  }
  if (typeof v === 'number' && v > 0 && v < 1) return Math.round(v * 24 * 60);
  if (typeof v === 'number') return Math.round(v);
  return Number(v) || 0;
}

export function detectarEixoXEhData(
  eixoX: string,
  colunasPadrao?: { nome: string; tipo: string }[],
): boolean {
  if (colunasPadrao?.length) {
    const exNorm = normalizarChave(eixoX);
    for (const c of colunasPadrao) {
      if (normalizarChave(c.nome) === exNorm && c.tipo === 'data') return true;
    }
  }
  const colNorm = normalizarChave(eixoX);
  return colNorm.includes('DATA') || colNorm.includes('DIA') || colNorm.includes('MES') || colNorm.includes('ANO');
}

type EntradaAgregada = { sortKey: number; label: string; value: number };

function finalizarAgregado(
  entradas: EntradaAgregada[],
  eixoXEhData: boolean,
  tipo: string,
  topN: number,
): { name: string; value: number }[] {
  if (eixoXEhData && (tipo === 'barra' || tipo === 'linha')) {
    return entradas
      .sort((a, b) => a.sortKey - b.sortKey)
      .map(e => ({ name: e.label, value: e.value }));
  }

  return [...entradas]
    .sort((a, b) => b.value - a.value)
    .slice(0, topN)
    .map(e => ({ name: e.label, value: e.value }));
}

function chaveDataAgregacao(rawKey: any): { sortKey: number; label: string } {
  const parsed = parseDataPlanilha(rawKey);
  const label = formatarDataPlanilha(rawKey) || String(rawKey ?? 'N/A');
  const sortKey = parsed ? parsed.getTime() : 0;
  return { sortKey, label };
}

/**
 * Agrega dados já carregados para um único gráfico (sem I/O).
 */
export function agregarDadosGrafico(
  dadosFiltrados: Record<string, any>[],
  input: GraficoAgregacaoInput,
  colunasPadrao?: { nome: string; tipo: string }[],
): GraficoAgregacaoResultado {
  const { eixoX, eixoY, tipo = 'barra', topN = 10 } = input;

  if (!eixoX || dadosFiltrados.length === 0) {
    return { dados: [], total: 0, processados: 0 };
  }

  const eixoXEhData = detectarEixoXEhData(eixoX, colunasPadrao);
  let agregado: { name: string; value: number }[] = [];

  if (tipo === 'pizza') {
    const contagem = new Map<string, number>();
    for (const d of dadosFiltrados) {
      const rawKey = encontrarValor(d, eixoX);
      const label = eixoXEhData
        ? (formatarDataPlanilha(rawKey) || 'N/A')
        : String(rawKey || 'N/A');
      contagem.set(label, (contagem.get(label) || 0) + 1);
    }
    agregado = [...contagem.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .map(([name, value]) => ({ name, value }));
  } else {
    if (!eixoY) {
      return { dados: [], total: dadosFiltrados.length, processados: dadosFiltrados.length };
    }

    const nomeUpperY = eixoY.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const isHoraY = nomeUpperY.includes('HORA') || nomeUpperY.includes('HORAR') ||
      nomeUpperY.includes('TEMPO') || nomeUpperY.includes('DURACAO') ||
      nomeUpperY.includes('MINUT') || nomeUpperY.includes('ENTRADA') ||
      nomeUpperY.includes('SAIDA') || nomeUpperY.includes('CHEGADA');

    const acc = new Map<number, EntradaAgregada>();

    for (const d of dadosFiltrados) {
      const rawKey = encontrarValor(d, eixoX);
      let sortKey: number;
      let label: string;

      if (eixoXEhData) {
        const chave = chaveDataAgregacao(rawKey);
        sortKey = chave.sortKey;
        label = chave.label;
      } else {
        label = String(rawKey || 'N/A');
        sortKey = label.split('').reduce((h, c) => ((h << 5) - h) + c.charCodeAt(0), 0);
      }

      const valRaw = encontrarValor(d, eixoY);
      const val = isHoraY ? serialParaMinutos(valRaw) : Number(valRaw) || 0;

      const existente = acc.get(sortKey);
      if (existente) {
        existente.value += val;
      } else {
        acc.set(sortKey, { sortKey, label, value: val });
      }
    }

    agregado = finalizarAgregado([...acc.values()], eixoXEhData, tipo, topN);
  }

  return {
    dados: agregado,
    total: dadosFiltrados.length,
    processados: dadosFiltrados.length,
  };
}

/**
 * Agrega vários gráficos em uma passada (dados já filtrados em memória).
 */
export function agregarGraficosEmLote(
  dadosFiltrados: Record<string, any>[],
  graficos: Array<GraficoAgregacaoInput & { idx?: number }>,
  colunasPadrao?: { nome: string; tipo: string }[],
): Array<{ idx: number; dados: { name: string; value: number }[] }> {
  return graficos.map((g, i) => {
    const resultado = agregarDadosGrafico(dadosFiltrados, g, colunasPadrao);
    return {
      idx: g.idx ?? i,
      dados: resultado.dados,
    };
  });
}
