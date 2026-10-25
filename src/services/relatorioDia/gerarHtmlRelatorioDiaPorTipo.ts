/**
 * HTML dos PDFs diários por tipo — mesmo layout da tela do dia
 * (roçada m², demais serviços por unidade).
 */
import { esc, fmtNum, formatarIsoParaBr, diaSemanaPt } from './fmt';

export interface LinhaGrupoDia {
  label: string;
  registros: number;
  valor: number;
}

function fmtArea(v: number): string {
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

function fmtMetrica(v: number, sufixo: string): string {
  const dec = sufixo === 'm²' || sufixo === 'arv' || sufixo === 'pts' ? 0 : (v >= 100 ? 1 : 2);
  return `${fmtNum(v, dec)} ${esc(sufixo)}`.trim();
}

function cardsHtml(items: { label: string; valor: string; cor: string }[]): string {
  const rows: string[] = [];
  for (let i = 0; i < items.length; i += 3) {
    const chunk = items.slice(i, i + 3);
    const cells = chunk.map((c) => `
      <td class="card" style="border-top-color:${c.cor};width:33.33%">
        <div class="card-lbl">${esc(c.label)}</div>
        <div class="card-val">${c.valor}</div>
      </td>`).join('');
    const fill = chunk.length < 3
      ? Array.from({ length: 3 - chunk.length }, () => '<td style="width:33.33%"></td>').join('')
      : '';
    rows.push(`<tr>${cells}${fill}</tr>`);
  }
  return `<table class="cards-tbl">${rows.join('')}</table>`;
}

const CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 8px; color: #1e293b; line-height: 1.35; width: 100%; }
  .header { color: #fff; border-radius: 8px; padding: 10px 12px; margin-bottom: 8px; }
  .header h1 { font-size: 13px; font-weight: 800; }
  .header .sub { font-size: 7px; margin-top: 2px; }
  .header .tipo {
    display: inline-block; margin-top: 3px; font-size: 6.5px; font-weight: 700;
    padding: 2px 7px; border-radius: 4px; text-transform: uppercase;
    background: rgba(255,255,255,0.15);
  }
  .banner { border-radius: 6px; padding: 5px 8px; margin-bottom: 8px; font-size: 7px; }
  .sec { font-size: 6.5px; font-weight: 800; color: #64748b; text-transform: uppercase; margin: 0 0 4px; }
  .hero-dark { border-radius: 8px; padding: 8px 10px; color: #fff; margin-bottom: 8px; }
  .hero-dark .lbl { font-size: 6px; font-weight: 600; text-transform: uppercase; }
  .hero-dark .val { font-size: 18px; font-weight: 900; font-family: monospace; white-space: nowrap; }
  .hero-dark .sub { font-size: 6.5px; margin-top: 2px; }
  .cards-tbl { width: 100%; border-collapse: separate; border-spacing: 4px; margin-bottom: 8px; }
  .card { background: #fff; border: 1px solid #e2e8f0; border-top: 3px solid #22c55e; border-radius: 5px; padding: 4px 5px; vertical-align: top; }
  .card-lbl { font-size: 5.5px; font-weight: 700; color: #64748b; text-transform: uppercase; }
  .card-val { font-size: 8px; font-weight: 800; color: #0f172a; white-space: nowrap; margin-top: 1px; }
  .bloco { background: #fff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px 7px; page-break-inside: avoid; margin-bottom: 8px; }
  .bloco-hd { font-size: 6.5px; font-weight: 800; color: #475569; text-transform: uppercase; margin-bottom: 4px; padding-bottom: 3px; border-bottom: 1px solid #e2e8f0; }
  table.data { width: 100%; border-collapse: collapse; font-size: 6.5px; }
  table.data thead { display: table-header-group; }
  table.data th { padding: 3px 4px; font-size: 5.5px; text-transform: uppercase; text-align: left; font-weight: 700; color: #fff; }
  table.data th.c, table.data td.c { text-align: center; }
  table.data th.r, table.data td.r { text-align: right; }
  table.data td { padding: 3px 4px; border-bottom: 1px solid #f1f5f9; }
  table.data tbody tr:nth-child(even) td { background: #f8fafc; }
  table.data tr { page-break-inside: avoid; }
  .bar-mini { display: block; height: 5px; background: #e2e8f0; border-radius: 3px; overflow: hidden; margin-top: 2px; }
  .bar-mini span { display: block; height: 5px; border-radius: 3px; }
  .layout2-tbl { width: 100%; border-collapse: separate; border-spacing: 6px; }
  .layout2-tbl > tbody > tr > td { width: 50%; vertical-align: top; }
  .footer { text-align: center; font-size: 5.5px; color: #94a3b8; margin-top: 8px; padding-top: 6px; border-top: 1px solid #e2e8f0; }
  @page { size: A4 portrait; margin: 10mm 12mm; }
  @media print { * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } }
`;

function rankingHtml(
  titulo: string,
  linhas: LinhaGrupoDia[],
  total: number,
  sufixo: string,
  barColor: string,
): string {
  const top = linhas.filter((l) => l.valor > 0).slice(0, 12);
  if (!top.length) return '';
  const max = Math.max(...top.map((l) => l.valor), 0.01);
  return `
    <div class="bloco">
      <div class="bloco-hd">${esc(titulo)}</div>
      <table class="data">
        <thead>
          <tr>
            <th style="width:42%">Nome</th>
            <th class="c" style="width:14%">Reg.</th>
            <th class="r" style="width:22%">${esc(sufixo)}</th>
            <th style="width:22%">Participação</th>
          </tr>
        </thead>
        <tbody>
          ${top.map((l) => {
            const pct = Math.max(3, Math.round((l.valor / max) * 100));
            const part = total > 0 ? (l.valor / total) * 100 : 0;
            const nome = l.label.length > 28 ? `${l.label.slice(0, 28)}…` : l.label;
            return `
              <tr>
                <td>${esc(nome)}</td>
                <td class="c">${fmtNum(l.registros, 0)}</td>
                <td class="r">${fmtMetrica(l.valor, sufixo)}</td>
                <td>
                  ${fmtNum(part, 1)}%
                  <span class="bar-mini"><span style="width:${pct}%;background:${barColor}"></span></span>
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

export interface ParamsDiaRocada {
  servicoNome: string;
  contratoNome?: string;
  dataIso: string;
  resumo: {
    registros: number;
    areaM2: number;
    areaManualM2: number;
    areaMecanizadaM2: number;
    registrosManual: number;
    registrosMecanizada: number;
    bairros: number;
    operadores: number;
    equipes: number;
    equipamentos: number;
  };
  porTipo: Array<{ label: string; registros: number; areaM2: number }>;
  porBairro: LinhaGrupoDia[];
  porOperador: LinhaGrupoDia[];
  porEquipe: LinhaGrupoDia[];
  porEquipamento: LinhaGrupoDia[];
  frotaCiclo?: { equipes: number; equipamentos: number; labelsEquipamento?: string[] };
  valorM2?: number | null;
}

export function gerarHtmlRelatorioDiaRocada(p: ParamsDiaRocada): string {
  const r = p.resumo;
  const areaTotal = r.areaM2 || 0;
  const areaMan = r.areaManualM2 || 0;
  const areaMec = r.areaMecanizadaM2 || 0;
  const receita = p.valorM2 && p.valorM2 > 0 ? areaTotal * p.valorM2 : 0;
  const geradoEm = new Date().toLocaleString('pt-BR');
  const ds = diaSemanaPt(p.dataIso);
  const porTipo: LinhaGrupoDia[] = p.porTipo
    .filter((t) => t.areaM2 > 0)
    .map((t) => ({ label: t.label, registros: t.registros, valor: t.areaM2 }));

  const cards = cardsHtml([
    { label: 'Área total', valor: `${fmtArea(areaTotal)} m²`, cor: '#22c55e' },
    { label: 'Registros', valor: fmtNum(r.registros, 0), cor: '#6366f1' },
    ...(areaMan > 0
      ? [{ label: 'Manual', valor: `${fmtArea(areaMan)} m² (${fmtNum(r.registrosManual, 0)})`, cor: '#0ea5e9' }]
      : []),
    ...(areaMec > 0
      ? [{ label: 'Mecanizada', valor: `${fmtArea(areaMec)} m² (${fmtNum(r.registrosMecanizada, 0)})`, cor: '#f59e0b' }]
      : []),
    { label: 'Bairros', valor: String(r.bairros), cor: '#14b8a6' },
    { label: 'Operadores', valor: String(r.operadores), cor: '#8b5cf6' },
    { label: 'Equipes', valor: String(r.equipes), cor: '#ef4444' },
    { label: 'Equipamentos', valor: String(r.equipamentos), cor: '#64748b' },
    ...(receita > 0
      ? [{ label: 'Receita estimada', valor: receita.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }), cor: '#059669' }]
      : []),
  ]);

  const tratores = p.porEquipamento.filter((l) => l.valor > 0);
  const nTratores = tratores.length;
  const mediaTrator = nTratores > 0 ? areaTotal / nTratores : 0;
  const frota = Math.max(Number(p.frotaCiclo?.equipamentos || 0), nTratores);
  const producaoHtml = nTratores > 0 ? `
    <div class="bloco">
      <div class="bloco-hd">Produção por trator · ${nTratores} de ${frota} no dia · média ${fmtArea(mediaTrator)} m²</div>
      <table class="data">
        <thead>
          <tr>
            <th>Trator</th>
            <th class="c">Reg.</th>
            <th class="r">Produção (m²)</th>
            <th class="r">Vs média</th>
            <th>Situação</th>
          </tr>
        </thead>
        <tbody>
          ${[...tratores].sort((a, b) => b.valor - a.valor).map((l) => {
            const vs = mediaTrator > 0 ? l.valor / mediaTrator : 1;
            const sit = vs >= 1.1 ? 'Acima da média' : vs <= 0.9 ? 'Abaixo da média' : 'Na média';
            return `<tr>
              <td>${esc(l.label)}</td>
              <td class="c">${fmtNum(l.registros, 0)}</td>
              <td class="r">${fmtArea(l.valor)}</td>
              <td class="r">${fmtNum(vs * 100, 0)}%</td>
              <td>${esc(sit)}</td>
            </tr>`;
          }).join('')}
          <tr>
            <td><strong>Total / média</strong></td>
            <td class="c"><strong>${fmtNum(tratores.reduce((s, l) => s + l.registros, 0), 0)}</strong></td>
            <td class="r"><strong>${fmtArea(areaTotal)}</strong></td>
            <td class="r">—</td>
            <td><strong>${fmtArea(mediaTrator)} m² / trator</strong></td>
          </tr>
        </tbody>
      </table>
    </div>` : rankingHtml('Top equipes por área', p.porEquipe, areaTotal, 'm²', '#22c55e');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Relatório Diário Roçada — ${esc(p.servicoNome)} — ${esc(formatarIsoParaBr(p.dataIso))}</title>
  <style>
    ${CSS}
    .header { background: linear-gradient(135deg,#14532d,#166534); }
    .header h1 { color: #bbf7d0; }
    .header .sub { color: #d1fae5; }
    .header .tipo { color: #ecfccb; }
    .banner { background: #f0fdf4; border: 1px solid #86efac; color: #166534; }
    .hero-dark { background: linear-gradient(135deg,#14532d,#052e16); border: 1px solid #166534; }
    .hero-dark .lbl { color: #86efac; }
    .hero-dark .val { color: #bbf7d0; }
    .hero-dark .sub { color: #a7f3d0; }
    table.data th { background: #166534; color: #dcfce7; }
  </style>
</head>
<body>
  <div class="header">
    <h1>${esc(p.servicoNome)}</h1>
    <div class="sub">${p.contratoNome ? `${esc(p.contratoNome)} · ` : ''}${formatarIsoParaBr(p.dataIso)}${ds ? ` · ${esc(ds)}` : ''}</div>
    <span class="tipo">Roçada · Relatório diário</span>
  </div>
  <div class="banner">
    Relatório operacional do dia com área (m²) importada da planilha, separado por Manual e Mecanizada quando disponível.
  </div>
  <div class="hero-dark">
    <div class="lbl">Área total roçada no dia</div>
    <div class="val">${fmtArea(areaTotal)} m²</div>
    <div class="sub">
      ${fmtNum(r.registros, 0)} registro(s)
      ${areaMan > 0 ? ` · Manual ${fmtArea(areaMan)} m²` : ''}
      ${areaMec > 0 ? ` · Mecanizada ${fmtArea(areaMec)} m²` : ''}
      · ${r.bairros} bairro(s)
      · ${r.operadores} operador(es)
    </div>
  </div>
  <div class="sec">Indicadores do dia</div>
  ${cards}
  ${porTipo.length ? rankingHtml('Área por tipo de execução', porTipo, areaTotal, 'm²', '#22c55e') : ''}
  <table class="layout2-tbl">
    <tr>
      <td>${rankingHtml('Top bairros por área', p.porBairro, areaTotal, 'm²', '#22c55e')}</td>
      <td>${rankingHtml('Top operadores por área', p.porOperador, areaTotal, 'm²', '#22c55e')}</td>
    </tr>
  </table>
  ${producaoHtml}
  <div class="footer">Sistemma · Relatório diário de roçada · Gerado em ${esc(geradoEm)}</div>
</body>
</html>`;
}

export interface ParamsDiaUnidade {
  servicoNome: string;
  contratoNome?: string;
  dataIso: string;
  tipoLabel: string;
  labelMetrica: string;
  sufixo: string;
  metricaTotal: number;
  registros: number;
  quantitativo?: number;
  porBairro: LinhaGrupoDia[];
  porEquipe: LinhaGrupoDia[];
  porOperador: LinhaGrupoDia[];
  linhas: Array<{
    logradouro: string;
    bairro: string;
    und: string;
    qtd: number;
    metrica: number;
    equipe: string;
    operador: string;
  }>;
}

export function gerarHtmlRelatorioDiaUnidade(p: ParamsDiaUnidade): string {
  const geradoEm = new Date().toLocaleString('pt-BR');
  const ds = diaSemanaPt(p.dataIso);
  const cards = cardsHtml([
    { label: 'Registros', valor: fmtNum(p.registros, 0), cor: '#6366f1' },
    { label: p.labelMetrica, valor: fmtMetrica(p.metricaTotal, p.sufixo), cor: '#14b8a6' },
    ...(Number(p.quantitativo || 0) > 0
      ? [{ label: 'Quantitativo planilha', valor: Number(p.quantitativo).toLocaleString('pt-BR', { maximumFractionDigits: 3 }), cor: '#0ea5e9' }]
      : []),
    { label: 'Bairros', valor: String(p.porBairro.length), cor: '#8b5cf6' },
    { label: 'Equipes', valor: String(p.porEquipe.length), cor: '#ef4444' },
    { label: 'Operadores', valor: String(p.porOperador.length), cor: '#64748b' },
  ]);

  const tabelaRegs = p.linhas.slice(0, 40);
  const tabelaHtml = tabelaRegs.length ? `
    <div class="bloco">
      <div class="bloco-hd">Registros do dia${p.linhas.length > 40 ? ` (top 40 de ${p.linhas.length})` : ''}</div>
      <table class="data">
        <thead>
          <tr>
            <th style="width:26%">Logradouro</th>
            <th style="width:18%">Bairro</th>
            <th class="c" style="width:8%">UND</th>
            <th class="r" style="width:12%">Qtd</th>
            <th class="r" style="width:14%">${esc(p.labelMetrica)}</th>
            <th style="width:11%">Equipe</th>
            <th style="width:11%">Operador</th>
          </tr>
        </thead>
        <tbody>
          ${tabelaRegs.map((r) => `
            <tr>
              <td>${esc(r.logradouro.length > 32 ? `${r.logradouro.slice(0, 32)}…` : r.logradouro || '—')}</td>
              <td>${esc(r.bairro.length > 22 ? `${r.bairro.slice(0, 22)}…` : r.bairro || '—')}</td>
              <td class="c">${esc(r.und || '—')}</td>
              <td class="r">${r.qtd > 0 ? r.qtd.toLocaleString('pt-BR', { maximumFractionDigits: 3 }) : '—'}</td>
              <td class="r">${fmtMetrica(r.metrica, p.sufixo)}</td>
              <td>${esc(r.equipe || '—')}</td>
              <td>${esc(r.operador || '—')}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>` : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Relatório Diário ${esc(p.tipoLabel)} — ${esc(p.servicoNome)} — ${esc(formatarIsoParaBr(p.dataIso))}</title>
  <style>
    ${CSS}
    .header { background: linear-gradient(135deg,#0f766e,#115e59); }
    .header h1 { color: #ccfbf1; }
    .header .sub { color: #99f6e4; }
    .header .tipo { color: #ecfeff; }
    .banner { background: #f0fdfa; border: 1px solid #5eead4; color: #115e59; }
    .hero-dark { background: linear-gradient(135deg,#0f766e,#134e4a); border: 1px solid #0f766e; }
    .hero-dark .lbl { color: #5eead4; }
    .hero-dark .val { color: #ccfbf1; }
    .hero-dark .sub { color: #99f6e4; }
    table.data th { background: #0f766e; color: #ccfbf1; }
  </style>
</head>
<body>
  <div class="header">
    <h1>${esc(p.servicoNome)}</h1>
    <div class="sub">${p.contratoNome ? `${esc(p.contratoNome)} · ` : ''}${formatarIsoParaBr(p.dataIso)}${ds ? ` · ${esc(ds)}` : ''}</div>
    <span class="tipo">${esc(p.tipoLabel)} · Relatório diário</span>
  </div>
  <div class="banner">
    Relatório do dia com quantitativos importados da planilha (DATA, UND, QUANTITATIVO, TIPO DE SERVIÇO).
  </div>
  <div class="hero-dark">
    <div class="lbl">${esc(p.labelMetrica)} no dia</div>
    <div class="val">${fmtMetrica(p.metricaTotal, p.sufixo)}</div>
    <div class="sub">
      ${fmtNum(p.registros, 0)} registro(s)
      ${Number(p.quantitativo || 0) > 0
        ? ` · Quantitativo ${Number(p.quantitativo).toLocaleString('pt-BR', { maximumFractionDigits: 3 })}`
        : ''}
      · ${p.porBairro.length} bairro(s)
    </div>
  </div>
  <div class="sec">Indicadores do dia</div>
  ${cards}
  <table class="layout2-tbl">
    <tr>
      <td>${rankingHtml('Por bairro', p.porBairro, p.metricaTotal, p.sufixo, '#14b8a6')}</td>
      <td>${rankingHtml('Por equipe', p.porEquipe, p.metricaTotal, p.sufixo, '#14b8a6')}</td>
    </tr>
    <tr>
      <td>${rankingHtml('Por operador', p.porOperador, p.metricaTotal, p.sufixo, '#14b8a6')}</td>
      <td></td>
    </tr>
  </table>
  ${tabelaHtml}
  <div class="footer">Sistemma · Relatório diário de ${esc(p.tipoLabel.toLowerCase())} · Gerado em ${esc(geradoEm)}</div>
</body>
</html>`;
}
