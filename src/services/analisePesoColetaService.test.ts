import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  analisarPesoColeta,
  calcularCaixaMediaPorFrota,
  calcularMediaIdealKg,
  calcularMediaIdealKgPorTipo,
  contarFrotaPorTipoCaminhao,
  DENSIDADE_OTIMA_PADRAO,
} from './analisePesoColetaService';
import { avisoTipoCaminhaoDeduzido } from './analisePesoComparativoMetricas';
import { PESO_MAX_KG_PADRAO, VOLUME_L_PADRAO } from '../config/pesoMaximoCaminhao';

describe('contarFrotaPorTipoCaminhao', () => {
  it('agrupa placas únicas pelo tipo declarado na planilha', () => {
    const dados = [
      { PLACA: 'M1', 'TIPO DE CAMINHÃO': 'MINI' },
      { PLACA: 'M2', 'TIPO DE CAMINHÃO': 'MINI' },
      { PLACA: 'M3', 'TIPO DE CAMINHÃO': 'MINI' },
      { PLACA: 'M4', 'TIPO DE CAMINHÃO': 'MINI' },
      { PLACA: 'M5', 'TIPO DE CAMINHÃO': 'MINI' },
      ...Array.from({ length: 17 }, (_, i) => ({
        PLACA: `T${i + 1}`,
        'TIPO DE CAMINHÃO': 'TOCO',
      })),
      ...Array.from({ length: 6 }, (_, i) => ({
        PLACA: `K${i + 1}`,
        'TIPO DE CAMINHÃO': 'TRUCK',
      })),
    ];

    const { tiposCaminhao } = contarFrotaPorTipoCaminhao(
      dados,
      'PLACA',
      'TIPO DE CAMINHÃO',
      'PESO TOTAL',
      PESO_MAX_KG_PADRAO,
    );

    assert.deepEqual(tiposCaminhao, { MINI: 5, TOCO: 17, BASCULANTE: 0, TRUCK: 6, soma: 28 });
  });

  it('reconhece BASCULANTE como tipo próprio', () => {
    const dados = [
      { PLACA: 'B1', 'TIPO DE CAMINHÃO': 'BASCULANTE' },
      { PLACA: 'B2', 'TIPO DE CAMINHÃO': 'BASCULANTO' },
    ];
    const { tiposCaminhao } = contarFrotaPorTipoCaminhao(
      dados,
      'PLACA',
      'TIPO DE CAMINHÃO',
      'PESO TOTAL',
      PESO_MAX_KG_PADRAO,
    );
    assert.equal(tiposCaminhao.BASCULANTE, 2);
    assert.equal(tiposCaminhao.TOCO, 0);
  });

  it('prioriza tipo declarado sobre inferência por peso', () => {
    const dados = [
      { PLACA: 'ABC1234', 'TIPO DE CAMINHÃO': 'MINI', 'PESO TOTAL': 15000 },
    ];
    const { tiposCaminhao } = contarFrotaPorTipoCaminhao(
      dados,
      'PLACA',
      'TIPO DE CAMINHÃO',
      'PESO TOTAL',
      PESO_MAX_KG_PADRAO,
    );
    assert.equal(tiposCaminhao.MINI, 1);
    assert.equal(tiposCaminhao.TRUCK, 0);
  });

  it('marca como deduzida a placa sem tipo na planilha', () => {
    const dados = [
      { PLACA: 'AAA1111', 'TIPO DE CAMINHÃO': 'TOCO', 'PESO TOTAL': 8000 },
      { PLACA: 'BBB2222', 'PESO TOTAL': 15000 },
    ];
    const { tiposCaminhao, tipoDeduzido } = contarFrotaPorTipoCaminhao(
      dados,
      'PLACA',
      'TIPO DE CAMINHÃO',
      'PESO TOTAL',
      PESO_MAX_KG_PADRAO,
    );

    assert.equal(tiposCaminhao.soma, 2);
    assert.equal(tipoDeduzido.placas, 1);
    assert.deepEqual(tipoDeduzido.placasLista, ['BBB2222']);
    assert.equal(tipoDeduzido.placasDeclaradas, 1);
    assert.equal(tipoDeduzido.placasSemTipo, 0);
    // porTipo conta só o que foi deduzido — a placa declarada não entra
    const deduzidasPorTipo = Object.values(tipoDeduzido.porTipo).reduce((s, n) => s + n, 0);
    assert.equal(deduzidasPorTipo, 1);
    assert.equal(tipoDeduzido.porTipo.TOCO, 0);
  });

  it('não marca dedução quando toda a frota vem declarada na planilha', () => {
    const dados = [
      { PLACA: 'AAA1111', 'TIPO DE CAMINHÃO': 'TOCO', 'PESO TOTAL': 8000 },
      { PLACA: 'BBB2222', 'TIPO DE CAMINHÃO': 'BASCULANTE', 'PESO TOTAL': 9000 },
    ];
    const { tipoDeduzido } = contarFrotaPorTipoCaminhao(
      dados,
      'PLACA',
      'TIPO DE CAMINHÃO',
      'PESO TOTAL',
      PESO_MAX_KG_PADRAO,
    );

    assert.equal(tipoDeduzido.placas, 0);
    assert.equal(tipoDeduzido.placasDeclaradas, 2);
    assert.deepEqual(tipoDeduzido.placasLista, []);
  });

  it('placa sem tipo e sem peso fica fora da contagem por tipo', () => {
    const dados = [
      { PLACA: 'AAA1111', 'TIPO DE CAMINHÃO': 'TOCO', 'PESO TOTAL': 8000 },
      { PLACA: 'CCC3333' },
    ];
    const { tiposCaminhao, tipoDeduzido, caminhoesUnicos } = contarFrotaPorTipoCaminhao(
      dados,
      'PLACA',
      'TIPO DE CAMINHÃO',
      'PESO TOTAL',
      PESO_MAX_KG_PADRAO,
    );

    assert.equal(caminhoesUnicos, 2);
    assert.equal(tiposCaminhao.soma, 1);
    assert.equal(tipoDeduzido.placas, 0);
    assert.equal(tipoDeduzido.placasSemTipo, 1);
  });
});

describe('avisoTipoCaminhaoDeduzido', () => {
  it('fica calado quando todo tipo veio da planilha', () => {
    const analise = analisarPesoColeta(
      [
        {
          PLACA: 'AAA1111',
          'TIPO DE CAMINHÃO': 'BASCULANTE',
          'DATA SAIDA': '01/07/2026',
          'CONTADOR DE VIAGENS': 1,
          'PESO 1': 9000,
          'PESO TOTAL': 9000,
        },
      ],
      'srv-1',
    );

    assert.ok(analise);
    assert.equal(analise!.frotaTipoDeduzido.placas, 0);
    assert.equal(analise!.viagensTipoDeduzido, 0);
    assert.equal(avisoTipoCaminhaoDeduzido(analise!), null);
  });

  it('avisa quais placas tiveram o tipo deduzido pelo peso', () => {
    const analise = analisarPesoColeta(
      [
        {
          PLACA: 'BBB2222',
          'DATA SAIDA': '01/07/2026',
          'CONTADOR DE VIAGENS': 1,
          'PESO 1': 9000,
          'PESO TOTAL': 9000,
        },
      ],
      'srv-2',
    );

    assert.ok(analise);
    assert.equal(analise!.frotaTipoDeduzido.placas, 1);
    assert.equal(analise!.viagensTipoDeduzido, 1);

    const aviso = avisoTipoCaminhaoDeduzido(analise!);
    assert.ok(aviso);
    assert.match(aviso!, /BBB2222/);
    assert.match(aviso!, /deduzido pelo peso/);
  });
});

describe('calcularMediaIdealKgPorTipo — densidade por caminhão', () => {
  const densidades = { MINI: 0.43, TOCO: 0.43, BASCULANTE: 0.43, TRUCK: 0.43 };
  const frota = { MINI: 0, TOCO: 4, BASCULANTE: 0, TRUCK: 0 };
  const placasPorTipo = {
    MINI: [],
    TOCO: ['AAA1111', 'BBB2222', 'CCC3333', 'DDD0031'],
    BASCULANTE: [],
    TRUCK: [],
  };

  it('sem densidade por placa, mantém a densidade do tipo', () => {
    const r = calcularMediaIdealKgPorTipo(frota, VOLUME_L_PADRAO, densidades);
    assert.equal(r.densidadeMedia, 0.43);
    assert.equal(r.mediaIdealKg, VOLUME_L_PADRAO.TOCO * 0.43);
  });

  it('o caminhão com densidade própria entra com a densidade dele', () => {
    const r = calcularMediaIdealKgPorTipo(frota, VOLUME_L_PADRAO, densidades, {
      placasPorTipo,
      densPorPlaca: { DDD0031: 0.55 },
    });
    // 3 caminhões a 0,43 + 1 a 0,55 = 0,46
    assert.equal(r.densidadeMedia, 0.46);
    assert.equal(r.mediaIdealKg, Math.round(VOLUME_L_PADRAO.TOCO * 0.46 * 100) / 100);
  });

  it('placa sem densidade própria não muda nada', () => {
    const r = calcularMediaIdealKgPorTipo(frota, VOLUME_L_PADRAO, densidades, {
      placasPorTipo,
      densPorPlaca: { ZZZ9999: 0.9 },
    });
    assert.equal(r.densidadeMedia, 0.43);
  });
});

describe('calcularCaixaMediaPorFrota', () => {
  it('calcula caixa média ponderada por volume (L) conforme planilha', () => {
    const frota = { MINI: 5, TOCO: 17, TRUCK: 6 };
    const caixaMedia = calcularCaixaMediaPorFrota(frota, VOLUME_L_PADRAO);
    assert.equal(caixaMedia, 14250);
  });

  it('retorna 0 quando frota vazia', () => {
    assert.equal(calcularCaixaMediaPorFrota({ MINI: 0, TOCO: 0, BASCULANTE: 0, TRUCK: 0 }, VOLUME_L_PADRAO), 0);
  });

  it('usa volume do contrato (ex.: basculante diferente do padrão 17.000 L)', () => {
    const frota = { MINI: 0, TOCO: 0, BASCULANTE: 2, TRUCK: 2 };
    const volumesContrato = { ...VOLUME_L_PADRAO, BASCULANTE: 12000 };
    // (12000×2 + 19000×2) / 4 = 15500
    assert.equal(calcularCaixaMediaPorFrota(frota, volumesContrato), 15500);
  });
});

describe('calcularMediaIdealKg', () => {
  it('multiplica caixa média (L) pela densidade do resíduo (kg/L)', () => {
    const pesoIdeal = calcularMediaIdealKg(14250, DENSIDADE_OTIMA_PADRAO);
    assert.equal(pesoIdeal, 7837.5);
  });
});

describe('analisarPesoColeta — mínimo/máximo por viagem', () => {
  it('usa menor e maior peso de viagem, não média/total da rota', () => {
    const dados = [
      {
        PLACA: 'AAA1111',
        REGIONAL: 'MC2B-NE',
        'CONTADOR DE VIAGENS': 2,
        'PESO 1': 2475,
        'PESO 2': 9000,
        'PESO TOTAL': 11475,
        validoDashboard: true,
      },
      {
        PLACA: 'BBB2222',
        REGIONAL: 'NO24B',
        'CONTADOR DE VIAGENS': 1,
        'PESO 1': 13120,
        'PESO TOTAL': 13120,
        validoDashboard: true,
      },
    ];

    const analise = analisarPesoColeta(dados, 'svc-test');
    assert.ok(analise);
    assert.equal(analise!.rotaMinima?.pesoMedioKg, 2475);
    assert.equal(analise!.rotaMinima?.nome, 'MC2B-NE');
    assert.equal(analise!.rotaMaxima?.pesoMedioKg, 13120);
    assert.equal(analise!.rotaMaxima?.nome, 'NO24B');
  });

  it('nunca usa PESO TOTAL enorme (ex. 76998) como máximo de viagem', () => {
    const dados = [
      {
        PLACA: 'CCC3333',
        REGIONAL: 'ROTA-X',
        'CONTADOR DE VIAGENS': 4,
        peso1: 8200,
        peso2: 9100,
        peso3: 7800,
        peso4: 8500,
        pesoTotal: 76998, // total errado / soma de várias rotas — NÃO é viagem
        validoDashboard: true,
      },
      {
        PLACA: 'DDD4444',
        REGIONAL: 'ROTA-Y',
        'CONTADOR DE VIAGENS': 1,
        'PESO 1': 1400,
        'PESO TOTAL': 1400,
        validoDashboard: true,
      },
    ];

    const analise = analisarPesoColeta(dados, 'svc-porto');
    assert.ok(analise);
    assert.equal(analise!.rotaMinima?.pesoMedioKg, 1400);
    assert.equal(analise!.rotaMaxima?.pesoMedioKg, 9100);
    assert.ok((analise!.rotaMaxima?.pesoMedioKg ?? 0) < 25000);
  });

  it('ignora registro só com PESO TOTAL absurdo sem PESO 1–4', () => {
    const dados = [
      {
        PLACA: 'EEE5555',
        REGIONAL: 'ROTA-Z',
        'CONTADOR DE VIAGENS': 1,
        pesoTotal: 76998,
        validoDashboard: true,
      },
      {
        PLACA: 'FFF6666',
        REGIONAL: 'ROTA-OK',
        'CONTADOR DE VIAGENS': 2,
        'PESO 1': 5000,
        'PESO 2': 6000,
        'PESO TOTAL': 11000,
        validoDashboard: true,
      },
    ];

    const analise = analisarPesoColeta(dados, 'svc-porto-2');
    assert.ok(analise);
    assert.equal(analise!.rotaMinima?.pesoMedioKg, 5000);
    assert.equal(analise!.rotaMaxima?.pesoMedioKg, 6000);
  });
});

describe('analisarPesoColeta — faixas vs peso ideal do tipo', () => {
  it('classifica em péssimo / ruim / ótimo / excedido conforme % do ideal', () => {
    // MINI ideal padrão = 6000 L × 0,55 = 3300 kg
    const dados = [
      {
        PLACA: 'M1',
        'TIPO DE CAMINHÃO': 'MINI',
        'CONTADOR DE VIAGENS': 1,
        'PESO 1': 1000, // ~30% → péssimo
        'PESO TOTAL': 1000,
        validoDashboard: true,
      },
      {
        PLACA: 'M2',
        'TIPO DE CAMINHÃO': 'MINI',
        'CONTADOR DE VIAGENS': 1,
        'PESO 1': 2000, // ~61% → ruim
        'PESO TOTAL': 2000,
        validoDashboard: true,
      },
      {
        PLACA: 'M3',
        'TIPO DE CAMINHÃO': 'MINI',
        'CONTADOR DE VIAGENS': 1,
        'PESO 1': 3300, // 100% → ótimo
        'PESO TOTAL': 3300,
        validoDashboard: true,
      },
      {
        PLACA: 'M4',
        'TIPO DE CAMINHÃO': 'MINI',
        'CONTADOR DE VIAGENS': 1,
        'PESO 1': 4000, // ~121% → excedido
        'PESO TOTAL': 4000,
        validoDashboard: true,
      },
    ];

    const analise = analisarPesoColeta(dados, 'svc-faixas-ideal');
    assert.ok(analise);
    assert.equal(analise!.faixas.length, 4);
    assert.match(analise!.faixas[0].label, /PÉSSIMO/i);
    assert.match(analise!.faixas[1].label, /RUIM/i);
    assert.match(analise!.faixas[2].label, /ÓTIMO|OTIMO/i);
    assert.match(analise!.faixas[3].label, /EXCEDIDO/i);
    assert.equal(analise!.faixas[0].quantidade, 1);
    assert.equal(analise!.faixas[1].quantidade, 1);
    assert.equal(analise!.faixas[2].quantidade, 1);
    assert.equal(analise!.faixas[3].quantidade, 1);
  });

  it('nao conta PESO 2–4 extras quando o CONTADOR DE VIAGENS e 1', () => {
    const dados = [
      {
        PLACA: 'M1',
        'TIPO DE CAMINHÃO': 'MINI',
        'CONTADOR DE VIAGENS': 1,
        'PESO 1': 1000, // péssimo
        'PESO 2': 4000, // excedido — deve ser ignorado
        'PESO TOTAL': 5000,
        validoDashboard: true,
      },
    ];
    const analise = analisarPesoColeta(dados, 'svc-faixas-contador');
    assert.ok(analise);
    assert.equal(analise!.numeroViagens, 1);
    assert.equal(analise!.faixas[0].quantidade, 1);
    assert.equal(analise!.faixas[3].quantidade, 0);
    assert.equal(analise!.faixas[0].pct, 100);
  });
});

describe('analisarPesoColeta — série diária', () => {
  it('agrupa viagens e peso médio por dia', () => {
    const dados = [
      {
        'DATA SAIDA': '2026-08-21',
        PLACA: 'AAA1111',
        'CONTADOR DE VIAGENS': 2,
        'PESO 1': 4000,
        'PESO 2': 6000,
        'PESO TOTAL': 10000,
        validoDashboard: true,
      },
      {
        'DATA SAIDA': '2026-08-21',
        PLACA: 'BBB2222',
        'CONTADOR DE VIAGENS': 1,
        'PESO 1': 5000,
        'PESO TOTAL': 5000,
        validoDashboard: true,
      },
      {
        'DATA SAIDA': '2026-08-22',
        PLACA: 'CCC3333',
        'CONTADOR DE VIAGENS': 1,
        'PESO 1': 8000,
        'PESO TOTAL': 8000,
        validoDashboard: true,
      },
    ];
    const analise = analisarPesoColeta(dados, 'svc-por-dia');
    assert.ok(analise?.porDia);
    assert.equal(analise!.porDia!.length, 2);
    assert.equal(analise!.porDia![0].data, '2026-08-21');
    assert.equal(analise!.porDia![0].viagens, 3);
    assert.equal(analise!.porDia![0].pesoTotalKg, 15000);
    assert.equal(analise!.porDia![0].pesoMedioKg, 5000);
    assert.equal(analise!.porDia![1].data, '2026-08-22');
    assert.equal(analise!.porDia![1].viagens, 1);
    assert.equal(analise!.porDia![1].pesoMedioKg, 8000);
  });
});
