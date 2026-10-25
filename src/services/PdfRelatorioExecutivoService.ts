/* ============================================
   PdfRelatorioExecutivoService
   ═══ MODELO CLEAN — DESING PROFISSIONAL ═══
   Capa branca → Financeiro (2 gráficos) → Projeção → Operacional (2 gráficos)
   Sem gradientes, sem glassmorphism, sem flash.
   Foco total na legibilidade dos dados.
   ============================================ */

import { format } from 'date-fns';

/* ─── Interfaces de entrada ─── */
export interface PdfExecutivoParams {
  contratoNome: string;
  contratoId: string;
  servicoNome: string;
  servicoId: string;
  periodoLabel: string;
  dataInicio: string;
  dataFim: string;
  dataGeracao: Date;
  corPrimaria: string;

  faturamentoTotal: { valor: number; formatado: string; variacao: number; tipoVariacao: string; meta?: number };
  margemBruta: { valor: number; formatado: string; variacao: number; tipoVariacao: string; meta?: number };
  ticketMedio: { valor: number; formatado: string; variacao: number; tipoVariacao: string; meta?: number };

  faturamentoPorTipo: { tipo: string; viagens: number; pesoTotal: number; valorUnitario: number; faturamento: number }[];
  temValorCaminhao: boolean;

  faturamentoPorPeriodo: { data: string; viagens: number; peso: number; faturamento: number }[];

  tendenciaFaturamento: { label: string; valor: number }[];

  indicadoresOperacionais: {
    viagens: number;
    coletores: number;
    tonelagem: number;
    kmRodados: number;
    horasProdutivas: number;
    produtividadeColetor: number;
    kmMedioViagem: number;
    pesoMedioColeta: number;
  };
  volumeColetaSerie: { label: string; valor: number }[];

  indicadoresCustomizados: { nome: string; valor: string; formato: string }[];

  secoes: string[];
  totalRegistros: number;
  dadosSuficientes: boolean;

  // Gráfico 1: Faturamento diário com custo
  faturamentoDiarioComCusto: { label: string; faturamento: number; custo: number }[];
  metaFaturamento?: number;

  // Gráfico 3: Faturamento por coletor Top 10
  faturamentoPorColetorTop10: { coletor: string; faturamento: number }[];

  // Gráfico 4: Projeção mensal
  projecaoMensalGrafico: {
    dias: number[];
    reais: number[];
    projetados: number[];
    meta?: number;
    labelMes: string;
  };

  // Gráfico 5: Volume com média móvel
  volumeColetaComMedia: { label: string; valor: number; mediaMovel: number }[];

  // Gráfico 6: Produtividade por coletor Top 10
  produtividadeColetorTop10: { coletor: string; tonelagem: number; tonPorDia: number }[];

  // Gráfico 7: Bolha — será removido, mantido por compatibilidade
  eficienciaOperacional: { coletor: string; km: number; tonelagem: number; viagens: number; tipoCor: string }[];
  coresTipoCaminhao: Record<string, string>;

  // ═══ NOVOS CAMPOS — EXPANSÃO FINANCEIRA ═══
  // Card extra da capa
  custoOperacional?: { valor: number; formatado: string; variacao: number; tipoVariacao: string; meta?: number };

  // Análise de rentabilidade (4 cards)
  receitaKm?: number;
  receitaHora?: number;
  custoPorKmIndicador?: { valor: number; origem: 'abastecimentos' | 'contrato' };
  lucroLiquidoEstimado?: number;

  // Tabela de margem por tipo de caminhão
  margemPorTipo?: { tipo: string; receita: number; custo: number; margem: number }[];

  // Tabela de lucro líquido por período
  lucroPorPeriodo?: { data: string; faturamento: number; custo: number; lucro: number; margem: number }[];

  // Gráfico de composição do custo
  custoComposicao?: { label: string; abastecimentos: number; estimado: number }[];

  // ═══ NOVOS CAMPOS — PDF 5 PÁGINAS ═══

  // Resumo da Frota (capa)
  resumoFrota?: {
    totalVeiculos: number;
    totalLitros: number;
    custoMedioKm: number;
    receitaMediaKm: number;
  };

  // Análise de Combustível (página 3)
  analiseCombustivel?: {
    totalLitros: number;
    totalValor: number;
    precoMedio: number;
    litrosPorKm: number;
    percentualCusto: number;
  };

  // Evolução diária de combustível (gráfico página 3)
  evolucaoCombustivel?: { label: string; litros: number; valor: number }[];

  // Desempenho por veículo (página 4)
  desempenhoVeiculos?: {
    placa: string;
    faturamento: number;
    custo: number;
    lucro: number;
    tonelagem: number;
    km: number;
    litros: number;
    kmPorLitro: number;
    margem: number;
  }[];

  // Projeção financeira (página 5)
  projecaoFinanceira?: {
    faturamentoRealizado: number;
    custoRealizado: number;
    margemAtual: number;
    faturamentoProjetado: number;
    custoProjetado: number;
    margemProjetada: number;
  };

  // ═══ NOVOS GRÁFICOS DE RECEITA ═══
  receitaKmDiario?: { label: string; valor: number }[];
  receitaHoraDiario?: { label: string; valor: number }[];
  rankingMotoristas?: { motorista: string; placa: string; faturamento: number; viagens: number }[];
  receitaPorRegional?: { regional: string; faturamento: number; viagens: number }[];
  receitaPorDiaSemana?: { diaNome: string; faturamento: number; viagens: number }[];
  receitaPorTurno?: { turno: string; faturamento: number; viagens: number }[];
}

/* ═══════════════════════════════════════════
   GERA HTML COMPLETO DO PDF — MODELO CLEAN
   ═══════════════════════════════════════════ */
export function gerarHtmlRelatorioExecutivo(p: PdfExecutivoParams): string {
  const {
    contratoNome, servicoNome, periodoLabel, dataInicio, dataFim,
    dataGeracao, secoes, dadosSuficientes,
  } = p;

  const ACCENT = '#059669';          // Verde escuro — cor principal
  const ACCENT_LIGHT = '#d1fae5';    // Verde claro — fundo de headers
  const ACCENT2 = '#4f46e5';         // Azul índigo — secundário
  const TEXT_DARK = '#0f172a';
  const TEXT_BODY = '#334155';
  const TEXT_MUTED = '#64748b';
  const BORDER = '#e2e8f0';
  const BG_STRIPE = '#f8fafc';

  const dataGeracaoStr = format(dataGeracao, "dd/MM/yyyy 'às' HH:mm");
  const periodoStr = `${format(new Date(dataInicio), 'dd/MM/yyyy')} a ${format(new Date(dataFim), 'dd/MM/yyyy')}`;
  const temFinanceira = secoes.includes('financeira');
  const temOperacional = secoes.includes('operacional');
  const temGraficos = secoes.includes('graficos');
  const temCustomizados = secoes.includes('customizados');

  // ─── Card financeiro (versão clean) ───
  const cardFin = (label: string, data: { valor: number; formatado: string; variacao: number; tipoVariacao: string; meta?: number }) => {
    const seta = data.tipoVariacao === 'aumento' ? '▲' : data.tipoVariacao === 'reducao' ? '▼' : '◆';
    const corVar = data.tipoVariacao === 'aumento' ? '#059669' : data.tipoVariacao === 'reducao' ? '#dc2626' : '#64748b';
    const varStr = data.tipoVariacao === 'estavel' ? '0%' : `${data.tipoVariacao === 'aumento' ? '+' : ''}${data.variacao.toFixed(1)}%`;
    const metaPct = data.meta && data.meta > 0 ? Math.min(100, Math.round((data.valor / data.meta) * 100)) : 0;
    return `
      <div class="fin-card">
        <div class="fin-label">${label}</div>
        <div class="fin-valor">${data.formatado}</div>
        <div class="fin-var" style="color:${corVar}">${seta} ${varStr}</div>
        ${data.meta && data.meta > 0 ? `<div class="meta-track"><div class="meta-fill" style="width:${metaPct}%"></div></div>` : ''}
      </div>`;
  };

  // ─── Resumo texto ───
  const resumoTexto = dadosSuficientes
    ? `${gerarFraseFinanceira(p)} ${gerarFraseOperacional(p)}`
    : 'Dados insuficientes para análise estatística no período selecionado.';

  // ─── Tabela Faturamento por Tipo ───
  const tabelaFatTipo = p.temValorCaminhao && p.faturamentoPorTipo.length > 0 ? `
    <h3 class="sec-title">Faturamento por Tipo de Caminhão</h3>
    <table class="tbl">
      <thead><tr><th>Tipo</th><th>Viagens</th><th>Peso (t)</th><th>Valor Unit.</th><th class="r">Faturamento</th></tr></thead>
      <tbody>
        ${p.faturamentoPorTipo.map((t, i) => `
          <tr${i % 2 === 0 ? ` class="s"` : ''}>
            <td><b>${t.tipo}</b></td>
            <td>${t.viagens.toLocaleString('pt-BR')}</td>
            <td>${t.pesoTotal.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td>
            <td>R$ ${t.valorUnitario.toFixed(2)}</td>
            <td class="r">R$ ${t.faturamento.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
          </tr>`).join('')}
      </tbody>
    </table>` : `
    <h3 class="sec-title">Faturamento por Tipo de Caminhão</h3>
    <p class="note">Valores por tipo não configurados. Faturamento estimado por peso total.</p>`;

  // ─── Helper: Card de rentabilidade (estilo diferente, mais compacto) ───
  const rentCard = (label: string, valorFmt: string, variacao?: string, corVar?: string, origem?: string) => {
    const badgeOrigem = origem ? `<span class="origem-badge">${origem}</span>` : '';
    return `
      <div class="rent-card">
        <div class="rent-label">${label}</div>
        <div class="rent-valor">${valorFmt}</div>
        ${badgeOrigem}
        ${variacao ? `<div class="rent-var" style="color:${corVar || '#64748b'}">${variacao}</div>` : ''}
      </div>`;
  };

  // ─── Seção de Análise de Rentabilidade (4 cards) ───
  const temRentabilidade = p.receitaKm !== undefined || p.custoPorKmIndicador !== undefined;
  const rentabilidadeHtml = temRentabilidade ? `
    <h3 class="sec-title" style="border-left-color:#7c3aed">Análise de Rentabilidade</h3>
    <div class="rent-grid">
      ${p.receitaKm !== undefined ? rentCard('Receita por KM Rodado', 'R$ ' + p.receitaKm.toFixed(2)) : ''}
      ${p.receitaHora !== undefined ? rentCard('Receita por Hora Produtiva', 'R$ ' + p.receitaHora.toFixed(2)) : ''}
      ${p.custoPorKmIndicador !== undefined ? rentCard('Custo por KM Rodado', 'R$ ' + p.custoPorKmIndicador.valor.toFixed(2), undefined, undefined, p.custoPorKmIndicador.origem === 'abastecimentos' ? 'Abastecimentos' : 'Contrato') : ''}
      ${p.lucroLiquidoEstimado !== undefined ? rentCard('Lucro Líquido Estimado', 'R$ ' + p.lucroLiquidoEstimado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })) : ''}
    </div>` : '';

  // ─── Tabela de Margem por Tipo de Caminhão ───
  const temMargemTipo = p.margemPorTipo && p.margemPorTipo.length > 0;
  const tabelaMargemTipo = temMargemTipo ? `
    <h3 class="sec-title" style="border-left-color:#d97706">Margem por Tipo de Caminhão</h3>
    <table class="tbl">
      <thead><tr><th>Tipo</th><th class="r">Receita</th><th class="r">Custo Prop.</th><th class="r">Margem</th></tr></thead>
      <tbody>
        ${p.margemPorTipo!.map((t, i) => {
          const corMargem = t.margem >= 0 ? '#059669' : '#dc2626';
          return `<tr${i % 2 === 0 ? ' class="s"' : ''}>
            <td><b>${t.tipo}</b></td>
            <td class="r">R$ ${t.receita.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
            <td class="r">R$ ${t.custo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
            <td class="r" style="color:${corMargem};font-weight:700">${t.margem >= 0 ? '+' : ''}${t.margem.toFixed(1)}%</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>` : `
    <h3 class="sec-title" style="border-left-color:#d97706">Margem por Tipo de Caminhão</h3>
    <p class="note">Valores por tipo não configurados. Cadastre valores de faturamento e custo por km no contrato para habilitar.</p>`;

  // ─── Tabela de Demonstrativo de Resultados (DRE) Diário ───
  const temLucroPeriodo = p.lucroPorPeriodo && p.lucroPorPeriodo.length > 0;
  const tabelaLucroPeriodo = temLucroPeriodo ? (() => {
    const dados = p.lucroPorPeriodo!;
    const totalFat = dados.reduce((s, t) => s + t.faturamento, 0);
    const totalCusto = dados.reduce((s, t) => s + t.custo, 0);
    const totalLucro = dados.reduce((s, t) => s + t.lucro, 0);
    const totalMargem = totalFat > 0 ? (totalLucro / totalFat) * 100 : 0;
    return `
    <h3 class="sec-title" style="border-left-color:#dc2626">Demonstrativo de Resultados (DRE) Diário</h3>
    <table class="tbl">
      <thead><tr><th>Data</th><th class="r">Faturamento</th><th class="r">Custo</th><th class="r">Lucro</th><th class="r">Margem</th></tr></thead>
      <tbody>
        ${dados.map((t, i) => {
          const corLucro = t.lucro >= 0 ? '#059669' : '#dc2626';
          const rowClass = i % 2 === 0 ? ' class="s"' : '';
          const bgNegativo = t.margem < 0 ? ' style="background:#fef2f2"' : '';
          return `<tr${rowClass}${bgNegativo}>
            <td>${t.data}</td>
            <td class="r">R$ ${t.faturamento.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
            <td class="r">R$ ${t.custo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
            <td class="r" style="color:${corLucro};font-weight:700">${t.lucro >= 0 ? '+' : ''}R$ ${t.lucro.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
            <td class="r" style="color:${corLucro};font-weight:700">${t.margem >= 0 ? '+' : ''}${t.margem.toFixed(1)}%</td>
          </tr>`;
        }).join('')}
        <tr style="font-weight:700;border-top:2px solid #1e293b">
          <td><b>TOTAL</b></td>
          <td class="r">R$ ${totalFat.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
          <td class="r">R$ ${totalCusto.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
          <td class="r" style="color:${totalLucro >= 0 ? '#059669' : '#dc2626'}">${totalLucro >= 0 ? '+' : ''}R$ ${totalLucro.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
          <td class="r" style="color:${totalMargem >= 0 ? '#059669' : '#dc2626'}">${totalMargem >= 0 ? '+' : ''}${totalMargem.toFixed(1)}%</td>
        </tr>
      </tbody>
    </table>`;
  })() : '';

  // ─── Tabela Faturamento por Período ───
  const tabelaPeriodo = p.faturamentoPorPeriodo.length > 0 ? `
    <h3 class="sec-title">Faturamento por Período</h3>
    <table class="tbl">
      <thead><tr><th>Data</th><th>Viagens</th><th>Peso (t)</th><th class="r">Faturamento</th></tr></thead>
      <tbody>
        ${p.faturamentoPorPeriodo.map((t, i) => `
          <tr${i % 2 === 0 ? ` class="s"` : ''}>
            <td>${t.data}</td>
            <td>${t.viagens.toLocaleString('pt-BR')}</td>
            <td>${t.peso.toFixed(2)}</td>
            <td class="r">R$ ${t.faturamento.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
          </tr>`).join('')}
      </tbody>
    </table>` : '';

  // ─── Grid Operacional (2 colunas) ───
  const op = p.indicadoresOperacionais;
  const opItens = [
    ['Viagens Realizadas', op.viagens.toLocaleString('pt-BR')],
    ['Coletores Ativos', op.coletores.toLocaleString('pt-BR')],
    ['Tonelagem Total', `${op.tonelagem.toFixed(2)} t`],
    ['KM Rodados', `${op.kmRodados.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} km`],
    ['Horas Produtivas', `${op.horasProdutivas.toFixed(1)}h`],
    ['Produtividade/Coletor', `${op.produtividadeColetor.toFixed(2)} t`],
    ['KM Médio/Viagem', `${op.kmMedioViagem.toFixed(1)} km`],
    ['Peso Médio/Coleta', `${op.pesoMedioColeta.toFixed(2)} t`],
  ];
  const gridOp = `
    <h3 class="sec-title" style="border-left-color:${ACCENT2}">Indicadores Operacionais</h3>
    <div class="op-grid">
      ${opItens.map(([l, v]) => `
        <div class="op-item">
          <span class="op-label">${l}</span>
          <span class="op-valor">${v}</span>
        </div>`).join('')}
    </div>`;

  // ─── Custom ───
  const customHtml = temCustomizados && p.indicadoresCustomizados.length > 0 ? `
    <div class="page-break"></div>
    <div class="page">
      ${header(contratoNome, servicoNome, dataGeracaoStr)}
      <h2 class="pag-titulo">Indicadores Customizados</h2>
      <div class="custom-grid">
        ${p.indicadoresCustomizados.map(ind => `
          <div class="custom-card">
            <div class="custom-label">${ind.nome}</div>
            <div class="custom-valor">${ind.valor}</div>
          </div>`).join('')}
      </div>
      ${footer(periodoStr)}
    </div>` : '';

  // ─── Cards KPI na capa — 5 cards ───
  const custoOpCard = p.custoOperacional ? cardFin('Custo Operacional', p.custoOperacional) : '';
  const lucroCard = p.lucroLiquidoEstimado !== undefined ? (() => {
    const val = p.lucroLiquidoEstimado!;
    const fmt = 'R$ ' + val.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    const lucroObj = { valor: val, formatado: fmt, variacao: 0, tipoVariacao: 'estavel' as const };
    return cardFin('Lucro Líquido', lucroObj);
  })() : '';
  const cardsKpi = `
    <div class="kpi-row kpi-row-5">
      ${cardFin('Faturamento Total', p.faturamentoTotal)}
      ${cardFin('Margem Bruta', p.margemBruta)}
      ${cardFin('Ticket Médio', p.ticketMedio)}
      ${custoOpCard}
      ${lucroCard}
    </div>`;

  // ─── Resumo da Frota (capa) ───
  const temResumoFrota = p.resumoFrota && p.resumoFrota.totalVeiculos > 0;
  const resumoFrotaHtml = temResumoFrota ? `
    <h3 class="sec-title" style="border-left-color:#7c3aed;margin-top:18px">Resumo da Frota</h3>
    <div class="frota-grid">
      <div class="frota-item"><span class="frota-label">Veículos Ativos</span><span class="frota-valor">${p.resumoFrota!.totalVeiculos}</span></div>
      <div class="frota-item"><span class="frota-label">Total Combustível</span><span class="frota-valor">${p.resumoFrota!.totalLitros.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} L</span></div>
      <div class="frota-item"><span class="frota-label">Custo Médio/KM</span><span class="frota-valor">R$ ${p.resumoFrota!.custoMedioKm.toFixed(2)}</span></div>
      <div class="frota-item"><span class="frota-label">Receita Média/KM</span><span class="frota-valor">R$ ${p.resumoFrota!.receitaMediaKm.toFixed(2)}</span></div>
    </div>` : '';

  // ─── Gráfico 1: Faturamento Diário vs Custo ───
  const temG1 = temGraficos && p.faturamentoDiarioComCusto.length >= 3;
  const g1Html = temG1 ? `
    <div class="chart-card full">
      <h3 class="chart-titulo">Faturamento Diário vs Custo Operacional</h3>
      <div class="cw" style="height:250px;"><canvas id="c1"></canvas></div>
    </div>` : '';

  // ─── Gráfico 6: Composição do Custo (barras empilhadas) ───
  const temG6 = temGraficos && p.custoComposicao && p.custoComposicao.length >= 3;
  const g6Html = temG6 ? `
    <div class="chart-card full">
      <h3 class="chart-titulo">Composição do Custo Operacional</h3>
      <div class="cw" style="height:230px;"><canvas id="c6"></canvas></div>
    </div>` : '';

  // ─── Gráfico 2: Distribuição por Tipo (barras empilhadas — substitui rosca) ───
  const temG2 = temGraficos && p.temValorCaminhao && p.faturamentoPorTipo.length >= 2;
  const g2Html = temG2 ? `
    <div class="chart-card">
      <h3 class="chart-titulo">Distribuição por Tipo de Caminhão</h3>
      <div class="cw" style="height:200px;"><canvas id="c2"></canvas></div>
    </div>` : '';

  // ─── Gráfico 3: Faturamento por Coletor Top 10 ───
  const temG3 = temGraficos && p.faturamentoPorColetorTop10.length >= 2;
  const g3Html = temG3 ? `
    <div class="chart-card">
      <h3 class="chart-titulo">Faturamento por Coletor (Top 10)</h3>
      <div class="cw" style="height:230px;"><canvas id="c3"></canvas></div>
    </div>` : '';

  // ─── Gráfico 4: Volume com Média Móvel ───
  const temG4 = temGraficos && p.volumeColetaComMedia.length >= 3;
  const g4Html = temG4 ? `
    <div class="chart-card full">
      <h3 class="chart-titulo">Volume de Coleta com Média Móvel (7 dias)</h3>
      <div class="cw" style="height:250px;"><canvas id="c4"></canvas></div>
    </div>` : '';

  // ─── Gráfico 5: Produtividade por Coletor Top 5 ───
  const temG5 = temGraficos && p.produtividadeColetorTop10.length >= 2;
  const g5Html = temG5 ? `
    <div class="chart-card">
      <h3 class="chart-titulo">Produtividade por Coletor (Top 5)</h3>
      <div class="cw" style="height:230px;"><canvas id="c5"></canvas></div>
    </div>` : '';

  // ═══ PÁGINA 3 — ANÁLISE DE RECEITA (NOVA) ═══
  const temReceitaKm = p.receitaKmDiario && p.receitaKmDiario.length >= 3;
  const temReceitaHora = p.receitaHoraDiario && p.receitaHoraDiario.length >= 3;
  const temRankingMotoristas = p.rankingMotoristas && p.rankingMotoristas.length >= 2;
  const temRegional = p.receitaPorRegional && p.receitaPorRegional.length >= 2;
  const temDiaSemana = p.receitaPorDiaSemana && p.receitaPorDiaSemana.length >= 2;
  const temTurno = p.receitaPorTurno && p.receitaPorTurno.length >= 2;

  const temAlgumGraficoReceita = temReceitaKm || temReceitaHora || temRankingMotoristas || temRegional || temDiaSemana || temTurno;

  const receitaPageCharts = temAlgumGraficoReceita ? (() => {
    // Charts da página de receita
    const charts = [];

    // Linha 1: Receita por KM (esquerda) e Receita por Hora (direita)
    if (temReceitaKm || temReceitaHora) {
      let rowHtml = '<div class="chart-row">';
      if (temReceitaKm) {
        rowHtml += `
          <div class="chart-card">
            <h3 class="chart-titulo">Receita por KM Rodado (Diário)</h3>
            <div class="cw" style="height:230px;"><canvas id="c-rec-km"></canvas></div>
          </div>`;
      }
      if (temReceitaHora) {
        rowHtml += `
          <div class="chart-card">
            <h3 class="chart-titulo">Receita por Hora Produtiva (Diário)</h3>
            <div class="cw" style="height:230px;"><canvas id="c-rec-hora"></canvas></div>
          </div>`;
      }
      rowHtml += '</div>';
      charts.push(rowHtml);
    }

    // Linha 2: Ranking Motoristas (esquerda) e Regional (direita)
    if (temRankingMotoristas || temRegional) {
      let rowHtml = '<div class="chart-row">';
      if (temRankingMotoristas) {
        rowHtml += `
          <div class="chart-card">
            <h3 class="chart-titulo">Ranking de Receita por Motorista</h3>
            <div class="cw" style="height:250px;"><canvas id="c-rec-motorista"></canvas></div>
          </div>`;
      }
      if (temRegional) {
        rowHtml += `
          <div class="chart-card">
            <h3 class="chart-titulo">Receita por Regional</h3>
            <div class="cw" style="height:250px;"><canvas id="c-rec-regional"></canvas></div>
          </div>`;
      }
      rowHtml += '</div>';
      charts.push(rowHtml);
    }

    // Linha 3: Dia da Semana (esquerda) e Turno (direita)
    if (temDiaSemana || temTurno) {
      let rowHtml = '<div class="chart-row">';
      if (temDiaSemana) {
        rowHtml += `
          <div class="chart-card">
            <h3 class="chart-titulo">Receita por Dia da Semana</h3>
            <div class="cw" style="height:230px;"><canvas id="c-rec-dia"></canvas></div>
          </div>`;
      }
      if (temTurno) {
        rowHtml += `
          <div class="chart-card">
            <h3 class="chart-titulo">Receita por Turno</h3>
            <div class="cw" style="height:230px;"><canvas id="c-rec-turno"></canvas></div>
          </div>`;
      }
      rowHtml += '</div>';
      charts.push(rowHtml);
    }

    return charts.join('\n');
  })() : '';

  const receitaPage = temAlgumGraficoReceita ? `
  <div class="page-break"></div>
  <div class="page">
    ${header(contratoNome, servicoNome, dataGeracaoStr)}
    <h2 class="pag-titulo" style="border-left:4px solid ${ACCENT};padding-left:12px">Análise de Receita</h2>
    ${receitaPageCharts}
    ${footer(periodoStr)}
  </div>` : '';

  // ═══ PÁGINA 3 — ANÁLISE DE COMBUSTÍVEL ═══
  const temCombustivel = p.analiseCombustivel && p.analiseCombustivel.totalLitros > 0;
  const temEvolucaoComb = temCombustivel && p.evolucaoCombustivel && p.evolucaoCombustivel.length >= 3;
  const combustivelHtml = temCombustivel ? `
  <div class="page-break"></div>
  <div class="page">
    ${header(contratoNome, servicoNome, dataGeracaoStr)}
    <h2 class="pag-titulo">Análise de Combustível</h2>
    <div class="comb-grid">
      <div class="comb-card">
        <div class="comb-label">Total Litros</div>
        <div class="comb-valor">${p.analiseCombustivel!.totalLitros.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} L</div>
      </div>
      <div class="comb-card">
        <div class="comb-label">Valor Total</div>
        <div class="comb-valor">R$ ${p.analiseCombustivel!.totalValor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
      </div>
      <div class="comb-card">
        <div class="comb-label">Preço Médio/L</div>
        <div class="comb-valor">R$ ${p.analiseCombustivel!.precoMedio.toFixed(2)}</div>
      </div>
      <div class="comb-card">
        <div class="comb-label">Litros por KM</div>
        <div class="comb-valor">${p.analiseCombustivel!.litrosPorKm.toFixed(3)} L/km</div>
      </div>
      <div class="comb-card">
        <div class="comb-label">Custo Comb./KM</div>
        <div class="comb-valor">R$ ${((p.analiseCombustivel!.totalValor / (p.indicadoresOperacionais.kmRodados || 1)) || 0).toFixed(2)}</div>
      </div>
      <div class="comb-card">
        <div class="comb-label">% do Custo Total</div>
        <div class="comb-valor">${p.analiseCombustivel!.percentualCusto.toFixed(1)}%</div>
      </div>
    </div>
    ${temEvolucaoComb ? `
    <div class="chart-card full" style="margin-top:12px">
      <h3 class="chart-titulo">Evolução Diária — Litros Abastecidos vs Valor Gasto</h3>
      <div class="cw" style="height:250px;"><canvas id="c-comb"></canvas></div>
    </div>` : ''}
    ${footer(periodoStr)}
  </div>` : '';

  // ═══ PÁGINA 4 — DESEMPENHO POR VEÍCULO ═══
  const temVeiculos = p.desempenhoVeiculos && p.desempenhoVeiculos.length > 0;
  const medalhas = ['🥇', '🥈', '🥉'];
  const veiculosHtml = temVeiculos ? `
  <div class="page-break"></div>
  <div class="page">
    ${header(contratoNome, servicoNome, dataGeracaoStr)}
    <h2 class="pag-titulo">Desempenho por Veículo</h2>
    <table class="tbl">
      <thead><tr><th>#</th><th>Veículo</th><th class="r">Faturamento</th><th class="r">Custo</th><th class="r">Lucro</th><th class="r">Tonelagem</th><th class="r">KM</th><th class="r">Litros</th><th class="r">KM/L</th><th class="r">Margem</th></tr></thead>
      <tbody>
        ${p.desempenhoVeiculos!.map((v, i) => {
          const medalha = i < 3 ? medalhas[i] : '';
          const corMargem = v.margem >= 0 ? '#059669' : '#dc2626';
          const bgNeg = v.margem < 0 ? ' style="background:#fef2f2"' : '';
          const rowClass = i % 2 === 0 ? ' class="s"' : '';
          return `<tr${rowClass}${bgNeg}>
            <td style="text-align:center;font-size:14px">${medalha || (i + 1)}</td>
            <td><b>${v.placa}</b></td>
            <td class="r">R$ ${v.faturamento.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
            <td class="r">R$ ${v.custo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
            <td class="r" style="color:${v.lucro >= 0 ? '#059669' : '#dc2626'};font-weight:700">${v.lucro >= 0 ? '+' : ''}R$ ${v.lucro.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
            <td class="r">${v.tonelagem.toFixed(2)} t</td>
            <td class="r">${v.km.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</td>
            <td class="r">${v.litros.toFixed(1)} L</td>
            <td class="r">${v.kmPorLitro.toFixed(1)}</td>
            <td class="r" style="color:${corMargem};font-weight:700">${v.margem >= 0 ? '+' : ''}${v.margem.toFixed(1)}%</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    ${footer(periodoStr)}
  </div>` : '';

  // ═══ PÁGINA 5 — PROJEÇÃO MENSAL (atualizada com custo) ═══
  const temProjFinanceira = p.projecaoFinanceira && p.projecaoFinanceira.faturamentoRealizado > 0;
  const tabelaCenario = temProjFinanceira ? `
    <h3 class="sec-title" style="border-left-color:#7c3aed">Cenário Projetado</h3>
    <table class="tbl">
      <thead><tr><th>Indicador</th><th class="r">Realizado</th><th class="r">Projetado</th></tr></thead>
      <tbody>
        <tr><td>Faturamento</td><td class="r">R$ ${p.projecaoFinanceira!.faturamentoRealizado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td><td class="r">R$ ${p.projecaoFinanceira!.faturamentoProjetado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td></tr>
        <tr class="s"><td>Custo</td><td class="r">R$ ${p.projecaoFinanceira!.custoRealizado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td><td class="r">R$ ${p.projecaoFinanceira!.custoProjetado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td></tr>
        <tr><td>Margem</td><td class="r" style="font-weight:700;color:${p.projecaoFinanceira!.margemAtual >= 0 ? '#059669' : '#dc2626'}">${p.projecaoFinanceira!.margemAtual >= 0 ? '+' : ''}${p.projecaoFinanceira!.margemAtual.toFixed(1)}%</td><td class="r" style="font-weight:700;color:${p.projecaoFinanceira!.margemProjetada >= 0 ? '#059669' : '#dc2626'}">${p.projecaoFinanceira!.margemProjetada >= 0 ? '+' : ''}${p.projecaoFinanceira!.margemProjetada.toFixed(1)}%</td></tr>
      </tbody>
    </table>` : '';

  const temProj = temGraficos && p.projecaoMensalGrafico.dias.length >= 7;
  const temCustoProjetado = p.lucroPorPeriodo && p.lucroPorPeriodo.length > 0;
  const projHtml = temProj ? `
    <div class="page-break"></div>
    <div class="page">
      ${header(contratoNome, servicoNome, dataGeracaoStr)}
      <h2 class="pag-titulo">Projeção Mensal — ${p.projecaoMensalGrafico.labelMes}</h2>
      <div class="chart-card full">
        <h3 class="chart-titulo">Faturamento Acumulado vs Projeção vs Custo</h3>
        <div class="cw" style="height:270px;"><canvas id="c-proj"></canvas></div>
      </div>
      ${tabelaCenario}
      ${footer(periodoStr)}
    </div>` : '';

  // ═══ LAYOUT: financeiro com gráficos lado a lado ═══
  const chartsFinRow = (temG2 || temG3) ? `
    <div class="chart-row">
      ${g2Html}
      ${g3Html}
    </div>` : '';

  // ═══ LAYOUT: operacional com gráficos lado a lado ═══
  const chartsOpRow = (temG5) ? `
    <div class="chart-row">
      ${g4Html}
      ${g5Html}
    </div>` : g4Html; // se só tem g4, ocupa full width

  const dadosInsuf = !dadosSuficientes ? `
    <div class="aviso">
      <b>⚠️ Dados Insuficientes</b> — Menos de 5 registros no período. Os valores abaixo refletem os dados disponíveis.
    </div>` : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Relatório Executivo — ${servicoNome}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; overflow: visible; }
    body {
      font-family: 'Inter', 'Segoe UI', Arial, sans-serif;
      color: ${TEXT_BODY};
      background: #fff;
      font-size: 10px;
      line-height: 1.5;
    }

    /* ═══ PÁGINAS ═══ */
    .page {
      padding: 44px 44px 52px;
      min-height: 297mm;
      position: relative;
      page-break-after: always;
      break-after: page;
    }
    .page:last-child { page-break-after: avoid; }
    .page-break { page-break-before: always; }

    /* ═══ HEADER/FOOTER ═══ */
    .p-header {
      display: flex; justify-content: space-between; align-items: center;
      font-size: 8px; color: ${TEXT_MUTED};
      padding-bottom: 6px; margin-bottom: 18px;
      border-bottom: 1px solid ${BORDER};
    }
    .p-header strong { color: ${TEXT_DARK}; }
    .p-footer {
      position: absolute; bottom: 16px; left: 44px; right: 44px;
      display: flex; justify-content: space-between;
      font-size: 7px; color: #94a3b8;
      border-top: 1px solid ${BORDER};
      padding-top: 4px;
    }

    /* ═══ CAPA ═══ */
    .capa {
      min-height: 297mm;
      padding: 60px 50px 50px;
      border-left: 6px solid ${ACCENT};
      page-break-after: always;
      break-after: page;
    }
    .capa-label {
      font-size: 9px; text-transform: uppercase; letter-spacing: 2px;
      color: ${ACCENT}; font-weight: 700; margin-bottom: 6px;
    }
    .capa-titulo {
      font-family: 'Georgia', 'Times New Roman', serif;
      font-size: 30px; font-weight: 700; color: ${TEXT_DARK};
      margin-bottom: 2px; letter-spacing: -0.3px;
    }
    .capa-sub {
      font-size: 15px; color: ${TEXT_BODY}; margin-bottom: 20px;
    }
    .capa-periodo {
      font-size: 10px; color: ${TEXT_MUTED}; margin-bottom: 2px;
    }
    .capa-data {
      font-size: 9px; color: #94a3b8; margin-bottom: 24px;
    }
    .capa-div {
      width: 40px; height: 3px; background: ${ACCENT};
      margin-bottom: 18px; border-radius: 2px;
    }
    .capa-resumo {
      background: ${BG_STRIPE}; border: 1px solid ${BORDER};
      border-radius: 6px; padding: 14px 18px; margin-top: 18px;
      font-size: 10px; line-height: 1.7; color: ${TEXT_BODY};
    }

    /* ═══ CARDS KPI ═══ */
    .kpi-row {
      display: grid; grid-template-columns: repeat(4, 1fr);
      gap: 10px; margin-top: 18px;
    }
    .kpi-row-5 {
      grid-template-columns: repeat(5, 1fr);
    }
    .frota-grid {
      display: grid; grid-template-columns: repeat(4, 1fr);
      gap: 8px; margin-bottom: 12px;
    }
    .frota-item {
      display: flex; flex-direction: column; align-items: center;
      background: #f8fafc; border: 1px solid #e2e8f0;
      border-radius: 6px; padding: 10px 8px; break-inside: avoid;
    }
    .frota-label {
      font-size: 7px; text-transform: uppercase; letter-spacing: 0.3px;
      color: #64748b; font-weight: 600; margin-bottom: 2px;
    }
    .frota-valor {
      font-size: 16px; font-weight: 700; color: #0f172a;
    }
    .fin-card {
      background: #fff; border: 1px solid ${BORDER};
      border-radius: 6px; padding: 14px 16px; text-align: center;
      break-inside: avoid;
    }
    .fin-label {
      font-size: 8px; text-transform: uppercase; letter-spacing: 0.5px;
      color: ${TEXT_MUTED}; font-weight: 600; margin-bottom: 3px;
    }
    .fin-valor {
      font-size: 20px; font-weight: 700; color: ${TEXT_DARK};
      margin-bottom: 2px;
    }
    .fin-var {
      font-size: 10px; font-weight: 600;
    }
    .meta-track {
      margin-top: 5px; height: 3px; background: ${BORDER};
      border-radius: 2px; overflow: hidden;
    }
    .meta-fill {
      height: 100%; border-radius: 2px;
      background: ${ACCENT};
    }

    /* ═══ RENTABILIDADE CARDS ═══ */
    .rent-grid {
      display: grid; grid-template-columns: repeat(4, 1fr);
      gap: 8px; margin-bottom: 12px;
    }
    .rent-card {
      background: #fff; border: 1px solid ${BORDER};
      border-radius: 5px; padding: 10px 12px; text-align: center;
      break-inside: avoid; position: relative;
    }
    .rent-label {
      font-size: 7px; text-transform: uppercase; letter-spacing: 0.3px;
      color: ${TEXT_MUTED}; font-weight: 600; margin-bottom: 2px;
    }
    .rent-valor {
      font-size: 15px; font-weight: 700; color: ${TEXT_DARK};
    }
    .rent-var {
      font-size: 9px; font-weight: 600;
    }
    .origem-badge {
      display: inline-block; font-size: 6px;
      background: #ede9fe; color: #5b21b6;
      border-radius: 3px; padding: 1px 6px; margin-top: 2px;
      font-weight: 600; letter-spacing: 0.3px;
    }

    /* ═══ SEÇÕES ═══ */
    .pag-titulo {
      font-size: 18px; font-weight: 700; color: ${TEXT_DARK};
      margin-bottom: 14px;
    }
    .sec-title {
      font-size: 11px; font-weight: 700; color: ${TEXT_DARK};
      margin: 14px 0 8px; padding: 0 0 4px 8px;
      border-left: 3px solid ${ACCENT};
      border-bottom: 1px solid ${BORDER};
    }

    /* ═══ TABELAS ═══ */
    table.tbl {
      width: 100%; border-collapse: collapse;
      font-size: 9px; margin-bottom: 12px;
    }
    table.tbl th {
      background: ${ACCENT_LIGHT};
      color: #065f46;
      padding: 5px 8px;
      font-weight: 600; font-size: 8px;
      text-transform: uppercase; letter-spacing: 0.3px;
      text-align: left;
    }
    table.tbl td {
      padding: 4px 8px;
      border-bottom: 1px solid #f1f5f9;
      font-size: 9px;
    }
    table.tbl tr.s td { background: ${BG_STRIPE}; }
    table.tbl .r { text-align: right; font-weight: 600; color: #065f46; }

    .note {
      font-size: 8px; color: ${TEXT_MUTED}; font-style: italic;
      padding: 4px 8px; background: ${BG_STRIPE};
      border-left: 3px solid ${BORDER}; border-radius: 2px;
      margin-bottom: 10px;
    }

    /* ═══ GRID OPERACIONAL ═══ */
    .op-grid {
      display: grid; grid-template-columns: 1fr 1fr;
      gap: 1px; background: ${BORDER};
      border: 1px solid ${BORDER}; border-radius: 4px;
      overflow: hidden; margin-bottom: 14px;
    }
    .op-item {
      display: flex; justify-content: space-between;
      padding: 5px 10px; background: #fff;
      font-size: 9px;
    }
    .op-item:nth-child(even) { background: ${BG_STRIPE}; }
    .op-label { color: ${TEXT_MUTED}; }
    .op-valor { font-weight: 700; color: ${TEXT_DARK}; }

    /* ═══ GRÁFICOS ═══ */
    .chart-row {
      display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
      margin-bottom: 10px;
    }
    .chart-card {
      background: #fff; border: 1px solid ${BORDER};
      border-radius: 6px; padding: 10px 12px;
      break-inside: avoid; page-break-inside: avoid;
    }
    .chart-card.full { grid-column: 1 / -1; }
    .chart-titulo {
      font-size: 10px; font-weight: 600; color: ${TEXT_DARK};
      margin-bottom: 8px;
    }
    .cw { position: relative; width: 100%; }

    /* ═══ CUSTOM ═══ */
    .custom-grid {
      display: grid; grid-template-columns: repeat(4, 1fr);
      gap: 8px; margin-top: 8px;
    }
    .custom-card {
      background: #fff; border: 1px solid ${BORDER};
      border-radius: 4px; padding: 10px; text-align: center;
      break-inside: avoid;
    }
    .custom-label { font-size: 8px; color: ${TEXT_MUTED}; font-weight: 600; text-transform: uppercase; margin-bottom: 3px; }
    .custom-valor { font-size: 14px; font-weight: 700; color: ${TEXT_DARK}; }

    /* ═══ COMBUSTÍVEL ═══ */
    .comb-grid {
      display: grid; grid-template-columns: repeat(3, 1fr);
      gap: 8px; margin-bottom: 12px;
    }
    .comb-card {
      background: #fff; border: 1px solid #e2e8f0;
      border-radius: 6px; padding: 12px; text-align: center;
      break-inside: avoid;
    }
    .comb-label {
      font-size: 7px; text-transform: uppercase; letter-spacing: 0.3px;
      color: #64748b; font-weight: 600; margin-bottom: 2px;
    }
    .comb-valor {
      font-size: 15px; font-weight: 700; color: #0f172a;
    }

    /* ═══ AVISO ═══ */
    .aviso {
      background: #fef3c7; border: 1px solid #f59e0b;
      border-radius: 4px; padding: 8px 12px; margin-bottom: 12px;
      font-size: 9px; color: #92400e;
    }

    /* ═══ PRINT ═══ */
    @media print {
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      .fin-card, .chart-card, .custom-card { break-inside: avoid; }
    }
  </style>
</head>
<body>

  <!-- PÁGINA 1 — CAPA -->
  <div class="capa">
    <div class="capa-label">● Relatório Executivo</div>
    <div class="capa-titulo">${servicoNome}</div>
    <div class="capa-sub">${contratoNome}</div>
    <div class="capa-periodo">${periodoStr}</div>
    <div class="capa-data">Gerado em ${dataGeracaoStr}</div>
    <div class="capa-div"></div>

    ${dadosSuficientes ? `
    <div class="capa-resumo">
      <p>${resumoTexto}</p>
    </div>` : ''}

    ${resumoFrotaHtml}
    ${cardsKpi}
  </div>

  <!-- PÁGINA 2 — FINANCEIRO -->
  ${temFinanceira ? `
  <div class="page">
    ${header(contratoNome, servicoNome, dataGeracaoStr)}
    <h2 class="pag-titulo">Análise Financeira</h2>
    ${dadosInsuf}
    ${tabelaMargemTipo}
    ${rentabilidadeHtml}
    ${tabelaLucroPeriodo || tabelaPeriodo}
    ${g1Html}
    ${g6Html}
    ${chartsFinRow}
    ${footer(periodoStr)}
  </div>` : ''}

  <!-- PÁGINA 3 — ANÁLISE DE RECEITA -->
  ${receitaPage}

  <!-- PÁGINA 4 — ANÁLISE DE COMBUSTÍVEL -->
  ${combustivelHtml}

  <!-- PÁGINA 4 — DESEMPENHO POR VEÍCULO -->
  ${veiculosHtml}

  <!-- PÁGINA 5 — PROJEÇÃO MENSAL -->
  ${projHtml}
  ${temProjFinanceira ? `
  <div class="page">
    ${header(contratoNome, servicoNome, dataGeracaoStr)}
    <h2 class="pag-titulo">Projeção Mensal — ${p.projecaoMensalGrafico.labelMes}</h2>
    ${tabelaCenario}
    ${footer(periodoStr)}
  </div>` : ''}

  <!-- PÁGINA 6 — OPERACIONAL -->
  ${temOperacional ? `
  <div class="page">
    ${header(contratoNome, servicoNome, dataGeracaoStr)}
    <h2 class="pag-titulo">Dados Operacionais</h2>
    ${gridOp}
    ${chartsOpRow}
    ${footer(periodoStr)}
  </div>` : ''}

  <!-- PÁGINA 5 — CUSTOMIZADOS (opcional) -->
  ${customHtml}

  <script>
    document.addEventListener('DOMContentLoaded', function() {
      Chart.defaults.animation = false;

      const fmtR$ = function(v) {
        return 'R$ ' + v.toLocaleString('pt-BR', {minimumFractionDigits:2});
      };
      const fmtNum = function(v) {
        return v.toLocaleString('pt-BR', {maximumFractionDigits:0});
      };
      const ACCENT = '${ACCENT}';
      const ACCENT2 = '${ACCENT2}';
      const RED = '#dc2626';
      const AMBER = '#d97706';
      const coresTipo = ${JSON.stringify(p.coresTipoCaminhao)};

      // ═══════════════════════════════════════════
      // GRÁFICO 1: Faturamento Diário vs Custo
      // ═══════════════════════════════════════════
      var el1 = document.getElementById('c1');
      if (el1) {
        var d1 = ${JSON.stringify(p.faturamentoDiarioComCusto)};
        var labels1 = d1.map(function(d) { return d.label; });
        var ds1 = [
          { label: 'Faturamento', data: d1.map(function(d) { return d.faturamento; }), backgroundColor: ACCENT, borderRadius: 2 },
          { label: 'Custo', data: d1.map(function(d) { return d.custo; }), backgroundColor: RED, borderRadius: 2 },
        ];
        var meta = ${p.metaFaturamento !== undefined ? p.metaFaturamento : 'null'};
        if (meta !== null && meta > 0) {
          ds1.push({ label: 'Meta', data: d1.map(function() { return meta; }), type: 'line', borderColor: AMBER, borderWidth: 2, borderDash: [5,3], pointRadius: 0, fill: false });
        }
        new Chart(el1, {
          type: 'bar',
          data: { labels: labels1, datasets: ds1 },
          options: {
            animation: false, responsive: true, maintainAspectRatio: false,
            plugins: {
              legend: { position: 'top', labels: { font: { size: 9 }, boxWidth: 10, padding: 6, usePointStyle: true } },
              tooltip: {
                callbacks: {
                  label: function(ctx) { return ctx.dataset.label + ': ' + fmtR$(ctx.parsed.y); }
                },
                titleFont: { size: 9 }, bodyFont: { size: 9 }, padding: 8
              }
            },
            scales: {
              x: {
                ticks: { font: { size: 8 }, maxRotation: 45, minRotation: 0, autoSkip: true, maxTicksLimit: 15 },
                grid: { color: '#f1f5f9' }
              },
              y: {
                ticks: { font: { size: 8 }, callback: function(v) { return 'R$ ' + (v/1000).toFixed(0) + 'k'; } },
                grid: { color: '#e2e8f0' },
                beginAtZero: true
              }
            }
          }
        });
      }

      // ═══════════════════════════════════════════
      // GRÁFICO 2: Distribuição por Tipo (barras empilhadas)
      // ═══════════════════════════════════════════
      var el2 = document.getElementById('c2');
      if (el2) {
        var tipos2 = ${JSON.stringify(p.faturamentoPorTipo.map(t => t.tipo))};
        var vals2 = ${JSON.stringify(p.faturamentoPorTipo.map(t => t.faturamento))};
        var cores2 = tipos2.map(function(t) { return coresTipo[t] || '#94a3b8'; });
        new Chart(el2, {
          type: 'bar',
          data: {
            labels: [''],
            datasets: tipos2.map(function(t, i) {
              return { label: t, data: [vals2[i]], backgroundColor: cores2[i], borderRadius: 2 };
            })
          },
          options: {
            animation: false, responsive: true, maintainAspectRatio: false,
            plugins: {
              legend: { position: 'top', labels: { font: { size: 9 }, boxWidth: 10, padding: 5 } },
              tooltip: {
                callbacks: {
                  label: function(ctx) {
                    var total = vals2.reduce(function(a,b) { return a+b; }, 0);
                    var pct = total > 0 ? ((ctx.parsed.y / total) * 100).toFixed(1) : 0;
                    return ctx.dataset.label + ': ' + fmtR$(ctx.parsed.y) + ' (' + pct + '%)';
                  }
                },
                titleFont: { size: 9 }, bodyFont: { size: 9 }, padding: 8
              }
            },
            scales: {
              x: { display: false },
              y: {
                stacked: true,
                ticks: { font: { size: 8 }, callback: function(v) { return 'R$ ' + (v/1000).toFixed(0) + 'k'; } },
                grid: { color: '#e2e8f0' },
                beginAtZero: true
              }
            }
          }
        });
      }

      // ═══════════════════════════════════════════
      // GRÁFICO 3: Faturamento por Coletor (barras horizontais)
      // ═══════════════════════════════════════════
      var el3 = document.getElementById('c3');
      if (el3) {
        var d3 = ${JSON.stringify(p.faturamentoPorColetorTop10)};
        var labels3 = d3.map(function(d) { return d.coletor; });
        var vals3 = d3.map(function(d) { return d.faturamento; });
        var max3 = Math.max.apply(null, vals3);
        var bg3 = vals3.map(function(v) {
          var i = max3 > 0 ? 0.25 + (v / max3) * 0.75 : 0.5;
          return 'rgba(79,70,229,' + i.toFixed(2) + ')';
        });
        new Chart(el3, {
          type: 'bar',
          data: { labels: labels3, datasets: [{ data: vals3, backgroundColor: bg3, borderRadius: 2 }] },
          options: {
            animation: false, responsive: true, maintainAspectRatio: false,
            indexAxis: 'y',
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: { label: function(ctx) { return 'Faturamento: ' + fmtR$(ctx.parsed.x); } },
                titleFont: { size: 9 }, bodyFont: { size: 9 }, padding: 8
              }
            },
            scales: {
              x: {
                ticks: { font: { size: 8 }, callback: function(v) { return 'R$ ' + (v/1000).toFixed(0) + 'k'; } },
                grid: { color: '#e2e8f0' },
                beginAtZero: true
              },
              y: {
                ticks: { font: { size: 8 } },
                grid: { display: false }
              }
            }
          }
        });
      }

      // ═══════════════════════════════════════════
      // GRÁFICO 4: Volume com Média Móvel
      // ═══════════════════════════════════════════
      var el4 = document.getElementById('c4');
      if (el4) {
        var d4 = ${JSON.stringify(p.volumeColetaComMedia)};
        var labels4 = d4.map(function(d) { return d.label; });
        new Chart(el4, {
          type: 'line',
          data: {
            labels: labels4,
            datasets: [
              { label: 'Volume (t)', data: d4.map(function(d) { return d.valor; }), borderColor: ACCENT, backgroundColor: ACCENT + '18', fill: true, tension: 0.3, pointRadius: 3, borderWidth: 2 },
              { label: 'Média Móvel (7d)', data: d4.map(function(d) { return d.mediaMovel; }), borderColor: ACCENT2, borderWidth: 2, borderDash: [4,3], pointRadius: 3, pointStyle: 'rectRot', fill: false }
            ]
          },
          options: {
            animation: false, responsive: true, maintainAspectRatio: false,
            plugins: {
              legend: { position: 'top', labels: { font: { size: 9 }, boxWidth: 10, padding: 5 } },
              tooltip: {
                callbacks: { label: function(ctx) { return ctx.dataset.label + ': ' + ctx.parsed.y.toFixed(2) + ' t'; } },
                titleFont: { size: 9 }, bodyFont: { size: 9 }, padding: 8
              }
            },
            scales: {
              x: {
                ticks: { font: { size: 8 }, maxRotation: 45, minRotation: 0, autoSkip: true, maxTicksLimit: 20 },
                grid: { color: '#f1f5f9' }
              },
              y: {
                ticks: { font: { size: 8 }, callback: function(v) { return v.toFixed(1) + ' t'; } },
                grid: { color: '#e2e8f0' },
                beginAtZero: true
              }
            }
          }
        });
      }

      // ═══════════════════════════════════════════
      // GRÁFICO 5: Produtividade por Coletor Top 5
      // ═══════════════════════════════════════════
      var el5 = document.getElementById('c5');
      if (el5) {
        var d5 = ${JSON.stringify(p.produtividadeColetorTop10.slice(0, 5))};
        var labels5 = d5.map(function(d) { return d.coletor; });
        new Chart(el5, {
          type: 'bar',
          data: {
            labels: labels5,
            datasets: [
              { label: 'Tonelagem', data: d5.map(function(d) { return d.tonelagem; }), backgroundColor: ACCENT, borderRadius: 2 },
              { label: 'Ton/dia', data: d5.map(function(d) { return d.tonPorDia; }), backgroundColor: '#a7f3d0', borderRadius: 2 }
            ]
          },
          options: {
            animation: false, responsive: true, maintainAspectRatio: false,
            plugins: {
              legend: { position: 'top', labels: { font: { size: 9 }, boxWidth: 10, padding: 5 } },
              tooltip: {
                callbacks: { label: function(ctx) { return ctx.dataset.label + ': ' + ctx.parsed.y.toFixed(2) + ' t'; } },
                titleFont: { size: 9 }, bodyFont: { size: 9 }, padding: 8
              }
            },
            scales: {
              x: {
                ticks: { font: { size: 8 }, maxRotation: 30 },
                grid: { display: false }
              },
              y: {
                ticks: { font: { size: 8 }, callback: function(v) { return v.toFixed(1) + ' t'; } },
                grid: { color: '#e2e8f0' },
                beginAtZero: true
              }
            }
          }
        });
      }

      // ═══════════════════════════════════════════
      // GRÁFICO 6: Composição do Custo Operacional
      // ═══════════════════════════════════════════
      var el6 = document.getElementById('c6');
      if (el6) {
        var d6 = ${JSON.stringify(p.custoComposicao || [])};
        var labels6 = d6.map(function(d) { return d.label; });
        new Chart(el6, {
          type: 'bar',
          data: {
            labels: labels6,
            datasets: [
              { label: 'Abastecimentos', data: d6.map(function(d) { return d.abastecimentos; }), backgroundColor: '#059669', borderRadius: 2 },
              { label: 'Custo Estimado', data: d6.map(function(d) { return d.estimado; }), backgroundColor: '#f59e0b', borderRadius: 2 },
            ]
          },
          options: {
            animation: false, responsive: true, maintainAspectRatio: false,
            plugins: {
              legend: { position: 'top', labels: { font: { size: 9 }, boxWidth: 10, padding: 5, usePointStyle: true } },
              tooltip: {
                callbacks: {
                  label: function(ctx) {
                    return ctx.dataset.label + ': ' + fmtR$(ctx.parsed.y);
                  }
                },
                titleFont: { size: 9 }, bodyFont: { size: 9 }, padding: 8
              }
            },
            scales: {
              x: {
                stacked: true,
                ticks: { font: { size: 8 }, maxRotation: 30, autoSkip: true, maxTicksLimit: 15 },
                grid: { color: '#f1f5f9' }
              },
              y: {
                stacked: true,
                ticks: { font: { size: 8 }, callback: function(v) { return 'R$ ' + (v/1000).toFixed(0) + 'k'; } },
                grid: { color: '#e2e8f0' },
                beginAtZero: true
              }
            }
          }
        });
      }

      // ═══════════════════════════════════════════
      // GRÁFICO COMBUSTÍVEL: Evolução Diária
      // ═══════════════════════════════════════════
      var elComb = document.getElementById('c-comb');
      if (elComb) {
        var dComb = ${JSON.stringify(p.evolucaoCombustivel || [])};
        new Chart(elComb, {
          type: 'bar',
          data: {
            labels: dComb.map(function(d) { return d.label; }),
            datasets: [
              {
                label: 'Litros',
                data: dComb.map(function(d) { return d.litros; }),
                backgroundColor: '#3b82f6',
                borderRadius: 2,
                order: 2,
                yAxisID: 'y'
              },
              {
                label: 'Valor (R$)',
                data: dComb.map(function(d) { return d.valor; }),
                backgroundColor: '#f59e0b',
                borderRadius: 2,
                order: 2,
                yAxisID: 'y1'
              }
            ]
          },
          options: {
            animation: false, responsive: true, maintainAspectRatio: false,
            plugins: {
              legend: { position: 'top', labels: { font: { size: 9 }, boxWidth: 10, padding: 5, usePointStyle: true } },
              tooltip: {
                callbacks: {
                  label: function(ctx) {
                    if (ctx.dataset.label === 'Litros') return 'Litros: ' + ctx.parsed.y.toFixed(1) + ' L';
                    return 'Valor: ' + fmtR$(ctx.parsed.y);
                  }
                },
                titleFont: { size: 9 }, bodyFont: { size: 9 }, padding: 8
              }
            },
            scales: {
              x: { ticks: { font: { size: 8 }, maxRotation: 45, autoSkip: true, maxTicksLimit: 15 }, grid: { color: '#f1f5f9' } },
              y: { position: 'left', ticks: { font: { size: 8 }, callback: function(v) { return v.toFixed(0) + ' L'; } }, grid: { color: '#e2e8f0' }, beginAtZero: true },
              y1: { position: 'right', grid: { display: false }, ticks: { font: { size: 8 }, callback: function(v) { return 'R$ ' + (v/1000).toFixed(0) + 'k'; } } }
            }
          }
        });
      }

      // ═══════════════════════════════════════════
      // GRÁFICO PROJEÇÃO MENSAL (com custo projetado)
      // ═══════════════════════════════════════════
      var elProj = document.getElementById('c-proj');
      if (elProj) {
        var proj = ${JSON.stringify(p.projecaoMensalGrafico)};
        var diasP = proj.dias;
        var dsProj = [];
        if (proj.reais.length > 0) {
          dsProj.push({
            label: 'Faturamento Real',
            data: diasP.map(function(d, i) { return i < proj.reais.length ? proj.reais[i] : null; }),
            borderColor: ACCENT, backgroundColor: ACCENT + '15', fill: true, tension: 0.3,
            pointRadius: 2, borderWidth: 2
          });
        }
        if (proj.projetados.length > 0 && proj.projetados.some(function(v) { return v > 0; })) {
          dsProj.push({
            label: 'Projeção Faturamento',
            data: proj.projetados,
            borderColor: ACCENT, borderWidth: 2, borderDash: [5,3],
            pointRadius: 0, fill: false, tension: 0.2
          });
        }
        if (proj.meta !== null && proj.meta !== undefined && proj.meta > 0) {
          dsProj.push({
            label: 'Meta',
            data: diasP.map(function() { return proj.meta; }),
            borderColor: RED, borderWidth: 2, borderDash: [3,3], pointRadius: 0, fill: false
          });
        }
        // ═══ CUSTO ACUMULADO PROJETADO ═══
        var dadosCusto = ${JSON.stringify((p.lucroPorPeriodo || []).map(l => l.custo))};
        var custoAcumulado = [];
        var somaCusto = 0;
        for (var ci = 0; ci < diasP.length; ci++) {
          if (ci < dadosCusto.length) {
            somaCusto += dadosCusto[ci];
            custoAcumulado.push(somaCusto);
          } else {
            custoAcumulado.push(null);
          }
        }
        if (custoAcumulado.some(function(v) { return v !== null && v > 0; })) {
          dsProj.push({
            label: 'Custo Acumulado',
            data: custoAcumulado,
            borderColor: '#dc2626', borderWidth: 2, borderDash: [4,2],
            pointRadius: 2, fill: false, tension: 0.3
          });
        }
        new Chart(elProj, {
          type: 'line',
          data: { labels: diasP.map(function(d) { return 'Dia ' + d; }), datasets: dsProj },
          options: {
            animation: false, responsive: true, maintainAspectRatio: false,
            plugins: {
              legend: { position: 'top', labels: { font: { size: 9 }, boxWidth: 10, padding: 5, usePointStyle: true } },
              tooltip: {
                callbacks: {
                  label: function(ctx) {
                    if (ctx.parsed.y === null) return '';
                    var prefix = ctx.dataset.label === 'Meta' ? '' : '';
                    return ctx.dataset.label + ': ' + fmtR$(ctx.parsed.y);
                  }
                },
                titleFont: { size: 9 }, bodyFont: { size: 9 }, padding: 8
              }
            },
            scales: {
              x: {
                ticks: { font: { size: 8 }, maxRotation: 45, autoSkip: true, maxTicksLimit: 31 },
                grid: { color: '#f1f5f9' }
              },
              y: {
                ticks: { font: { size: 8 }, callback: function(v) { return 'R$ ' + (v/1000).toFixed(0) + 'k'; } },
                grid: { color: '#e2e8f0' },
                beginAtZero: true
              }
            }
          }
        });
      }

      // ═══════════════════════════════════════════
      // NOVOS GRÁFICOS DE RECEITA
      // ═══════════════════════════════════════════

      // GRÁFICO: Receita por KM Diário
      var elRecKm = document.getElementById('c-rec-km');
      if (elRecKm) {
        var dRecKm = ${JSON.stringify(p.receitaKmDiario || [])};
        new Chart(elRecKm, {
          type: 'line',
          data: {
            labels: dRecKm.map(function(d) { return d.label; }),
            datasets: [{
              label: 'R$/km',
              data: dRecKm.map(function(d) { return d.valor; }),
              borderColor: '#7c3aed', backgroundColor: '#7c3aed15', fill: true,
              tension: 0.3, pointRadius: 3, borderWidth: 2
            }]
          },
          options: {
            animation: false, responsive: true, maintainAspectRatio: false,
            plugins: {
              legend: { position: 'top', labels: { font: { size: 9 }, boxWidth: 10, padding: 5 } },
              tooltip: {
                callbacks: { label: function(ctx) { return 'R$/km: ' + ctx.parsed.y.toFixed(2); } },
                titleFont: { size: 9 }, bodyFont: { size: 9 }, padding: 8
              }
            },
            scales: {
              x: { ticks: { font: { size: 8 }, maxRotation: 30, autoSkip: true, maxTicksLimit: 15 }, grid: { color: '#f1f5f9' } },
              y: { ticks: { font: { size: 8 }, callback: function(v) { return 'R$ ' + v.toFixed(2); } }, grid: { color: '#e2e8f0' }, beginAtZero: true }
            }
          }
        });
      }

      // GRÁFICO: Receita por Hora Diário
      var elRecHora = document.getElementById('c-rec-hora');
      if (elRecHora) {
        var dRecHora = ${JSON.stringify(p.receitaHoraDiario || [])};
        new Chart(elRecHora, {
          type: 'line',
          data: {
            labels: dRecHora.map(function(d) { return d.label; }),
            datasets: [{
              label: 'R$/h',
              data: dRecHora.map(function(d) { return d.valor; }),
              borderColor: '#0891b2', backgroundColor: '#0891b215', fill: true,
              tension: 0.3, pointRadius: 3, borderWidth: 2
            }]
          },
          options: {
            animation: false, responsive: true, maintainAspectRatio: false,
            plugins: {
              legend: { position: 'top', labels: { font: { size: 9 }, boxWidth: 10, padding: 5 } },
              tooltip: {
                callbacks: { label: function(ctx) { return 'R$/h: ' + ctx.parsed.y.toFixed(2); } },
                titleFont: { size: 9 }, bodyFont: { size: 9 }, padding: 8
              }
            },
            scales: {
              x: { ticks: { font: { size: 8 }, maxRotation: 30, autoSkip: true, maxTicksLimit: 15 }, grid: { color: '#f1f5f9' } },
              y: { ticks: { font: { size: 8 }, callback: function(v) { return 'R$ ' + v.toFixed(2); } }, grid: { color: '#e2e8f0' }, beginAtZero: true }
            }
          }
        });
      }

      // GRÁFICO: Ranking Motoristas (barras horizontais)
      var elRecMotorista = document.getElementById('c-rec-motorista');
      if (elRecMotorista) {
        var dRecMot = ${JSON.stringify(p.rankingMotoristas || [])};
        var labelsMot = dRecMot.map(function(d) { return d.motorista; });
        var valsMot = dRecMot.map(function(d) { return d.faturamento; });
        var maxMot = Math.max.apply(null, valsMot);
        var bgMot = valsMot.map(function(v) {
          var i = maxMot > 0 ? 0.25 + (v / maxMot) * 0.75 : 0.5;
          return 'rgba(5,150,105,' + i.toFixed(2) + ')';
        });
        new Chart(elRecMotorista, {
          type: 'bar',
          data: { labels: labelsMot, datasets: [{ data: valsMot, backgroundColor: bgMot, borderRadius: 2 }] },
          options: {
            animation: false, responsive: true, maintainAspectRatio: false,
            indexAxis: 'y',
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: { label: function(ctx) { return 'Faturamento: ' + fmtR$(ctx.parsed.x); } },
                titleFont: { size: 9 }, bodyFont: { size: 9 }, padding: 8
              }
            },
            scales: {
              x: { ticks: { font: { size: 8 }, callback: function(v) { return 'R$ ' + (v/1000).toFixed(0) + 'k'; } }, grid: { color: '#e2e8f0' }, beginAtZero: true },
              y: { ticks: { font: { size: 8 } }, grid: { display: false } }
            }
          }
        });
      }

      // GRÁFICO: Receita por Regional
      var elRecRegional = document.getElementById('c-rec-regional');
      if (elRecRegional) {
        var dRecReg = ${JSON.stringify(p.receitaPorRegional || [])};
        new Chart(elRecRegional, {
          type: 'bar',
          data: {
            labels: dRecReg.map(function(d) { return d.regional; }),
            datasets: [{
              label: 'Faturamento',
              data: dRecReg.map(function(d) { return d.faturamento; }),
              backgroundColor: '#6366f1', borderRadius: 2
            }]
          },
          options: {
            animation: false, responsive: true, maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: { label: function(ctx) { return 'Faturamento: ' + fmtR$(ctx.parsed.y); } },
                titleFont: { size: 9 }, bodyFont: { size: 9 }, padding: 8
              }
            },
            scales: {
              x: { ticks: { font: { size: 8 }, maxRotation: 30 }, grid: { display: false } },
              y: { ticks: { font: { size: 8 }, callback: function(v) { return 'R$ ' + (v/1000).toFixed(0) + 'k'; } }, grid: { color: '#e2e8f0' }, beginAtZero: true }
            }
          }
        });
      }

      // GRÁFICO: Receita por Dia da Semana
      var elRecDia = document.getElementById('c-rec-dia');
      if (elRecDia) {
        var dRecDia = ${JSON.stringify(p.receitaPorDiaSemana || [])};
        var coresDia = ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#6366f1','#a855f7'];
        new Chart(elRecDia, {
          type: 'bar',
          data: {
            labels: dRecDia.map(function(d) { return d.diaNome; }),
            datasets: [{
              label: 'Faturamento',
              data: dRecDia.map(function(d) { return d.faturamento; }),
              backgroundColor: dRecDia.map(function(_, i) { return coresDia[i % 7]; }),
              borderRadius: 2
            }]
          },
          options: {
            animation: false, responsive: true, maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: { label: function(ctx) { return 'Faturamento: ' + fmtR$(ctx.parsed.y); } },
                titleFont: { size: 9 }, bodyFont: { size: 9 }, padding: 8
              }
            },
            scales: {
              x: { ticks: { font: { size: 8 } }, grid: { display: false } },
              y: { ticks: { font: { size: 8 }, callback: function(v) { return 'R$ ' + (v/1000).toFixed(0) + 'k'; } }, grid: { color: '#e2e8f0' }, beginAtZero: true }
            }
          }
        });
      }

      // GRÁFICO: Receita por Turno
      var elRecTurno = document.getElementById('c-rec-turno');
      if (elRecTurno) {
        var dRecTurno = ${JSON.stringify(p.receitaPorTurno || [])};
        new Chart(elRecTurno, {
          type: 'doughnut',
          data: {
            labels: dRecTurno.map(function(d) { return d.turno; }),
            datasets: [{
              data: dRecTurno.map(function(d) { return d.faturamento; }),
              backgroundColor: ['#22c55e', '#3b82f6', '#f59e0b', '#a855f7'],
              borderWidth: 0
            }]
          },
          options: {
            animation: false, responsive: true, maintainAspectRatio: false,
            cutout: '45%',
            plugins: {
              legend: { position: 'bottom', labels: { font: { size: 9 }, boxWidth: 10, padding: 5 } },
              tooltip: {
                callbacks: {
                  label: function(ctx) {
                    var total = ctx.dataset.data.reduce(function(a,b) { return a+b; }, 0);
                    var pct = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : 0;
                    return ctx.label + ': ' + fmtR$(ctx.parsed) + ' (' + pct + '%)';
                  }
                },
                titleFont: { size: 9 }, bodyFont: { size: 9 }, padding: 8
              }
            }
          }
        });
      }
    });
  </script>
</body>
</html>`;
}

/* ═══ HELPERS ═══ */

function header(contrato: string, servico: string, data: string): string {
  return `<div class="p-header"><strong>${contrato}</strong> • ${servico}<span>${data}</span></div>`;
}

function footer(periodo: string): string {
  return `<div class="p-footer"><span>Relatório Executivo</span><span>${periodo}</span></div>`;
}

function gerarCardFinanceiro(
  label: string,
  data: { valor: number; formatado: string; variacao: number; tipoVariacao: string; meta?: number },
  _cor: string
): string {
  // Não usado diretamente — mantido por compatibilidade
  const seta = data.tipoVariacao === 'aumento' ? '▲' : data.tipoVariacao === 'reducao' ? '▼' : '◆';
  const corVar = data.tipoVariacao === 'aumento' ? '#059669' : data.tipoVariacao === 'reducao' ? '#dc2626' : '#64748b';
  return `<div class="fin-card"><div class="fin-label">${label}</div><div class="fin-valor">${data.formatado}</div><div class="fin-var" style="color:${corVar}">${seta} ${data.tipoVariacao === 'estavel' ? '0%' : (data.tipoVariacao === 'aumento' ? '+' : '') + data.variacao.toFixed(1) + '%'}</div></div>`;
}

function gerarFraseFinanceira(p: PdfExecutivoParams): string {
  const fat = p.faturamentoTotal;
  const varStr = fat.tipoVariacao === 'aumento' ? 'aumento de' : fat.tipoVariacao === 'reducao' ? 'redução de' : 'estabilidade em';
  return `O faturamento total do período foi de ${fat.formatado}, registrando ${varStr} ${Math.abs(fat.variacao).toFixed(1)}% em relação ao período anterior.`;
}

function gerarFraseOperacional(p: PdfExecutivoParams): string {
  const op = p.indicadoresOperacionais;
  const partes: string[] = [];
  if (op.viagens > 0) partes.push(`${op.viagens.toLocaleString('pt-BR')} viagens realizadas`);
  if (op.coletores > 0) partes.push(`${op.coletores} coletores ativos`);
  if (op.kmRodados > 0) partes.push(`${op.kmRodados.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} km rodados`);
  if (partes.length === 0) return 'Dados operacionais insuficientes para análise no período selecionado.';
  return `No período, foram registradas ${partes.join(', ')}, com produtividade média de ${op.produtividadeColetor.toFixed(2)} t por coletor.`;
}
