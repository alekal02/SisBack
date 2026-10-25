function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtNum(n: number | null | undefined, digitos = 1): string {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digitos,
  });
}

function dataBr(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return iso.split('-').reverse().join('/');
}

function diaSemanaPt(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const dias = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  return dias[new Date(y, m - 1, d).getDay()] || '';
}

type LinhaGrupo = {
  label: string;
  viagens?: number;
  tonelagem?: number;
  kmTotal?: number;
  horasProdutivas?: number;
  registros?: number;
  areaM2?: number;
};

function tabelaTop(
  titulo: string,
  linhas: LinhaGrupo[],
  cols: Array<{ key: keyof LinhaGrupo; label: string; digitos?: number }>,
): string {
  if (!linhas.length || !cols.length) return '';
  const head = cols.map((c) => `<th${c.key !== 'label' ? ' class="r"' : ''}>${esc(c.label)}</th>`).join('');
  const body = linhas.slice(0, 15).map((l) => `
    <tr>
      ${cols.map((c) => {
        const v = l[c.key];
        if (c.key === 'label') return `<td>${esc(v ?? '—')}</td>`;
        return `<td class="r">${typeof v === 'number' ? fmtNum(v, c.digitos ?? 1) : esc(v ?? '—')}</td>`;
      }).join('')}
    </tr>`).join('');
  return `
  <div class="bloco">
    <div class="bloco-hd">${esc(titulo)}</div>
    <table class="data">
      <thead><tr>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>
  </div>`;
}

export function gerarHtmlRelatorioDiaRocadaServer(opts: {
  servicoNome: string;
  contratoNome: string;
  dataIso: string;
  resumo: {
    registros: number;
    areaM2: number;
    areaManualM2?: number;
    areaMecanizadaM2?: number;
    bairros?: number;
    operadores?: number;
    equipes?: number;
  };
  porBairro?: LinhaGrupo[];
  porOperador?: LinhaGrupo[];
}): string {
  const { servicoNome, contratoNome, dataIso, resumo } = opts;
  const ds = diaSemanaPt(dataIso);
  const cards = [
    { label: 'Registros', valor: fmtNum(resumo.registros, 0) },
    { label: 'Área total (m²)', valor: fmtNum(resumo.areaM2, 1) },
    { label: 'Manual (m²)', valor: fmtNum(resumo.areaManualM2 ?? 0, 1) },
    { label: 'Mecanizada (m²)', valor: fmtNum(resumo.areaMecanizadaM2 ?? 0, 1) },
    { label: 'Bairros', valor: fmtNum(resumo.bairros ?? 0, 0) },
    { label: 'Operadores', valor: fmtNum(resumo.operadores ?? 0, 0) },
    { label: 'Equipes', valor: fmtNum(resumo.equipes ?? 0, 0) },
  ];

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10px; color: #1e293b; padding: 16px; background: #f8fafc; }
    .header { background: linear-gradient(135deg,#0f172a,#14532d); color: #fff; border-radius: 10px; padding: 14px 16px; margin-bottom: 12px; }
    .header h1 { font-size: 16px; font-weight: 800; color: #86efac; }
    .header .sub { font-size: 11px; color: #94a3b8; margin-top: 4px; }
    .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-top: 3px solid #22c55e; border-radius: 8px; padding: 10px; }
    .card .lbl { font-size: 9px; color: #64748b; text-transform: uppercase; font-weight: 700; }
    .card .val { font-size: 16px; font-weight: 800; color: #0f172a; margin-top: 4px; }
    .bloco { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; margin-bottom: 10px; }
    .bloco-hd { font-size: 11px; font-weight: 700; color: #475569; margin-bottom: 6px; padding-bottom: 4px; border-bottom: 1px solid #e2e8f0; }
    table.data { width: 100%; border-collapse: collapse; font-size: 9px; }
    table.data th { padding: 5px 6px; background: #1e293b; color: #fff; text-align: left; }
    table.data td { padding: 4px 6px; border-bottom: 1px solid #f1f5f9; }
    table.data .r { text-align: right; font-family: monospace; }
    .footer { text-align: center; font-size: 9px; color: #94a3b8; margin-top: 14px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Relatório Diário — Roçada</h1>
    <div class="sub">${esc(contratoNome)} • ${esc(servicoNome)}</div>
    <div class="sub">${esc(dataBr(dataIso))}${ds ? ` • ${esc(ds)}` : ''} • último dia com dados no ciclo</div>
  </div>

  <div class="cards">
    ${cards.map((c) => `
      <div class="card"><div class="lbl">${esc(c.label)}</div><div class="val">${esc(c.valor)}</div></div>
    `).join('')}
  </div>

  ${tabelaTop('Por bairro', opts.porBairro || [], [
    { key: 'label', label: 'Bairro' },
    { key: 'registros', label: 'Registros', digitos: 0 },
    { key: 'areaM2', label: 'Área m²', digitos: 1 },
  ])}

  ${tabelaTop('Por operador', opts.porOperador || [], [
    { key: 'label', label: 'Operador' },
    { key: 'registros', label: 'Registros', digitos: 0 },
    { key: 'areaM2', label: 'Área m²', digitos: 1 },
  ])}

  <div class="footer">Gerado automaticamente via WhatsApp • Sistemma • ${esc(new Date().toLocaleString('pt-BR'))}</div>
</body>
</html>`;
}
