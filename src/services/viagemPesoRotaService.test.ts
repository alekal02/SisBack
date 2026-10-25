import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  agruparViagensPesoPorLinha,
  montarViagensPesoDoRegistro,
  ratearHoras,
} from './viagemPesoRotaService';

describe('ratearHoras', () => {
  it('divide e o último recebe o resto', () => {
    assert.deepEqual(ratearHoras(5.4, 2), [2.7, 2.7]);
    assert.deepEqual(ratearHoras(5.41, 3), [1.8, 1.8, 1.81]);
  });
});

describe('montarViagensPesoDoRegistro', () => {
  it('Mini com 2 PESOs e 4 trechos: uma hora por trecho, as extras sem peso', () => {
    const viagens = montarViagensPesoDoRegistro({
      data: '2026-09-11',
      rota: 'MC2B-L',
      placa: 'RJI2E33',
      motorista: 'JOÃO',
      tipo: 'MINI',
      pesos: [3480, 3410, 0, null],
      pesoIdealKg: 3300,
      objHoras: {
        dados: {
          'HORA SÁIDA BASE': 8 / 24,
          'HORA CHEGADA BASE': 16 / 24,
          'HORA CHEGADA ROTA 01': 8 / 24,
          'HORA SAÍDA ROTA 01': 9.5 / 24,
          'HORA CHEGADA ROTA 02': 10 / 24,
          'HORA SAÍDA ROTA 02': 11.3 / 24,
          'HORA CHEGADA ROTA 03': 12 / 24,
          'HORA SAÍDA ROTA 03': 13.4 / 24,
          'HORA CHEGADA ROTA 04': 14 / 24,
          'HORA SAÍDA ROTA 04': 15.2 / 24,
        },
      },
    });

    assert.equal(viagens.length, 4);
    assert.equal(viagens[0].nViagem, 1);
    assert.equal(viagens[1].nViagem, 2);
    assert.equal(viagens[0].encheu, true);
    assert.equal(viagens[1].encheu, true);
    assert.equal(viagens[0].origemHora, 'trecho');
    assert.equal(viagens[0].horasProdutivasViagem, 1.5);
    assert.equal(viagens[1].horasProdutivasViagem, 1.3);
    assert.equal(viagens[2].semPesagem, true);
    assert.equal(viagens[3].semPesagem, true);
    assert.ok(viagens[0].horasProdutivasViagem < 3);
  });

  it('2 PESOs e 2 trechos: usa a hora de cada trecho', () => {
    const viagens = montarViagensPesoDoRegistro({
      rota: 'A',
      placa: 'ABC1D23',
      motorista: 'X',
      tipo: 'MINI',
      pesos: [2000, 1500],
      pesoIdealKg: 3300,
      objHoras: {
        dados: {
          'HORA SÁIDA BASE': 8 / 24,
          'HORA CHEGADA BASE': 14 / 24,
          'HORA CHEGADA ROTA 01': 8 / 24,
          'HORA SAÍDA ROTA 01': 10 / 24,
          'HORA CHEGADA ROTA 02': 11 / 24,
          'HORA SAÍDA ROTA 02': 13.5 / 24,
        },
      },
    });
    assert.equal(viagens.length, 2);
    assert.equal(viagens[0].origemHora, 'trecho');
    assert.equal(viagens[0].horasProdutivasViagem, 2);
    assert.equal(viagens[1].horasProdutivasViagem, 2.5);
    assert.equal(viagens[0].encheu, false);
    assert.equal(viagens[0].estimado, true);
    assert.equal(viagens[0].tempoEqEncher, 3.3); // 2h × (3300/2000)
  });

  it('preenche km da viagem e hora total da jornada (não só produtiva)', () => {
    const viagens = montarViagensPesoDoRegistro({
      rota: 'BD05',
      placa: 'RBS6G77',
      motorista: 'X',
      tipo: 'TOCO',
      pesos: [7000, 8200],
      pesoIdealKg: 8250,
      objHoras: {
        kmTotal: 142,
        dados: {
          'HORA SÁIDA BASE': 7 / 24,
          'HORA CHEGADA BASE': 16 / 24,
          'HORA CHEGADA ROTA 01': 8 / 24,
          'HORA SAÍDA ROTA 01': 11 / 24,
          'HORA CHEGADA ROTA 02': 12 / 24,
          'HORA SAÍDA ROTA 02': 14.7 / 24,
          'KM CHEGADA ROTA 01': 10,
          'KM SAÍDA ROTA 01': 48,
          'KM CHEGADA ROTA 02': 60,
          'KM SAÍDA ROTA 02': 95,
        },
      },
    });
    assert.equal(viagens.length, 2);
    assert.equal(viagens[0].kmViagem, 38);
    assert.equal(viagens[1].kmViagem, 35);
    assert.equal(viagens[0].kmTotalRota, 142);
    assert.equal(viagens[0].horasTotaisRota, 9);
    assert.equal(viagens[0].horasProdutivasViagem, 3);
    const grupos = agruparViagensPesoPorLinha(viagens);
    assert.equal(grupos[0].kmTotalRota, 142);
    assert.equal(grupos[0].horasTotaisRota, 9);
  });

  it('usa KM TOTAL da planilha e soma hodômetro se a coluna tipada vier vazia', () => {
    const comColuna = montarViagensPesoDoRegistro({
      rota: 'BD05',
      placa: 'RBS6G77',
      motorista: 'X',
      tipo: 'TOCO',
      pesos: [7000, 8200],
      pesoIdealKg: 8250,
      objHoras: {
        dados: {
          'KM TOTAL': 142,
          'HORA SÁIDA BASE': 7 / 24,
          'HORA CHEGADA BASE': 16 / 24,
          'HORA CHEGADA ROTA 01': 8 / 24,
          'HORA SAÍDA ROTA 01': 11 / 24,
          'HORA CHEGADA ROTA 02': 12 / 24,
          'HORA SAÍDA ROTA 02': 14.7 / 24,
          'KM CHEGADA ROTA 01': 10,
          'KM SAÍDA ROTA 01': 48,
          'KM CHEGADA ROTA 02': 60,
          'KM SAÍDA ROTA 02': 95,
        },
      },
    });
    assert.equal(comColuna[0].kmTotalRota, 142);
    assert.equal(comColuna[0].horasTotaisRota, 9);

    const soHodometro = montarViagensPesoDoRegistro({
      rota: 'BD05',
      placa: 'RBS6G77',
      motorista: 'X',
      tipo: 'TOCO',
      pesos: [7000],
      pesoIdealKg: 8250,
      objHoras: {
        dados: {
          'HORA SÁIDA BASE': 7 / 24,
          'HORA CHEGADA BASE': 16 / 24,
          'HORA CHEGADA ROTA 01': 8 / 24,
          'HORA SAÍDA ROTA 01': 11 / 24,
          'KM CHEGADA ROTA 01': 10,
          'KM SAÍDA ROTA 01': 48,
        },
      },
    });
    assert.equal(soHodometro[0].kmTotalRota, 38);
    assert.equal(soHodometro[0].kmViagem, 38);
    assert.equal(soHodometro[0].horasTotaisRota, 9);
  });

  it('2 trechos e 1 pesagem: hora de cada viagem, a segunda sem peso', () => {
    const viagens = montarViagensPesoDoRegistro({
      rota: '01AD',
      placa: 'RBK7H47',
      motorista: 'JOÃO VIEIRA',
      tipo: null,
      pesos: [8390, 0, null],
      nViagens: 2,
      pesoIdealKg: 8250,
      objHoras: {
        dados: {
          'HORA SÁIDA BASE': 7 / 24,
          'HORA CHEGADA BASE': 16 / 24,
          'HORA CHEGADA ROTA 01': 7.2 / 24,
          'HORA SAÍDA ROTA 01': 11.4 / 24,
          'HORA CHEGADA ROTA 02': 12.1 / 24,
          'HORA SAÍDA ROTA 02': 16 / 24,
        },
      },
    });
    assert.equal(viagens.length, 2);
    assert.equal(viagens[0].origemHora, 'trecho');
    assert.equal(viagens[0].horasProdutivasViagem, 4.2);
    assert.equal(viagens[0].semPesagem, false);
    assert.equal(viagens[0].pesoKg, 8390);
    assert.equal(viagens[1].nViagem, 2);
    assert.equal(viagens[1].semPesagem, true);
    assert.equal(viagens[1].pesoKg, 0);
    assert.equal(viagens[1].horasProdutivasViagem, 3.9);
    assert.ok(viagens[0].horasProdutivasViagem < 8);
  });

  it('CONTADOR=2 e um único horário: não inventa a segunda faixa sem dado', () => {
    const viagens = montarViagensPesoDoRegistro({
      rota: '01AD',
      placa: 'RBK7H47',
      motorista: 'JOÃO VIEIRA',
      tipo: null,
      pesos: [8390],
      nViagens: 2,
      pesoIdealKg: null,
      objHoras: {
        dados: {
          'HORA CHEGADA ROTA 01': 7.2 / 24,
          'HORA SAÍDA ROTA 01': 15.3 / 24,
        },
      },
    });
    assert.equal(viagens.length, 1);
    assert.equal(viagens[0].semPesagem, false);
    assert.equal(viagens[0].horasProdutivasViagem, 8.1);
  });

  it('CONTADOR=4 com só 2 pesagens e sem horário extra: não polui com sem pesagem', () => {
    const viagens = montarViagensPesoDoRegistro({
      rota: '04AD',
      placa: 'SCS5G66',
      motorista: 'X',
      tipo: 'TOCO',
      pesos: [5540, 6440, 0, 0],
      nViagens: 4,
      pesoIdealKg: 6450,
      objHoras: {
        dados: {
          'HORA CHEGADA ROTA 01': 8 / 24,
          'HORA SAÍDA ROTA 01': 9.4 / 24,
          'HORA CHEGADA ROTA 02': 10 / 24,
          'HORA SAÍDA ROTA 02': 11.4 / 24,
        },
      },
    });
    assert.equal(viagens.length, 2);
    assert.equal(viagens.every((v) => !v.semPesagem), true);
    assert.equal(viagens[0].horasProdutivasViagem, 1.4);
    assert.equal(viagens[1].horasProdutivasViagem, 1.4);
  });

  it('contador tipado=1 mas 2 horários: ainda abre a segunda viagem', () => {
    const viagens = montarViagensPesoDoRegistro({
      rota: '01AD',
      placa: 'RBK7H47',
      motorista: 'X',
      tipo: null,
      pesos: [8390],
      nViagens: 1,
      pesoIdealKg: null,
      objHoras: {
        dados: {
          'HORA CHEGADA ROTA 01': 8 / 24,
          'HORA SAÍDA ROTA 01': 12 / 24,
          'HORA CHEGADA ROTA 02': 13 / 24,
          'HORA SAÍDA ROTA 02': 17.1 / 24,
        },
      },
    });
    assert.equal(viagens.length, 2);
    assert.equal(viagens[0].horasProdutivasViagem, 4);
    assert.equal(viagens[1].horasProdutivasViagem, 4.1);
  });

  it('1 pesagem + 2 horários, sem contador: não joga as 8 h na viagem pesada', () => {
    const viagens = montarViagensPesoDoRegistro({
      rota: '01AD',
      placa: 'RBK7H47',
      motorista: 'X',
      tipo: null,
      pesos: [8390],
      pesoIdealKg: null,
      objHoras: {
        dados: {
          'HORA CHEGADA ROTA 01': 8 / 24,
          'HORA SAÍDA ROTA 01': 12 / 24,
          'HORA CHEGADA ROTA 02': 13 / 24,
          'HORA SAÍDA ROTA 02': 17.1 / 24,
        },
      },
    });
    assert.equal(viagens.length, 2);
    assert.equal(viagens[0].horasProdutivasViagem, 4);
    assert.equal(viagens[1].horasProdutivasViagem, 4.1);
    assert.equal(viagens[1].semPesagem, true);
  });

  it('agrupa por rota e mostra a soma das horas das viagens', () => {
    const viagens = montarViagensPesoDoRegistro({
      data: '2026-09-11',
      rota: 'MC2B-L',
      placa: 'RJI2E33',
      motorista: 'JOÃO',
      tipo: 'MINI',
      pesos: [3480, 3410],
      pesoIdealKg: 3300,
      objHoras: {
        dados: {
          'HORA SÁIDA BASE': 8 / 24,
          'HORA CHEGADA BASE': 14 / 24,
          'HORA CHEGADA ROTA 01': 8 / 24,
          'HORA SAÍDA ROTA 01': 10.7 / 24,
          'HORA CHEGADA ROTA 02': 11 / 24,
          'HORA SAÍDA ROTA 02': 13.7 / 24,
        },
      },
    });
    const grupos = agruparViagensPesoPorLinha(viagens);
    assert.equal(grupos.length, 1);
    assert.equal(grupos[0].viagens.length, 2);
    assert.equal(grupos[0].horasProdutivasRota, 5.4);
  });
});
