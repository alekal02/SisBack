import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { encontrarChavePlanilha } from '../utils/encontrarChavePlanilha';

describe('encontrarChavePlanilha', () => {
  const row = {
    'DATA SAIDA': 46280,
    'KM SAIDA BASE': 100,
    'KM CHEGADA ROTA 01': 110,
    'KM CHEGADA BASE': 200,
    'KM TOTAL': 50,
    'DIA DA SEMANA\n1(DOMINGO) A 7(SÁBADO)': 5,
  };

  it('liga KM SAIDA ao KM SAIDA BASE', () => {
    assert.equal(encontrarChavePlanilha(row, 'KM SAIDA'), 'KM SAIDA BASE');
  });

  it('não usa KM CHEGADA ROTA 01 no lugar de KM CHEGADA BASE', () => {
    assert.equal(encontrarChavePlanilha(row, 'KM CHEGADA'), 'KM CHEGADA BASE');
  });

  it('não trata DIA DA SEMANA como DATA', () => {
    assert.equal(encontrarChavePlanilha(row, 'DIA'), null);
    assert.equal(encontrarChavePlanilha(row, 'DATA SAIDA'), 'DATA SAIDA');
  });
});
