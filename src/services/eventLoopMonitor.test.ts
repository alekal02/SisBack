import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { avisoAtrasoEventLoop } from './eventLoopMonitor';

describe('atraso do event loop', () => {
  it('fica calado até 500 ms e avisa acima disso', () => {
    assert.equal(avisoAtrasoEventLoop(120), null);
    assert.equal(avisoAtrasoEventLoop(500), null);
    assert.equal(avisoAtrasoEventLoop(840), '[EventLoop] atraso máximo 840 ms');
  });
});
