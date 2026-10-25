/**
 * HTML dos PDFs de ciclo por tipo — mesmo layout do CicloDateSelector
 * (roçada m², demais serviços por unidade).
 */
import { esc, fmtNum, formatarIsoParaBr } from './fmt';

export interface DiaCicloPdf {
  data: string;
  rotas: number;
  areaM2?: number;
  metricaUnidade?: number;
  metricaSufixo?: string;
  metricaLabel?: string;
}

export interface LinhaGrupoRocada {
  label: string;
  registros: number;
  areaM2: number;
}

export interface ParamsCicloRocada {
  servicoNome: string;
  contratoNome?: string;
  cicloLabel: string;
  dataInicio: string;
  dataFim: string;
  dias: DiaCicloPdf[];
  diasComDados: number;
  totaisRotas: number;
  areaTotal: number;
  analise: {
    resumo: {
      registros: number;
      areaM2: number;
      bairros: number;
      operadores: number;
      equipes: number;
      equipamentos: number;
    };
    porBairro: LinhaGrupoRocada[];
    porOperador: LinhaGrupoRocada[];
    porEquipe: LinhaGrupoRocada[];
    porEquipamento: LinhaGrupoRocada[];
  };
  valorM2?: number | null;
}

export interface ParamsCicloUnidade {
  servicoNome: string;
  contratoNome?: string;
  tipoLabel: string;
  cicloLabel?: string;
  dataInicio: string;
  dataFim: string;
  dias: DiaCicloPdf[];
  diasComDados: number;
  totaisRotas: number;
  metricaTotal: number;
  sufixo: string;
  labelMetrica: string;
}

function fmtArea(v: number): string {
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

function fmtMetrica(v: number, sufixo: string): string {
  const dec = sufixo === 'm²' || sufixo === 'arv' || sufixo === 'pts' ? 0 : (v >= 100 ? 1 : 2);
  return `${fmtNum(v, dec)} ${esc(sufixo)}`.trim();
}

function cardsHtml(items: { label: string; valor: string; cor: string }[], topColorDefault: string): string {
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
  void topColorDefault;
  return `<table class="cards-tbl">${rows.join('')}</table>`;
}

const CSS_BASE = `
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
  .sec { font-size: 6.5px; font-weight: 800; color: #64748b; text-transform: uppercase; margin: 0 0 4px; letter-spacing: 0.03em; }
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

function tabelaGrupoHtml(titulo: string, linhas: LinhaGrupoRocada[], maxArea: number): string {
  const top = linhas.filter((l) => l.areaM2 > 0).slice(0, 12);
  if (!top.length) return '';
  const max = Math.max(maxArea, 0.01);
  return `
    <div class="bloco">
      <div class="bloco-hd">${esc(titulo)}</div>
      <table class="data">
        <thead>
          <tr>
            <th style="width:42%">Nome</th>
            <th class="c" style="width:14%">Reg.</th>
            <th class="r" style="width:22%">Área (m²)</th>
            <th style="width:22%">Participação</th>
          </tr>
        </thead>
        <tbody>
          ${top.map((l) => {
            const pct = Math.max(3, Math.round((l.areaM2 / max) * 100));
            const part = maxArea > 0 ? (l.areaM2 / maxArea) * 100 : 0;
            return `
              <tr>
                <td>${esc(l.label.length > 28 ? `${l.label.slice(0, 28)}…` : l.label)}</td>
                <td class="c">${fmtNum(l.registros, 0)}</td>
                <td class="r">${fmtArea(l.areaM2)}</td>
                <td>
                  ${fmtNum(part, 1)}%
                  <span class="bar-mini"><span style="width:${pct}%;background:#22c55e"></span></span>
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

export function gerarHtmlRelatorioCicloRocada(p: ParamsCicloRocada): string {
  const areaTotal = p.areaTotal || p.analise.resumo.areaM2 || 0;
  const diasDecorridos = Math.max(p.dias.length, 1);
  const mediaDia = areaTotal / diasDecorridos;
  const receita = p.valorM2 && p.valorM2 > 0 ? areaTotal * p.valorM2 : 0;
  const geradoEm = new Date().toLocaleString('pt-BR');
  const ativos = p.dias.filter((d) => (d.areaM2 || 0) > 0 || d.rotas > 0);
  const maxDia = Math.max(...ativos.map((d) => d.areaM2 || 0), 0.01);

  const cards = cardsHtml([
    { label: 'Área total', valor: `${fmtArea(areaTotal)} m²`, cor: '#22c55e' },
    { label: 'Registros', valor: fmtNum(p.totaisRotas || p.analise.resumo.registros, 0), cor: '#6366f1' },
    { label: 'Dias do ciclo', valor: String(p.dias.length), cor: '#0ea5e9' },
    { label: 'Dias com operação', valor: String(p.diasComDados), cor: '#14b8a6' },
    { label: 'Média m² / dia do ciclo', valor: `${fmtArea(mediaDia)} m²`, cor: '#8b5cf6' },
    { label: 'Bairros', valor: String(p.analise.resumo.bairros), cor: '#14b8a6' },
    { label: 'Operadores', valor: String(p.analise.resumo.operadores), cor: '#f59e0b' },
    { label: 'Equipes', valor: String(p.analise.resumo.equipes), cor: '#ef4444' },
    { label: 'Equipamentos', valor: String(p.analise.resumo.equipamentos), cor: '#64748b' },
    ...(receita > 0
      ? [{ label: 'Receita estimada', valor: receita.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }), cor: '#059669' }]
      : []),
  ], '#22c55e');

  const tabelaDias = ativos.length ? `
    <div class="bloco">
      <div class="bloco-hd">Área por dia do ciclo (${ativos.length} dia(s) com operação)</div>
      <table class="data">
        <thead>
          <tr>
            <th style="width:18%">Data</th>
            <th class="c" style="width:16%">Registros</th>
            <th class="r" style="width:28%">Área (m²)</th>
            <th style="width:38%">Participação no ciclo</th>
          </tr>
        </thead>
        <tbody>
          ${ativos.map((d) => {
            const area = d.areaM2 || 0;
            const pctBar = Math.max(3, Math.round((area / maxDia) * 100));
            const part = areaTotal > 0 ? (area / areaTotal) * 100 : 0;
            return `
              <tr>
                <td>${esc(formatarIsoParaBr(d.data))}</td>
                <td class="c">${fmtNum(d.rotas, 0)}</td>
                <td class="r">${fmtArea(area)}</td>
                <td>
                  ${fmtNum(part, 1)}%
                  <span class="bar-mini"><span style="width:${pctBar}%;background:#22c55e"></span></span>
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>` : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Relatório Ciclo Roçada — ${esc(p.servicoNome)}</title>
  <style>
    ${CSS_BASE}
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
    <div class="sub">${p.contratoNome ? `${esc(p.contratoNome)} · ` : ''}Ciclo ${esc(p.cicloLabel)}</div>
    <div class="sub">${formatarIsoParaBr(p.dataInicio)} → ${formatarIsoParaBr(p.dataFim)}</div>
    <span class="tipo">Roçada · Relatório do ciclo</span>
  </div>
  <div class="banner">
    Relatório operacional de roçada com base na área (m²) importada da planilha.
    Linhas sem metragem não entram neste consolidado.
  </div>
  <div class="hero-dark">
    <div class="lbl">Área total roçada no ciclo</div>
    <div class="val">${fmtArea(areaTotal)} m²</div>
    <div class="sub">
      ${fmtNum(p.totaisRotas || p.analise.resumo.registros, 0)} registro(s)
      · ${p.dias.length} dia(s) do ciclo
      · ${p.diasComDados} com operação
      · ${p.analise.resumo.bairros} bairro(s)
      · ${p.analise.resumo.operadores} operador(es)
    </div>
  </div>
  <div class="sec">Indicadores do ciclo</div>
  ${cards}
  ${tabelaDias}
  <table class="layout2-tbl">
    <tr>
      <td>${tabelaGrupoHtml('Top bairros por área', p.analise.porBairro, areaTotal)}</td>
      <td>${tabelaGrupoHtml('Top operadores por área', p.analise.porOperador, areaTotal)}</td>
    </tr>
    <tr>
      <td>${tabelaGrupoHtml('Top equipes por área', p.analise.porEquipe, areaTotal)}</td>
      <td>${tabelaGrupoHtml('Top equipamentos por área', p.analise.porEquipamento, areaTotal)}</td>
    </tr>
  </table>
  <div class="footer">Sistemma · Relatório de ciclo de roçada · Gerado em ${esc(geradoEm)}</div>
</body>
</html>`;
}

export function gerarHtmlRelatorioCicloUnidade(p: ParamsCicloUnidade): string {
  const geradoEm = new Date().toLocaleString('pt-BR');
  const diasCom = p.dias.filter((d) => (d.metricaUnidade || 0) > 0 || d.rotas > 0);
  const maxDia = Math.max(...diasCom.map((d) => Number(d.metricaUnidade || 0)), 0.01);
  const media = p.dias.length > 0 ? p.metricaTotal / p.dias.length : 0;

  const cards = `
    <table class="cards-tbl">
      <tr>
        <td class="card" style="border-top-color:#14b8a6;width:25%">
          <div class="card-lbl">${esc(p.labelMetrica)} total</div>
          <div class="card-val">${fmtMetrica(p.metricaTotal, p.sufixo)}</div>
        </td>
        <td class="card" style="border-top-color:#6366f1;width:25%">
          <div class="card-lbl">Registros</div>
          <div class="card-val">${fmtNum(p.totaisRotas, 0)}</div>
        </td>
        <td class="card" style="border-top-color:#0ea5e9;width:25%">
          <div class="card-lbl">Dias do ciclo</div>
          <div class="card-val">${fmtNum(p.dias.length, 0)}</div>
        </td>
        <td class="card" style="border-top-color:#f59e0b;width:25%">
          <div class="card-lbl">Média / dia do ciclo</div>
          <div class="card-val">${fmtMetrica(media, p.sufixo)}</div>
        </td>
      </tr>
    </table>`;

  const tabelaDias = diasCom.length ? `
    <table class="data">
      <thead>
        <tr>
          <th style="width:18%">Data</th>
          <th class="c" style="width:14%">Registros</th>
          <th class="r" style="width:28%">${esc(p.labelMetrica)}</th>
          <th style="width:40%">Participação</th>
        </tr>
      </thead>
      <tbody>
        ${diasCom.map((d) => {
          const v = Number(d.metricaUnidade || 0);
          const pct = p.metricaTotal > 0 ? (v / p.metricaTotal) * 100 : 0;
          const bar = Math.max(3, Math.round((v / maxDia) * 100));
          return `
            <tr>
              <td>${esc(formatarIsoParaBr(d.data))}</td>
              <td class="c">${fmtNum(d.rotas || 0, 0)}</td>
              <td class="r">${fmtMetrica(v, d.metricaSufixo || p.sufixo)}</td>
              <td>
                ${fmtNum(pct, 1)}%
                <span class="bar-mini"><span style="width:${bar}%;background:#14b8a6"></span></span>
              </td>
            </tr>`;
        }).join('')}
      </tbody>
    </table>` : '<p style="color:#64748b">Nenhum dia com dados no período.</p>';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Relatório Ciclo ${esc(p.tipoLabel)} — ${esc(p.servicoNome)}</title>
  <style>
    ${CSS_BASE}
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
    <div class="sub">
      ${p.contratoNome ? `${esc(p.contratoNome)} · ` : ''}
      ${formatarIsoParaBr(p.dataInicio)} a ${formatarIsoParaBr(p.dataFim)}
      ${p.cicloLabel ? ` · ${esc(p.cicloLabel)}` : ''}
    </div>
    <span class="tipo">${esc(p.tipoLabel)} · Relatório de ciclo</span>
  </div>
  <div class="banner">
    Consolidado do ciclo com métricas da planilha por dia (sem regras de viagem/coleta).
  </div>
  <div class="hero-dark">
    <div class="lbl">${esc(p.labelMetrica)} no ciclo</div>
    <div class="val">${fmtMetrica(p.metricaTotal, p.sufixo)}</div>
    <div class="sub">
      ${fmtNum(p.totaisRotas, 0)} registro(s)
      · ${fmtNum(p.dias.length, 0)} dia(s) do ciclo
      · ${fmtNum(p.diasComDados, 0)} com operação
    </div>
  </div>
  <div class="sec">Indicadores do ciclo</div>
  ${cards}
  <div class="sec" style="margin-top:8px">Produção por dia</div>
  ${tabelaDias}
  <div class="footer">Sistemma · Relatório de ciclo de ${esc(p.tipoLabel.toLowerCase())} · Gerado em ${esc(geradoEm)}</div>
</body>
</html>`;
}
