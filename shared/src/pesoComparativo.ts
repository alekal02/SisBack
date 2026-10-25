export interface RotaPesoExtremoComparativo {
  nome: string;
  pesoMedioKg: number;
}

export interface FaixaPesoComparativo {
  label: string;
  quantidade: number;
  pct: number;
}

/** Campos usados pelas métricas/formatadores de peso (sem HTML). */
export interface AnalisePesoComparativo {
  numeroViagens: number;
  pesoMedioKg: number;
  rotaMinima: RotaPesoExtremoComparativo | null;
  rotaMaxima: RotaPesoExtremoComparativo | null;
  faixas: FaixaPesoComparativo[];
  tiposCaminhao: { MINI: number; TOCO: number; BASCULANTE: number; TRUCK: number; soma: number };
  caminhoesUnicos: number;
  caixaMediaKg: number;
  densidadeOtima: number;
  mediaIdealKg: number;
  perdaTon: number;
  /** Origem do tipo de caminhão — ausente em análises antigas em cache. */
  frotaTipoDeduzido?: {
    placas: number;
    porTipo: { MINI: number; TOCO: number; BASCULANTE: number; TRUCK: number };
    placasLista: string[];
    placasDeclaradas: number;
    placasSemTipo: number;
  } | null;
  viagensTipoDeduzido?: number;
}

/**
 * Aviso para o relatório quando a contagem por tipo não saiu inteira da planilha.
 * Retorna null quando todo tipo veio da coluna TIPO DE CAMINHÃO.
 */
export function avisoTipoCaminhaoDeduzido(
  a: Pick<AnalisePesoComparativo, 'frotaTipoDeduzido'>,
): string | null {
  const d = a.frotaTipoDeduzido;
  if (!d || d.placas <= 0) return null;

  const porTipo = (['MINI', 'TOCO', 'BASCULANTE', 'TRUCK'] as const)
    .filter((t) => d.porTipo[t] > 0)
    .map((t) => `${d.porTipo[t]} ${t}`)
    .join(', ');
  const placas = d.placasLista.slice(0, 6).join(', ');
  const resto = d.placasLista.length > 6 ? ` e outras ${d.placasLista.length - 6}` : '';

  return `${d.placas} placa(s) sem TIPO DE CAMINHÃO na planilha tiveram o tipo deduzido pelo peso`
    + `${porTipo ? ` (${porTipo})` : ''}: ${placas}${resto}. `
    + 'Preencha a coluna na planilha para a contagem por tipo sair 100% da origem.';
}

const FAIXA_CORES = ['vermelho', 'amarelo', 'verde', 'laranja'] as const;

/** Padrão alinhado ao backend (DENSIDADE_OTIMA_PADRAO). */
export const DENSIDADE_RESIDUO_PADRAO = 0.55;

/** Recalcula peso ideal e resultado do cenário com nova densidade (kg/L). */
export function aplicarDensidadeNaAnalisePeso<T extends AnalisePesoComparativo>(
  analise: T,
  densidadeKgL: number,
): T {
  const densidadeOtima = densidadeKgL > 0
    ? Math.round(densidadeKgL * 1000) / 1000
    : DENSIDADE_RESIDUO_PADRAO;
  const mediaIdealKg = Math.round(analise.caixaMediaKg * densidadeOtima * 100) / 100;
  const perdaTon = Math.round(
    (((analise.pesoMedioKg - mediaIdealKg) * analise.numeroViagens) / 1000) * 100,
  ) / 100;
  return {
    ...analise,
    densidadeOtima,
    mediaIdealKg,
    perdaTon,
  };
}

export function parseDensidadeResiduoInput(raw: string): number | null {
  const n = Number(String(raw || '').replace(',', '.').trim());
  if (!Number.isFinite(n) || n <= 0 || n > 5) return null;
  return Math.round(n * 1000) / 1000;
}

export type SecaoPeso = 'operacao' | 'faixa' | 'frota' | 'cenario';

export interface LinhaMetricaPeso {
  secao: SecaoPeso;
  label: string;
  tipo: 'int' | 'num' | 'faixa' | 'texto';
  faixaIdx?: number;
  getValor?: (a: AnalisePesoComparativo) => number | undefined;
  getTexto?: (a: AnalisePesoComparativo) => string;
  getTitulo?: (a: AnalisePesoComparativo) => string | undefined;
  classeCelula?: (a: AnalisePesoComparativo) => string;
}

export const SECAO_LABEL_PESO: Record<SecaoPeso, string> = {
  operacao: 'Operação — viagens e peso',
  faixa: 'Distribuição por qualidade vs peso ideal do tipo',
  frota: 'Frota por tipo de caminhão (placas únicas — coluna TIPO DE CAMINHÃO)',
  cenario: 'Cenário — caixa média (L) × densidade do resíduo (kg/L) = peso ideal',
};

export const CORES_SERVICO_PESO = ['#059669', '#0284c7', '#d97706', '#7c3aed', '#db2777', '#0891b2'];

export function fmtNumPeso(v: number, dec = 2): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

export function fmtIntPeso(v: number): string {
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

export function fmtPctPeso(v: number): string {
  return `${Math.round(v).toLocaleString('pt-BR')}%`;
}

function fmtCenario(a: AnalisePesoComparativo): string {
  if (a.perdaTon < 0) return 'PERDA';
  if (a.perdaTon > 0) return 'SUPERÁVIT';
  return 'NEUTRO';
}

function fmtResultado(a: AnalisePesoComparativo): string {
  const abs = fmtNumPeso(Math.abs(a.perdaTon), 2);
  if (a.perdaTon < 0) return `- ${abs} TON`;
  if (a.perdaTon > 0) return `+ ${abs} TON`;
  return `${abs} TON`;
}

function calcularMediaIdealExibicao(a: AnalisePesoComparativo): number {
  return Math.round(a.caixaMediaKg * a.densidadeOtima * 100) / 100;
}

/**
 * Converte o RESULTADO (toneladas) em viagens equivalentes vs peso ideal.
 * |perdaTon| × 1000 / pesoIdealKg
 *
 * - PERDA: viagens ao aterro sem necessidade (subcarga — caberiam menos idas no ideal).
 * - SUPERÁVIT: equivalente em viagens acima do peso ideal.
 */
export function calcularViagensEquivalentesResultado(a: AnalisePesoComparativo): number | null {
  const idealKg = calcularMediaIdealExibicao(a);
  if (!Number.isFinite(idealKg) || idealKg <= 0) return null;
  if (!Number.isFinite(a.perdaTon) || a.perdaTon === 0) return 0;
  return Math.round(((Math.abs(a.perdaTon) * 1000) / idealKg) * 10) / 10;
}

export function fmtViagensEquivalentesResultado(a: AnalisePesoComparativo): string {
  const n = calcularViagensEquivalentesResultado(a);
  if (n === null) return '—';
  if (n === 0) return '0';
  const base = fmtNumPeso(n, 1);
  if (a.perdaTon < 0) return `${base} evitáveis`;
  if (a.perdaTon > 0) return `${base} excedentes`;
  return base;
}

export function tituloViagensEquivalentesResultado(a: AnalisePesoComparativo): string | undefined {
  const n = calcularViagensEquivalentesResultado(a);
  const ideal = calcularMediaIdealExibicao(a);
  if (n === null || !ideal) return undefined;
  const ton = fmtNumPeso(Math.abs(a.perdaTon), 2);
  const idealTxt = fmtNumPeso(ideal, 2);
  if (a.perdaTon < 0) {
    return (
      `PERDA de ${ton} TON ÷ peso ideal ${idealTxt} kg ≈ ${fmtNumPeso(n, 1)} viagens ao aterro sem necessidade `
      + `(subcarga: caberiam menos idas se todas fossem no peso ideal).`
    );
  }
  if (a.perdaTon > 0) {
    return (
      `SUPERÁVIT de ${ton} TON ÷ peso ideal ${idealTxt} kg ≈ ${fmtNumPeso(n, 1)} viagens equivalentes acima do ideal.`
    );
  }
  return 'Resultado neutro — sem viagens equivalentes de desvio.';
}

function tituloFaixa(idx: number) {
  return (a: AnalisePesoComparativo): string | undefined => {
    const faixa = a.faixas?.[idx];
    if (!faixa) return undefined;
    const classificados = a.faixas.reduce((s, f) => s + (Number(f.quantidade) || 0), 0);
    const qtd = fmtIntPeso(faixa.quantidade);
    const totClass = fmtIntPeso(classificados);
    const viagens = fmtIntPeso(a.numeroViagens);
    const pct = fmtPctPeso(faixa.pct);
    if (classificados !== a.numeroViagens) {
      return (
        `${qtd} viagens nesta faixa (${pct} das ${totClass} viagens com PESO 1–4 classificado). `
        + `O ciclo tem ${viagens} viagens no contador.`
      );
    }
    return `${qtd} de ${viagens} viagens (${pct}) nesta faixa vs peso ideal do tipo.`;
  };
}

/** Diz de onde veio a contagem daquele tipo: coluna da planilha ou dedução por peso. */
function tituloOrigemTipo(tipo: 'MINI' | 'TOCO' | 'BASCULANTE' | 'TRUCK') {
  return (a: AnalisePesoComparativo): string | undefined => {
    const total = a.tiposCaminhao[tipo];
    if (!total) return undefined;
    const deduzidas = a.frotaTipoDeduzido?.porTipo?.[tipo] || 0;
    if (deduzidas <= 0) return `${total} placa(s) — tipo lido da coluna TIPO DE CAMINHÃO.`;
    return `${total} placa(s), das quais ${deduzidas} com tipo deduzido pelo peso `
      + '(a planilha não declarou o tipo dessas placas).';
  };
}

export const METRICAS_PESO: LinhaMetricaPeso[] = [
  { secao: 'operacao', label: 'NÚMERO DE VIAGENS', tipo: 'int', getValor: (a) => a.numeroViagens },
  { secao: 'operacao', label: 'PESO MÉDIO', tipo: 'num', getValor: (a) => a.pesoMedioKg },
  {
    secao: 'operacao',
    label: 'MÍNIMO',
    tipo: 'num',
    getValor: (a) => a.rotaMinima?.pesoMedioKg,
    getTitulo: (a) => (a.rotaMinima ? `Menor viagem — Rota: ${a.rotaMinima.nome}` : undefined),
  },
  {
    secao: 'operacao',
    label: 'MÁXIMO',
    tipo: 'num',
    getValor: (a) => a.rotaMaxima?.pesoMedioKg,
    getTitulo: (a) => (a.rotaMaxima ? `Maior viagem — Rota: ${a.rotaMaxima.nome}` : undefined),
  },
  { secao: 'faixa', label: 'PÉSSIMO (< 50% do ideal)', tipo: 'faixa', faixaIdx: 0, getTitulo: tituloFaixa(0) },
  { secao: 'faixa', label: 'RUIM (50–90% do ideal)', tipo: 'faixa', faixaIdx: 1, getTitulo: tituloFaixa(1) },
  { secao: 'faixa', label: 'ÓTIMO (90–110% do ideal)', tipo: 'faixa', faixaIdx: 2, getTitulo: tituloFaixa(2) },
  { secao: 'faixa', label: 'EXCEDIDO (> 110% do ideal)', tipo: 'faixa', faixaIdx: 3, getTitulo: tituloFaixa(3) },
  { secao: 'frota', label: 'MINI', tipo: 'int', getValor: (a) => a.tiposCaminhao.MINI, getTitulo: tituloOrigemTipo('MINI') },
  { secao: 'frota', label: 'TOCO', tipo: 'int', getValor: (a) => a.tiposCaminhao.TOCO, getTitulo: tituloOrigemTipo('TOCO') },
  { secao: 'frota', label: 'BASCULANTE', tipo: 'int', getValor: (a) => a.tiposCaminhao.BASCULANTE, getTitulo: tituloOrigemTipo('BASCULANTE') },
  { secao: 'frota', label: 'TRUCK', tipo: 'int', getValor: (a) => a.tiposCaminhao.TRUCK, getTitulo: tituloOrigemTipo('TRUCK') },
  { secao: 'frota', label: 'SOMA', tipo: 'int', getValor: (a) => a.tiposCaminhao.soma },
  { secao: 'frota', label: 'Caminhões (placas únicas)', tipo: 'int', getValor: (a) => a.caminhoesUnicos },
  { secao: 'cenario', label: 'CAIXA MÉDIA (L)', tipo: 'num', getValor: (a) => a.caixaMediaKg },
  { secao: 'cenario', label: 'DENSIDADE DO RESÍDUO (KG/L)', tipo: 'num', getValor: (a) => a.densidadeOtima },
  {
    secao: 'cenario',
    label: 'PESO IDEAL (KG)',
    tipo: 'num',
    getValor: calcularMediaIdealExibicao,
    classeCelula: () => 'celula-ideal',
  },
  {
    secao: 'cenario',
    label: 'CENÁRIO',
    tipo: 'texto',
    getTexto: fmtCenario,
    classeCelula: (a) => (a.perdaTon < 0 ? 'celula-cenario-perda' : a.perdaTon > 0 ? 'celula-cenario-ganho' : ''),
  },
  {
    secao: 'cenario',
    label: 'RESULTADO',
    tipo: 'texto',
    getTexto: fmtResultado,
    classeCelula: (a) => (a.perdaTon < 0 ? 'celula-resultado-perda' : a.perdaTon > 0 ? 'celula-resultado-ganho' : ''),
  },
  {
    secao: 'cenario',
    label: 'VIAGENS ATERRO (RESULTADO ÷ IDEAL)',
    tipo: 'texto',
    getTexto: fmtViagensEquivalentesResultado,
    getTitulo: tituloViagensEquivalentesResultado,
    classeCelula: (a) => (a.perdaTon < 0 ? 'celula-resultado-perda' : a.perdaTon > 0 ? 'celula-resultado-ganho' : ''),
  },
];

export interface CelulaMetricaPeso {
  texto: string;
  titulo?: string;
  pct?: string;
  pctCor?: (typeof FAIXA_CORES)[number];
  classe?: string;
}

export function formatarCelulaMetricaPeso(
  linha: LinhaMetricaPeso,
  analise: AnalisePesoComparativo,
): CelulaMetricaPeso {
  const classe = linha.classeCelula?.(analise) || '';
  const titulo = linha.getTitulo?.(analise);

  if (linha.tipo === 'faixa' && linha.faixaIdx !== undefined) {
    const faixa = analise.faixas?.[linha.faixaIdx];
    if (!faixa) {
      return { texto: '—', classe: `celula-faixa ${classe}`.trim(), titulo };
    }
    return {
      texto: fmtIntPeso(faixa.quantidade),
      pct: fmtPctPeso(faixa.pct),
      pctCor: FAIXA_CORES[linha.faixaIdx] ?? 'amarelo',
      classe: `celula-faixa ${classe}`.trim(),
      titulo,
    };
  }

  if (linha.tipo === 'texto' && linha.getTexto) {
    return { texto: linha.getTexto(analise), classe, titulo };
  }

  const raw = linha.getValor?.(analise);
  if (raw === undefined || raw === null || Number.isNaN(raw)) {
    return { texto: '—', classe, titulo };
  }

  if (linha.tipo === 'int') return { texto: fmtIntPeso(raw), classe, titulo };
  return { texto: fmtNumPeso(raw, 2), classe, titulo };
}
