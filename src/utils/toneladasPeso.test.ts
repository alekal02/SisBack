import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toneladasDoPesoKg } from '@sistemma/shared';

describe('toneladasDoPesoKg', () => {
  it('converte kg da planilha para toneladas (total, nunca média)', () => {
    assert.equal(Math.round(toneladasDoPesoKg(25673.7) * 10) / 10, 25.7);
    assert.equal(Math.round(toneladasDoPesoKg(685713.2) * 10) / 10, 685.7);
  });

  it('corrige kg gravado ×1000 (tela 2.7.7: 25.673,7 t no dia)', () => {
    assert.equal(Math.round(toneladasDoPesoKg(25_673_700) * 10) / 10, 25.7);
    assert.equal(Math.round(toneladasDoPesoKg(685_713_200) * 10) / 10, 685.7);
  });

  it('não altera um dia real de coleta abaixo de 10.000 t', () => {
    assert.equal(toneladasDoPesoKg(288_000), 288);
  });
});
