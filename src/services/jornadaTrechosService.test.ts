import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  agregarJornadas,
  agruparJornadaPor,
  decomporJornadaRegistro,
} from './jornadaTrechosService';

/**
 * Horas em fração de dia (padrão Excel): 06:00 = 0.25, 07:00 = 0.291666…
 */
function h(hora: number, minuto = 0): number {
  return (hora + minuto / 60) / 24;
}

/**
 * Jornada de referência (base → 2 rotas → base):
 *   06:00 sai da base, hodômetro 1000
 *   07:00 chega na rota 01 (1020)   → deslocamento inicial: 1h / 20 km
 *   09:00 sai da rota 01  (1035)    → coleta rota 01:       2h / 15 km
 *   10:00 chega na rota 02 (1060)   → entre rotas:          1h / 25 km
 *   12:00 sai da rota 02  (1075)    → coleta rota 02:       2h / 15 km
 *   13:00 chega na base   (1100)    → retorno final:        1h / 25 km
 * Jornada total 7h, produtiva 4h, improdutiva 3h. KM total 100, produtivo 30.
 */
function registroCompleto(extra: Record<string, unknown> = {}) {
  return {
    kmTotal: 100,
    dados: {
      'HORA SÁIDA BASE': h(6),
      ' KM SAIDA BASE ': 1000,
      'HORA CHEGADA ROTA 01': h(7),
      ' KM CHEGADA ROTA 01 ': 1020,
      'HORA SAÍDA ROTA 01': h(9),
      ' KM SAÍDA ROTA 01 ': 1035,
      'HORA CHEGADA ROTA 02': h(10),
      ' KM CHEGADA ROTA 02 ': 1060,
      'HORA SAÍDA ROTA 02': h(12),
      ' KM SAÍDA ROTA 02 ': 1075,
      'HORA CHEGADA BASE': h(13),
      ' KM CHEGADA BASE ': 1100,
      'PESO 1': 8000,
      'PESO 2': 9000,
      'CONTADOR DE VIAGENS': 2,
      ...extra,
    },
  };
}

describe('decomporJornadaRegistro — trechos da jornada', () => {
  test('separa deslocamento inicial, coleta, entre rotas e retorno', () => {
    const j = decomporJornadaRegistro(registroCompleto());

    assert.equal(j.horasTotais, 7);
    assert.equal(j.horasProdutivas, 4);
    assert.equal(j.horasImprodutivas, 3);

    assert.equal(j.horasDeslocamentoInicial, 1);
    assert.equal(j.horasEntreRotas, 1);
    assert.equal(j.horasRetornoFinal, 1);
    assert.equal(j.horasImprodutivasNaoDetalhadas, 0);
    assert.equal(j.ajustado, false);
  });

  test('a soma dos trechos improdutivos fecha com a hora improdutiva total', () => {
    const j = decomporJornadaRegistro(registroCompleto());
    const soma = j.horasDeslocamentoInicial + j.horasEntreRotas
      + j.horasRetornoFinal + j.horasImprodutivasNaoDetalhadas;
    assert.equal(soma, j.horasImprodutivas);
  });

  test('separa KM rodado dentro da rota do KM rodado vazio', () => {
    const j = decomporJornadaRegistro(registroCompleto());

    assert.equal(j.kmTotal, 100);
    assert.equal(j.kmProdutivo, 30);
    assert.equal(j.kmImprodutivo, 70);

    assert.equal(j.kmDeslocamentoInicial, 20);
    assert.equal(j.kmEntreRotas, 25);
    assert.equal(j.kmRetornoFinal, 25);
    assert.equal(j.kmImprodutivoNaoDetalhado, 0);
  });

  test('rotula cada trecho pelos pontos de origem e destino', () => {
    const { trechos } = decomporJornadaRegistro(registroCompleto());
    assert.deepEqual(
      trechos.map((t) => `${t.tipo}:${t.rotulo}`),
      [
        'deslocamento_inicial:Base → Rota 01',
        'coleta:Rota 01',
        'entre_rotas:Rota 01 → Rota 02',
        'coleta:Rota 02',
        'retorno_final:Rota 02 → Base',
      ],
    );
  });

  test('conta viagens e toneladas da linha', () => {
    const j = decomporJornadaRegistro(registroCompleto());
    assert.equal(j.viagens, 2);
    assert.equal(j.toneladas, 17);
    assert.equal(j.rotasComHorario, 2);
  });

  test('vira jornada vazia quando não há horário nenhum', () => {
    const j = decomporJornadaRegistro({ kmTotal: 40, dados: { 'PESO TOTAL': 5000 } });
    assert.equal(j.horasTotais, 0);
    assert.equal(j.horasImprodutivas, 0);
    assert.equal(j.trechos.length, 0);
  });

  test('sem hora de chegada na base, não inventa retorno final', () => {
    const registro = registroCompleto();
    delete (registro.dados as Record<string, unknown>)['HORA CHEGADA BASE'];
    const j = decomporJornadaRegistro(registro);

    assert.equal(j.horasRetornoFinal, 0);
    assert.ok(!j.trechos.some((t) => t.tipo === 'retorno_final'));
  });

  test('trecho sem hodômetro confiável fica com KM nulo, sem quebrar as horas', () => {
    const registro = registroCompleto();
    delete (registro.dados as Record<string, unknown>)[' KM CHEGADA ROTA 01 '];
    const j = decomporJornadaRegistro(registro);

    assert.equal(j.horasDeslocamentoInicial, 1);
    assert.equal(j.kmDeslocamentoInicial, 0);
    const inicial = j.trechos.find((t) => t.tipo === 'deslocamento_inicial');
    assert.equal(inicial?.km, null);
  });

  test('jornada que vira o dia (sai 22:00, chega 02:00) não gera hora negativa', () => {
    const registro = {
      kmTotal: 60,
      dados: {
        'HORA SÁIDA BASE': h(22),
        'HORA CHEGADA ROTA 01': h(23),
        'HORA SAÍDA ROTA 01': h(1),
        'HORA CHEGADA BASE': h(2),
      },
    };
    const j = decomporJornadaRegistro(registro);

    assert.equal(j.horasTotais, 4);
    assert.equal(j.horasProdutivas, 2);
    assert.equal(j.horasDeslocamentoInicial, 1);
    assert.equal(j.horasRetornoFinal, 1);
  });
});

describe('agregarJornadas e agruparJornadaPor', () => {
  test('soma trechos de várias linhas e calcula percentual produtivo', () => {
    const agregado = agregarJornadas([
      decomporJornadaRegistro(registroCompleto()),
      decomporJornadaRegistro(registroCompleto()),
    ]);

    assert.equal(agregado.registros, 2);
    assert.equal(agregado.horasTotais, 14);
    assert.equal(agregado.horasProdutivas, 8);
    assert.equal(agregado.horasImprodutivas, 6);
    assert.equal(agregado.pctProdutivo, 57.14);
    assert.equal(agregado.viagens, 4);
    assert.equal(agregado.horasImprodutivasPorViagem, 1.5);
    assert.equal(agregado.kmImprodutivoPorViagem, 35);
  });

  test('agrupa por placa e ordena pela maior hora improdutiva', () => {
    const boa = registroCompleto();
    const ruim = registroCompleto({ 'HORA CHEGADA ROTA 01': h(9) });

    const ranking = agruparJornadaPor(
      [
        { ...boa, placa: 'ABC1D23' },
        { ...ruim, placa: 'XYZ9W88' },
      ],
      (r) => String(r.placa || ''),
    );

    assert.equal(ranking.length, 2);
    assert.equal(ranking[0].chave, 'XYZ9W88');
    assert.ok(ranking[0].horasDeslocamentoInicial > ranking[1].horasDeslocamentoInicial);
  });

  test('linha sem a dimensão cai em "Não informado"', () => {
    const ranking = agruparJornadaPor([{ ...registroCompleto(), motorista: '  ' }], (r) =>
      String(r.motorista || ''),
    );
    assert.equal(ranking[0].chave, 'Não informado');
  });
});
