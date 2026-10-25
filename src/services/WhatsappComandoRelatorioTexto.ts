import { isoHojeLocal } from '../utils/periodoCicloContrato';
import { TipoServico } from '../enums/TipoServico';

export type QualCiclo = 'atual' | 'anterior';

const ALIASES_TIPO_SERVICO: Array<{ tipo: string; palavras: string[] }> = [
  { tipo: TipoServico.COLETA_SELETIVA, palavras: ['coleta seletiva'] },
  { tipo: TipoServico.ATERRO, palavras: ['aterro'] },
  { tipo: TipoServico.COLETA_CAMINHAO, palavras: ['coleta', 'caminhao'] },
  { tipo: TipoServico.ROCADEIRA, palavras: ['rocada', 'rocadeira'] },
  { tipo: TipoServico.VARRICAO, palavras: ['varricao', 'varredura'] },
  { tipo: TipoServico.CAPINA, palavras: ['capina'] },
  { tipo: TipoServico.PODA, palavras: ['poda'] },
  { tipo: TipoServico.REMOCAO, palavras: ['remocao', 'entulho'] },
  { tipo: TipoServico.PINTURA_MEIO_FIO, palavras: ['pintura'] },
  { tipo: TipoServico.GERAL, palavras: ['feira', 'feiras'] },
];

function textoTemPalavra(norm: string, palavra: string): boolean {
  const p = palavra.replace(/\s+/g, '\\s+');
  return new RegExp(`(?:^|\\s)${p}(?:$|\\s)`, 'i').test(` ${norm} `);
}

/** Tipo pedido no texto ("relatorio rocada", "pdf varricao"). */
export function extrairTipoServicoComando(norm: string): string | null {
  const t = String(norm || '').trim();
  if (!t) return null;
  for (const item of ALIASES_TIPO_SERVICO) {
    if (item.palavras.some((p) => textoTemPalavra(t, p))) return item.tipo;
  }
  return null;
}

function montarIso(ano: number, mes: number, dia: number): string | null {
  if (!ano || mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const dt = new Date(ano, mes - 1, dia);
  if (dt.getFullYear() !== ano || dt.getMonth() !== mes - 1 || dt.getDate() !== dia) return null;
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** Extrai YYYY-MM-DD de "dia 16/09", "16/09/2026", "2026-09-16". */
export function extrairDataIsoComando(texto: string, hojeIso?: string): string | null {
  const t = String(texto || '').trim();
  const hoje = hojeIso || isoHojeLocal();
  const [hy] = hoje.split('-').map(Number);

  const mIso = t.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (mIso) return montarIso(Number(mIso[1]), Number(mIso[2]), Number(mIso[3]));

  const mBrAno = t.match(/\b(\d{1,2})[/.\\-](\d{1,2})[/.\\-](20\d{2})\b/);
  if (mBrAno) return montarIso(Number(mBrAno[3]), Number(mBrAno[2]), Number(mBrAno[1]));

  const mBr = t.match(/\b(\d{1,2})[/.\\-](\d{1,2})\b/);
  if (mBr) return montarIso(hy, Number(mBr[2]), Number(mBr[1]));

  return null;
}

/** Atalho direto para o PDF de saúde dos dados (hodômetro/peso da coleta). */
export function ehPedidoSaude(norm: string): boolean {
  const t = String(norm || '').trim();
  if (!t) return false;
  if (/^(saude|hodometro)\b/.test(t)) return true;
  if (/^(relatorio(s)?|pdf|report)\s+(saude|hodometro)\b/.test(t)) return true;
  if (t.includes('saude dos dados') || t.includes('relatorio de saude')) return true;
  return false;
}

/** Atalho para o menu operacional (lista de serviços). */
export function ehPedidoOperacional(norm: string): boolean {
  const t = String(norm || '').trim();
  if (!t) return false;
  return /^(operacional|relatorio operacional|pdf operacional)\b/.test(t);
}

/** Atalho para o PDF de evolução diária (gráficos Ótimo/Ruim/Péssimo/Excedido). */
export function ehPedidoEvolucao(norm: string): boolean {
  const t = String(norm || '').trim();
  if (!t) return false;
  if (textoPedeCicloAnterior(t)) return false;
  if (/^evolucao(\s+por)?\s+ciclo$/.test(t)) return false;
  if (/^(evolucao|graficos|grafico)\b/.test(t)) return true;
  if (/^(relatorio(s)?|pdf|report)\s+(evolucao|grafico)/.test(t)) return true;
  if (t.includes('evolucao diaria') || t.includes('evolucao por grafico')) return true;
  return false;
}

/** Abre o menu de serviços (não gera PDF na hora). */
export function ehPedidoMenuRelatorio(norm: string): boolean {
  const t = String(norm || '').trim();
  if (!t) return false;
  if (/^(ciclo|comparativo|peso|evolucao|analise|dia|diario|saude|hodometro)\b/.test(t)) return false;
  if (/^(relatorio(s)?|pdf|report)\s+(ciclo|peso|comparativo|evolucao|anterior|saude|hodometro)\b/.test(t)) return false;
  if (textoPedeCicloAnterior(t) && !/\brelatorio/.test(t)) return false;
  if (/^(relatorio|relatorios|report)$/.test(t)) return true;
  if (/^(relatorio|relatorios|report)\b/.test(t)) return true;
  const tipo = extrairTipoServicoComando(t);
  if (tipo) {
    const resto = t
      .replace(/\b(relatorio|relatorios|report|pdf|do|da|de|os|as)\b/g, ' ')
      .replace(/\b\d{1,4}[/.\\-]\d{1,2}([/.\\-]\d{2,4})?\b/g, ' ')
      .replace(/\b20\d{2}-\d{1,2}-\d{1,2}\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const palavrasTipo = ALIASES_TIPO_SERVICO.find((x) => x.tipo === tipo)?.palavras || [];
    const soTipo = !resto || palavrasTipo.some((p) => resto === p || resto.replace(/\s+/g, '') === p.replace(/\s+/g, ''));
    return soTipo;
  }
  return false;
}

/** Índice 1-based de "1", "2 — roçada", etc. */
export function resolverEscolhaIndice(norm: string, max: number): number | null {
  const m = String(norm || '').trim().match(/^(\d+)\b/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isInteger(n) || n < 1 || n > max) return null;
  return n;
}

export function ehPedidoFormatoDiario(norm: string): boolean {
  const t = String(norm || '').trim();
  if (!t) return false;
  if (/^(1|diario|diaria|do dia|operacao|pdf dia)\b/.test(t)) return true;
  if (t === 'dia') return true;
  return false;
}

export function ehPedidoFormatoCiclo(norm: string): boolean {
  const t = String(norm || '').trim();
  if (!t) return false;
  if (/^(2|ciclo|completo|ciclo completo)\b/.test(t)) return true;
  return false;
}

export function ehPedidoFormatoEvolucao(norm: string): boolean {
  const t = String(norm || '').trim();
  if (!t) return false;
  if (/^(3|evolucao|graficos|grafico)\b/.test(t)) return true;
  return false;
}
export function ehPedidoRelatorioDia(norm: string): boolean {
  const t = String(norm || '').trim();
  if (!t) return false;
  if (/^(ciclo|comparativo|peso|evolucao|analise)\b/.test(t)) return false;
  if (/^(relatorio(s)?|pdf|report)\s+(ciclo|peso|comparativo|evolucao|anterior)\b/.test(t)) return false;
  if (textoPedeCicloAnterior(t) && !/\bdia\b/.test(t)) return false;
  if (/^(dia|diario|pdf dia|relatorio dia|relatorio do dia|relatorios do dia|operacao|pdf operacao)\b/.test(t)) {
    return true;
  }
  return false;
}

export function textoPedeCicloAnterior(norm: string): boolean {
  const t = String(norm || '');
  return (
    /\banterior\b/.test(t)
    || /\bpassado\b/.test(t)
    || t.includes('mes passado')
    || t.includes('ultimo ciclo')
    || t.includes('ciclo fechado')
  );
}

/**
 * Conversa solta no grupo não entra na fila pesada (Chrome/PDF).
 * Comando, número de menu, data ou planilha continuam.
 */
export function textoMereceProcessamento(bruto: string): boolean {
  const t = String(bruto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  if (!t || t.length > 180) return false;
  if (/^\d{1,2}\b/.test(t)) return true;
  if (/^(cancelar|sair|voltar|menu|ajuda|help|comandos)\b/.test(t)) return true;
  if (extrairDataIsoComando(t)) return true;
  if (ehPedidoSaude(t) || ehPedidoOperacional(t) || ehPedidoEvolucao(t)) return true;
  if (ehPedidoMenuRelatorio(t) || ehPedidoRelatorioDia(t) || ehPedidoFormatoCiclo(t)) return true;
  if (/^(ciclo|comparativo|comparar|peso|evolucao|saude|hodometro|diario|dia|relatorio|relatorios|pdf|report)\b/.test(t)) {
    return true;
  }
  return false;
}

/** Menu atual/anterior — o "2" aqui é ciclo anterior (não análise de peso). */
export function resolverQualCicloMenu(norm: string): QualCiclo | null {
  if (textoPedeCicloAnterior(norm)) return 'anterior';
  if (norm === '2') return 'anterior';
  if (norm === '1' || /\batual\b/.test(norm) || /\bandamento\b/.test(norm) || /\beste ciclo\b/.test(norm)) {
    return 'atual';
  }
  return null;
}
