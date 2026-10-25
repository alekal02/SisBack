/**
 * HTML do PDF de ciclo — todos os serviços do contrato (coleta + produção).
 */
export interface DiaServicoCiclo {
  data: string;
  registros: number;
  quantitativo: number;
}

export interface ServicoCicloContrato {
  id?: string;
  tipo: string;
  nome: string;
  und: string;
  registros: number;
  quantitativo: number;
  diasComDados: number;
  dias: DiaServicoCiclo[];
  extra?: string;
}

export interface ParamsRelatorioCicloTodosServicos {
  contratoNome: string;
  cicloLabel?: string;
  dataInicio: string;
  dataFim: string;
  servicos: ServicoCicloContrato[];
  omitidos?: Array<{ nome: string; motivo: string }>;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtNum(n: number, dec = 0): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fmtQtd(n: number, und: string): string {
  const dec = n >= 100 || und === 'pts' || und === 'arv' ? 0 : 2;
  return `${fmtNum(n, dec)} ${esc(und)}`.trim();
}

function isoBr(iso: string): string {
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function gerarHtmlRelatorioCicloTodosServicos(p: ParamsRelatorioCicloTodosServicos): string {
  const geradoEm = new Date().toLocaleString('pt-BR');
  const totalReg = p.servicos.reduce((s, t) => s + t.registros, 0);
  const cardsHtml = chunk(p.servicos, 3).map((row) => {
    const cells = row.map((t) => `
      <td class="card">
        <div class="card-lbl">${esc(t.nome)}</div>
        <div class="card-val">${fmtQtd(t.quantitativo, t.und)}</div>
        <div class="card-sub">${fmtNum(t.registros, 0)} reg. · ${t.diasComDados} dia(s)${t.extra ? ` · ${esc(t.extra)}` : ''}</div>
      </td>`).join('');
    const pad = 3 - row.length;
    const empty = pad > 0 ? '<td></td>'.repeat(pad) : '';
    return `<tr>${cells}${empty}</tr>`;
  }).join('');

  const datas = [...new Set(p.servicos.flatMap((t) => t.dias.map((d) => d.data)))].sort();
  const head = p.servicos.map((t) => `<th class="r">${esc(t.nome)}</th>`).join('');
  const rows = datas.map((iso) => {
    const cells = p.servicos.map((t) => {
      const d = t.dias.find((x) => x.data === iso);
      if (!d || (d.registros <= 0 && d.quantitativo <= 0)) return '<td class="r">—</td>';
      return `<td class="r">${fmtQtd(d.quantitativo, t.und)}</td>`;
    }).join('');
    return `<tr><td>${esc(isoBr(iso))}</td>${cells}</tr>`;
  }).join('');
  const rowTotal = `<tr class="tot"><td>Total do ciclo</td>${p.servicos.map((t) =>
    `<td class="r">${fmtQtd(t.quantitativo, t.und)}</td>`
  ).join('')}</tr>`;

  const resumo = `<table class="data" style="margin-bottom:8px">
    <thead>
      <tr>
        <th>Serviço</th>
        <th class="r">Registros</th>
        <th class="r">Quantidade</th>
        <th class="r">Dias</th>
      </tr>
    </thead>
    <tbody>
      ${p.servicos.map((t) => `
        <tr>
          <td>${esc(t.nome)}</td>
          <td class="r">${fmtNum(t.registros, 0)}</td>
          <td class="r">${fmtQtd(t.quantitativo, t.und)}</td>
          <td class="r">${fmtNum(t.diasComDados, 0)}</td>
        </tr>`).join('')}
    </tbody>
  </table>`;

  const omitidos = (p.omitidos || []).length
    ? `<div class="banner">Sem operação neste ciclo: ${(p.omitidos || []).map((o) => `${esc(o.nome)} (${esc(o.motivo)})`).join(' · ')}</div>`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @page { size: A4 landscape; margin: 9mm 10mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 8px; color: #1e293b; }
    .header { background: #0f172a; color: #fff; border-radius: 8px; padding: 10px 12px; margin-bottom: 8px; }
    .header h1 { font-size: 14px; font-weight: 800; color: #fbbf24; }
    .header .sub { font-size: 7px; color: #94a3b8; margin-top: 3px; }
    .banner { background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 5px 8px; margin-bottom: 8px; font-size: 7px; color: #92400e; }
    .cards-tbl { width: 100%; border-collapse: separate; border-spacing: 4px; margin-bottom: 8px; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-top: 3px solid #6366f1; border-radius: 5px; padding: 6px; vertical-align: top; width: 33%; }
    .card-lbl { font-size: 6.5px; font-weight: 700; color: #64748b; text-transform: uppercase; }
    .card-val { font-size: 11px; font-weight: 800; color: #0f172a; margin-top: 2px; }
    .card-sub { font-size: 6px; color: #64748b; margin-top: 2px; }
    .sec { font-size: 7px; font-weight: 800; color: #64748b; text-transform: uppercase; margin: 8px 0 4px; }
    table.data { width: 100%; border-collapse: collapse; font-size: 7px; }
    table.data th { padding: 3px 4px; background: #1e293b; color: #fff; text-align: left; font-size: 6px; text-transform: uppercase; }
    table.data th.r, table.data td.r { text-align: right; font-family: ui-monospace, monospace; }
    table.data td { padding: 3px 4px; border-bottom: 1px solid #f1f5f9; }
    table.data tbody tr:nth-child(even) td { background: #f8fafc; }
    table.data tr.tot td { background: #ecfdf5; font-weight: 800; border-top: 2px solid #10b981; }
    .footer { text-align: center; font-size: 6px; color: #94a3b8; margin-top: 8px; padding-top: 6px; border-top: 1px solid #e2e8f0; }
    table.data thead { display: table-header-group; }
    table.data tr { break-inside: avoid; }
    @media print { * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>Ciclo — todos os serviços</h1>
    <div class="sub">${esc(p.contratoNome)} · ${esc(p.cicloLabel || `${isoBr(p.dataInicio)} a ${isoBr(p.dataFim)}`)} · ${fmtNum(totalReg, 0)} registro(s) · ${p.servicos.length} serviço(s)</div>
  </div>
  ${omitidos}
  <table class="cards-tbl">${cardsHtml}</table>
  <div class="sec">Acumulado do ciclo por serviço</div>
  ${resumo}
  <div class="sec">Série diária por serviço</div>
  <table class="data">
    <thead><tr><th>Data</th>${head}</tr></thead>
    <tbody>${rows}${rowTotal}</tbody>
  </table>
  <div class="footer">Contrato ${esc(p.contratoNome)} · gerado em ${esc(geradoEm)}</div>
</body>
</html>`;
}
