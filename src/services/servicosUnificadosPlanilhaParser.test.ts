import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import {
  detectarPlanilhaServicosUnificados,
  parsearPlanilhaServicosUnificados,
  mapearTipoServicoUnificado,
} from './servicosUnificadosPlanilhaParser';

const ARQUIVO_EXEMPLO =
  'C:/Users/Kal/Downloads/TESTEEE 22 agora o kalebe para de reclamar.xlsx';

describe('servicosUnificadosPlanilhaParser', () => {
  it('mapeia tipos de serviço', () => {
    assert.equal(mapearTipoServicoUnificado('CAPINA'), 'capina');
    assert.equal(mapearTipoServicoUnificado('ROÇADA'), 'rocadeira');
    assert.equal(mapearTipoServicoUnificado('VARRIÇÃO'), 'varricao');
    assert.equal(mapearTipoServicoUnificado('PODA'), 'poda');
    assert.equal(mapearTipoServicoUnificado('XYZ'), null);
  });

  it('lê abas com layout unificado e separa por TIPO DE SERVIÇO', () => {
    if (!fs.existsSync(ARQUIVO_EXEMPLO)) return;
    const buf = fs.readFileSync(ARQUIVO_EXEMPLO);
    assert.equal(detectarPlanilhaServicosUnificados(buf), true);

    const r = parsearPlanilhaServicosUnificados(buf);
    assert.equal(r.modelo, 'servicos_unificados');
    assert.ok(r.abasUsadas.length >= 1);
    // Arquivo de exemplo tem a maior parte dos dados em Tabela* (CONSOLIDADO quase vazia)
    assert.ok(
      r.linhas.length >= 50,
      `esperava dados das Tabelas/abas filhas, veio ${r.linhas.length}`,
    );

    const capina = r.porTipo.find((p) => p.tipoSistema === 'capina');
    const rocada = r.porTipo.find((p) => p.tipoSistema === 'rocadeira');
    assert.ok(capina && capina.registros > 0, 'deveria ter CAPINA');
    assert.ok(rocada && rocada.registros > 0, 'deveria ter ROÇADA');
    assert.ok(
      (capina?.registros || 0) > (rocada?.registros || 0),
      'CAPINA deveria ter mais registros que ROÇADA neste arquivo',
    );
    assert.ok(r.avisos.some((a) => /separados por TIPO DE SERVIÇO/i.test(a)));
  });

  it('não detecta buffer vazio/inválido como unificado', () => {
    assert.equal(detectarPlanilhaServicosUnificados(Buffer.from('not-an-xlsx')), false);
  });
});
