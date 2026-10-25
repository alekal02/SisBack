import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { afirmarNomeBanco, nomeBancoContrato } from './slugContrato';

describe('nome de banco', () => {
  it('aceita o identificador gerado pelo slug', () => {
    assert.equal(nomeBancoContrato('ap'), 'contrato_ap');
    assert.equal(afirmarNomeBanco('contrato_ap'), 'contrato_ap');
  });

  it('recusa nome que poderia alterar o SQL', () => {
    assert.throws(() => afirmarNomeBanco('abastecimento; DROP DATABASE abastecimento'));
    assert.throws(() => afirmarNomeBanco('Contrato'));
    assert.throws(() => afirmarNomeBanco('contrato-1'));
  });
});
