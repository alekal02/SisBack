/** Port fiel de `frontend/src/utils/gerarHtmlAnalisePesoComparativo.ts`. */
import type { AnalisePesoColeta } from './analisePesoColetaService';
import {
  CORES_SERVICO_PESO,
  METRICAS_PESO,
  SECAO_LABEL_PESO,
  avisoTipoCaminhaoDeduzido,
  formatarCelulaMetricaPeso,
  type SecaoPeso,
} from './analisePesoComparativoMetricas';

export type ServicoComparativoPesoPdf = {
  nome: string;
  contratoNome?: string | null;
  totalRegistros: number;
  periodo?: { label: string } | null;
  analisePeso: AnalisePesoColeta | null;
};

function formatarDataArquivoPdf(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const PCT_BG: Record<string, { bg: string; color: string }> = {
  vermelho: { bg: '#fecaca', color: '#991b1b' },
  amarelo: { bg: '#fef08a', color: '#854d0e' },
  verde: { bg: '#bbf7d0', color: '#166534' },
  laranja: { bg: '#fed7aa', color: '#9a3412' },
};

function renderCelulaHtml(celula: ReturnType<typeof formatarCelulaMetricaPeso>): string {
  const cls = celula.classe ? ` class="${esc(celula.classe)}"` : '';
  if (celula.pct && celula.pctCor) {
    const cor = PCT_BG[celula.pctCor] || PCT_BG.amarelo;
    return `<td${cls}><div class="faixa"><span class="qtd">${esc(celula.texto)}</span><span class="pct" style="background:${cor.bg};color:${cor.color}">${esc(celula.pct)}</span></div></td>`;
  }
  return `<td${cls}>${esc(celula.texto)}</td>`;
}

/** PDF do comparativo de análise de peso entre serviços/contratos. */
export function gerarHtmlAnalisePesoComparativo(opts: {
  servicos: ServicoComparativoPesoPdf[];
  tipoServicoLabel?: string;
  /** Ex.: "1ª quinzena (01/07/2026 a 15/07/2026)" */
  periodoLabel?: string;
  geradoEm?: Date;
}): string {
  const comDados = opts.servicos.filter((s) => s.analisePeso);
  if (comDados.length === 0) return '';

  const tipoLabel = opts.tipoServicoLabel || 'Coleta com caminhão';
  const periodoExtra = opts.periodoLabel ? ` · ${esc(opts.periodoLabel)}` : '';
  const gerado = opts.geradoEm ?? new Date();
  const dataGeracao = gerado.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
  const horaGeracao = gerado.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  const colHeaders = comDados.map((s, idx) => {
    const cor = CORES_SERVICO_PESO[idx % CORES_SERVICO_PESO.length];
    return `<th style="border-left:3px solid ${cor}">
      <div class="col-h">
        <div class="col-contrato">${esc(s.contratoNome || '—')}</div>
        <div class="col-nome">${esc(s.nome)}</div>
        <div class="col-meta">${s.totalRegistros.toLocaleString('pt-BR')} registros</div>
        ${s.periodo ? `<div class="col-periodo">${esc(s.periodo.label)}</div>` : ''}
      </div>
    </th>`;
  }).join('');

  const bodyRows: string[] = [];
  let secaoAtual: SecaoPeso | null = null;

  for (const linha of METRICAS_PESO) {
    if (linha.secao !== secaoAtual) {
      secaoAtual = linha.secao;
      bodyRows.push(
        `<tr class="secao"><td colspan="${comDados.length + 1}">${esc(SECAO_LABEL_PESO[linha.secao])}</td></tr>`,
      );
    }

    const cells = comDados.map((s) => {
      const celula = formatarCelulaMetricaPeso(linha, s.analisePeso!);
      return renderCelulaHtml(celula);
    }).join('');

    bodyRows.push(
      `<tr>
        <th scope="row" class="ind">${esc(linha.label)}</th>
        ${cells}
      </tr>`,
    );
  }

  const avisosTipo = comDados
    .map((s) => {
      const aviso = avisoTipoCaminhaoDeduzido(s.analisePeso!);
      return aviso ? `<li><strong>${esc(s.nome)}:</strong> ${esc(aviso)}</li>` : '';
    })
    .filter(Boolean)
    .join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8"/>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      font-size: 8px;
      color: #1e293b;
      padding: 12px 14px;
      line-height: 1.35;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      background: linear-gradient(135deg,#0f172a,#1e3a5f);
      color: #fff;
      border-radius: 10px;
      padding: 12px 14px;
      margin-bottom: 12px;
    }
    .header h1 { font-size: 14px; font-weight: 800; color: #fbbf24; }
    .header .sub { font-size: 8px; color: #94a3b8; margin-top: 3px; }
    .header .meta { font-size: 7px; color: #64748b; text-align: right; white-space: nowrap; }
    table { width: 100%; border-collapse: collapse; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
    th, td { padding: 5px 7px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
    thead th { background: #f8fafc; font-size: 7px; text-align: left; vertical-align: top; }
    th.ind { background: #f1f5f9; font-weight: 700; font-size: 7px; text-align: left; color: #475569; width: 22%; }
    td { text-align: center; font-size: 8px; font-weight: 600; color: #0f172a; }
    tr.secao td {
      background: #eef2ff;
      color: #4338ca;
      font-size: 7px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      padding: 6px 8px;
      border-top: 2px solid #c7d2fe;
    }
    .col-h { display: flex; flex-direction: column; gap: 2px; min-width: 90px; }
    .col-contrato { font-size: 6px; font-weight: 700; color: #64748b; text-transform: uppercase; }
    .col-nome { font-size: 8px; font-weight: 800; color: #1e293b; }
    .col-meta, .col-periodo { font-size: 6px; color: #64748b; }
    .faixa { display: flex; flex-direction: column; align-items: center; gap: 2px; }
    .faixa .qtd { font-weight: 800; }
    .faixa .pct { font-size: 6px; font-weight: 700; padding: 1px 4px; border-radius: 4px; }
    .celula-cenario-perda, .celula-resultado-perda { color: #b91c1c; font-weight: 800; }
    .celula-cenario-ganho, .celula-resultado-ganho { color: #15803d; font-weight: 800; }
    .celula-ideal { background: #bbf7d0; color: #166534; }
    .aviso-tipo {
      margin-top: 8px;
      background: #fff7ed;
      border: 1px solid #fed7aa;
      border-radius: 8px;
      padding: 6px 8px;
      font-size: 7px;
      color: #9a3412;
      line-height: 1.5;
    }
    .aviso-tipo ul { margin: 3px 0 0 12px; }
    .footer { margin-top: 10px; font-size: 6px; color: #94a3b8; text-align: center; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>Comparativo de análise de peso</h1>
      <div class="sub">${esc(tipoLabel)} — ${comDados.length} serviço${comDados.length > 1 ? 's' : ''} / contrato${comDados.length > 1 ? 's' : ''}${periodoExtra}</div>
    </div>
    <div class="meta">Gerado em ${esc(dataGeracao)} · ${esc(horaGeracao)}<br/>Ref. ${esc(formatarDataArquivoPdf(gerado))}</div>
  </div>
  <table>
    <thead>
      <tr>
        <th class="ind">Indicador</th>
        ${colHeaders}
      </tr>
    </thead>
    <tbody>
      ${bodyRows.join('\n')}
    </tbody>
  </table>
  ${avisosTipo ? `<div class="aviso-tipo">
    <strong>Origem do tipo de caminhão</strong>
    <ul>${avisosTipo}</ul>
  </div>` : ''}
  <div class="footer">SistemMA — Análise de peso por viagem (PESO 1–4, qualidade vs peso ideal do tipo, frota e cenário caixa × densidade)</div>
</body>
</html>`;
}
