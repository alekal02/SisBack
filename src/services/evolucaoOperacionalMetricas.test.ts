import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classificarTempoPorTipo,
  classificarTonPorHora,
  classificarTonPorKm,
  classificarVelocidade,
  REF_TON_POR_HORA,
  tempoEquivalenteEncher,
  tempoParaEncherPorMedia,
  tipoParaTempoEncher,
} from './evolucaoOperacionalMetricas';

describe('evolucaoOperacionalMetricas (correções diretoria)', () => {
  it('classifica tempo TOCO (<3,5h / 3,5–4,5h / >4,5h)', () => {
    assert.equal(classificarTempoPorTipo(3.4, 'TOCO'), 'bom');
    assert.equal(classificarTempoPorTipo(3.5, 'TOCO'), 'regular');
    assert.equal(classificarTempoPorTipo(4.5, 'TOCO'), 'regular');
    assert.equal(classificarTempoPorTipo(4.6, 'TOCO'), 'ruim');
  });

  it('classifica tempo TRUCADO (<3,8h / 3,8–5h / >5h)', () => {
    assert.equal(classificarTempoPorTipo(3.7, 'TRUCK'), 'bom');
    assert.equal(classificarTempoPorTipo(3.8, 'TRUCK'), 'regular');
    assert.equal(classificarTempoPorTipo(5.0, 'TRUCK'), 'regular');
    assert.equal(classificarTempoPorTipo(5.1, 'TRUCK'), 'ruim');
  });

  it('classifica tempo MINI (<1,2h / 1,2–1,6h / >1,6h)', () => {
    assert.equal(classificarTempoPorTipo(1.1, 'MINI'), 'bom');
    assert.equal(classificarTempoPorTipo(1.2, 'MINI'), 'regular');
    assert.equal(classificarTempoPorTipo(1.6, 'MINI'), 'regular');
    assert.equal(classificarTempoPorTipo(1.7, 'MINI'), 'ruim');
  });

  it('mapeia BASCULANTE para limiar de TRUCADO no tempo até encher', () => {
    assert.equal(tipoParaTempoEncher('BASCULANTE'), 'TRUCK');
    assert.equal(tipoParaTempoEncher('TOCO'), 'TOCO');
    assert.equal(tipoParaTempoEncher('MINI'), 'MINI');
    assert.equal(tipoParaTempoEncher(null), null);
  });

  it('extrapola tempo até encher com peso ideal da caixa', () => {
    const eq = tempoEquivalenteEncher({
      horasProd: 2,
      pesoKg: 4000,
      pesoIdealKg: 8250,
    });
    assert.ok(eq != null);
    assert.ok(Math.abs((eq as number) - (2 / (4000 / 8250))) < 0.1);

    assert.equal(tempoEquivalenteEncher({
      horasProd: 3,
      pesoKg: 8250,
      pesoIdealKg: 8250,
    }), 3);
  });

  it('estima tempo até o ideal pela média da rota quando não encheu a caixa', () => {
    const r = tempoParaEncherPorMedia({
      horasProd: 1.2,
      pesoKg: 3818 * 4,
      pesoIdealKg: 8250,
      viagens: 4,
    });
    assert.ok(r);
    assert.equal(r!.estimado, true);
    assert.equal(r!.atingiuIdeal, false);
    assert.equal(r!.tempoH, 0.65);
  });

  it('usa o tempo real até 100% quando a média já atingiu o peso ideal', () => {
    const r = tempoParaEncherPorMedia({
      horasProd: 8,
      pesoKg: 9000 * 4,
      pesoIdealKg: 8250,
      viagens: 4,
    });
    assert.ok(r);
    assert.equal(r!.atingiuIdeal, true);
    assert.equal(r!.estimado, false);
    assert.equal(r!.tempoH, 1.83);
  });

  it('velocidade: >9 km/h = risco de acidente', () => {
    assert.equal(classificarVelocidade(4.9), 'ruim');
    assert.equal(classificarVelocidade(6), 'regular');
    assert.equal(classificarVelocidade(8), 'bom');
    assert.equal(classificarVelocidade(9.1), 'risco');
  });

  it('classifica ton/km e ton/h (inversos)', () => {
    // 1/3.9 > 0.25 → ótimo; 1/5 ≈ 0.2 → bom; 1/7 ≈ 0.143 → regular; 1/9 < 0.125 → ruim
    assert.equal(classificarTonPorKm(1 / 3.9), 'otimo');
    assert.equal(classificarTonPorKm(1 / 5), 'bom');
    assert.equal(classificarTonPorKm(1 / 7), 'regular');
    assert.equal(classificarTonPorKm(1 / 9), 'ruim');

    assert.equal(classificarTonPorHora(3.5), 'bom');
    assert.equal(classificarTonPorHora(REF_TON_POR_HORA), 'regular');
    assert.equal(classificarTonPorHora(2.0), 'ruim');
  });
});
