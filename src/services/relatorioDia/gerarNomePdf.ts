/** Nome de arquivo alinhado ao frontend `gerarNomePdfRelatorioDia`. */

export function sanitizarParteNome(texto: string, maxLen = 50): string {
  return (texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, maxLen);
}

function sufixoPeriodoPdf(opts: { dataInicio?: string; dataFim?: string }): string | undefined {
  const { dataInicio, dataFim } = opts;
  if (!dataInicio) return undefined;
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split('-');
    return y && m && d ? `${d}-${m}-${y}` : iso;
  };
  if (dataFim && dataInicio === dataFim) return fmt(dataInicio);
  if (dataFim) return `Ciclo_${fmt(dataInicio)}_a_${fmt(dataFim)}`;
  return fmt(dataInicio);
}

/** Ex.: Coleta_Aparecida_Operacao_11-07-2026 */
export function gerarNomePdfRelatorioDia(opts: {
  servicoNome: string;
  aba: 'operacao' | 'receita';
  dataIso: string;
}): string {
  const dataFmt = sufixoPeriodoPdf({ dataInicio: opts.dataIso, dataFim: opts.dataIso }) || opts.dataIso;
  const tipo = opts.aba === 'receita' ? 'Receita' : 'Operacao';
  return [
    sanitizarParteNome(opts.servicoNome || 'Servico'),
    tipo,
    sanitizarParteNome(dataFmt),
  ].join('_');
}

/** Ex.: CONSOLIDADO_Operacao_Ciclo_25-08-2026_a_16-09-2026 */
export function gerarNomePdfPacoteConsolidado(opts: {
  dataInicio: string;
  dataFim: string;
}): string {
  const periodo = sufixoPeriodoPdf({ dataInicio: opts.dataInicio, dataFim: opts.dataFim }) || opts.dataFim;
  return [
    'CONSOLIDADO',
    'Operacao_Ciclo',
    sanitizarParteNome(periodo.replace(/^Ciclo_/, '')),
  ].join('_');
}

/** Ex.: Rocada_Manual_Operacao_16-09-2026 */
export function gerarNomePdfDiaServicoProducao(opts: {
  servicoNome: string;
  dataIso: string;
}): string {
  return gerarNomePdfRelatorioDia({
    servicoNome: opts.servicoNome,
    aba: 'operacao',
    dataIso: opts.dataIso,
  });
}

/** Ex.: Rocada_Manual_Ciclo_25-08-2026_a_16-09-2026 */
export function gerarNomePdfCicloServicoProducao(opts: {
  servicoNome: string;
  dataInicio: string;
  dataFim: string;
}): string {
  const periodo = sufixoPeriodoPdf({ dataInicio: opts.dataInicio, dataFim: opts.dataFim }) || opts.dataFim;
  return [
    sanitizarParteNome(opts.servicoNome || 'Servico'),
    'Ciclo',
    sanitizarParteNome(periodo.replace(/^Ciclo_/, '')),
  ].join('_');
}
