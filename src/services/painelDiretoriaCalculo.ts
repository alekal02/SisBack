/**
 * Números da diretoria: quantidade da planilha × preço cadastrado.
 * O fallback de R$ 80/t da fórmula antiga não entra aqui. Sem preço, a
 * tonelada fica de fora da soma.
 */
import { resolverValorUnitarioPorTipo } from '../config/pesoMaximoCaminhao';
import { detectarTodasColunas } from './metricaExecutivaService';
import { encontrarValorColuna } from './FormulaEngine';
import { obterPesoTotalRegistro } from './viagensPorRotaService';
import { camposMetricaDeRegistro, metricaOficialServico } from '@sistemma/shared';

export interface LinhaPeso {
  tipo: string;
  pesoKg: number;
  data?: string | null;
}

export interface ParteTipo {
  tipo: string;
  toneladas: number;
  tarifa: number | null;
  reais: number | null;
}

export interface ComposicaoColeta {
  toneladas: number;
  faturamento: number | null;
  porTipo: ParteTipo[];
  porDia: Array<{ data: string; reais: number }>;
  temPreco: boolean;
  temSemPreco: boolean;
}

export interface ProducaoServico {
  quantidade: number;
  unidade: string;
  label: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Preço cadastrado do tipo. Zero e o fallback de R$ 80 não contam. */
export function precoCadastrado(tipo: string, valores: Record<string, number>): number | null {
  const preco = resolverValorUnitarioPorTipo(tipo, valores, 0);
  return preco > 0 ? preco : null;
}

export function comporFaturamentoColeta(
  linhas: LinhaPeso[],
  valores: Record<string, number>,
): ComposicaoColeta {
  const porTipo = new Map<string, { toneladas: number; reais: number; tarifa: number | null }>();
  const porDia = new Map<string, number>();
  let toneladas = 0;
  let soma = 0;
  let temPreco = false;
  let temSemPreco = false;

  for (const linha of linhas) {
    const peso = Number(linha.pesoKg) || 0;
    if (peso <= 0) continue;
    const tipoRaw = String(linha.tipo || '').trim();
    const toneladasLinha = peso / 1000;
    toneladas += toneladasLinha;
    if (/^\d+$/.test(tipoRaw)) continue;
    const chave = tipoRaw || 'Não informado';
    const preco = precoCadastrado(tipoRaw, valores);
    const acc = porTipo.get(chave) || { toneladas: 0, reais: 0, tarifa: preco };
    acc.toneladas += toneladasLinha;
    if (preco == null) {
      temSemPreco = true;
      acc.tarifa = acc.reais > 0 ? acc.tarifa : null;
    } else {
      temPreco = true;
      acc.tarifa = preco;
      const reais = toneladasLinha * preco;
      acc.reais += reais;
      soma += reais;
      if (linha.data) porDia.set(linha.data, (porDia.get(linha.data) || 0) + reais);
    }
    porTipo.set(chave, acc);
  }

  const partes: ParteTipo[] = [...porTipo.entries()]
    .map(([tipo, acc]) => ({
      tipo,
      toneladas: round2(acc.toneladas),
      tarifa: acc.tarifa,
      reais: acc.reais > 0 ? round2(acc.reais) : null,
    }))
    .sort((a, b) => (b.reais || 0) - (a.reais || 0) || a.tipo.localeCompare(b.tipo, 'pt-BR'));

  return {
    toneladas: round2(toneladas),
    faturamento: temPreco ? round2(soma) : null,
    porTipo: partes,
    porDia: [...porDia.entries()]
      .map(([data, reais]) => ({ data, reais: round2(reais) }))
      .sort((a, b) => a.data.localeCompare(b.data)),
    temPreco,
    temSemPreco,
  };
}

/** Mesma leitura de peso e tipo do executivo, sem o R$ 80. */
export function comporFaturamentoColetaDeBrutos(
  brutos: Record<string, unknown>[],
  valores: Record<string, number>,
  servicoId: string,
): ComposicaoColeta {
  const colunas = detectarTodasColunas(brutos, servicoId);
  const linhas: LinhaPeso[] = [];
  for (const d of brutos) {
    const tipoRaw = colunas.colTipo
      ? String(encontrarValorColuna(d, colunas.colTipo) || '').trim()
      : '';
    const peso = Number(encontrarValorColuna(d, colunas.colPeso)) || 0;
    const dataBruta = encontrarValorColuna(d, colunas.colData);
    linhas.push({
      tipo: tipoRaw,
      pesoKg: peso,
      data: dataBruta == null ? null : String(dataBruta).slice(0, 10),
    });
  }
  return comporFaturamentoColeta(linhas, valores);
}

/** Peso da tela da coleta (célula da planilha), vezes o preço cadastrado. */
export function comporFaturamentoColetaDeRegistros(
  registros: Array<{ validoDashboard?: boolean; tipoCaminhao?: string | null; pesoTotal?: number | null; dados?: Record<string, unknown> | null; dataSaida?: Date | string | null }>,
  valores: Record<string, number>,
): ComposicaoColeta {
  const linhas: LinhaPeso[] = [];
  for (const c of registros) {
    if (c.validoDashboard === false) continue;
    const data = c.dataSaida instanceof Date
      ? c.dataSaida.toISOString().slice(0, 10)
      : (c.dataSaida ? String(c.dataSaida).slice(0, 10) : null);
    linhas.push({
      tipo: String(c.tipoCaminhao || ''),
      pesoKg: obterPesoTotalRegistro(c),
      data,
    });
  }
  return comporFaturamentoColeta(linhas, valores);
}

export function producaoDeRegistros(
  tipoServico: string,
  registros: Array<Record<string, unknown> | null | undefined>,
): ProducaoServico {
  const total = {
    areaM2: 0,
    metroLinear: 0,
    kmLinear: 0,
    qtdArvore: 0,
    quantitativo: 0,
  };
  for (const registro of registros) {
    const campos = camposMetricaDeRegistro(registro || undefined);
    total.areaM2 += Number(campos.areaM2) || 0;
    total.metroLinear += Number(campos.metroLinear) || 0;
    total.kmLinear += Number(campos.kmLinear) || 0;
    total.qtdArvore += Number(campos.qtdArvore) || 0;
    total.quantitativo += Number(campos.quantitativo) || 0;
  }
  const oficial = metricaOficialServico(tipoServico, total);
  return {
    quantidade: round2(oficial.valor),
    unidade: unidadeDaMetrica(oficial.sufixo, tipoServico),
    label: oficial.label,
  };
}

export function unidadeDaMetrica(sufixo: string, tipoServico?: string): string {
  if (sufixo === 'arv') return 'árvore';
  if (sufixo === 'pts') return tipoServico === 'remocao' ? 'equipe' : 'un';
  if (sufixo === 'm²' || sufixo === 'm2') return 'm²';
  return sufixo || 'un';
}

export function tarifaProducaoDe(
  tipo: string,
  nome: string,
  config: Record<string, unknown> | null | undefined,
): number | null {
  if (!config || config.ativo !== true) return null;
  const n = (valor: unknown): number | null => {
    const x = Number(valor);
    return Number.isFinite(x) && x > 0 ? x : null;
  };
  if (tipo === 'rocadeira') {
    if (/manual/i.test(nome)) return n(config.valorM2Manual) ?? n(config.valorM2);
    if (/mecan/i.test(nome)) return n(config.valorM2Mecanizada) ?? n(config.valorM2);
    return n(config.valorM2) ?? n(config.valorM2Mecanizada) ?? n(config.valorM2Manual);
  }
  if (tipo === 'poda') return n(config.valorPorArvore);
  if (tipo === 'remocao') return n(config.valorPorEquipe) ?? n(config.valorPorUnidade);
  if (tipo === 'varricao' || tipo === 'capina' || tipo === 'pintura_meio_fio' || tipo === 'geral') {
    return n(config.valorKmLinear) ?? n(config.valorPorUnidade);
  }
  return n(config.valorPorUnidade) ?? n(config.valorKmLinear) ?? n(config.valorM2) ?? n(config.valorPorArvore);
}

export function variacaoPercentual(atual: number, anterior: number): number | null {
  if (!(anterior > 0) || !Number.isFinite(atual)) return null;
  return Math.round(((atual - anterior) / anterior) * 1000) / 10;
}

export type LuzDiretoria = 'verde' | 'amarelo' | 'vermelho' | 'cinza' | 'sem-meta';

export function semaforoDiretoria(opts: {
  temTarifa: boolean;
  temPlanilha: boolean;
  variacao: number | null;
  pctMeta?: number | null;
}): LuzDiretoria {
  if (!opts.temTarifa) return 'cinza';
  if (!opts.temPlanilha) return 'vermelho';
  if (opts.pctMeta != null) {
    if (opts.pctMeta < 80 || (opts.variacao != null && opts.variacao < -15)) return 'vermelho';
    if (opts.pctMeta < 95 || (opts.variacao != null && opts.variacao <= -5)) return 'amarelo';
    return 'verde';
  }
  if (opts.variacao == null) return 'amarelo';
  if (opts.variacao < -15) return 'vermelho';
  if (opts.variacao <= -5) return 'amarelo';
  return 'sem-meta';
}

export function projetarFechamento(
  realizado: number,
  diasDecorridos: number,
  diasCiclo: number,
): number | null {
  if (!(realizado > 0) || !(diasDecorridos > 0) || !(diasCiclo > 0)) return null;
  return round2((realizado / diasDecorridos) * diasCiclo);
}

export function pctDaMeta(realizado: number | null, meta: number | null): number | null {
  if (realizado == null || meta == null || !(meta > 0)) return null;
  return round2((realizado / meta) * 100);
}
