import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  alertasQuantidadeForaDoNormal,
  juntarConferencias,
  montarConferencia,
} from './conferenciaImportacaoService';

const TEXTO = 'Varrição Mecanizada 12/09: 3.398 km, mediana 125 km — confira';

const historico125 = [
  { data: '2026-07-10', valor: 125 },
  { data: '2026-07-11', valor: 100 },
  { data: '2026-08-12', valor: 150 },
];

describe('alerta de quantidade fora do normal', () => {
  it('avisa o dia acima de 3 vezes a mediana e não tira o registro da importação', () => {
    const alertas = alertasQuantidadeForaDoNormal({
      nome: 'Varrição Mecanizada',
      unidade: 'km',
      dias: [{ data: '2026-09-12', valor: 3398 }],
      historico: historico125,
    });
    assert.equal(alertas.length, 1);
    assert.equal(alertas[0].texto, TEXTO);

    const conf = montarConferencia({
      nome: 'Varrição Mecanizada',
      modelo: 'consolidado_producao',
      registros: [{
        dataSaida: new Date('2026-09-12T00:00:00.000Z'),
        validoDashboard: true,
        dados: { 'KM Linear': 3398, _modeloPlanilha: 'consolidado_producao' },
      }],
      ignoradas: [],
      alertasQuantidade: alertas,
    });
    assert.equal(conf.importadas, 1);
    assert.match(conf.mensagem, /3\.398 km, mediana 125 km — confira/);
  });

  it('não avisa no limite exato de 3 vezes nem de 1/3', () => {
    const noTeto = alertasQuantidadeForaDoNormal({
      nome: 'Varrição Mecanizada',
      unidade: 'km',
      dias: [{ data: '2026-09-12', valor: 375 }],
      historico: historico125,
    });
    const noPiso = alertasQuantidadeForaDoNormal({
      nome: 'Varrição Mecanizada',
      unidade: 'km',
      dias: [{ data: '2026-09-13', valor: 125 / 3 }],
      historico: historico125,
    });
    assert.deepEqual(noTeto, []);
    assert.deepEqual(noPiso, []);
  });

  it('avisa o dia abaixo de 1/3 da mediana', () => {
    const alertas = alertasQuantidadeForaDoNormal({
      nome: 'Varrição Mecanizada',
      unidade: 'km',
      dias: [{ data: '2026-09-12', valor: 40 }],
      historico: historico125,
    });
    assert.equal(alertas.length, 1);
    assert.equal(alertas[0].texto, 'Varrição Mecanizada 12/09: 40 km, mediana 125 km — confira');
  });

  it('avisa o mesmo valor repetido em 5 dias seguidos e ignora 4', () => {
    const cinco = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05']
      .map((data) => ({ data, valor: 80 }));
    const alertas = alertasQuantidadeForaDoNormal({
      nome: 'Varrição Mecanizada',
      unidade: 'km',
      dias: cinco,
      historico: cinco.map((dia) => ({ ...dia, data: dia.data.replace('09', '07') })),
    });
    assert.equal(alertas.length, 5);
    assert.equal(alertas[0].texto, 'Varrição Mecanizada 01/09: 80 km, mediana 80 km — confira');

    const quatro = alertasQuantidadeForaDoNormal({
      nome: 'Varrição Mecanizada',
      unidade: 'km',
      dias: cinco.slice(0, 4),
      historico: [{ data: '2026-07-01', valor: 80 }],
    });
    assert.deepEqual(quatro, []);
  });

  it('mantém o aviso quando a conferência junta os serviços do WhatsApp', () => {
    const alerta = alertasQuantidadeForaDoNormal({
      nome: 'Varrição Mecanizada',
      unidade: 'km',
      dias: [{ data: '2026-09-12', valor: 3398 }],
      historico: historico125,
    });
    const varricao = montarConferencia({
      nome: 'Varrição Mecanizada',
      modelo: 'consolidado_producao',
      registros: [{
        dataSaida: new Date('2026-09-12T00:00:00.000Z'),
        validoDashboard: true,
        dados: { 'KM Linear': 3398 },
      }],
      ignoradas: [],
      alertasQuantidade: alerta,
    });
    const capina = montarConferencia({
      nome: 'Capina',
      modelo: 'consolidado_producao',
      registros: [{
        dataSaida: new Date('2026-09-12T00:00:00.000Z'),
        validoDashboard: true,
        dados: { 'Metro Linear': 20 },
      }],
      ignoradas: [],
    });
    const junto = juntarConferencias([varricao, capina], 'Produção');
    assert.ok(junto);
    assert.match(junto.mensagem, /Varrição Mecanizada 12\/09: 3\.398 km, mediana 125 km — confira/);
    assert.equal(junto.importadas, 2);
  });
});
