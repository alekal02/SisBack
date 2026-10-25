import { esc, fmtNum, formatarIsoParaBr } from './fmt';
import type { RelatorioPacoteConsolidado, CardTipoConsolidado } from '../consolidadoProducaoRelatorio';
import { fmtQtd } from '../consolidadoProducaoRelatorio';

function diaSemanaPt(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return '';
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return dt.toLocaleDateString('pt-BR', { weekday: 'long', timeZone: 'UTC' });
}

const CSS = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 9px; color: #1e293b; padding: 14px; background: #f8fafc; }
    .header { background: #0f172a; color: #fff; border-radius: 10px; padding: 12px 14px; margin-bottom: 10px; }
    .header .eyebrow { font-size: 7px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #94a3b8; }
    .header h1 { font-size: 16px; font-weight: 800; color: #fbbf24; margin-top: 2px; }
    .header .data { font-size: 11px; font-weight: 700; color: #e2e8f0; margin-top: 4px; }
    .header .meta { font-size: 7px; color: #94a3b8; margin-top: 6px; }
    .tipo { display: inline-block; font-size: 7px; font-weight: 700; padding: 2px 8px; border-radius: 4px; text-transform: uppercase; margin-right: 4px; }
    .tipo.op { color: #c7d2fe; background: rgba(99,102,241,0.28); }
    .tipo.ciclo { color: #6ee7b7; background: rgba(16,185,129,0.22); }
    .sec { font-size: 8px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; margin: 12px 0 6px; }
    .quebra { page-break-before: always; }
    .cards { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 10px; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-top: 3px solid #6366f1; border-radius: 8px; padding: 10px; }
    .card.ciclo { border-top-color: #10b981; }
    .card .lbl { font-size: 8px; color: #64748b; text-transform: uppercase; font-weight: 700; }
    .card .val { font-size: 15px; font-weight: 800; color: #0f172a; margin-top: 4px; }
    .card .sub, .card .mix { font-size: 7.5px; color: #64748b; margin-top: 3px; }
    .banner { background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 7px 8px; margin-bottom: 10px; font-size: 8px; color: #92400e; }
    .bloco { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; margin-bottom: 10px; }
    .bloco-hd { font-size: 9px; font-weight: 700; color: #475569; margin-bottom: 6px; padding-bottom: 4px; border-bottom: 1px solid #e2e8f0; }
    table.data { width: 100%; border-collapse: collapse; font-size: 8px; }
    table.data th { padding: 5px 6px; background: #1e293b; color: #fff; text-align: left; }
    table.data td { padding: 4px 6px; border-bottom: 1px solid #f1f5f9; }
    table.data .r { text-align: right; font-family: monospace; }
    table.data tr.hoje td { background: #eef2ff; font-weight: 700; }
    table.data tr.tot td { background: #ecfdf5; font-weight: 800; border-top: 2px solid #10b981; }
    .footer { text-align: center; font-size: 8px; color: #94a3b8; margin-top: 12px; }
    .card, .bloco, .banner { break-inside: avoid; }
    table.data tr { break-inside: avoid; }
    table.data thead { display: table-header-group; }
`;

function wrapHtml(body: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>${CSS}</style>
</head>
<body>
${body}
</body>
</html>`;
}

function cardsHtml(cards: CardTipoConsolidado[], ciclo = false): string {
  return cards.map((c) => {
    const mix = (c.registrosManual > 0 || c.registrosMecanizada > 0)
      ? `<div class="mix">Manual ${esc(fmtQtd(c.quantitativoManual, c.und))} · Mecanizada ${esc(fmtQtd(c.quantitativoMecanizada, c.und))}</div>`
      : '';
    return `<div class="card${ciclo ? ' ciclo' : ''}">
      <div class="lbl">${esc(c.tipoLabel)}</div>
      <div class="val">${esc(fmtQtd(c.quantitativo, c.und))}</div>
      <div class="sub">${c.registros} registro(s) · ${c.locais} local(is)</div>
      ${mix}
    </div>`;
  }).join('');
}

function tabelaResumo(cards: CardTipoConsolidado[]): string {
  const rows = cards.map((c) => `
    <tr>
      <td>${esc(c.tipoLabel)}</td>
      <td class="r">${fmtNum(c.registros, 0)}</td>
      <td class="r">${esc(fmtQtd(c.quantitativo, c.und))}</td>
      <td class="r">${fmtNum(c.locais, 0)}</td>
      <td class="r">${c.registrosManual ? fmtNum(c.registrosManual, 0) : '—'}</td>
      <td class="r">${c.registrosMecanizada ? fmtNum(c.registrosMecanizada, 0) : '—'}</td>
    </tr>`).join('');
  return `<table class="data">
    <thead>
      <tr>
        <th>Serviço</th>
        <th class="r">Registros</th>
        <th class="r">Quantidade</th>
        <th class="r">Locais</th>
        <th class="r">Manual</th>
        <th class="r">Mecanizada</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function blocosLocais(cards: CardTipoConsolidado[]): string {
  return cards.map((c) => {
    if (!c.topLocais.length) return '';
    const rows = c.topLocais.map((l) => `
      <tr>
        <td>${esc(l.local)}</td>
        <td class="r">${fmtNum(l.registros, 0)}</td>
        <td class="r">${esc(fmtQtd(l.quantitativo, c.und))}</td>
      </tr>`).join('');
    return `<div class="bloco">
      <div class="bloco-hd">${esc(c.tipoLabel)} — principais locais</div>
      <table class="data">
        <thead><tr><th>Local</th><th class="r">Registros</th><th class="r">Quantidade</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }).join('');
}

function avisosHtml(avisos: string[]): string {
  if (!avisos.length) return '';
  return `<div class="banner">${avisos.map((a) => esc(a)).join('<br/>')}</div>`;
}

function corpoDia(opts: {
  contratoNome: string;
  servicoNome: string;
  pacote: RelatorioPacoteConsolidado;
}): string {
  const { contratoNome, servicoNome, pacote } = opts;
  const { dia } = pacote;
  const ds = diaSemanaPt(dia.dataIso);
  const geradoEm = new Date().toLocaleString('pt-BR');
  return `
  <div class="header">
    <div class="eyebrow">Relatório diário do serviço</div>
    <h1>${esc(servicoNome)} — operação do dia</h1>
    <div class="data">${esc(formatarIsoParaBr(dia.dataIso))}${ds ? ` · ${esc(ds)}` : ''}</div>
    <div class="meta">
      <span class="tipo op">Diário</span>
      &nbsp;${esc(contratoNome)} · ${dia.totalRegistros} registro(s) · Gerado em ${esc(geradoEm)}
    </div>
  </div>
  ${avisosHtml(dia.avisos)}
  <div class="sec">Operação do dia — ${esc(formatarIsoParaBr(dia.dataIso))}</div>
  <div class="cards">${cardsHtml(dia.cards)}</div>
  <div class="bloco">
    <div class="bloco-hd">Resumo do dia</div>
    ${tabelaResumo(dia.cards)}
  </div>
  ${blocosLocais(dia.cards)}
  <div class="footer">Fonte: CONSOLIDADO da planilha padrão de produção · um PDF por serviço por dia</div>`;
}

function corpoCiclo(opts: {
  contratoNome: string;
  servicoNome: string;
  pacote: RelatorioPacoteConsolidado;
}): string {
  const { contratoNome, servicoNome, pacote } = opts;
  const { dia, ciclo } = pacote;
  const geradoEm = new Date().toLocaleString('pt-BR');
  const tiposColuna = ciclo.cards;
  const headSerie = tiposColuna.map((c) => `<th class="r">${esc(c.tipoLabel)}</th>`).join('');
  const rowsSerie = ciclo.serie.map((s) => {
    const cells = tiposColuna.map((c) => {
      const t = s.porTipo.find((p) => p.tipoSistema === c.tipoSistema);
      if (!t) return '<td class="r">—</td>';
      return `<td class="r">${esc(fmtQtd(t.quantitativo, t.und))}</td>`;
    }).join('');
    const destaque = s.dataIso === dia.dataIso ? ' class="hoje"' : '';
    return `<tr${destaque}><td>${esc(formatarIsoParaBr(s.dataIso))}</td>${cells}</tr>`;
  }).join('');
  const rowTotal = `<tr class="tot"><td>Total do ciclo</td>${tiposColuna.map((c) =>
    `<td class="r">${esc(fmtQtd(c.quantitativo, c.und))}</td>`
  ).join('')}</tr>`;

  return `
  <div class="header">
    <div class="eyebrow">Relatório do ciclo do serviço</div>
    <h1>${esc(servicoNome)} — ciclo</h1>
    <div class="data">${esc(formatarIsoParaBr(ciclo.dataInicio))} a ${esc(formatarIsoParaBr(ciclo.dataFim))}</div>
    <div class="meta">
      <span class="tipo ciclo">Ciclo</span>
      &nbsp;${esc(contratoNome)} · ${ciclo.diasComDados} dia(s) · ${ciclo.totalRegistros} registro(s) · Gerado em ${esc(geradoEm)}
    </div>
  </div>
  <div class="sec">Acumulado do ciclo — ${esc(formatarIsoParaBr(ciclo.dataInicio))} a ${esc(formatarIsoParaBr(ciclo.dataFim))}</div>
  <div class="cards">${cardsHtml(ciclo.cards, true)}</div>
  <div class="bloco">
    <div class="bloco-hd">Acumulado do ciclo (${ciclo.totalRegistros} registros · ${ciclo.diasComDados} dias)</div>
    ${tabelaResumo(ciclo.cards)}
  </div>
  <div class="bloco">
    <div class="bloco-hd">Série diária — último dia destacado</div>
    <table class="data">
      <thead><tr><th>Data</th>${headSerie}</tr></thead>
      <tbody>${rowsSerie}${rowTotal}</tbody>
    </table>
  </div>
  <div class="footer">Fonte: CONSOLIDADO da planilha padrão de produção · um PDF de ciclo por serviço</div>`;
}

export function gerarHtmlRelatorioDiaServicoProducao(opts: {
  contratoNome: string;
  servicoNome?: string;
  pacote: RelatorioPacoteConsolidado;
}): string {
  const servicoNome = opts.servicoNome || opts.pacote.dia.cards[0]?.tipoLabel || 'Serviço';
  return wrapHtml(corpoDia({ ...opts, servicoNome }));
}

export function gerarHtmlRelatorioCicloServicoProducao(opts: {
  contratoNome: string;
  servicoNome?: string;
  pacote: RelatorioPacoteConsolidado;
}): string {
  const servicoNome = opts.servicoNome || opts.pacote.ciclo.cards[0]?.tipoLabel || 'Serviço';
  return wrapHtml(corpoCiclo({ ...opts, servicoNome }));
}

/** PDF único (dia + ciclo) — compatível com callers antigos. */
export function gerarHtmlRelatorioPacoteConsolidado(opts: {
  contratoNome: string;
  servicoNome?: string;
  pacote: RelatorioPacoteConsolidado;
}): string {
  const servicoNome = opts.servicoNome || opts.pacote.dia.cards[0]?.tipoLabel || 'Serviço';
  return wrapHtml(
    `${corpoDia({ ...opts, servicoNome })}<div class="quebra"></div>${corpoCiclo({ ...opts, servicoNome })}`,
  );
}

/** Compat: só o dia, se algum caller antigo ainda pedir. */
export function gerarHtmlRelatorioDiaConsolidado(opts: {
  contratoNome: string;
  relatorio: RelatorioPacoteConsolidado['dia'];
}): string {
  return gerarHtmlRelatorioDiaServicoProducao({
    contratoNome: opts.contratoNome,
    pacote: {
      dia: opts.relatorio,
      ciclo: {
        dataInicio: opts.relatorio.dataIso,
        dataFim: opts.relatorio.dataIso,
        diasComDados: 1,
        totalRegistros: opts.relatorio.totalRegistros,
        cards: opts.relatorio.cards,
        serie: [{
          dataIso: opts.relatorio.dataIso,
          registros: opts.relatorio.totalRegistros,
          porTipo: opts.relatorio.cards.map((c) => ({
            tipoSistema: c.tipoSistema,
            tipoLabel: c.tipoLabel,
            registros: c.registros,
            quantitativo: c.quantitativo,
            und: c.und,
          })),
        }],
      },
    },
  });
}
