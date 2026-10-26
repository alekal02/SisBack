import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { enfileirarPdf, resetarFilaPdfParaTeste } from './filaPdf';

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('fila de PDF', () => {
  it('gera um PDF por vez', async () => {
    resetarFilaPdfParaTeste();
    const ordem: string[] = [];
    const primeiro = enfileirarPdf(async () => {
      ordem.push('a-ini');
      await esperar(40);
      ordem.push('a-fim');
      return 'a';
    });
    const segundo = enfileirarPdf(async () => {
      ordem.push('b-ini');
      ordem.push('b-fim');
      return 'b';
    });
    const resultados = await Promise.all([primeiro, segundo]);
    assert.deepEqual(resultados, ['a', 'b']);
    assert.deepEqual(ordem, ['a-ini', 'a-fim', 'b-ini', 'b-fim']);
  });

  it('uma falha não trava o próximo PDF', async () => {
    resetarFilaPdfParaTeste();
    await assert.rejects(enfileirarPdf(async () => {
      throw new Error('chrome caiu');
    }));
    assert.equal(await enfileirarPdf(async () => 7), 7);
  });
});
