import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  alinharPorOcorrenciaDiaSemana,
  medianaSerie,
  montarBaselineDia,
  rotuloOcorrenciaDiaSemana,
  type DiaSerieOperacional,
} from '@sistemma/shared';

function dia(
  data: string,
  viagens: number,
  toneladas: number,
  km = 0,
  rotas = 1,
  horas = 0,
): DiaSerieOperacional {
  return { data, viagens, toneladas, km, rotas, horas };
}

function metrica(base: ReturnType<typeof montarBaselineDia>, id: string) {
  assert.ok(base, 'baseline nao deveria ser nula');
  const m = base!.metricas.find((x) => x.id === id);
  assert.ok(m, `metrica ${id} nao encontrada`);
  return m!;
}

describe('medianaSerie', () => {
  it('retorna null para lista vazia', () => {
    assert.equal(medianaSerie([]), null);
  });

  it('usa o valor central em lista impar', () => {
    assert.equal(medianaSerie([10, 2, 6]), 6);
  });

  it('usa a media dos dois centrais em lista par', () => {
    assert.equal(medianaSerie([10, 2, 6, 4]), 5);
  });

  it('ignora valores nao finitos', () => {
    assert.equal(medianaSerie([Number.NaN, 4, 8, Number.POSITIVE_INFINITY]), 6);
  });
});

describe('alinharPorOcorrenciaDiaSemana', () => {
  it('casa a n-esima ocorrencia do dia da semana entre os ciclos', () => {
    // 2026-08-03 e segunda; 2026-07-06 tambem.
    const anterior = [dia('2026-07-06', 1, 1), dia('2026-07-13', 1, 1)];
    const atual = [dia('2026-08-03', 1, 1), dia('2026-08-10', 1, 1)];
    const pares = alinharPorOcorrenciaDiaSemana(anterior, atual);
    assert.equal(pares.length, 2);
    assert.equal(pares[0].ant?.data, '2026-07-06');
    assert.equal(pares[0].ocorrencia, 1);
    assert.equal(pares[1].ant?.data, '2026-07-13');
    assert.equal(pares[1].ocorrencia, 2);
  });

  it('nao cruza dias da semana diferentes quando os ciclos comecam desalinhados', () => {
    const anterior = [dia('2026-07-07', 1, 1)]; // terca
    const atual = [dia('2026-08-03', 1, 1)]; // segunda
    const pares = alinharPorOcorrenciaDiaSemana(anterior, atual);
    assert.equal(pares[0].ant, null);
  });

  it('tolera listas vazias', () => {
    assert.deepEqual(alinharPorOcorrenciaDiaSemana([], []), []);
  });
});

describe('rotuloOcorrenciaDiaSemana', () => {
  it('usa genero do dia da semana', () => {
    assert.equal(rotuloOcorrenciaDiaSemana(1, 3), '3ª seg');
    assert.equal(rotuloOcorrenciaDiaSemana(6, 2), '2º sáb');
  });

  it('retorna tracinho para entrada invalida', () => {
    assert.equal(rotuloOcorrenciaDiaSemana(9, 1), '—');
    assert.equal(rotuloOcorrenciaDiaSemana(1, 0), '—');
  });
});

describe('montarBaselineDia', () => {
  // Segundas do ciclo: 03, 10, 17, 24 de agosto de 2026.
  const segundas = [
    dia('2026-08-03', 10, 100, 500, 4, 50),
    dia('2026-08-10', 10, 100, 500, 4, 50),
    dia('2026-08-17', 10, 100, 500, 4, 50),
  ];

  it('retorna null quando o dia nao esta na serie', () => {
    assert.equal(montarBaselineDia({ dataIso: '2026-08-24', diasCiclo: segundas }), null);
  });

  it('retorna null para data invalida', () => {
    assert.equal(montarBaselineDia({ dataIso: '24/08/2026', diasCiclo: segundas }), null);
  });

  it('retorna null quando o dia e o unico com operacao', () => {
    const base = montarBaselineDia({
      dataIso: '2026-08-03',
      diasCiclo: [segundas[0], dia('2026-08-04', 0, 0, 0, 0, 0)],
    });
    assert.equal(base, null);
  });

  it('compara o dia com a mediana do mesmo dia da semana, sem contar o proprio dia', () => {
    const diasCiclo = [...segundas, dia('2026-08-24', 5, 60, 400, 3, 40)];
    const base = montarBaselineDia({ dataIso: '2026-08-24', diasCiclo });
    const viagens = metrica(base, 'viagens');
    assert.equal(viagens.valor, 5);
    assert.equal(viagens.mesmoDiaSemana.referencia, 10);
    assert.equal(viagens.mesmoDiaSemana.delta, -5);
    assert.equal(viagens.mesmoDiaSemana.pct, -50);
    assert.equal(viagens.mesmoDiaSemana.melhor, false);
    assert.equal(base!.diasMesmoDiaSemana, 3);
    assert.equal(base!.rotuloOcorrencia, '4ª seg');
  });

  it('trata KM por viagem como pior quando sobe', () => {
    const diasCiclo = [...segundas, dia('2026-08-24', 10, 100, 1000, 4, 50)];
    const base = montarBaselineDia({ dataIso: '2026-08-24', diasCiclo });
    const kmPorViagem = metrica(base, 'kmPorViagem');
    assert.equal(kmPorViagem.valor, 100);
    assert.equal(kmPorViagem.mesmoDiaSemana.referencia, 50);
    assert.equal(kmPorViagem.mesmoDiaSemana.melhor, false);
    const km = metrica(base, 'km');
    assert.equal(km.melhorQuandoSobe, false);
    assert.equal(km.mesmoDiaSemana.melhor, false);
  });

  it('cai para a mediana do ciclo quando nao ha outro dia da mesma semana', () => {
    const diasCiclo = [
      dia('2026-08-04', 8, 80, 400, 4, 40),
      dia('2026-08-05', 12, 120, 600, 4, 60),
      dia('2026-08-03', 10, 100, 500, 4, 50),
    ];
    const base = montarBaselineDia({ dataIso: '2026-08-03', diasCiclo });
    const viagens = metrica(base, 'viagens');
    assert.equal(viagens.mesmoDiaSemana.referencia, null);
    assert.equal(viagens.medianaCiclo.referencia, 10);
    assert.equal(viagens.medianaCiclo.delta, 0);
    assert.equal(viagens.medianaCiclo.melhor, null);
    assert.equal(base!.diasMesmoDiaSemana, 0);
    assert.equal(base!.temCicloAnterior, false);
  });

  it('compara com o dia equivalente do ciclo anterior', () => {
    const anterior = [
      dia('2026-07-06', 8, 80, 400, 3, 40),
      dia('2026-07-13', 9, 90, 450, 3, 45),
    ];
    const diasCiclo = [dia('2026-08-03', 10, 100, 500, 4, 50), dia('2026-08-10', 10, 100, 500, 4, 50)];
    const base = montarBaselineDia({
      dataIso: '2026-08-10',
      diasCiclo,
      diasCicloAnterior: anterior,
    });
    assert.equal(base!.temCicloAnterior, true);
    const viagens = metrica(base, 'viagens');
    assert.equal(viagens.cicloAnterior.referencia, 9);
    assert.equal(viagens.cicloAnterior.delta, 1);
    assert.equal(viagens.cicloAnterior.melhor, true);
    assert.equal(base!.rotuloOcorrencia, '2ª seg');
  });

  it('sinaliza dia dentro do padrao quando nao ha desvio relevante', () => {
    const diasCiclo = [...segundas, dia('2026-08-24', 10, 100, 500, 4, 50)];
    const base = montarBaselineDia({ dataIso: '2026-08-24', diasCiclo });
    assert.match(base!.leitura, /dentro do padr/i);
  });

  it('descreve os maiores desvios na leitura do dia', () => {
    const diasCiclo = [...segundas, dia('2026-08-24', 5, 40, 500, 4, 50)];
    const base = montarBaselineDia({ dataIso: '2026-08-24', diasCiclo });
    assert.match(base!.leitura, /fora do padr/i);
    assert.match(base!.leitura, /abaixo do normal/);
  });

  it('ignora metricas sem valor no dia', () => {
    const diasCiclo = [...segundas, dia('2026-08-24', 5, 60, 0, 3, 0)];
    const base = montarBaselineDia({ dataIso: '2026-08-24', diasCiclo });
    assert.equal(metrica(base, 'km').valor, null);
    assert.equal(metrica(base, 'km').mesmoDiaSemana.referencia, null);
    assert.equal(metrica(base, 'tonPorHora').valor, null);
  });
});
