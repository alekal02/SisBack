import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcularHorasNasRotasRegistro,
  calcularHorasProdutivaImprodutivaRegistro,
  calcularKmNasRotasRegistro,
  calcularVelocidadeColetaRegistro,
  diffHorasSaidaChegada,
} from './horasProdutivasService';

describe('horas produtivas / improdutivas (rota × base)', () => {
  it('diff = fim − início com virada de dia em serial Excel', () => {
    // 22:00 → 02:00 = 4h
    assert.equal(diffHorasSaidaChegada(22 / 24, 2 / 24), 4);
    // 8:00 → 10:00 = 2h
    assert.equal(diffHorasSaidaChegada(8 / 24, 10 / 24), 2);
  });

  it('produtiva = Σ (saída rota − chegada rota); total = chegada base − saída base', () => {
    const reg = {
      // tipado poluído (chegada = rota 01) — não deve ser usado
      horaSaida: 20 / 24,
      horaChegada: 20.17 / 24,
      dados: {
        'HORA SÁIDA BASE': 20 / 24,
        'HORA CHEGADA BASE': 5 / 24, // dia seguinte → 9h
        'HORA CHEGADA ROTA 01': 20.17 / 24,
        'HORA SAÍDA ROTA 01': 23.33 / 24, // ~3.16h
        'HORA CHEGADA ROTA 02': 0.42 / 24,
        'HORA SAÍDA ROTA 02': 2.67 / 24, // ~2.25h
      },
    };
    const prod = calcularHorasNasRotasRegistro(reg);
    assert.ok(prod > 5 && prod < 6, `prod=${prod}`);
    const r = calcularHorasProdutivaImprodutivaRegistro(reg);
    assert.equal(r.horasTotais, 9);
    assert.ok(r.horasProdutivas > 5 && r.horasProdutivas < 6);
    assert.ok(r.horasImprodutivas > 3 && r.horasImprodutivas < 4, `improd=${r.horasImprodutivas}`);
  });

  it('improdutiva = total − produtiva e não fica negativa', () => {
    const reg = {
      dados: {
        'HORA SÁIDA BASE': 8 / 24,
        'HORA CHEGADA BASE': 12 / 24,
        'HORA CHEGADA ROTA 01': 9 / 24,
        'HORA SAÍDA ROTA 01': 14 / 24, // produtiva > total
      },
    };
    const r = calcularHorasProdutivaImprodutivaRegistro(reg);
    assert.equal(r.horasTotais, 4);
    assert.equal(r.horasProdutivas, 4);
    assert.equal(r.horasImprodutivas, 0);
  });

  it('usa HORA CHEGADA BASE do JSON mesmo com tipado igual à rota 01', () => {
    const reg = {
      horaSaida: 0.8333333333333334,
      horaChegada: 0.8402777777777778, // = HORA CHEGADA ROTA 01 (poluído)
      dados: {
        'HORA SÁIDA BASE': 0.8333333333333334,
        'HORA CHEGADA BASE': 0.20833333333333334,
        'HORA SAÍDA ROTA 01': 0.9722222222222222,
        'HORA CHEGADA ROTA 01': 0.8402777777777778,
        'HORA SAÍDA ROTA 02': 0.1111111111111111,
        'HORA CHEGADA ROTA 02': 0.017361111111111112,
      },
    };
    const r = calcularHorasProdutivaImprodutivaRegistro(reg);
    assert.equal(r.horasTotais, 9);
    assert.equal(r.horasProdutivas, 5.42);
    assert.equal(r.horasImprodutivas, 3.58);
  });
});

describe('km produtivo nas rotas / velocidade de coleta', () => {
  it('km produtivo = Σ (KM SAÍDA ROTA − KM CHEGADA ROTA)', () => {
    const reg = {
      dados: {
        ' KM CHEGADA ROTA 01 ': 1000,
        ' KM SAÍDA ROTA 01 ': 1025,
        ' KM CHEGADA ROTA 02 ': 1030,
        ' KM SAÍDA ROTA 02 ': 1045,
      },
    };
    assert.equal(calcularKmNasRotasRegistro(reg), 40);
  });

  it('velocidade = km nas rotas ÷ horas nas rotas', () => {
    const reg = {
      dados: {
        ' KM CHEGADA ROTA 01 ': 1000,
        ' KM SAÍDA ROTA 01 ': 1020,
        'HORA CHEGADA ROTA 01': 8 / 24,
        'HORA SAÍDA ROTA 01': 10 / 24,
      },
    };
    assert.equal(calcularHorasNasRotasRegistro(reg), 2);
    assert.equal(calcularKmNasRotasRegistro(reg), 20);
    assert.equal(calcularVelocidadeColetaRegistro(reg), 10);
  });

  it('usa kmRota tipado quando hodômetro da rota não gera distância', () => {
    const reg = {
      kmRota1: 18,
      dados: {
        ' KM CHEGADA ROTA 01 ': 5000,
        ' KM SAÍDA ROTA 01 ': 5000,
      },
    };
    assert.equal(calcularKmNasRotasRegistro(reg), 18);
  });
});
