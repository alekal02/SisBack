import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { alteracaoNegada } from './tenantGuard';
import { TokenPayload } from './authMiddleware';

const contratoA = '11111111-1111-1111-1111-111111111111';
const contratoB = '22222222-2222-2222-2222-222222222222';

function usuario(parcial: Partial<TokenPayload>): TokenPayload {
  return {
    id: 'u1',
    email: 'a@b.c',
    nome: 'A',
    role: 'user',
    contractId: null,
    ...parcial,
  };
}

describe('escopo de contrato', () => {
  it('usuário preso ao contrato A não altera o contrato B', () => {
    assert.equal(alteracaoNegada(usuario({ contractId: contratoA }), contratoB), true);
    assert.equal(alteracaoNegada(usuario({ contractId: contratoA, role: 'admin' }), contratoB), true);
  });

  it('o mesmo usuário altera o próprio contrato', () => {
    assert.equal(alteracaoNegada(usuario({ contractId: contratoA }), contratoA), false);
  });

  it('gestor sem contrato e super-admin seguem podendo', () => {
    assert.equal(alteracaoNegada(usuario({ role: 'admin', contractId: null }), contratoB), false);
    assert.equal(alteracaoNegada(usuario({ role: 'superadmin', contractId: contratoA }), contratoB), false);
  });

  it('usuário preso não cria outro contrato nem grava sem contrato alvo', () => {
    assert.equal(alteracaoNegada(usuario({ contractId: contratoA }), null), true);
    assert.equal(alteracaoNegada(usuario({ role: 'admin', contractId: null }), null), false);
  });
});
