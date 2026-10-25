import type { ResultadoAnaliseViagens } from './analisarViagensPlanilhaService';

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Mensagens de tratamento de hodômetro (inclui motivo explícito de coluna menor que outra). */
function problemaEhTratamentoHodometro(pl: string): boolean {
  return pl.includes('hodômetro')
    || pl.includes('hodometro')
    || pl.includes('km zerado')
    || pl.includes('km total corrigido')
    || pl.includes('km total mantido')
    || pl.includes('motivo do tratamento')
    || pl.includes('leitura foi descartada')
    || pl.includes('km saída')
    || pl.includes('km chegada');
}

function fmtTon(n: number): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 2, minimumFractionDigits: 1 });
}

function fmtPesoTon(kg: unknown): string {
  if (kg == null || kg === '') return '—';
  const n = Number(kg);
  if (Number.isNaN(n)) return '—';
  return fmtTon(n / 1000);
}

/**
 * A linha da planilha pode somar várias pesagens (PESO 1–5). Mostrar só o total
 * faz uma linha de 2 viagens parecer uma pesagem impossível, então detalhamos.
 */
function celulaPesoLinha(v: ResultadoAnaliseViagens['viagens'][number]): string {
  if (v.pesoTotal == null) return '—';
  const total = fmtPesoTon(v.pesoTotal);
  const pesagens = v.pesagensKg || [];
  if (pesagens.length <= 1) return total;
  const detalhe = pesagens.map((p) => fmtTon(p / 1000)).join(' + ');
  return `${total}<br/><span style="font-size:8px;color:#64748b">`
    + `${pesagens.length} pesagens: ${esc(detalhe)}</span>`;
}

export function gerarHtmlSaudeDadosServer(opts: {
  relatorio: ResultadoAnaliseViagens;
  contratoNome: string;
  servicoNome: string;
  tipoLabel?: string;
}): string {
  const { relatorio, contratoNome, servicoNome, tipoLabel = 'Coleta' } = opts;
  const viagens = relatorio.viagens || [];
  const inconsistentes = relatorio.viagensInconsistentesTotal ?? relatorio.viagensIncompletas ?? 0;
  const validas = relatorio.viagensValidasDashboard ?? relatorio.viagensCompletas ?? 0;
  const descartadas = relatorio.linhasDescartadasSemDados ?? 0;
  const emBranco = relatorio.linhasEmBrancoIgnoradas ?? 0;
  const corrigidasHodometro = relatorio.viagensCorrigidasHodometro ?? 0;
  const pesagensAltas = relatorio.pesagensAltas ?? 0;
  const linhasPesagemAlta = relatorio.linhasComPesagemAlta ?? 0;
  const tDash = ((relatorio.pesoKgDashboard ?? 0) / 1000);
  const tFora = ((relatorio.pesoKgForaDashboard ?? 0) / 1000);
  const dataRelatorio = new Date().toLocaleDateString('pt-BR');
  const contadorPlanilha = relatorio.somaContadorViagens ?? relatorio.totalViagens ?? 0;
  const contadorDashboard = relatorio.somaContadorNoDashboard ?? validas;
  const contadorFora = relatorio.somaContadorForaDashboard ?? inconsistentes;
  const pctAproveitamento = contadorPlanilha > 0
    ? Math.round((contadorDashboard / contadorPlanilha) * 1000) / 10
    : 0;
  const viagensCorrigidas = viagens.filter((v) => v.corrigidaHodometro && !v.foraDashboard && !v.descartada);
  const viagensFora = viagens.filter((v) => v.foraDashboard || v.descartada);
  const viagensAlerta = viagens.filter((v) => v.alertaPesagemAlta && !v.foraDashboard && !v.descartada && !v.corrigidaHodometro);
  const viagensSemPeso = viagens.filter((v) => v.alertaSemPesagem && !v.foraDashboard && !v.descartada);
  const qtdSemPesagem = relatorio.viagensSemPesagem ?? viagensSemPeso.reduce((n, v) => n + (v.viagensSemPesagem?.length || 1), 0);
  const conferencia = relatorio.conferenciaUpload;
  const rotasPlanilha = conferencia?.rotasPlanilha ?? (validas + inconsistentes);
  const rotasTemplate = conferencia?.linhasTemplate ?? emBranco;
  const retrabalho = conferencia?.retrabalhosMesmaRota || [];
  const viagensOk = viagens.filter((v) => !v.foraDashboard && !v.descartada);
  const amostraOk = viagensOk.slice(-15);

  const filtrarProblemas = (
    problemas: string[] | undefined,
    opts?: { corrigidaHodometro?: boolean; alertaPesagemAlta?: boolean; alertaSemPesagem?: boolean },
  ) =>
    (problemas || []).filter((p) => {
      const pl = p.toLowerCase();
      if (opts?.corrigidaHodometro && problemaEhTratamentoHodometro(pl)) {
        return true;
      }
      if (opts?.alertaPesagemAlta && pl.includes('pesagem alta')) {
        return true;
      }
      if (opts?.alertaSemPesagem && pl.includes('sem pesagem')) {
        return true;
      }
      return !pl.includes('placa será unificada') && !pl.startsWith('corrigido automaticamente');
    });

  const linhaTabela = (v: ResultadoAnaliseViagens['viagens'][number]) => {
    const probs = filtrarProblemas(v.problemas, {
      corrigidaHodometro: v.corrigidaHodometro,
      alertaPesagemAlta: v.alertaPesagemAlta,
      alertaSemPesagem: v.alertaSemPesagem,
    });
    const corProb = v.foraDashboard || v.descartada
      ? '#dc2626'
      : v.alertaPesagemAlta
        ? '#9a3412'
        : v.alertaSemPesagem
          ? '#b45309'
          : (v.corrigidaHodometro ? '#166534' : '#b45309');
    const kmCell = (() => {
      if (!v.corrigidaHodometro) {
        if (v.kmTotal != null) {
          return Number(v.kmTotal).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
        }
        if (v.kmTotalCalculado != null) {
          return `${Number(v.kmTotalCalculado).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}*`;
        }
        return '—';
      }
      const kmFinal = v.kmTotalCalculado != null && v.kmTotalCalculado > 0
        ? v.kmTotalCalculado
        : (v.kmTotal != null && v.kmTotal > 0 ? v.kmTotal : null);
      if (kmFinal != null && kmFinal > 0) {
        return `${Number(kmFinal).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} (ajustado)`;
      }
      return '0 (tratado)';
    })();
    const statusHtml = v.foraDashboard || v.descartada
      ? `<strong style="color:#dc2626">FORA DO DASH</strong>${v.motivoForaDashboard ? ` — ${esc(v.motivoForaDashboard)}` : ''}`
        + (probs.length ? `<br/>${esc(probs.join('; '))}` : '')
      : esc(probs.join('; ') || (v.corrigidaHodometro ? 'No dash (KM tratado) — peso/viagens mantidos' : (v.alertaSemPesagem ? 'No dash — viagem sem pesagem' : '—')));
    return `
      <tr>
        <td>${esc(v.linha)}</td>
        <td>${esc(v.data || '—')}</td>
        <td>${esc(v.placa || '—')}</td>
        <td>${esc(v.motorista || '—')}</td>
        <td style="text-align:center;font-weight:700;color:${v.foraDashboard || v.descartada ? '#dc2626' : '#16a34a'}">${esc(v.contadorViagens ?? '—')}</td>
        <td>${kmCell}</td>
        <td style="${v.alertaPesagemAlta ? 'font-weight:700;color:#9a3412' : ''}">${celulaPesoLinha(v)}${v.alertaPesagemAlta && v.pesoAlertaKg != null
          ? ` <span style="font-size:8px">(máx viagem ${Number(v.pesoAlertaKg).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} kg)</span>`
          : ''}</td>
        <td style="color:${corProb};font-size:9px">${statusHtml}</td>
      </tr>`;
  };
  const tabelaViagens = (titulo: string, lista: ResultadoAnaliseViagens['viagens'], classe = '') => lista.length === 0 ? '' : `
  <div class="section-title ${classe}">${esc(titulo)} (${esc(lista.length)})</div>
  <table>
    <thead><tr>
      <th>Linha</th><th>Data</th><th>Placa</th><th>Motorista</th><th>Contador</th>
      <th>KM Total</th><th>Peso da linha (t)</th><th>Status / Tratativa</th>
    </tr></thead>
    <tbody>${lista.map(linhaTabela).join('')}</tbody>
  </table>`;

  const problemasLista = relatorio.problemasDashboard || relatorio.problemasAgrupados || [];
  const problemasHtml = problemasLista.map((p) => `
    <div style="display:flex;justify-content:space-between;padding:6px 10px;background:#fef2f2;border-radius:6px;margin-bottom:4px;font-size:13px;">
      <span>${esc(p.tipo)}</span>
      <span style="font-weight:700;color:#dc2626">${esc(p.quantidade)} viagem(ns)</span>
    </div>`).join('');

  const resumoPlacasHtml = relatorio.resumoPlacas?.alerta
    ? `<div class="aviso" style="background:#fef2f2;border-color:#fecaca;color:#991b1b">
        <strong>Placas:</strong> ${esc(relatorio.resumoPlacas.alerta)}
      </div>`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { box-sizing: border-box; overflow: visible; }
    @page { size: A4; margin: 10mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; margin: 0; padding: 24px; background: #edf2f7; color: #172238; }
    .header { text-align: left; padding: 22px 24px 18px; background: linear-gradient(120deg, #172238, #263b61); border-radius: 12px; color: #fff; }
    .header h1 { margin: 0; font-size: 22px; color: #fff; letter-spacing: -.02em; }
    .header p { margin: 5px 0 0; font-size: 11px; color: #d5e0f2; }
    .header .eyebrow { color: #91e1d0; text-transform: uppercase; letter-spacing: .12em; font-size: 9px; font-weight: 700; }
    .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 14px 0; }
    .card { background: #fff; border: 1px solid #dce4ef; border-radius: 9px; padding: 13px 10px; text-align: center; box-shadow: 0 4px 12px rgba(23,34,56,.05); }
    .card .num { font-size: 21px; font-weight: 800; color: #172238; }
    .card .label { font-size: 9px; color: #697890; margin-top: 4px; text-transform: uppercase; letter-spacing: .04em; }
    .card.completas .num { color: #0f9f86; }
    .card.incompletas .num { color: #d34b59; }
    .card.tratadas .num { color: #2475c9; }
    .section-title { font-size: 13px; font-weight: 800; color: #253653; margin: 18px 0 8px; padding: 0 0 6px 10px; border-bottom: 2px solid #2457d6; }
    .section-title.ok { border-bottom-color: #0f9f86; }
    .section-title.danger { border-bottom-color: #d34b59; }
    .problemas-box { background: #fff; border: 1px solid #dce4ef; border-radius: 9px; padding: 10px; margin-bottom: 12px; box-shadow: 0 4px 12px rgba(23,34,56,.04); }
    .aviso { background: #eaf0ff; border: 1px solid #b9caff; border-radius: 9px; padding: 12px 14px; margin-bottom: 12px; font-size: 11px; color: #18388f; line-height: 1.5; }
    .aviso-ok { background: #e4f8f3; border-color: #9adfd2; color: #087564; }
    .tratativas { display: grid; grid-template-columns: repeat(4, 1fr); gap: 9px; margin-bottom: 12px; }
    .tratativa { background: #fff; border: 1px solid #dce4ef; border-left: 4px solid #2475c9; border-radius: 8px; padding: 10px; font-size: 10px; color: #52627a; }
    .tratativa strong { display: block; color: #253653; font-size: 12px; margin-bottom: 3px; }
    .impacto { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
    .impacto-box { background: #fff; border: 1px solid #dce4ef; border-radius: 9px; padding: 11px 13px; }
    .impacto-box strong { display: block; font-size: 11px; color: #253653; margin-bottom: 4px; }
    .impacto-box span { font-size: 11px; color: #52627a; }
    ul.regras { font-size: 11px; color: #52627a; margin: 0 0 12px 18px; padding: 0; line-height: 1.5; }
    table { width: 100%; border-collapse: collapse; font-size: 9px; background: #fff; }
    th { background: #172238; color: #fff; padding: 7px 8px; text-align: left; font-weight: 600; }
    td { padding: 6px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
    tr:nth-child(even) { background: #f7f9fc; }
    tr { break-inside: avoid; }
    .footer { text-align: center; font-size: 9px; color: #92a0b4; margin-top: 20px; padding-top: 10px; border-top: 1px solid #dce4ef; }
    .obs { font-size: 10px; color: #697890; font-style: italic; margin-top: 6px; line-height: 1.4; }
    @media (max-width: 760px) { body { padding: 12px; } .summary, .tratativas, .impacto { grid-template-columns: 1fr 1fr; } }
    @media print { body { background: #fff; padding: 0; } .header, .card, .problemas-box, .tratativa, .impacto-box { box-shadow: none; } }
  </style>
</head>
<body>
  <div class="header">
    <div class="eyebrow">Sistemma · Qualidade e rastreabilidade</div>
    <h1>Relatório de Saúde dos Dados</h1>
    <p style="font-size:13px;font-weight:600;color:#334155;margin:6px 0 2px">
      Contrato: ${esc(contratoNome)} • Tipo: ${esc(tipoLabel)} • Data: ${esc(dataRelatorio)}
    </p>
    <p>Serviço: ${esc(servicoNome)} • Arquivo: ${esc(relatorio.nomeArquivo || '—')} • Aba: ${esc(relatorio.aba || '—')}</p>
  </div>

  <div class="summary">
    <div class="card"><div class="num">${esc(rotasPlanilha)}</div><div class="label">Rotas na planilha</div></div>
    <div class="card completas"><div class="num">${esc(validas)}</div><div class="label">Rotas no dashboard</div></div>
    <div class="card"><div class="num">${esc(contadorPlanilha)}</div><div class="label">Viagens (contador)</div></div>
    <div class="card incompletas"><div class="num">${esc(inconsistentes)}</div><div class="label">Rotas rejeitadas</div></div>
  </div>

  <div class="summary">
    <div class="card completas"><div class="num">${esc(contadorDashboard)}</div><div class="label">Viagens aproveitadas</div></div>
    <div class="card incompletas"><div class="num">${esc(contadorFora)}</div><div class="label">Viagens rejeitadas</div></div>
    <div class="card completas"><div class="num">${esc(pctAproveitamento)}%</div><div class="label">Aproveitamento</div></div>
    <div class="card"><div class="num">${esc(retrabalho.reduce((s, p) => s + p.linhas.length, 0))}</div><div class="label">Linhas de retrabalho</div></div>
  </div>

  <div class="impacto">
    <div class="impacto-box"><strong>Impacto no peso</strong><span>${esc(tDash.toLocaleString('pt-BR', { maximumFractionDigits: 1 }))} t aproveitadas${tFora > 0 ? ` · ${esc(tFora.toLocaleString('pt-BR', { maximumFractionDigits: 1 }))} t fora` : ''}</span></div>
    <div class="impacto-box"><strong>Tratamento automático</strong><span>${esc(corrigidasHodometro)} viagem(ns) corrigidas e mantidas no dashboard</span></div>
  </div>

  <div class="aviso aviso-ok">
    <strong>Conclusão executiva:</strong>
    ${rotasPlanilha > 0
      ? `a planilha tem ${esc(rotasPlanilha)} rota(s) (linha operacional). `
      : ''}
    ${contadorPlanilha > 0
      ? `O CONTADOR informa ${esc(contadorPlanilha)} viagem(ns), das quais ${esc(contadorDashboard)} (${esc(pctAproveitamento)}%) entraram no dashboard.`
      : 'não foram identificadas viagens com contador preenchido.'}
    ${inconsistentes === 0 && rotasPlanilha > 0
      ? ' Nenhuma rota foi bloqueada — a lista de erros abaixo fica vazia de propósito.'
      : ''}
    ${tFora > 0
      ? ` O dashboard considera ${esc(tDash.toLocaleString('pt-BR', { maximumFractionDigits: 1 }))} t; ${esc(tFora.toLocaleString('pt-BR', { maximumFractionDigits: 1 }))} t ficaram fora por inconsistências e não foram somadas.`
      : ''}
    ${rotasTemplate > 0 ? ` ${esc(rotasTemplate)} linha(s) de template/rodapé foram ignoradas.` : ''}
    ${emBranco > 0 && rotasTemplate === 0 ? ` ${esc(emBranco)} linha(s) em branco foram ignoradas por não representarem viagens.` : ''}
    ${qtdSemPesagem > 0
      ? ` ${esc(qtdSemPesagem)} viagem(ns) subiram sem pesagem (trecho com horário e PESO vazio); o peso dessa faixa não entra nas toneladas.`
      : ''}
  </div>

  ${conferencia?.mensagem ? `
  <div class="aviso">
    <strong>Agente de conferência:</strong> ${esc(conferencia.mensagem)}
  </div>` : ''}

  <div class="section-title ok">Tratativas aplicadas automaticamente</div>
  <div class="tratativas">
    <div class="tratativa"><strong>${esc(corrigidasHodometro)} corrigidas</strong>Hodômetro inconsistente tratado. Peso e contador preservados; KM ajustado quando possível.</div>
    <div class="tratativa"><strong>${esc(pesagensAltas)} alertas</strong>Pesagens acima de 15 t sinalizadas para conferência, sem bloquear a entrada.</div>
    <div class="tratativa"><strong>${esc(qtdSemPesagem)} sem pesagem</strong>Trecho com horário e PESO vazio. A viagem sobe no dashboard; o peso dessa faixa não soma.</div>
    <div class="tratativa"><strong>${esc(emBranco)} ignoradas</strong>Linhas vazias de template ou rodapé não foram consideradas viagens.</div>
  </div>

  ${(relatorio.regrasSaude || []).length > 0 ? `
  <div class="section-title">Critérios de entrada no dashboard</div>
  <ul class="regras">
    ${(relatorio.regrasSaude || []).map((r) => `<li>${esc(r)}</li>`).join('')}
  </ul>` : ''}

  <div class="section-title danger">Viagens rejeitadas e motivo</div>
  <div class="problemas-box">
    ${problemasHtml || '<p style="color:#16a34a;font-weight:600">Nenhum bloqueio — todas as viagens identificadas entram no dashboard.</p>'}
  </div>

  ${resumoPlacasHtml}

  ${tabelaViagens('Viagens que ficaram fora do dashboard', viagensFora, 'danger')}
  ${retrabalho.length > 0 ? `
  <div class="section-title">Retrabalho da sala técnica (mesma operação, equipe diferente)</div>
  <table>
    <thead><tr>
      <th>Linhas Excel</th><th>Data</th><th>Placa</th><th>Motoristas</th><th>Motivo</th>
    </tr></thead>
    <tbody>
      ${retrabalho.map((p) => `
      <tr>
        <td>${esc(p.linhas.join(', '))}</td>
        <td>${esc(p.data || '—')}</td>
        <td>${esc(p.placa || '—')}</td>
        <td>${esc(p.motoristas.join(' / ') || '—')}</td>
        <td style="font-size:9px">${esc(p.motivo)}</td>
      </tr>`).join('')}
    </tbody>
  </table>` : ''}
  ${tabelaViagens('Viagens corrigidas e mantidas no dashboard', viagensCorrigidas, 'ok')}
  ${tabelaViagens('Viagens sem pesagem (mantidas no dashboard)', viagensSemPeso)}
  ${tabelaViagens('Alertas informativos de pesagem', viagensAlerta)}
  ${tabelaViagens('Amostra das últimas rotas válidas (o dashboard usa todas)', amostraOk, 'ok')}
  ${viagens.length > 0 ? `
  <div class="obs">
    * Contador = coluna CONTADOR DE VIAGENS. O peso é o total da linha em toneladas (kg ÷ 1000) —
    quando a linha tem mais de uma viagem, cada pesagem (PESO 1–5) aparece detalhada abaixo do total.
    Linhas fora do dashboard não entram na coluna Toneladas do ciclo.
  </div>
  ` : ''}

  <div class="footer">
    Relatório gerado automaticamente • Sistemma • ${esc(new Date().toLocaleString('pt-BR'))}
  </div>
</body>
</html>`;
}
