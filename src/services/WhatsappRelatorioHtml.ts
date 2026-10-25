/** HTMLs para PDFs enviados pelo WhatsApp (ciclo + comparativo). */
import type { AnalisePesoColeta } from './analisePesoColetaService';
import { gerarHtmlAnalisePesoComparativo } from './gerarHtmlAnalisePesoComparativo';
import {
  blocoDesempenhoPorTipoHtml,
  type ResumoCapacidadeDia,
} from './relatorioDia/capacidadeViagemDia';
import { COR_NOTA_IDEAL, PCT_IDEAL_MAX, PCT_IDEAL_MIN, textoEscalaIdealCurto } from './relatorioDia/escalaIdealPeso';
import { fmtNum as fmt } from './relatorioDia/fmt';
import { listarDatasIntervalo } from '../utils/periodoCicloContrato';

function esc(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtNum(n: number, casas = 0): string {
  return Number(n || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

function fmtDataBr(iso: string): string {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

const CSS = `
  * { box-sizing: border-box; }
  body { font-family: Segoe UI, Arial, sans-serif; font-size: 11px; color: #0f172a; margin: 0; padding: 12px 14px; }
  h1 { font-size: 16px; margin: 0 0 2px; color: #fbbf24; }
  .header { background: linear-gradient(135deg,#0f172a,#1e3a5f); color: #fff; border-radius: 10px; padding: 12px 14px; margin-bottom: 10px; }
  .header .sub { color: #94a3b8; font-size: 9px; margin-top: 2px; }
  .header .tipo { font-size: 10px; font-weight: 700; color: #e2e8f0; margin-top: 4px; }
  .banner { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 10px; font-size: 9px; margin-bottom: 10px; color: #334155; }
  .banner strong { color: #0f172a; }
  .sec { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; color: #334155; margin: 14px 0 6px; }
  .cards { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
  .card { flex: 1 1 110px; border: 1px solid #e2e8f0; border-top: 3px solid #6366f1; border-radius: 8px; padding: 8px 10px; }
  .card .lbl { font-size: 8px; font-weight: 700; color: #64748b; text-transform: uppercase; }
  .card .val { font-size: 15px; font-weight: 800; font-family: ui-monospace, monospace; margin-top: 2px; }
  .q-cards { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
  .q-card { flex: 1 1 120px; border-radius: 8px; padding: 8px 10px; border: 1px solid #e2e8f0; }
  .q-card .lbl { font-size: 8px; font-weight: 700; text-transform: uppercase; color: #64748b; }
  .q-card .val { font-size: 16px; font-weight: 800; margin-top: 2px; }
  table.data { width: 100%; border-collapse: collapse; font-size: 9.5px; }
  table.data th { background: #f1f5f9; text-align: left; padding: 5px 6px; font-size: 8px; color: #475569; }
  table.data td { padding: 4px 6px; border-top: 1px solid #f1f5f9; }
  table.data .r { text-align: right; }
  table.data .c { text-align: center; }
  .st-bom { color: #166534; background: #bbf7d0; font-size: 7px; font-weight: 800; padding: 1px 5px; border-radius: 4px; }
  .st-medio { color: #854d0e; background: #fef08a; font-size: 7px; font-weight: 800; padding: 1px 5px; border-radius: 4px; }
  .st-ruim { color: #991b1b; background: #fecaca; font-size: 7px; font-weight: 800; padding: 1px 5px; border-radius: 4px; }
  .bar-row { display: flex; align-items: center; gap: 6px; margin: 3px 0; }
  .bar-lbl { width: 78px; font-size: 8px; font-weight: 700; }
  .bar-track { flex: 1; height: 8px; background: #f1f5f9; border-radius: 4px; overflow: hidden; }
  .bar-fill { display: block; height: 8px; border-radius: 4px; }
  .bar-val { width: 48px; text-align: right; font-size: 8px; font-weight: 700; }
  .bar-detail { font-size: 6.5px; color: #64748b; margin: 0 0 4px 84px; }
  .bloco-hd { font-size: 9px; font-weight: 800; color: #334155; margin: 6px 0 4px; }
  .foot { margin-top: 14px; font-size: 8px; color: #94a3b8; }
  .rank { font-weight: 800; color: #64748b; }
  .muted { font-size: 7px; color: #64748b; }
`;

function qualidadeCicloHtml(capacidade?: ResumoCapacidadeDia | null): string {
  if (!capacidade || !(capacidade.viagensComPeso > 0)) return '';
  const total = capacidade.otimo + capacidade.ruim + capacidade.pessimo;
  if (!(total > 0)) return '';
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  const acima = (capacidade.viagens || []).filter(
    (v) => v.ocupacaoPct != null && v.ocupacaoPct > PCT_IDEAL_MAX,
  ).length;
  const abaixo = (capacidade.viagens || []).filter(
    (v) => v.ocupacaoPct != null && v.ocupacaoPct < PCT_IDEAL_MIN,
  ).length;

  return `
  <div class="sec">Qualidade das viagens vs peso ideal</div>
  <p class="muted">${esc(textoEscalaIdealCurto())} · ${fmtNum(capacidade.viagensComPeso)} viagem(ns) com peso</p>
  <div class="q-cards">
    <div class="q-card" style="border-top:3px solid ${COR_NOTA_IDEAL.otimo}">
      <div class="lbl">Ótimo (${PCT_IDEAL_MIN}–${PCT_IDEAL_MAX}%)</div>
      <div class="val" style="color:${COR_NOTA_IDEAL.otimo}">${fmtNum(capacidade.otimo)} · ${fmtNum(pct(capacidade.otimo), 0)}%</div>
    </div>
    <div class="q-card" style="border-top:3px solid #ea580c">
      <div class="lbl">Acima do ideal</div>
      <div class="val" style="color:#ea580c">${fmtNum(acima)} · ${fmtNum(pct(acima), 0)}%</div>
    </div>
    <div class="q-card" style="border-top:3px solid ${COR_NOTA_IDEAL.pessimo}">
      <div class="lbl">Abaixo do ideal</div>
      <div class="val" style="color:${COR_NOTA_IDEAL.pessimo}">${fmtNum(abaixo)} · ${fmtNum(pct(abaixo), 0)}%</div>
    </div>
  </div>`;
}

function detalheCapacidadeCicloHtml(capacidade?: ResumoCapacidadeDia | null): string {
  if (!capacidade?.viagens?.length) return '';

  const nota = (v: ResumoCapacidadeDia['viagens'][number]) => {
    if (v.notaIdeal === 'otimo') return '<span class="st-bom">Ótimo</span>';
    if (v.notaIdeal === 'pessimo') return '<span class="st-ruim">Péssimo</span>';
    return '<span class="st-medio">Ruim</span>';
  };
  const pctIdeal = (v: ResumoCapacidadeDia['viagens'][number]) =>
    v.ocupacaoPct == null ? '—' : `${fmtNum(v.ocupacaoPct, 0)}%`;

  const acima = [...capacidade.viagens]
    .filter((v) => (v.ocupacaoPct != null && v.ocupacaoPct > PCT_IDEAL_MAX) || v.acimaPesoMax)
    .sort((a, b) => (b.ocupacaoPct || 0) - (a.ocupacaoPct || 0))
    .slice(0, 20);
  const rowsAcima = acima.map((v) => {
    const excesso = v.pesoIdealKg ? Math.max(0, v.pesoKg - v.pesoIdealKg) : 0;
    return `<tr>
      <td><b>${esc(v.placa)}</b></td><td>${esc(v.motorista)}</td><td>${esc(v.tipoLabel)}</td>
      <td class="r">${fmtNum(v.pesoKg, 0)}</td><td class="r">${v.pesoIdealKg ? fmtNum(v.pesoIdealKg, 0) : '—'}</td>
      <td class="r">${pctIdeal(v)}</td><td class="r">${excesso > 0 ? `+${fmtNum(excesso, 0)}` : '—'}</td>
      <td class="c">${nota(v)}</td><td>${esc(v.rota)}</td>
    </tr>`;
  }).join('');

  const detalhe = [...capacidade.viagens]
    .filter((v) => v.ocupacaoPct != null)
    .sort((a, b) => Math.abs((b.ocupacaoPct || 100) - 100) - Math.abs((a.ocupacaoPct || 100) - 100))
    .slice(0, 30);
  const rowsDetalhe = detalhe.map((v) => {
    const vsIdeal = v.ocupacaoPct == null
      ? '—'
      : v.ocupacaoPct > PCT_IDEAL_MAX ? 'ACIMA' : v.ocupacaoPct < PCT_IDEAL_MIN ? 'ABAIXO' : 'ÓTIMO';
    return `<tr>
      <td><b>${esc(v.placa)}</b></td><td>${esc(v.motorista)}</td><td>${esc(v.tipoLabel)}</td>
      <td class="r">${fmtNum(v.pesoKg, 0)}</td><td class="r">${v.pesoIdealKg ? fmtNum(v.pesoIdealKg, 0) : '—'}</td>
      <td class="r">${pctIdeal(v)}</td><td class="c"><b>${vsIdeal}</b></td><td class="c">${nota(v)}</td>
    </tr>`;
  }).join('');

  const ranking = (
    titulo: string,
    chave: (v: ResumoCapacidadeDia['viagens'][number]) => string,
    coluna: string,
  ) => {
    const map = new Map<string, { viagens: number; kg: number; pct: number; nPct: number }>();
    for (const v of capacidade.viagens) {
      const nome = chave(v);
      if (!nome || nome === '—') continue;
      const atual = map.get(nome) || { viagens: 0, kg: 0, pct: 0, nPct: 0 };
      atual.viagens += 1;
      atual.kg += v.pesoKg;
      if (v.ocupacaoPct != null) {
        atual.pct += v.ocupacaoPct;
        atual.nPct += 1;
      }
      map.set(nome, atual);
    }
    const linhas = [...map.entries()]
      .map(([nome, x]) => ({
        nome,
        ...x,
        media: x.viagens ? x.kg / x.viagens : 0,
        pct: x.nPct ? x.pct / x.nPct : null,
      }))
      .sort((a, b) => {
        const da = a.pct == null ? 100 : Math.abs(a.pct - 100);
        const db = b.pct == null ? 100 : Math.abs(b.pct - 100);
        return da - db || b.media - a.media;
      })
      .slice(0, 15);
    if (!linhas.length) return '';
    return `<div class="sec">${esc(titulo)}</div>
      <table class="data"><thead><tr><th>#</th><th>${esc(coluna)}</th><th class="c">Viag.</th>
      <th class="r">Ton</th><th class="r">kg/viag</th><th class="r">% ideal</th></tr></thead>
      <tbody>${linhas.map((x, i) => `<tr><td class="rank">#${i + 1}</td><td><b>${esc(x.nome)}</b></td>
      <td class="c">${fmtNum(x.viagens)}</td><td class="r">${fmtNum(x.kg / 1000, 1)} t</td>
      <td class="r">${fmtNum(x.media, 0)}</td><td class="r">${x.pct == null ? '—' : `${fmtNum(x.pct, 0)}%`}</td></tr>`).join('')}</tbody></table>`;
  };

  return `
    ${rowsAcima ? `<div class="sec">Viagens acima do peso ideal — detalhe</div>
      <p class="muted">Pesagens acima de ${PCT_IDEAL_MAX}% do ideal ou acima do peso máximo do tipo.</p>
      <table class="data"><thead><tr><th>Placa</th><th>Motorista</th><th>Tipo</th><th class="r">Peso</th>
      <th class="r">Ideal</th><th class="r">% ideal</th><th class="r">Excesso</th><th class="c">Status</th><th>Rota</th></tr></thead>
      <tbody>${rowsAcima}</tbody></table>` : ''}
    <div class="sec">Melhores números — motoristas e coletores</div>
    <p class="muted">Ranking por proximidade do peso ideal (100%) + produtividade (kg/viagem).</p>
    ${ranking('Top motoristas', (v) => v.motorista, 'Motorista')}
    ${ranking('Top coletores (placas)', (v) => v.placa, 'Placa')}
    <div class="sec">Detalhe das viagens do ciclo vs peso ideal</div>
    <p class="muted">Viagens com maior desvio do ideal. Status: ACIMA, ÓTIMO ou ABAIXO.</p>
    <table class="data"><thead><tr><th>Placa</th><th>Motorista</th><th>Tipo</th><th class="r">Peso</th>
    <th class="r">Ideal</th><th class="r">% ideal</th><th class="c">Vs ideal</th><th class="c">Nota</th></tr></thead>
    <tbody>${rowsDetalhe}</tbody></table>`;
}

/** PDF ciclo operacional — alinhado às seções do botão PDF Ciclo Operacional. */
export function gerarHtmlCicloOperacionalWhatsapp(opts: {
  servicoNome: string;
  contratoNome: string;
  periodo: { dataInicio: string; dataFim: string; label: string };
  dias: Array<{
    data: string;
    rotas: number;
    viagens: number;
    pesoTotalKg: number;
    kmTotal: number;
  }>;
  totais: { rotas: number; viagens: number; pesoTotalKg: number; kmTotal: number };
  resumo: {
    viagens: number;
    pesoTotalTon: number;
    kmTotal: number;
    placas: number;
    horasProdutivas: number;
    faturamento: number;
  };
  porPlaca: Array<{
    label: string;
    viagens: number;
    tonelagem: number;
    kmTotal: number;
    tipoCaminhao?: string;
  }>;
  porMotorista?: Array<{
    label: string;
    viagens: number;
    tonelagem: number;
    kmTotal: number;
  }>;
  porDistrito?: Array<{
    label: string;
    viagens: number;
    tonelagem: number;
    kmTotal: number;
  }>;
  porTipoFat: Record<string, number>;
  capacidade?: ResumoCapacidadeDia | null;
}): string {
  const { periodo, totais, resumo, dias, porPlaca, capacidade } = opts;
  const ton = resumo.pesoTotalTon || totais.pesoTotalKg / 1000;
  const viagens = resumo.viagens || totais.viagens;
  const tViag = viagens > 0 ? ton / viagens : 0;
  const diasAtivos = dias.filter((d) => d.viagens > 0);
  const diasComDados = diasAtivos.length;
  const diasDecorridos = Math.max(listarDatasIntervalo(periodo.dataInicio, periodo.dataFim).length, 1);
  const viagensMediaDia = viagens / diasDecorridos;
  const tonMediaDia = ton / diasDecorridos;
  const kmMedio = viagens > 0 ? (resumo.kmTotal || totais.kmTotal) / viagens : 0;
  const prodVeiculo = resumo.placas > 0 ? ton / resumo.placas : 0;
  const pctOtimo = capacidade && (capacidade.otimo + capacidade.ruim + capacidade.pessimo) > 0
    ? (capacidade.otimo / (capacidade.otimo + capacidade.ruim + capacidade.pessimo)) * 100
    : null;

  const rowsDia = [...diasAtivos]
    .sort((a, b) => b.data.localeCompare(a.data))
    .map((d) => `
      <tr>
        <td style="font-weight:700;color:#4338ca">${esc(fmtDataBr(d.data).slice(0, 5))}</td>
        <td class="c">${fmtNum(d.viagens, 0)}</td>
        <td class="r">${fmtNum(d.pesoTotalKg / 1000, 1)} t</td>
        <td class="r">${fmtNum(d.kmTotal, 0)} km</td>
        <td class="c">${fmtNum(d.rotas, 0)}</td>
      </tr>`).join('');

  const rowsPlaca = porPlaca.slice(0, 30).map((p, i) => `
    <tr>
      <td class="rank">#${i + 1}</td>
      <td style="font-weight:700;font-family:ui-monospace,monospace">${esc(p.label)}</td>
      <td>${esc(p.tipoCaminhao || '—')}</td>
      <td class="c">${fmtNum(p.viagens, 0)}</td>
      <td class="r">${fmtNum(p.tonelagem, 1)} t</td>
      <td class="r">${fmtNum(p.kmTotal, 0)}</td>
      <td class="r">${p.viagens > 0 ? fmtNum((p.tonelagem * 1000) / p.viagens, 0) : '0'} kg</td>
    </tr>`).join('');

  const rankingRows = (
    lista: Array<{ label: string; viagens: number; tonelagem: number; kmTotal: number }>,
    limite = 15,
  ) => lista.slice(0, limite).map((item, i) => `
    <tr>
      <td class="rank">#${i + 1}</td>
      <td style="font-weight:700">${esc(item.label || '—')}</td>
      <td class="c">${fmtNum(item.viagens)}</td>
      <td class="r">${fmtNum(item.tonelagem, 1)} t</td>
      <td class="r">${fmtNum(item.kmTotal)}</td>
      <td class="r">${item.viagens > 0 ? fmtNum((item.tonelagem * 1000) / item.viagens, 0) : '0'} kg</td>
    </tr>`).join('');

  const rowsMotorista = rankingRows(opts.porMotorista || []);
  const rowsDistrito = rankingRows(opts.porDistrito || []);
  const desempenhoTipo = blocoDesempenhoPorTipoHtml(capacidade).replace(
    'Desempenho por tipo — peso ideal × média do dia',
    'Desempenho por tipo — peso ideal × média do ciclo',
  );

  const fatTipo = Object.entries(opts.porTipoFat || {})
    .filter(([, v]) => Number(v) > 0)
    .map(([k, v]) => `<span style="margin-right:10px"><b>${esc(k)}</b>: ${Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>`)
    .join('');

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"/><style>${CSS}</style></head><body>
  <div class="header">
    <h1>${esc(opts.servicoNome)}</h1>
    <div class="sub">${esc(opts.contratoNome)} · ${esc(periodo.label)}</div>
    <div class="tipo">Relatório Gerencial do Ciclo (dias decorridos)</div>
    <div class="sub">Gerado ${new Date().toLocaleString('pt-BR')}</div>
  </div>

  <div class="banner">
    Período: <strong>${fmtDataBr(periodo.dataInicio)}</strong> a <strong>${fmtDataBr(periodo.dataFim)}</strong>
    · ${fmtNum(viagens)} viagem${viagens !== 1 ? 's' : ''}
    · ${fmtNum(ton, 1)} t · ${fmtNum(resumo.kmTotal || totais.kmTotal, 0)} km
    · ${fmtNum(resumo.placas, 0)} veículo${resumo.placas !== 1 ? 's' : ''}
    · ${fmtNum(diasDecorridos)} dia(s) decorridos · ${fmtNum(diasComDados)} com operação
  </div>

  <div class="sec">Indicadores do ciclo</div>
  <div class="cards">
    <div class="card"><div class="lbl">Média viagens/dia do ciclo</div><div class="val">${fmtNum(viagensMediaDia, 1)}</div></div>
    <div class="card" style="border-top-color:#16a34a"><div class="lbl">Média ton/dia do ciclo</div><div class="val">${fmtNum(tonMediaDia, 1)} t</div></div>
    <div class="card" style="border-top-color:#f59e0b"><div class="lbl">Ton./viagem</div><div class="val">${fmtNum(tViag, 2)} t</div></div>
    <div class="card" style="border-top-color:#0891b2"><div class="lbl">KM/viagem</div><div class="val">${fmtNum(kmMedio, 1)} km</div></div>
    <div class="card" style="border-top-color:#6366f1"><div class="lbl">Prod./veículo</div><div class="val">${fmtNum(prodVeiculo, 2)} t</div></div>
    ${pctOtimo != null ? `<div class="card" style="border-top-color:${COR_NOTA_IDEAL.otimo}"><div class="lbl">% viagens no ótimo</div><div class="val">${fmtNum(pctOtimo, 0)}%</div></div>` : `<div class="card" style="border-top-color:#7c3aed"><div class="lbl">Horas</div><div class="val">${fmtNum(resumo.horasProdutivas, 1)} h</div></div>`}
  </div>
  ${resumo.faturamento > 0 ? `<div class="muted" style="margin-bottom:8px">Faturamento est.: ${resumo.faturamento.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} ${fatTipo ? `· ${fatTipo}` : ''}</div>` : ''}

  ${qualidadeCicloHtml(capacidade)}
  ${desempenhoTipo}
  ${detalheCapacidadeCicloHtml(capacidade)}

  <div class="sec">Evolução diária</div>
  <table class="data">
    <thead><tr><th>Data</th><th class="c">Viagens</th><th class="r">Ton</th><th class="r">KM</th><th class="c">Rotas</th></tr></thead>
    <tbody>${rowsDia || '<tr><td colspan="5">Sem dias com operação</td></tr>'}</tbody>
  </table>

  ${rowsPlaca ? `
  <div class="sec">Desempenho por placa</div>
  <table class="data">
    <thead><tr><th></th><th>Placa</th><th>Tipo</th><th class="c">Viag.</th><th class="r">Ton</th><th class="r">KM</th><th class="r">kg/viag</th></tr></thead>
    <tbody>${rowsPlaca}</tbody>
  </table>` : ''}

  ${rowsMotorista ? `
  <div class="sec">Desempenho por motorista</div>
  <table class="data">
    <thead><tr><th></th><th>Motorista</th><th class="c">Viag.</th><th class="r">Ton</th><th class="r">KM</th><th class="r">kg/viag</th></tr></thead>
    <tbody>${rowsMotorista}</tbody>
  </table>` : ''}

  ${rowsDistrito ? `
  <div class="sec">Desempenho por distrito / região</div>
  <table class="data">
    <thead><tr><th></th><th>Distrito</th><th class="c">Viag.</th><th class="r">Ton</th><th class="r">KM</th><th class="r">kg/viag</th></tr></thead>
    <tbody>${rowsDistrito}</tbody>
  </table>` : ''}

  <div class="foot">Sistemma · Relatório Gerencial do Ciclo Completo · Ideal por tipo = volume (L) × densidade (kg/L) do contrato · ${fmt(diasComDados, 0)} dia(s) com operação</div>
  </body></html>`;
}

type LinhaPesoWhatsapp = {
  contratoNome: string;
  servicoNome: string;
  totalRegistros: number;
  periodoLabel: string;
  analise: AnalisePesoColeta;
};

/** Mesmo HTML do botão "PDF Ciclo" em Análise de Peso (`gerarHtmlAnalisePesoComparativo`). */
export function gerarHtmlComparativoContratosWhatsapp(opts: {
  tipoLabel: string;
  periodoRef: string;
  linhas: LinhaPesoWhatsapp[];
}): string {
  return gerarHtmlAnalisePesoComparativo({
    tipoServicoLabel: opts.tipoLabel,
    periodoLabel: opts.periodoRef,
    servicos: opts.linhas.map((l) => ({
      nome: l.servicoNome,
      contratoNome: l.contratoNome,
      totalRegistros: l.totalRegistros,
      periodo: { label: l.periodoLabel },
      analisePeso: l.analise,
    })),
  });
}

type FaixaEvolucao = 'otimo' | 'ruim' | 'pessimo' | 'excedido';

export type SerieDiaEvolucao = {
  data: string;
  label: string;
  viagens: number;
  otimo: number | null;
  ruim: number | null;
  pessimo: number | null;
  excedido: number | null;
};

export type BlocoEvolucaoPdf = {
  id: string;
  nome: string;
  viagens: number;
  pct: Record<FaixaEvolucao, number>;
  linhas: SerieDiaEvolucao[];
};

const FAIXAS_EVOLUCAO: Array<{ id: FaixaEvolucao; label: string; cor: string; regra: string }> = [
  { id: 'otimo', label: 'Ótimo', cor: '#22c55e', regra: '90–110% do ideal' },
  { id: 'ruim', label: 'Ruim', cor: '#facc15', regra: '50–90% do ideal' },
  { id: 'pessimo', label: 'Péssimo', cor: '#ef4444', regra: 'abaixo de 50%' },
  { id: 'excedido', label: 'Excedido', cor: '#a855f7', regra: 'acima de 110%' },
];

const TENSAO_CHART = 0.25;

function num(v: number): string {
  return v.toFixed(1);
}

/**
 * Mesma curva do Chart.js 4 (tension 0.25) usada no PDF até a 4.0.11.
 * Arredonda a virada do dia em vez de deixar quina.
 */
function caminhoChart(pontos: Array<{ x: number; y: number }>): string {
  const n = pontos.length;
  if (n < 2) return '';
  if (n === 2) {
    return `M ${num(pontos[0].x)} ${num(pontos[0].y)} L ${num(pontos[1].x)} ${num(pontos[1].y)}`;
  }
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(b.x - a.x, b.y - a.y);
  const entrada: Array<{ x: number; y: number }> = [];
  const saida: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < n; i += 1) {
    const prev = pontos[i - 1] || pontos[i];
    const curr = pontos[i];
    const next = pontos[i + 1] || pontos[i];
    const d01 = dist(prev, curr);
    const d12 = dist(curr, next);
    let s01 = d01 / (d01 + d12);
    let s12 = d12 / (d01 + d12);
    if (!Number.isFinite(s01)) s01 = 0;
    if (!Number.isFinite(s12)) s12 = 0;
    const fa = TENSAO_CHART * s01;
    const fb = TENSAO_CHART * s12;
    entrada.push({
      x: curr.x - fa * (next.x - prev.x),
      y: curr.y - fa * (next.y - prev.y),
    });
    saida.push({
      x: curr.x + fb * (next.x - prev.x),
      y: curr.y + fb * (next.y - prev.y),
    });
  }
  let d = `M ${num(pontos[0].x)} ${num(pontos[0].y)}`;
  for (let i = 0; i < n - 1; i += 1) {
    const c1 = saida[i];
    const c2 = entrada[i + 1];
    const p = pontos[i + 1];
    d += ` C ${num(c1.x)} ${num(c1.y)}, ${num(c2.x)} ${num(c2.y)}, ${num(p.x)} ${num(p.y)}`;
  }
  return d;
}

function indicesEixoX(n: number): number[] {
  const passo = n <= 14 ? 1 : Math.max(1, Math.round(n / 10));
  const indices: number[] = [];
  for (let i = 0; i < n; i += passo) indices.push(i);
  if (indices[indices.length - 1] !== n - 1) {
    if (n - 1 - indices[indices.length - 1] <= Math.floor(passo / 2)) indices[indices.length - 1] = n - 1;
    else indices.push(n - 1);
  }
  return indices;
}

/** Gráfico de linhas do PDF gerencial (deploy até 4.0.11), sem depender da internet. */
export function svgGraficoEvolucaoCiclo(linhas: SerieDiaEvolucao[]): string {
  const w = 780;
  const h = 280;
  const left = 42;
  const right = 16;
  const top = 16;
  const bottom = 34;
  const plotW = w - left - right;
  const plotH = h - top - bottom;
  const n = Math.max(linhas.length, 1);
  const xDe = (i: number) => left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yDe = (pct: number) => top + ((100 - Math.max(0, Math.min(100, pct))) / 100) * plotH;
  const ticksX = new Set(indicesEixoX(n));

  const grades = [0, 25, 50, 75, 100].map((tick) => {
    const y = yDe(tick);
    return `<line x1="${left}" y1="${y.toFixed(1)}" x2="${w - right}" y2="${y.toFixed(1)}" stroke="#e8eef5"/>
      <text x="${left - 8}" y="${(y + 3).toFixed(1)}" text-anchor="end" fill="#64748b" font-size="10" font-family="Segoe UI, Arial, sans-serif">${tick}%</text>`;
  }).join('');

  const eixos = linhas.map((l, i) => {
    if (!ticksX.has(i)) return '';
    const x = xDe(i);
    return `<line x1="${x.toFixed(1)}" y1="${top}" x2="${x.toFixed(1)}" y2="${(top + plotH).toFixed(1)}" stroke="#f1f5f9"/>
      <text x="${x.toFixed(1)}" y="${h - 12}" text-anchor="middle" fill="#334155" font-size="10" font-family="Segoe UI, Arial, sans-serif">${esc(l.label || l.data.slice(5))}</text>`;
  }).join('');

  const ordem = [...FAIXAS_EVOLUCAO].reverse();
  const series = ordem.map((faixa) => {
    const grupos: Array<Array<{ x: number; y: number }>> = [];
    let atual: Array<{ x: number; y: number }> = [];
    linhas.forEach((l, i) => {
      const valor = l[faixa.id];
      if (valor == null || Number.isNaN(valor)) {
        if (atual.length) grupos.push(atual);
        atual = [];
        return;
      }
      atual.push({ x: xDe(i), y: yDe(valor) });
    });
    if (atual.length) grupos.push(atual);
    const largura = faixa.id === 'otimo' ? 3 : 2;
    const traços = grupos
      .filter((g) => g.length >= 2)
      .map((g) => `<path d="${caminhoChart(g)}" fill="none" stroke="${faixa.cor}" stroke-width="${largura}" stroke-linejoin="round" stroke-linecap="round"/>`)
      .join('');
    const pontos = grupos.flat().map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.6" fill="#fff" stroke="${faixa.cor}" stroke-width="1.6"/>`).join('');
    return traços + pontos;
  }).join('');

  const legenda = FAIXAS_EVOLUCAO.map((f) => `<span class="leg"><i style="background:${f.cor}"></i>${esc(f.label)}</span>`).join('');

  return `<div class="chart-wrap">
    <svg class="grafico" viewBox="0 0 ${w} ${h}" width="100%" height="268" role="img" aria-label="Gráfico de evolução por ciclo">
      <rect x="${left}" y="${top}" width="${plotW}" height="${plotH}" fill="#fbfdff" stroke="#e2e8f0"/>
      ${grades}
      ${eixos}
      ${series}
    </svg>
    <div class="legenda">${legenda}</div>
  </div>`;
}

/**
 * PDF de Evolução Diária (mesmo conceito do TV Mode):
 * uma linha por faixa de qualidade vs peso ideal, um gráfico por contrato.
 */
export function gerarHtmlEvolucaoDiariaWhatsapp(opts: {
  tipoLabel: string;
  periodoLabel: string;
  janelaLabel: string;
  geradoEm: string;
  totalViagens: number;
  pctGeral: Record<FaixaEvolucao, number>;
  blocos: BlocoEvolucaoPdf[];
}): string {
  const chips = FAIXAS_EVOLUCAO.map((f) => `
    <div class="chip" style="border-color:${f.cor}">
      <span class="dot" style="background:${f.cor}"></span>
      <span class="cl">${esc(f.label)}</span>
      <strong>${opts.pctGeral[f.id].toFixed(0)}%</strong>
      <span class="cr">${esc(f.regra)}</span>
    </div>`).join('');

  const cards = opts.blocos.map((b) => {
    const pcts = FAIXAS_EVOLUCAO.map((f) => `
      <span class="p"><i style="background:${f.cor}"></i>${b.pct[f.id].toFixed(0)}%</span>`).join('');
    return `
    <section class="bloco">
      <div class="bh">
        <div>
          <div class="bnome">${esc(b.nome)}</div>
          <div class="bmeta">${fmtNum(b.viagens)} viagens na janela</div>
        </div>
        <div class="bpcts">${pcts}</div>
      </div>
      <div class="chart-box">${svgGraficoEvolucaoCiclo(b.linhas)}</div>
    </section>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"/>
<title>Evolução Diária — ${esc(opts.tipoLabel)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Segoe UI, Arial, sans-serif; font-size: 11px; color: #0f172a; margin: 0; padding: 14px 16px; background: #fff; }
  .header { background: linear-gradient(135deg,#062e1a,#14532d); color: #fff; border-radius: 10px; padding: 12px 14px; margin-bottom: 10px; }
  .header h1 { font-size: 16px; margin: 0; color: #fef08a; }
  .header .sub { color: #bbf7d0; font-size: 10px; margin-top: 4px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
  .chip { display: flex; align-items: baseline; gap: 5px; border: 1px solid #e2e8f0; border-radius: 8px; padding: 5px 8px; background: #f8fafc; flex: 1 1 140px; }
  .chip .dot { width: 9px; height: 9px; border-radius: 2px; flex-shrink: 0; align-self: center; }
  .chip .cl { font-size: 9px; font-weight: 700; color: #334155; }
  .chip strong { font-size: 14px; margin-left: auto; }
  .chip .cr { font-size: 8px; color: #64748b; white-space: nowrap; }
  .bloco { border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 12px; margin-bottom: 10px; page-break-inside: avoid; background: #fff; }
  .bh { display: flex; justify-content: space-between; gap: 8px; align-items: flex-start; margin-bottom: 6px; flex-wrap: wrap; }
  .bnome { font-size: 12px; font-weight: 800; color: #0f172a; }
  .bmeta { font-size: 9px; color: #64748b; margin-top: 2px; }
  .bpcts { display: flex; gap: 8px; flex-wrap: wrap; }
  .bpcts .p { display: inline-flex; align-items: center; gap: 3px; font-size: 9px; font-weight: 700; color: #334155; }
  .bpcts i { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }
  .chart-box { margin-top: 4px; }
  .grafico { display: block; width: 100%; height: auto; background: #fff; }
  .legenda { display: flex; justify-content: center; gap: 14px; margin-top: 2px; }
  .leg { display: inline-flex; align-items: center; gap: 4px; font-size: 9px; color: #334155; font-weight: 700; }
  .leg i { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
  .foot { margin-top: 8px; font-size: 8px; color: #94a3b8; text-align: center; }
</style></head><body>
  <div class="header">
    <h1>Evolução diária · qualidade vs peso ideal</h1>
    <div class="sub">${esc(opts.tipoLabel)} · ${esc(opts.janelaLabel)} · ${esc(opts.periodoLabel)} · ${fmtNum(opts.totalViagens)} viagens · ${opts.blocos.length} série(s)</div>
    <div class="sub">Gerado em ${esc(opts.geradoEm)}</div>
  </div>
  <div class="chips">${chips}</div>
  ${cards}
  <div class="foot">Sistemma · mesmas faixas do painel Evolução Diária (TV) · Ótimo = 90–110% do peso ideal do tipo</div>
</body></html>`;
}
