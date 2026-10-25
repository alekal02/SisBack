import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcularTendencia,
  coeficienteVariacao,
  mediana,
  montarFichasRotaCiclo,
  type RegistroRotaDia,
} from './rotaCicloService';

function reg(
  data: string,
  rota: string,
  viagens: number,
  toneladas: number,
  km: number,
  horasProdutivas = 4,
): RegistroRotaDia {
  return { data, rota, viagens, toneladas, km, horasProdutivas, tipo: 'TOCO' };
}

describe('estatísticas de rota', () => {
  test('mediana com número ímpar de dias pega o valor do meio', () => {
    assert.equal(mediana([10, 30, 20]), 20);
  });

  test('mediana com número par de dias faz a média dos dois centrais', () => {
    assert.equal(mediana([10, 20, 30, 40]), 25);
  });

  test('mediana ignora lista vazia', () => {
    assert.equal(mediana([]), null);
  });

  test('mediana resiste a um dia atípico, ao contrário da média', () => {
    const dias = [50, 52, 51, 500];
    const media = dias.reduce((s, v) => s + v, 0) / dias.length;
    assert.equal(mediana(dias), 51.5);
    assert.ok(media > 150);
  });

  test('coeficiente de variação é baixo em rota repetível', () => {
    const cv = coeficienteVariacao([50, 51, 49, 50]);
    assert.ok(cv != null && cv < 5, `esperado cv baixo, veio ${cv}`);
  });

  test('coeficiente de variação é alto em rota irregular', () => {
    const cv = coeficienteVariacao([20, 80, 35, 95]);
    assert.ok(cv != null && cv > 30, `esperado cv alto, veio ${cv}`);
  });

  test('coeficiente de variação exige pelo menos dois dias', () => {
    assert.equal(coeficienteVariacao([50]), null);
  });
});

describe('calcularTendencia', () => {
  const dia = (data: string, tonPorViagem: number) => ({
    data,
    viagens: 2,
    toneladas: tonPorViagem * 2,
    km: 50,
    horasProdutivas: 4,
    tonPorViagem,
  });

  test('detecta queda de carga na segunda metade do ciclo', () => {
    const t = calcularTendencia([
      dia('2026-08-01', 10),
      dia('2026-08-02', 10),
      dia('2026-08-03', 8),
      dia('2026-08-04', 8),
    ]);
    assert.equal(t?.direcao, 'piorando');
    assert.equal(t?.variacaoPct, -20);
  });

  test('detecta melhoria de carga', () => {
    const t = calcularTendencia([
      dia('2026-08-01', 8),
      dia('2026-08-02', 8),
      dia('2026-08-03', 10),
      dia('2026-08-04', 10),
    ]);
    assert.equal(t?.direcao, 'melhorando');
    assert.equal(t?.variacaoPct, 25);
  });

  test('variação pequena fica estável', () => {
    const t = calcularTendencia([
      dia('2026-08-01', 10),
      dia('2026-08-02', 10),
      dia('2026-08-03', 10.3),
      dia('2026-08-04', 10.3),
    ]);
    assert.equal(t?.direcao, 'estavel');
  });

  test('poucos dias não geram tendência', () => {
    const t = calcularTendencia([dia('2026-08-01', 10), dia('2026-08-02', 6)]);
    assert.equal(t, null);
  });
});

describe('montarFichasRotaCiclo', () => {
  test('soma o ciclo e calcula a mediana do comportamento diário', () => {
    const fichas = montarFichasRotaCiclo([
      reg('2026-08-01', 'CENTRO', 2, 18, 60),
      reg('2026-08-02', 'CENTRO', 2, 20, 62),
      reg('2026-08-03', 'CENTRO', 2, 19, 61),
    ]);

    assert.equal(fichas.length, 1);
    const f = fichas[0];
    assert.equal(f.rota, 'CENTRO');
    assert.equal(f.diasComOperacao, 3);
    assert.equal(f.viagens, 6);
    assert.equal(f.toneladas, 57);
    assert.equal(f.medianaKmDia, 61);
    assert.equal(f.medianaTonDia, 19);
    assert.equal(f.medianaTonPorViagem, 9.5);
    assert.equal(f.tipoPredominante, 'TOCO');
  });

  test('agrega várias linhas do mesmo dia na mesma rota', () => {
    const fichas = montarFichasRotaCiclo([
      reg('2026-08-01', 'CENTRO', 2, 18, 60),
      reg('2026-08-01', 'CENTRO', 1, 9, 30),
    ]);

    assert.equal(fichas[0].diasComOperacao, 1);
    assert.equal(fichas[0].viagens, 3);
    assert.equal(fichas[0].toneladas, 27);
    assert.equal(fichas[0].porDia[0].km, 90);
  });

  test('marca rota instável quando o KM diário varia muito', () => {
    const fichas = montarFichasRotaCiclo([
      reg('2026-08-01', 'INSTAVEL', 2, 18, 30),
      reg('2026-08-02', 'INSTAVEL', 2, 18, 95),
      reg('2026-08-03', 'INSTAVEL', 2, 18, 40),
      reg('2026-08-04', 'INSTAVEL', 2, 18, 110),
    ]);

    const f = fichas[0];
    assert.equal(f.instavelKm, true);
    assert.ok(f.alertas.some((a) => a.includes('KM diário varia')));
  });

  test('rota repetível não é marcada como instável', () => {
    const fichas = montarFichasRotaCiclo([
      reg('2026-08-01', 'ESTAVEL', 2, 18, 60),
      reg('2026-08-02', 'ESTAVEL', 2, 18, 61),
      reg('2026-08-03', 'ESTAVEL', 2, 18, 59),
      reg('2026-08-04', 'ESTAVEL', 2, 18, 60),
    ]);

    const f = fichas[0];
    assert.equal(f.instavelKm, false);
    assert.equal(f.instavelCarga, false);
    assert.deepEqual(f.alertas, []);
  });

  test('alerta quando a carga por viagem cai ao longo do ciclo', () => {
    const fichas = montarFichasRotaCiclo([
      reg('2026-08-01', 'CAINDO', 2, 20, 60),
      reg('2026-08-02', 'CAINDO', 2, 20, 60),
      reg('2026-08-03', 'CAINDO', 2, 14, 60),
      reg('2026-08-04', 'CAINDO', 2, 14, 60),
    ]);

    const f = fichas[0];
    assert.equal(f.tendencia?.direcao, 'piorando');
    assert.ok(f.alertas.some((a) => a.includes('Tonelada por viagem caiu')));
  });

  test('alerta quando a rota cobre menos da metade dos dias do período', () => {
    const fichas = montarFichasRotaCiclo(
      [reg('2026-08-01', 'ESPORADICA', 2, 18, 60), reg('2026-08-02', 'ESPORADICA', 2, 18, 60)],
      { diasPeriodo: 30 },
    );

    assert.ok(fichas[0].alertas.some((a) => a.includes('operou em 2 de 30 dias')));
  });

  test('ordena as rotas pela tonelagem do ciclo', () => {
    const fichas = montarFichasRotaCiclo([
      reg('2026-08-01', 'PEQUENA', 1, 5, 20),
      reg('2026-08-01', 'GRANDE', 4, 40, 80),
      reg('2026-08-01', 'MEDIA', 2, 18, 50),
    ]);

    assert.deepEqual(fichas.map((f) => f.rota), ['GRANDE', 'MEDIA', 'PEQUENA']);
  });

  test('rota sem nome cai em "Não informado"', () => {
    const fichas = montarFichasRotaCiclo([reg('2026-08-01', '  ', 1, 5, 20)]);
    assert.equal(fichas[0].rota, 'Não informado');
  });

  test('registro sem data é ignorado', () => {
    const fichas = montarFichasRotaCiclo([reg('', 'CENTRO', 1, 5, 20)]);
    assert.equal(fichas.length, 0);
  });
});
