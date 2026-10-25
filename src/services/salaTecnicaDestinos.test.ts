import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decidirDestinosSalaTecnica } from './salaTecnicaDestinos';

const grupos = ['1203630@g.us', '1203631@g.us'];

describe('sala técnica — destinos do relatório', () => {
  it('envia só ao grupo informado', () => {
    const r = decidirDestinosSalaTecnica({
      grupoPedido: '1203630@g.us',
      confirmarTodosGrupos: false,
      gruposAtivos: grupos,
    });
    assert.deepEqual(r, { destinos: ['1203630@g.us'] });
  });

  it('não dispara para todos os grupos quando o destino vem vazio', () => {
    const r = decidirDestinosSalaTecnica({
      grupoPedido: '',
      confirmarTodosGrupos: false,
      gruposAtivos: grupos,
    });
    assert.ok('erro' in r);
  });

  it('só alcança todos os grupos com confirmação explícita', () => {
    const r = decidirDestinosSalaTecnica({
      grupoPedido: '',
      confirmarTodosGrupos: true,
      gruposAtivos: grupos,
    });
    assert.deepEqual(r, { destinos: grupos });
  });
});
