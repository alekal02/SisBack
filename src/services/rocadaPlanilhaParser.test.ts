import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { parsearPlanilhaRocada, resumoParseRocada, labelModeloRocada } from './rocadaPlanilhaParser';

const DIR = 'C:/Users/Kal/Downloads/planilha roçada';

function ler(nome: string): Buffer {
  return fs.readFileSync(path.join(DIR, nome));
}

describe('parsearPlanilhaRocada — 5 modelos reais', () => {
  it('Londrina: metragem US e data 1-Jun', () => {
    if (!fs.existsSync(DIR)) return;
    const r = parsearPlanilhaRocada(ler('Planilha de roçada - modelo Londrina.xlsx'));
    const s = resumoParseRocada(r);
    assert.equal(r.modelo, 'londrina');
    assert.equal(labelModeloRocada(r.modelo), 'Londrina');
    assert.ok(s.registros >= 2);
    assert.ok(s.areaTotalM2 >= 20000);
    assert.ok(r.linhas.every((l) => l.bairro && !/^TOTAL$/i.test(l.bairro)));
    assert.equal(r.linhas[0].dataSaida?.toISOString().slice(0, 10), '2026-06-01');
  });

  it('QGIS: coluna Tipo Manual+Mecanizada (não força pelo nome da aba)', () => {
    if (!fs.existsSync(DIR)) return;
    const r = parsearPlanilhaRocada(ler('Planilha de roçada - modelo QGIS.xlsx'));
    const s = resumoParseRocada(r);
    assert.equal(r.modelo, 'qgis');
    assert.ok(s.registros > 1000);
    assert.ok(r.linhas[0].areaM2 > 100);
    assert.ok(r.abasUsadas.length >= 1);
    assert.ok(r.porTipoExecucao.mecanizada.registros > 0);
    assert.ok(r.porTipoExecucao.manual.registros > 0);
  });

  it('QGIS: filtro Manual vs Mecanizada pelo serviço', () => {
    if (!fs.existsSync(DIR)) return;
    const man = parsearPlanilhaRocada(ler('Planilha de roçada - modelo QGIS.xlsx'), { filtroTipo: 'manual' });
    const mec = parsearPlanilhaRocada(ler('Planilha de roçada - modelo QGIS.xlsx'), { filtroTipo: 'mecanizada' });
    assert.ok(man.linhas.length > 0);
    assert.ok(mec.linhas.length > 0);
    assert.ok(man.linhas.every((l) => l.tipoExecucao === 'manual'));
    assert.ok(mec.linhas.every((l) => l.tipoExecucao === 'mecanizada'));
  });

  it('Pinda: TOTAL m² e data dd\\mm\\yyyy', () => {
    if (!fs.existsSync(DIR)) return;
    const r = parsearPlanilhaRocada(ler('Planilha de roçada - modelo Pindamonhangaba.xlsx'));
    assert.equal(r.modelo, 'pindamonhangaba');
    assert.ok(r.linhas[0].areaM2 >= 1000);
    assert.equal(r.linhas[0].dataSaida?.toISOString().slice(0, 10), '2026-06-01');
  });

  it('Betim: LOCALIZAÇÃO + COMPRIMENTO×LARGURA/TOTAL', () => {
    if (!fs.existsSync(DIR)) return;
    const r = parsearPlanilhaRocada(ler('Planilha de roçada - modelo Betim.xlsm'));
    const s = resumoParseRocada(r);
    assert.equal(r.modelo, 'betim_trator');
    assert.equal(labelModeloRocada(r.modelo), 'Betim');
    assert.ok(s.podeImportar);
    assert.ok(s.registros >= 1);
    assert.ok(s.areaTotalM2 > 0);
  });

  it('Padrão (modelo.xlsm): aba ROÇADA com TRECHO/EXECUTADO — ignora TRATOR vazio', () => {
    if (!fs.existsSync(DIR)) return;
    const r = parsearPlanilhaRocada(ler('Planilha de roçada - modelo.xlsm'));
    const s = resumoParseRocada(r);
    assert.equal(r.modelo, 'modelo_trecho');
    assert.equal(labelModeloRocada(r.modelo), 'Padrão (área m²)');
    assert.ok(s.podeImportar);
    assert.ok(s.registros >= 2);
    assert.ok(s.areaTotalM2 >= 7000);
    assert.ok(r.abasUsadas.includes('ROÇADA'));
    assert.ok(!r.abasUsadas.some((a) => /trator/i.test(a)));
  });
});
