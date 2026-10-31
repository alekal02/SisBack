import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  comporFaturamentoColeta,
  precoCadastrado,
  semaforoDiretoria,
} from './painelDiretoriaCalculo';

describe('painel da diretoria — sem R$ 80', () => {
  it('tipo sem preço fica fora da soma', () => {
    const comp = comporFaturamentoColeta([
      { tipo: 'TOCO', pesoKg: 2000 },
      { tipo: 'MINI', pesoKg: 1000 },
    ], { VALOR_TOCO: 240.19 });
    assert.equal(comp.toneladas, 3);
    assert.equal(comp.faturamento, 480.38);
    assert.equal(comp.porTipo.find((p) => p.tipo === 'MINI')?.tarifa, null);
    assert.equal(comp.porTipo.find((p) => p.tipo === 'MINI')?.reais, null);
    assert.equal(precoCadastrado('MINI', {}), null);
    assert.notEqual(comp.faturamento, 3 * 80);
  });

  it('sem tarifa o semáforo fica cinza', () => {
    assert.equal(semaforoDiretoria({
      temTarifa: false,
      temPlanilha: true,
      variacao: 10,
      pctMeta: 100,
    }), 'cinza');
  });
});
