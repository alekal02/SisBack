import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { montarRecomendacaoConferencia } from './conferenciaDiariaPlanilhaService';

describe('montarRecomendacaoConferencia', () => {
  it('menciona remoção de dias só no sistema e substituição da planilha antiga', () => {
    const msg = montarRecomendacaoConferencia({
      diasNovos: 2,
      diasDivergentes: 1,
      diasBloqueados: 0,
      diasSomenteSistema: 3,
      temPlanilhaAnterior: true,
    });
    assert.match(msg, /2 dia\(s\) novo/);
    assert.match(msg, /1 dia\(s\) serão atualizados/);
    assert.match(msg, /3 dia\(s\) só no sistema serão removidos/);
    assert.match(msg, /planilha antiga será substituída/);
  });
});
