import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  camposMetricaDeRegistro,
  metricaDeRegistro,
  metricaOficialServico,
} from '@sistemma/shared';
import { sqlAreaM2, sqlKmLinear, sqlMetroLinear, sqlQtdArvore, sqlQuantitativo } from './metricaServicoSql';

const servicos = [
  'rocadeira',
  'capina',
  'varricao',
  'poda',
  'pintura_meio_fio',
  'remocao',
  'geral',
] as const;

describe('metrica oficial dos serviços', () => {
  it('não soma aliases da mesma linha', () => {
    const registro = {
      'Area m²': 80,
      AREA_M2: 80,
      QUANTITATIVO: 80,
      'Metro Linear': 1000,
      METRO_LINEAR: 1000,
      COMPRIMENTO: 40,
      'COMPRIMENTO TOTAL': 400,
      'KM Linear': 1.5,
      KM_LINEAR: 1.5,
      'Quantidade de Arvore': 12,
      QTD_ARVORE: 12,
    };
    const campos = camposMetricaDeRegistro(registro);
    assert.equal(campos.areaM2, 80);
    assert.equal(campos.metroLinear, 1000);
    assert.equal(campos.kmLinear, 1.5);
    assert.equal(campos.qtdArvore, 12);
    assert.equal(campos.quantitativo, 80);
    assert.equal(metricaDeRegistro('rocadeira', registro).valor, 80);
    assert.equal(metricaDeRegistro('capina', registro).valor, 1000);
    assert.equal(metricaDeRegistro('varricao', registro).valor, 1.5);
    assert.equal(metricaDeRegistro('poda', registro).valor, 12);
    assert.equal(metricaDeRegistro('pintura_meio_fio', registro).valor, 1000);
  });

  it('capina fica em metros e não usa o espelho em km', () => {
    const agregado = { metroLinear: 2500, kmLinear: 2.5, quantitativo: 2500, areaM2: 2500, qtdArvore: 0 };
    const tela = metricaOficialServico('capina', agregado);
    const pdfDia = metricaOficialServico('capina', agregado);
    const pdfCiclo = metricaOficialServico('capina', agregado);
    const pdfContrato = metricaOficialServico('capina', agregado);
    assert.deepEqual(tela, pdfDia);
    assert.deepEqual(tela, pdfCiclo);
    assert.deepEqual(tela, pdfContrato);
    assert.equal(tela.valor, 2500);
    assert.equal(tela.sufixo, 'm');
    assert.deepEqual(tela.pendencias, []);
  });

  it('capina sem metro linear não converte km', () => {
    const m = metricaOficialServico('capina', { kmLinear: 2.5, quantitativo: 2.5, metroLinear: 0 });
    assert.equal(m.valor, 0);
    assert.equal(m.sufixo, 'm');
    assert.equal(m.pendencias.length, 1);
  });

  it('varrição usa km e não converte metro', () => {
    const comKm = metricaOficialServico('varricao', { kmLinear: 3.25, metroLinear: 3250, quantitativo: 3250 });
    assert.equal(comKm.valor, 3.25);
    assert.equal(comKm.sufixo, 'km');
    const soMetro = metricaOficialServico('varricao', { metroLinear: 800, quantitativo: 800, kmLinear: null });
    assert.equal(soMetro.valor, 0);
    assert.equal(soMetro.pendencias.length, 1);
  });

  it('roçada manual e mecanizada usam somente a área', () => {
    for (const tipo of ['rocadeira'] as const) {
      const m = metricaOficialServico(tipo, { areaM2: 1500.5, quantitativo: 9, kmLinear: 4 });
      assert.equal(m.valor, 1500.5);
      assert.equal(m.sufixo, 'm²');
    }
    const semArea = metricaOficialServico('rocadeira', { areaM2: null, quantitativo: 40 });
    assert.equal(semArea.valor, 0);
    assert.equal(semArea.pendencias.length, 1);
  });

  it('poda soma a quantidade de árvores e ignora a contagem de linhas', () => {
    const m = metricaOficialServico('poda', { qtdArvore: 12, quantitativo: 1, rotas: 1 } as never);
    assert.equal(m.valor, 12);
    assert.equal(m.sufixo, 'arv');
    const semColuna = metricaOficialServico('poda', { qtdArvore: 0, quantitativo: 7 });
    assert.equal(semColuna.valor, 0);
    assert.equal(semColuna.pendencias.length, 1);
  });

  it('pintura usa metragem e não a quantidade de itens', () => {
    const m = metricaOficialServico('pintura_meio_fio', { metroLinear: 86, quantitativo: 4 });
    assert.equal(m.valor, 86);
    assert.equal(m.sufixo, 'm');
    const soItens = metricaOficialServico('pintura_meio_fio', { quantitativo: 4, metroLinear: null });
    assert.equal(soItens.valor, 0);
    assert.equal(soItens.pendencias.length, 1);
    const registro = { COMPRIMENTO: 15, 'COMPRIMENTO TOTAL': 90, QUANTITATIVO: 3 };
    assert.equal(metricaDeRegistro('pintura_meio_fio', registro).valor, 15);
    const soTotal = { 'COMPRIMENTO TOTAL': 90, QUANTIDADE: 2 };
    assert.equal(metricaDeRegistro('pintura_meio_fio', soTotal).valor, 90);
  });

  it('remoção e feiras são pontos, não árvores', () => {
    const remocao = metricaOficialServico('remocao', { quantitativo: 6, qtdArvore: 6, rotas: 20 } as never);
    const feiras = metricaOficialServico('geral', { quantitativo: 4, qtdArvore: 4 } );
    assert.equal(remocao.valor, 6);
    assert.equal(remocao.sufixo, 'pts');
    assert.equal(remocao.label, 'Pontos');
    assert.equal(feiras.valor, 4);
    assert.equal(feiras.sufixo, 'pts');
    assert.equal(feiras.label, 'Pontos');
  });

  it('nulo e zero não viram quantidade', () => {
    for (const tipo of servicos) {
      const m = metricaOficialServico(tipo, {
        areaM2: null,
        metroLinear: 0,
        kmLinear: undefined,
        qtdArvore: null,
        quantitativo: 0,
      });
      assert.equal(m.valor, 0, tipo);
    }
  });

  it('SQL lê um alias por medida e não soma quantitativo na área nem na árvore', () => {
    assert.doesNotMatch(sqlAreaM2(), /QUANTITATIVO|QUANTIDADE/);
    assert.match(sqlAreaM2(), /Area m²/);
    assert.match(sqlMetroLinear(), /COMPRIMENTO TOTAL/);
    assert.doesNotMatch(sqlMetroLinear(), /QUANTITATIVO/);
    assert.doesNotMatch(sqlQtdArvore(), /QUANTITATIVO|COUNT/);
    assert.match(sqlQtdArvore(), /Quantidade de Arvore/);
    assert.match(sqlKmLinear(), /KM Linear/);
    assert.doesNotMatch(sqlKmLinear(), /kmTotal/);
    assert.match(sqlQuantitativo(), /QUANTITATIVO/);
    assert.doesNotMatch(sqlAreaM2() + sqlMetroLinear() + sqlKmLinear() + sqlQtdArvore(), /\s\+\s/);
  });
});
