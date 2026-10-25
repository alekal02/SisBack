import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcularCicloMensalContrato,
  limitarDiasAusentesAoPeriodoDaPlanilha,
  montarJanelasComparativoCiclo,
  recortarPeriodoAteReferencia,
  restringirDatasAoCicloDaDataMaisRecente,
} from './periodoCicloContrato';

describe('limitarDiasAusentesAoPeriodoDaPlanilha', () => {
  it('nao apaga dias do ciclo anterior quando a planilha so traz o ciclo novo', () => {
    const sistema = ['2026-07-21', '2026-08-15', '2026-08-20', '2026-08-21', '2026-08-25'];
    const planilha = ['2026-08-21', '2026-08-25'];
    assert.deepEqual(limitarDiasAusentesAoPeriodoDaPlanilha(sistema, planilha), []);
  });

  it('apaga apenas buracos dentro do intervalo da planilha nova', () => {
    const sistema = ['2026-07-21', '2026-08-22', '2026-08-23', '2026-08-25'];
    const planilha = ['2026-08-21', '2026-08-25'];
    assert.deepEqual(
      limitarDiasAusentesAoPeriodoDaPlanilha(sistema, planilha),
      ['2026-08-22', '2026-08-23'],
    );
  });

  it('nao remove nada se a planilha nao tem datas', () => {
    assert.deepEqual(
      limitarDiasAusentesAoPeriodoDaPlanilha(['2026-07-21'], []),
      [],
    );
  });
});

describe('restringirDatasAoCicloDaDataMaisRecente', () => {
  it('ignora datas do ciclo anterior em planilha cumulativa (dia 21)', () => {
    const { datas, ignoradas, ciclo } = restringirDatasAoCicloDaDataMaisRecente(
      ['2026-07-21', '2026-07-30', '2026-08-21', '2026-08-25'],
      21,
    );
    assert.equal(ciclo?.dataInicio, '2026-08-21');
    assert.deepEqual(datas, ['2026-08-21', '2026-08-25']);
    assert.deepEqual(ignoradas, ['2026-07-21', '2026-07-30']);
    assert.deepEqual(
      limitarDiasAusentesAoPeriodoDaPlanilha(
        ['2026-07-21', '2026-07-22', '2026-08-22'],
        datas,
      ),
      ['2026-08-22'],
    );
  });

  it('mantem o ciclo unico quando a planilha so tem aquele periodo', () => {
    const { datas, ignoradas } = restringirDatasAoCicloDaDataMaisRecente(
      ['2026-08-01', '2026-08-15'],
      1,
    );
    assert.deepEqual(datas, ['2026-08-01', '2026-08-15']);
    assert.deepEqual(ignoradas, []);
  });
});

describe('recortarPeriodoAteReferencia', () => {
  it('ciclo dia 25: de 25/07 a 21/08 sao os dias decorridos ate hoje', () => {
    const ciclo = calcularCicloMensalContrato(2026, 8, 25);
    assert.equal(ciclo.dataInicio, '2026-07-25');
    assert.equal(ciclo.dataFim, '2026-08-24');
    const recorte = recortarPeriodoAteReferencia(ciclo.dataInicio, ciclo.dataFim, '2026-08-21');
    assert.equal(recorte.dataInicio, '2026-07-25');
    assert.equal(recorte.dataFim, '2026-08-21');
    assert.equal(recorte.diasDecorridos, 28);
    assert.equal(recorte.emAndamento, true);
  });

  it('nao recorta quando o ciclo ja fechou', () => {
    const ciclo = calcularCicloMensalContrato(2026, 7, 25);
    const recorte = recortarPeriodoAteReferencia(ciclo.dataInicio, ciclo.dataFim, '2026-08-21');
    assert.equal(recorte.dataFim, ciclo.dataFim);
    assert.equal(recorte.emAndamento, false);
  });
});

describe('montarJanelasComparativoCiclo', () => {
  it('compara os mesmos N dias do ciclo anterior, nao o ciclo anterior inteiro', () => {
    const atual = calcularCicloMensalContrato(2026, 8, 25);
    const janelas = montarJanelasComparativoCiclo(atual, '2026-08-21');
    assert.equal(janelas.diasDecorridos, 28);
    assert.equal(janelas.atual.dataInicio, '2026-07-25');
    assert.equal(janelas.atual.dataFim, '2026-08-21');
    assert.equal(janelas.anterior.dataInicio, '2026-06-25');
    assert.equal(janelas.anterior.dataFim, '2026-07-22');
    assert.equal(janelas.emAndamento, true);
  });
});
