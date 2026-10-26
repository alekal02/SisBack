import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cacheAindaVale, chaveCicloExecutivo } from './executivoCacheTabela';
import { colunasCitadasNaFormula, colunasJsonDoExecutivo } from './executivoColunas';

describe('cache do executivo', () => {
  it('identifica o ciclo de referência como AAAA-MM', () => {
    assert.equal(chaveCicloExecutivo({
      periodo: 'ciclo',
      mesReferencia: 10,
      anoReferencia: 2026,
    }), '2026-10');
    assert.equal(chaveCicloExecutivo({
      periodo: 'ciclo',
      mesReferencia: 10,
      anoReferencia: 2026,
      servicoId: 'abc',
    }), '2026-10:s:abc');
  });

  it('considera o cache velho quando a importação é mais nova', () => {
    const calculado = new Date('2026-10-25T12:00:00Z');
    assert.equal(cacheAindaVale(calculado, null), true);
    assert.equal(cacheAindaVale(calculado, new Date('2026-10-25T11:00:00Z')), true);
    assert.equal(cacheAindaVale(calculado, new Date('2026-10-25T12:00:01Z')), false);
  });

  it('pede só as colunas citadas na fórmula, além das fixas do executivo', () => {
    const citadas = colunasCitadasNaFormula('SUM(M2) / COUNT DISTINCT(BAIRRO) + FATURAMENTO_EST(PESO TOTAL, TIPO CAMINHAO)');
    assert.deepEqual(citadas.sort(), ['BAIRRO', 'M2', 'PESO TOTAL', 'TIPO CAMINHAO'].sort());
    const colunas = colunasJsonDoExecutivo([{ expressao: 'SUM(M2)' }]);
    assert.equal(colunas.includes('M2'), true);
    assert.equal(colunas.includes('PESO TOTAL'), true);
    assert.equal(colunas.includes('OBSERVACAO LIVRE QUE NAO ENTRA'), false);
  });
});
