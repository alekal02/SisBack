import test from 'node:test';
import assert from 'node:assert/strict';
import { calcularWarmupPedido } from './warmupPolicy';

test('limita o warmup em ambiente de máquina fraca', () => {
  const pedido = calcularWarmupPedido({
    fullScan: false,
    contratoTotal: 12,
    servicoTotal: 42,
    servicos: ['s1', 's2', 's3', 's4', 's5', 's6'],
    maxContratos: 2,
    maxServicos: 3,
  });

  assert.equal(pedido.fullScan, false);
  assert.equal(pedido.maxContratos, 2);
  assert.equal(pedido.maxServicos, 3);
  assert.deepEqual(pedido.servicos, ['s1', 's2', 's3']);
});

test('mantém o warmup completo apenas quando explicitamente habilitado', () => {
  const pedido = calcularWarmupPedido({
    fullScan: true,
    contratoTotal: 12,
    servicoTotal: 42,
    servicos: ['s1', 's2', 's3'],
    maxContratos: 2,
    maxServicos: 3,
  });

  assert.equal(pedido.fullScan, true);
  assert.equal(pedido.maxContratos, 12);
  assert.equal(pedido.maxServicos, 42);
});
