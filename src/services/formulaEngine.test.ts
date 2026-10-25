import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcularExpressao,
  calcularKpiComFormula,
  validarExpressao,
  parseNumeroBr,
  normalizarChave,
  corrigirFormulaHorasLegada,
  encontrarValorColuna,
} from './FormulaEngine';

const dadosColeta = [
  {
    'PESO TOTAL': 10,
    'KM TOTAL': 50,
    'COLETOR 01': 'João',
    'COLETOR 02': 'Maria',
    'HORA SAIDA BASE': 8,
    'HORA CHEGADA BASE': 12,
    validoDashboard: true,
  },
  {
    'PESO TOTAL': 20,
    'KM TOTAL': 80,
    'COLETOR 01': 'João',
    'COLETOR 02': '',
    'HORA SAIDA BASE': 13,
    'HORA CHEGADA BASE': 17.5,
    validoDashboard: true,
  },
  {
    'PESO TOTAL': 5,
    'KM TOTAL': 10,
    validoDashboard: false,
  },
];

const dadosMotoristas = [
  { MOTORISTA: 'Carlos', validoDashboard: true },
  { MOTORISTA: 'Carlos', validoDashboard: true },
  { MOTORISTA: 'Ana', validoDashboard: false },
];

describe('FormulaEngine — funções básicas', () => {
  it('parseNumeroBr converte formato brasileiro', () => {
    assert.equal(parseNumeroBr('1.234,56'), 1234.56);
    assert.equal(parseNumeroBr('1234,56'), 1234.56);
    assert.equal(parseNumeroBr('1.234.567,89'), 1234567.89);
    assert.equal(parseNumeroBr('1234.56'), 1234.56);
    assert.equal(parseNumeroBr('485.073'), 485.073);
    assert.equal(parseNumeroBr('42'), 42);
    assert.equal(parseNumeroBr(1234.56), 1234.56);
    assert.ok(Number.isNaN(parseNumeroBr(null)));
    assert.ok(Number.isNaN(parseNumeroBr('')));
  });

  it('normalizarChave remove acentos e espaços', () => {
    assert.equal(normalizarChave('Peso Total'), 'PESOTOTAL');
    assert.equal(normalizarChave('COLETOR 01'), 'COLETOR01');
  });

  it('validarExpressao aceita SUM simples', () => {
    const r = validarExpressao('SUM(PESO TOTAL)');
    assert.equal(r.valido, true);
  });
});

describe('FormulaEngine — agregações', () => {
  it('SUM soma coluna numérica', () => {
    const { valor } = calcularExpressao('SUM(PESO TOTAL)', { dados: dadosColeta, valoresFixos: {} });
    assert.equal(valor, 35);
  });

  it('AVG calcula média', () => {
    const { valor } = calcularExpressao('AVG(KM TOTAL)', { dados: dadosColeta, valoresFixos: {} });
    assert.equal(valor, 46.67);
  });

  it('COUNT conta registros', () => {
    const { valor } = calcularExpressao('COUNT(*)', { dados: dadosColeta, valoresFixos: {} });
    assert.equal(valor, 3);
  });
});

describe('FormulaEngine — funções especiais de coleta', () => {
  it('VIAGENS_VALIDADAS conta apenas validoDashboard=true', () => {
    const { valor } = calcularExpressao('VIAGENS_VALIDADAS()', { dados: dadosColeta, valoresFixos: {} });
    assert.equal(valor, 2);
  });

  it('VIAGENS_REALIZADAS é alias de VIAGENS_VALIDADAS', () => {
    const { valor } = calcularExpressao('VIAGENS_REALIZADAS()', { dados: dadosColeta, valoresFixos: {} });
    assert.equal(valor, 2);
  });

  it('MOTORISTAS_UNICOS conta motoristas distintos', () => {
    const { valor } = calcularExpressao('MOTORISTAS_UNICOS()', { dados: dadosMotoristas, valoresFixos: {} });
    assert.equal(valor, 2);
  });

  it('COLETORES_UNICOS conta nomes distintos', () => {
    const { valor } = calcularExpressao('COLETORES_UNICOS()', { dados: dadosColeta, valoresFixos: {} });
    assert.equal(valor, 2);
  });

  it('HORAS_PRODUTIVAS soma duração entre saída e chegada', () => {
    const { valor } = calcularExpressao(
      'HORAS_PRODUTIVAS(HORA SAIDA BASE, HORA CHEGADA BASE)',
      { dados: dadosColeta, valoresFixos: {} },
    );
    assert.ok(valor > 8 && valor < 9.5, `esperado ~8.5h, obtido ${valor}`);
  });
});

describe('FormulaEngine — transformações', () => {
  it('DIVIDE retorna 0 quando denominador é zero', () => {
    const { valor } = calcularExpressao('DIVIDE(10, 0)', { dados: dadosColeta, valoresFixos: {} });
    assert.equal(valor, 0);
  });

  it('DIVIDE divide corretamente', () => {
    const { valor } = calcularExpressao('DIVIDE(SUM(PESO TOTAL), SUM(KM TOTAL))', {
      dados: dadosColeta,
      valoresFixos: {},
    });
    assert.ok(Math.abs(valor - 35 / 140) < 0.01);
  });

  it('ROUND arredonda resultado', () => {
    const { valor } = calcularExpressao('ROUND(DIVIDE(SUM(PESO TOTAL), 3), 1)', {
      dados: dadosColeta,
      valoresFixos: {},
    });
    assert.equal(valor, 11.7);
  });

  it('calcularKpiComFormula é atalho para calcularExpressao', () => {
    const v = calcularKpiComFormula('SUM(PESO TOTAL)', dadosColeta);
    assert.equal(v, 35);
  });
});

describe('kpiCalculoServicoService — resolvers de fórmula', async () => {
  const {
    resolverExpressaoKpiViagensRealizadas,
    resolverExpressaoKpiContadorViagens,
    resolverExpressaoKpiMotoristas,
  } = await import('./kpiCalculoServicoService');

  it('Viagens Realizadas mantém VIAGENS_VALIDADAS()', () => {
    const expr = resolverExpressaoKpiViagensRealizadas(
      { nome: 'Viagens', label: 'Viagens Realizadas', expressao: 'VIAGENS_VALIDADAS()' },
      'VIAGENS_VALIDADAS()',
    );
    assert.equal(expr, 'VIAGENS_VALIDADAS()');
  });

  it('Viagens Realizadas corrige alias legado VIAGENS_REALIZADAS()', () => {
    const expr = resolverExpressaoKpiViagensRealizadas(
      { label: 'Viagens Realizadas', expressao: 'VIAGENS_REALIZADAS()' },
      'VIAGENS_REALIZADAS()',
    );
    assert.equal(expr, 'VIAGENS_VALIDADAS()');
  });

  it('Total de Viagens (Contador) corrige SUM legado para VIAGENS_POR_ROTA()', () => {
    const expr = resolverExpressaoKpiContadorViagens(
      { label: 'Total de Viagens (Contador)', expressao: 'SUM(CONTADOR DE VIAGENS)' },
      'SUM(CONTADOR DE VIAGENS)',
    );
    assert.equal(expr, 'VIAGENS_POR_ROTA()');
  });

  it('Total de Motoristas usa MOTORISTAS_UNICOS()', () => {
    const expr = resolverExpressaoKpiMotoristas(
      { nome: 'Total de Motoristas', label: 'Total de Motoristas', expressao: 'COUNT(DISTINCT MOTORISTA)' },
      'COUNT(DISTINCT MOTORISTA)',
    );
    assert.equal(expr, 'MOTORISTAS_UNICOS()');
  });

  it('Peso/Coletor legado usa ton total ÷ coletores únicos', async () => {
    const { resolverExpressaoKpiPesoColetor, EXPRESSAO_TON_POR_COLETOR_UNICO } = await import('./kpiCalculoServicoService');
    const expr = resolverExpressaoKpiPesoColetor(
      { label: 'Peso/Coletor', expressao: 'DIVIDE(SUM(PESO TOTAL), SUM(Nº DE COLETORES))' },
      'DIVIDE(SUM(PESO TOTAL), SUM(Nº DE COLETORES))',
    );
    assert.equal(expr, EXPRESSAO_TON_POR_COLETOR_UNICO);
  });

  it('Média Ton/Coletor por Viagem mantém MEDIA_TON_POR_COLETOR()', async () => {
    const { resolverExpressaoKpiPesoColetor } = await import('./kpiCalculoServicoService');
    const expr = resolverExpressaoKpiPesoColetor(
      { label: 'Média Ton/Coletor por Viagem', expressao: 'MEDIA_TON_POR_COLETOR()' },
      'MEDIA_TON_POR_COLETOR()',
    );
    assert.equal(expr, 'MEDIA_TON_POR_COLETOR()');
  });

  it('Ton/Coletor = tonelagem total ÷ coletores ativos (placas)', async () => {
    const { ajustarKpisColetorConsolidada } = await import('./kpiCalculoServicoService');
    const kpis = [
      { id: 'peso-col', nome: 'Peso/Coletor', valor: 86, formatado: '86', formato: 'numero' },
    ];
    const ajustados = ajustarKpisColetorConsolidada(kpis, [], {
      pesoTotalTon: 306,
      qtdColetores: 17,
    });
    assert.equal(ajustados[0]?.valor, 18);
    assert.equal(ajustados[0]?.nome, 'Ton/Coletor');
  });

  it('Ton/Coletor via placas distintas quando sem métricas agregadas', async () => {
    const { ajustarKpisColetorConsolidada } = await import('./kpiCalculoServicoService');
    const dados = [
      { 'PESO TOTAL': 100000, PLACA: 'ABC1D23', validoDashboard: true },
      { 'PESO TOTAL': 80000, PLACA: 'XYZ9W87', validoDashboard: true },
    ];
    const kpis = [
      { id: 'peso-col', nome: 'Peso/Coletor', valor: 86, formatado: '86', formato: 'numero' },
    ];
    const ajustados = ajustarKpisColetorConsolidada(kpis, dados);
    assert.equal(ajustados[0]?.valor, 90);
  });

  it('MEDIA_TON_POR_COLETOR divide peso em ton pelas participações', () => {
    const dados = [
      { 'PESO TOTAL': 10000, 'Nº DE COLETORES': 2, validoDashboard: true },
      { 'PESO TOTAL': 8000, 'Nº DE COLETORES': 2, validoDashboard: true },
    ];
    const errado = calcularExpressao('DIVIDE(SUM(PESO TOTAL), SUM(Nº DE COLETORES))', { dados, valoresFixos: {} }).valor;
    const certo = calcularExpressao('MEDIA_TON_POR_COLETOR()', { dados, valoresFixos: {} }).valor;
    assert.equal(errado, 4500);
    assert.equal(certo, 4.5);
  });
});

describe('ajustarKpisContagemDistintaConsolidada', async () => {
  const { ajustarKpisContagemDistintaConsolidada } = await import('./kpiCalculoServicoService');

  it('recalcula Total de Motoristas no dataset consolidado multi-serviço', () => {
    const dados = [
      { MOTORISTA: 'Ana' },
      { MOTORISTA: 'Bruno' },
      { MOTORISTA: 'Ana' },
    ];
    const kpis = [
      { id: 'uni:1', nome: 'Total de Motoristas', valor: 0, formatado: '0', formato: 'numero' },
      { id: 'padrao_coleta_kpi_5', nome: 'Motoristas Ativos', valor: 0, formatado: '0', formato: 'numero' },
      { id: 'kpi-ton', nome: 'Tonelagem Total', valor: 100, formatado: '100', formato: 'numero' },
    ];
    const ajustados = ajustarKpisContagemDistintaConsolidada(kpis, dados);
    const total = ajustados.find((k) => k.nome === 'Total de Motoristas');
    const ativos = ajustados.find((k) => k.nome === 'Motoristas Ativos');
    const ton = ajustados.find((k) => k.nome === 'Tonelagem Total');
    assert.equal(total?.valor, 2);
    assert.equal(ativos?.valor, 2);
    assert.equal(ton?.valor, 100);
  });
});

describe('ajustarKpisFaturamentoCicloConsolidada', async () => {
  const {
    ehKpiFaturamentoEstimadoCiclo,
    ajustarKpisFaturamentoCicloConsolidada,
  } = await import('./kpiCalculoServicoService');

  it('identifica KPI Faturamento Estimado e não Receita/Km', () => {
    assert.equal(
      ehKpiFaturamentoEstimadoCiclo({ label: 'Faturamento Estimado', expressao: 'FATURAMENTO_EST(PESO TOTAL, TIPO CAMINHAO)' }),
      true,
    );
    assert.equal(
      ehKpiFaturamentoEstimadoCiclo({
        label: 'Receita por Km',
        expressao: 'DIVIDE(FATURAMENTO_EST(PESO TOTAL, TIPO CAMINHAO), SUM(KM TOTAL))',
      }),
      false,
    );
  });

  it('recalcula Faturamento Estimado com dados do ciclo consolidado', () => {
    const dadosCiclo = [
      { 'PESO TOTAL': 10000, 'TIPO DE CAMINHÃO': 'TRUCK', validoDashboard: true, 'DATA SAIDA': '2026-06-01' },
      { 'PESO TOTAL': 5000, 'TIPO DE CAMINHÃO': 'MINI', validoDashboard: true, 'DATA SAIDA': '2026-06-02' },
    ];
    const valoresFixos = { VALOR_TRUCK: 100, VALOR_MINI: 80, VALOR_GERAL: 90 };
    const kpis = [
      { id: 'fat-est', nome: 'Faturamento Estimado', valor: 70400, formatado: 'R$ 70.400,00', formato: 'moeda' },
      { id: 'rec-km', nome: 'Receita por Km', valor: 12, formatado: 'R$ 12,00', formato: 'moeda' },
    ];
    const defs = new Map([
      ['fat-est', { label: 'Faturamento Estimado', expressao: 'FATURAMENTO_EST(PESO TOTAL, TIPO CAMINHAO)', formato: 'moeda' }],
    ]);
    const ajustados = ajustarKpisFaturamentoCicloConsolidada(
      kpis,
      dadosCiclo,
      valoresFixos,
      defs,
      [],
      { dataInicio: '2026-06-01', dataFim: '2026-06-30', hoje: new Date(2026, 5, 15, 12, 0, 0) },
    );
    const fat = ajustados.find((k) => k.nome === 'Faturamento Estimado');
    const recKm = ajustados.find((k) => k.nome === 'Receita por Km');
    assert.equal(fat?.faturamentoRealizado, 1400);
    assert.ok((fat?.faturamentoProjetado ?? 0) > 1400);
    assert.equal(fat?.ehProjecaoCiclo, true);
    assert.equal(recKm?.valor, 12);
  });
});

describe('calcularProjecaoFaturamentoCiclo', async () => {
  const { calcularProjecaoFaturamentoCiclo, contarDiasComDadosOperacionais } = await import('./projecaoFaturamentoCicloService');
  const hojeNoCiclo = new Date(2026, 5, 15, 12, 0, 0);

  it('projeta pela média dos dias corridos, não só dos dias com dados', () => {
    const proj = calcularProjecaoFaturamentoCiclo(
      128139,
      [
        { 'DATA SAIDA': '2026-06-01' },
        { 'DATA SAIDA': '2026-06-02' },
      ],
      '2026-06-01',
      '2026-06-30',
      hojeNoCiclo,
    );
    assert.equal(proj.realizado, 128139);
    assert.equal(proj.diasComDados, 2);
    assert.equal(proj.diasTotaisCiclo, 30);
    assert.equal(proj.diasDecorridos, 15);
    assert.equal(proj.mediaDiaria, 8542.6);
    assert.equal(proj.projetado, 256278);
    assert.equal(proj.cicloEmAndamento, true);
    assert.notEqual(proj.mediaDiaria, 64069.5);
  });

  it('ciclo encerrado devolve o realizado, com data fixa', () => {
    const proj = calcularProjecaoFaturamentoCiclo(
      1400,
      [{ 'DATA SAIDA': '2026-06-01' }, { 'DATA SAIDA': '2026-06-02' }],
      '2026-06-01',
      '2026-06-30',
      new Date(2026, 6, 2, 12, 0, 0),
    );
    assert.equal(proj.cicloEmAndamento, false);
    assert.equal(proj.projetado, 1400);
    assert.equal(proj.realizado, 1400);
  });

  it('célula vazia e valor brasileiro não criam dia operacional', () => {
    assert.equal(contarDiasComDadosOperacionais([
      { 'DATA SAIDA': '' },
      { 'DATA SAIDA': null },
      { 'DATA SAIDA': '1.234,56' },
      { 'DATA SAIDA': '02/06/2026' },
      { 'DATA SAIDA': '02/06/2026' },
    ]), 1);
  });

  it('virada do dia de referência entra no decorrido e o dia seguinte não', () => {
    const noDia10 = calcularProjecaoFaturamentoCiclo(
      300,
      [{ 'DATA SAIDA': '2026-06-01' }],
      '2026-06-01',
      '2026-06-30',
      new Date(2026, 5, 10, 23, 30, 0),
    );
    const noDia11 = calcularProjecaoFaturamentoCiclo(
      300,
      [{ 'DATA SAIDA': '2026-06-01' }],
      '2026-06-01',
      '2026-06-30',
      new Date(2026, 5, 11, 0, 30, 0),
    );
    assert.equal(noDia10.diasDecorridos, 10);
    assert.equal(noDia11.diasDecorridos, 11);
  });
});

describe('horas e KM nos KPIs', async () => {
  const { encontrarColunaKmDistancia } = await import('./AutoIndicatorService');

  it('coluna de KM da varrição não é o hodômetro', () => {
    const cols = [
      { nome: 'KM SAIDA BASE' },
      { nome: 'KM CHEGADA ROTA 01' },
      { nome: 'KM Linear' },
    ];
    assert.equal(
      encontrarColunaKmDistancia(cols, ['KM TOTAL', 'KM', 'KM LINEAR', 'QUILOMETROS_VARRIDOS']),
      'KM Linear',
    );
    assert.equal(
      encontrarColunaKmDistancia([{ nome: 'KM SAIDA BASE' }, { nome: 'KM TOTAL' }], ['KM', 'KM TOTAL']),
      'KM TOTAL',
    );
  });

  it('não troca SUM de relógio quando ele ainda é o denominador', () => {
    const expr = 'DIVIDE(SUM(HORA CHEGADA BASE) - SUM(HORA SAIDA BASE), SUM(HORA CHEGADA BASE)) * 100';
    assert.equal(corrigirFormulaHorasLegada(expr), expr);
    const duracao = 'DIVIDE(FATURAMENTO_EST(PESO TOTAL, TIPO CAMINHAO), SUM(HORA CHEGADA BASE) - SUM(HORA SAIDA BASE))';
    assert.match(corrigirFormulaHorasLegada(duracao), /HORAS_PRODUTIVAS\(HORA SAIDA BASE, HORA CHEGADA BASE\)/);
  });

  it('fórmula antiga de rota não conta a virada como quase 24h', () => {
    const dados = [{
      'HORA CHEGADA ROTA 01': 8 / 24,
      'HORA SAÍDA ROTA 01': 10 / 24,
    }];
    const legado = 'HORAS_PRODUTIVAS(HORA SAÍDA ROTA 01, HORA CHEGADA ROTA 01)';
    assert.match(corrigirFormulaHorasLegada(legado), /HORA CHEGADA ROTA 01, HORA SAÍDA ROTA 01/);
    const { valor } = calcularExpressao(legado, { dados, valoresFixos: {} });
    assert.equal(valor, 2);
  });

  it('jornada com virada de dia soma 4h, não 20h', () => {
    const { valor } = calcularExpressao(
      'HORAS_PRODUTIVAS(HORA SAIDA BASE, HORA CHEGADA BASE)',
      {
        dados: [{ 'HORA SAIDA BASE': 22 / 24, 'HORA CHEGADA BASE': 2 / 24 }],
        valoresFixos: {},
      },
    );
    assert.equal(valor, 4);
  });

  it('SUM(KM TOTAL) não lê hodômetro de KM SAIDA BASE', () => {
    const linha = {
      'KM SAIDA BASE': 82401,
      'KM CHEGADA BASE': 82452,
      'KM ROTA 01': 12,
    };
    assert.equal(encontrarValorColuna(linha, 'KM TOTAL'), undefined);
    const { valor } = calcularExpressao('SUM(KM TOTAL)', { dados: [linha], valoresFixos: {} });
    assert.equal(valor, 0);
    const comTotal = { ...linha, 'KM TOTAL': '1.234,56' };
    const soma = calcularExpressao('SUM(KM TOTAL)', { dados: [comTotal], valoresFixos: {} });
    assert.equal(soma.valor, 1234.56);
  });
});

describe('contarViagensValidadas', () => {
  it('conta viagens quando só _validoDashboard está presente (objeto plano)', async () => {
    const { contarViagensValidadas } = await import('./viagensPorRotaService');
    const dados = [
      { 'PESO TOTAL': 5000, 'KM TOTAL': 40, _validoDashboard: true, 'PESO 1': 2500, 'PESO 2': 2500 },
      { 'PESO TOTAL': 3000, 'KM TOTAL': 20, _validoDashboard: true, 'PESO 1': 3000 },
    ];
    assert.equal(contarViagensValidadas(dados), 3);
  });

  it('VIAGENS_VALIDADAS() usa contagem corrigida', () => {
    const dados = [
      { 'PESO TOTAL': 5000, 'KM TOTAL': 40, validoDashboard: true, 'CONTADOR DE VIAGENS': 2 },
    ];
    const { valor } = calcularExpressao('VIAGENS_VALIDADAS()', { dados, valoresFixos: {} });
    assert.equal(valor, 2);
  });
});

describe('corrigirViagemAutomatica', () => {
  it('preenche KM Total a partir das rotas e valida a viagem', async () => {
    const { ColetaData } = await import('../entities/ColetaData');
    const { prepararViagemParaImportacao } = await import('./validacaoViagemService');
    const coleta = new ColetaData();
    coleta.dataSaida = new Date(Date.UTC(2026, 5, 10));
    coleta.placa = 'ABC1D23';
    coleta.pesoTotal = 12000;
    coleta.kmRota1 = 45;
    coleta.kmRota2 = 30;
    coleta.dados = {
      'DATA SAIDA': '10/06/2026',
      'PLACA': 'ABC1D23',
      'PESO TOTAL': 12000,
      'KM ROTA 01': 45,
      'KM ROTA 02': 30,
    };

    const r = prepararViagemParaImportacao(coleta);
    assert.equal(r.validoDashboard, true);
    assert.ok(coleta.kmTotal === 75);
    assert.ok(r.correcoes?.some(c => c.includes('KM Total')));
  });

  it('corrige hora com ponto-e-vírgula e soma pesos parciais', async () => {
    const { ColetaData } = await import('../entities/ColetaData');
    const { prepararViagemParaImportacao } = await import('./validacaoViagemService');
    const coleta = new ColetaData();
    coleta.dataSaida = new Date(Date.UTC(2026, 5, 11));
    coleta.placa = 'XYZ9Z99';
    coleta.kmTotal = 55;
    coleta.peso1 = 4000;
    coleta.peso2 = 3500;
    coleta.dados = {
      'HORA SAIDA': '08;30',
      'PESO 1': 4000,
      'PESO 2': 3500,
      'KM TOTAL': 55,
    };

    const r = prepararViagemParaImportacao(coleta);
    assert.equal(r.validoDashboard, true);
    assert.equal(coleta.pesoTotal, 7500);
    assert.ok(r.correcoes?.length);
  });

  it('aceita retorno à base sem pesagem (placa, motorista, KM ok, peso zerado)', async () => {
    const { ColetaData } = await import('../entities/ColetaData');
    const { prepararViagemParaImportacao } = await import('./validacaoViagemService');
    const coleta = new ColetaData();
    coleta.dataSaida = new Date(Date.UTC(2026, 5, 12));
    coleta.placa = 'ABC1D23';
    coleta.motorista = 'João Silva';
    coleta.kmTotal = 42;
    coleta.pesoTotal = 0;
    coleta.dados = {
      'DATA SAIDA': '12/06/2026',
      'PLACA': 'ABC1D23',
      'MOTORISTA': 'João Silva',
      'KM TOTAL': 42,
      'PESO TOTAL': 0,
    };

    const r = prepararViagemParaImportacao(coleta);
    assert.equal(r.validoDashboard, true);
    assert.equal(r.pesoEfetivo, 0);
    assert.equal(coleta.pesoTotal, 0);
  });

  it('planilha BH: deriva KM Total do hodômetro base quando coluna KM TOTAL vazia', async () => {
    const { ColetaData } = await import('../entities/ColetaData');
    const { prepararViagemParaImportacao } = await import('./validacaoViagemService');
    const coleta = new ColetaData();
    coleta.dataSaida = new Date(Date.UTC(2026, 5, 25));
    coleta.placa = 'ABC1D23';
    coleta.motorista = 'Teste Motorista';
    coleta.dados = {
      'DATA SAIDA': '25/06/2026',
      'PLACA': 'ABC1D23',
      'MOTORISTA': 'Teste Motorista',
      'PESO 1': 1500,
      'PESO 2': 1200,
      'KM SAIDA BASE': 82401,
      'KM CHEGADA BASE': 82452,
    };

    const r = prepararViagemParaImportacao(coleta);
    assert.equal(r.validoDashboard, true);
    assert.equal(coleta.kmTotal, 51);
    assert.equal(coleta.pesoTotal, 2700);
  });

  it('não confunde hodômetro (KM SAIDA BASE) com KM TOTAL', async () => {
    const { ColetaData } = await import('../entities/ColetaData');
    const { prepararViagemParaImportacao } = await import('./validacaoViagemService');
    const coleta = new ColetaData();
    coleta.dataSaida = new Date(Date.UTC(2026, 5, 25));
    coleta.placa = 'ABC1D23';
    coleta.motorista = 'Teste';
    coleta.pesoTotal = 3000;
    coleta.dados = {
      'DATA SAIDA': '25/06/2026',
      'PLACA': 'ABC1D23',
      'MOTORISTA': 'Teste',
      'PESO TOTAL': 3000,
      'KM SAIDA BASE': 82401,
      'KM CHEGADA ROTA 01': 82409,
      'KM TOTAL': 0,
    };

    const r = prepararViagemParaImportacao(coleta);
    assert.equal(r.validoDashboard, true);
    assert.equal(coleta.kmTotal, 8);
  });

  it('corrige KM Total a partir de rotas com hodômetro quebrado e números de rota irregulares', async () => {
    const { ColetaData } = await import('../entities/ColetaData');
    const { prepararViagemParaImportacao } = await import('./validacaoViagemService');
    const coleta = new ColetaData();
    coleta.dataSaida = new Date(Date.UTC(2026, 5, 25));
    coleta.placa = 'ABC1D23';
    coleta.motorista = 'Teste';
    coleta.pesoTotal = 5000;
    coleta.dados = {
      'DATA SAIDA': '25/06/2026',
      'PLACA': 'ABC1D23',
      'MOTORISTA': 'Teste',
      'PESO TOTAL': 5000,
      'KM SAIDA ROTA 1': 100000,
      'KM CHEGADA ROTA 1': 100050,
      'KM SAIDA ROTA 2': 100050,
      'KM CHEGADA ROTA 2': 100070,
      'KM TOTAL': 0,
    };

    const r = prepararViagemParaImportacao(coleta);
    assert.equal(r.validoDashboard, true);
    assert.equal(coleta.kmTotal, 70);
    assert.ok(r.correcoes?.some(c => c.includes('KM Total')));
  });

  it('serial Excel 46199 grava como 2026-06-26 (UTC, sem −1 dia)', async () => {
    const { dateUtcColumnTransformer } = await import('../utils/dateColumnTransformer');
    const { ColetaData } = await import('../entities/ColetaData');
    const d = ColetaData.fromExcelDate(46199);
    assert.ok(d);
    const iso = dateUtcColumnTransformer.to(d);
    assert.equal(iso, '2026-06-26');
    const back = dateUtcColumnTransformer.from(iso);
    assert.equal(back?.getUTCDate(), 26);
    assert.equal(back?.getUTCMonth(), 5);
  });
});
