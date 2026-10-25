import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mesclarKpisCalculados } from './kpiCalculoServicoService';

describe('mesclarKpisCalculados', () => {
  it('consolida o mesmo KPI manual vindo de serviços diferentes', () => {
    const resultado = mesclarKpisCalculados([
      [{ id: 'servico-a-1', nome: 'Faturamento Estimado', valor: 120, formatado: 'R$ 120,00', formato: 'moeda' }],
      [{ id: 'servico-b-9', nome: 'Faturamento Estimado', valor: 80, formatado: 'R$ 80,00', formato: 'moeda' }],
    ]);

    assert.equal(resultado.length, 1);
    assert.equal(resultado[0].valor, 200);
    assert.equal(resultado[0].formatado, 'R$\u00a0200,00');
  });
});