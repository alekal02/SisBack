/**
 * Deduplicação de KPIs manuais, automáticos e universais.
 * Usado em runtime (dashboard), ativação de universais e scripts de limpeza.
 */

export type KpiLike = Record<string, any>;

const ALIASES_NOME: Record<string, string> = {
  'total viagens contador': 'viagens totais',
  'total de viagens contador': 'viagens totais',
  'contador de viagens': 'viagens totais',
  'amplitude de peso': 'indice de variacao',
  'índice de variação': 'indice de variacao',
  'peso por km rodado': 'tonelada por km',
  'peso/km': 'tonelada por km',
  'velocidade media operacional': 'km por hora produtiva',
  'vel. media km/h': 'km por hora produtiva',
  'km por hora fora': 'km por hora produtiva',
  'ton. por hora fora': 'toneladas por hora produtiva',
  'toneladas por hora fora': 'toneladas por hora produtiva',
  'horas produtivas totais': 'horas produtivas',
  'jornada total horas fora': 'horas produtivas',
  'km medio por viagem': 'km medio por viagem',
  'km medio/viagem': 'km medio por viagem',
  'km médio por viagem': 'km medio por viagem',
  'km medio por viagem individual': 'km medio por viagem',
  'media ton/coletor por viagem': 'produtividade por coletor',
  'média ton/coletor por viagem': 'produtividade por coletor',
  'produtividade por coletor t': 'produtividade por coletor',
  'prod. por coletor (t)': 'produtividade por coletor',
  'prod. por coletor ton': 'produtividade por coletor',
  'prod por coletor ton': 'produtividade por coletor',
  'coletores ativos': 'veiculos ativos placas',
  'coletas por coletor': 'viagens por veiculo',
  'total coletores na equipe': 'coletores unicos equipe',
  'total de coletores na equipe': 'coletores unicos equipe',
  'coletores na equipe': 'coletores unicos equipe',
  'total viagens': 'viagens totais',
  'total de viagens': 'viagens totais',
  'km/ton': 'km por tonelada',
  'km ton': 'km por tonelada',
  'km por ton': 'km por tonelada',
  'kmtotal/tontotal': 'km por tonelada',
  'ton/km': 'tonelada por km',
  'ton km': 'tonelada por km',
  'toneladas/km': 'tonelada por km',
};

function normalizarTexto(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function normalizarFormula(expr: string): string {
  return expr
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '')
    .replace(/PLACEHOLDER/g, 'PH');
}

/** Prioridade: manual > universal > modelo executivo > automático import */
function prioridadeKpi(kpi: KpiLike): number {
  if (kpi.origemUniversal) return 3;
  if (kpi.modeloExecutivo) return 2;
  if (kpi.automatico) return 1;
  return 4;
}

function chavePorNome(kpi: KpiLike): string {
  const raw = normalizarTexto(kpi.label || kpi.nome || '');
  const canon = ALIASES_NOME[raw] || raw;
  return `nome:${canon}`;
}

function chavePorExpressao(kpi: KpiLike): string | null {
  const expr = kpi.expressao || kpi.formula || '';
  if (!expr.trim()) return null;
  return `expr:${normalizarFormula(expr)}`;
}

function chavePorOrigemUniversal(kpi: KpiLike): string | null {
  if (!kpi.origemUniversal) return null;
  return `uni:${kpi.origemUniversal}`;
}

function chavePorAgregacaoSimples(kpi: KpiLike): string | null {
  const expr = kpi.expressao || kpi.formula || '';
  if (expr.trim()) return null;
  const col = kpi.coluna2 || kpi.nome || '';
  if (!kpi.agregacao || !col) return null;
  return `agg:${kpi.agregacao}:${normalizarTexto(col)}`;
}

/** Gera todas as chaves de duplicata possíveis para um KPI */
export function gerarChavesDuplicata(kpi: KpiLike): string[] {
  const chaves: string[] = [];
  const origem = chavePorOrigemUniversal(kpi);
  if (origem) chaves.push(origem);
  const expr = chavePorExpressao(kpi);
  if (expr) chaves.push(expr);
  const agg = chavePorAgregacaoSimples(kpi);
  if (agg) chaves.push(agg);
  chaves.push(chavePorNome(kpi));
  return [...new Set(chaves)];
}

export interface ResultadoDeduplicacao {
  kpis: KpiLike[];
  removidos: number;
  detalhes: { nome: string; label?: string; motivo: string }[];
}

/**
 * Remove KPIs duplicados mantendo o de maior prioridade (manual > universal > auto).
 */
export function deduplicarKpisLista(
  kpis: KpiLike[],
  opts?: { manterInativos?: boolean },
): ResultadoDeduplicacao {
  const manterInativos = opts?.manterInativos ?? false;
  const lista = manterInativos ? kpis : kpis.filter(k => k.ativo !== false);

  const indicePorChave = new Map<string, number>();
  const resultado: KpiLike[] = [];
  const detalhes: ResultadoDeduplicacao['detalhes'] = [];

  for (const kpi of lista) {
    const chaves = gerarChavesDuplicata(kpi);
    let duplicataDe: number | null = null;

    for (const chave of chaves) {
      if (indicePorChave.has(chave)) {
        duplicataDe = indicePorChave.get(chave)!;
        break;
      }
    }

    if (duplicataDe !== null) {
      const existente = resultado[duplicataDe];
      const prioNovo = prioridadeKpi(kpi);
      const prioExist = prioridadeKpi(existente);

      if (prioNovo > prioExist) {
        detalhes.push({
          nome: existente.nome || existente.label,
          label: existente.label,
          motivo: `Substituído por KPI de maior prioridade: ${kpi.label || kpi.nome}`,
        });
        for (const c of gerarChavesDuplicata(existente)) {
          indicePorChave.delete(c);
        }
        resultado[duplicataDe] = kpi;
        for (const c of chaves) {
          indicePorChave.set(c, duplicataDe);
        }
      } else {
        detalhes.push({
          nome: kpi.nome || kpi.label,
          label: kpi.label,
          motivo: `Duplicata de: ${existente.label || existente.nome}`,
        });
      }
      continue;
    }

    const idx = resultado.length;
    resultado.push(kpi);
    for (const c of chaves) {
      indicePorChave.set(c, idx);
    }
  }

  const inativos = manterInativos ? kpis.filter(k => k.ativo === false) : [];
  return {
    kpis: [...resultado, ...inativos],
    removidos: detalhes.length,
    detalhes,
  };
}

/** Chave única para alinhar o mesmo KPI entre serviços na comparação por tipo */
export function chaveComparacaoKpi(kpi: KpiLike): string {
  const uni = chavePorOrigemUniversal(kpi);
  if (uni) return uni;
  const expr = chavePorExpressao(kpi);
  if (expr) return expr;
  const agg = chavePorAgregacaoSimples(kpi);
  if (agg) return agg;
  return chavePorNome(kpi);
}

export { normalizarTexto, normalizarFormula };

/** Nomes de KPIs universais redundantes na biblioteca (coleta) — não re-seedar */
export const KPIS_UNIVERSAIS_REMOVIDOS_COLETA = [
  'Total de Viagens (Contador)',
  'Amplitude de Peso',
  'Peso por KM Rodado',
  'Velocidade Média Operacional',
  'Jornada Total (Horas Fora)',
  'KM Médio por Tipo',
] as const;

/** Nomes renomeados ou descontinuados — removidos na sincronização da biblioteca */
export const KPIS_UNIVERSAIS_NOMES_LEGADOS = [
  'KM por Viagem Individual',
] as const;

export function chaveCatalogoKpiUniversal(nome: string, tipoServico: string): string {
  return `${normalizarTexto(nome)}|${tipoServico}`;
}

/**
 * Lista KPIs ativos para cálculo no dashboard sem colapsar KPIs com a mesma fórmula.
 * (Ex.: "Coletores Ativos" e "Total Coletores na Equipe" usam COLETORES_UNICOS() mas são cards distintos.)
 */
export function listarKpisAtivosParaCalculo(kpis: KpiLike[]): KpiLike[] {
  const ativos = kpis.filter((k) => k.ativo !== false);
  const seenIds = new Set<string>();
  const resultado: KpiLike[] = [];

  for (const kpi of ativos) {
    const id = typeof kpi.id === 'string' ? kpi.id.trim() : '';
    if (id) {
      if (seenIds.has(id)) continue;
      seenIds.add(id);
    }
    resultado.push(kpi);
  }

  return resultado;
}
