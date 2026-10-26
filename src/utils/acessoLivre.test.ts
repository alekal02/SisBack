import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { acessoLivreLigado } from './acessoLivre';

describe('acessoLivreLigado', () => {
  it('fica desligado quando a variável não existe', () => {
    assert.equal(acessoLivreLigado({}), false);
  });

  it('fica desligado com false, vazio ou outro texto', () => {
    assert.equal(acessoLivreLigado({ ACESSO_LIVRE: 'false' }), false);
    assert.equal(acessoLivreLigado({ ACESSO_LIVRE: '' }), false);
    assert.equal(acessoLivreLigado({ ACESSO_LIVRE: 'TRUE' }), false);
  });

  it('só liga com true', () => {
    assert.equal(acessoLivreLigado({ ACESSO_LIVRE: 'true' }), true);
  });
});
