import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  decidirDatasRegravacao,
  fraseDiasHash,
  hashConteudoDia,
} from './importacaoDiaHash';

type Gravacao = { hash: string; versao: number };

function importarDias(
  banco: Map<string, Gravacao>,
  dias: Array<{ data: string; linhas: unknown[] }>,
  bloqueadas: string[] = [],
) {
  const hashesPlanilha = new Map(dias.map((dia) => [dia.data, hashConteudoDia(dia.linhas)]));
  const hashesSalvos = new Map([...banco].map(([data, gravado]) => [data, gravado.hash]));
  const { regravar, iguais } = decidirDatasRegravacao({
    hashesPlanilha,
    hashesSalvos,
    datasBloqueadas: bloqueadas,
  });
  const apagados: string[] = [];
  for (const data of regravar) {
    if (banco.has(data)) apagados.push(data);
    const atual = banco.get(data);
    banco.set(data, {
      hash: hashesPlanilha.get(data)!,
      versao: (atual?.versao ?? 0) + 1,
    });
  }
  return { regravar, iguais, apagados };
}

const planilha = [
  { data: '2026-10-01', linhas: [{ placa: 'ABC1D23', peso: 10, local: ' Centro ' }] },
  { data: '2026-10-02', linhas: [{ placa: 'DEF2E34', peso: 12 }, { placa: 'GHI3F45', peso: 8 }] },
  { data: '2026-10-03', linhas: [{ placa: 'JKL4G56', peso: 9 }] },
];

describe('hash do dia da planilha', () => {
  it('ignora ordem das linhas, ordem das chaves e espaços nas pontas', () => {
    const a = hashConteudoDia([
      { placa: 'AAA', peso: 1 },
      { placa: 'BBB', peso: 2 },
    ]);
    const b = hashConteudoDia([
      { peso: 2, placa: 'BBB' },
      { placa: ' AAA ', peso: 1, extra: null },
    ]);
    assert.equal(a, b);
    assert.notEqual(a, hashConteudoDia([{ placa: 'AAA', peso: 1 }, { placa: 'BBB', peso: 3 }]));
  });

  it('reenviar a mesma planilha não regrava nada', () => {
    const banco = new Map<string, Gravacao>();
    const primeiro = importarDias(banco, planilha);
    assert.deepEqual(primeiro.regravar, ['2026-10-01', '2026-10-02', '2026-10-03']);
    const versoes = new Map([...banco].map(([data, gravado]) => [data, gravado.versao]));

    const segundo = importarDias(banco, planilha);
    assert.deepEqual(segundo.regravar, []);
    assert.deepEqual(segundo.apagados, []);
    assert.equal(segundo.iguais.length, 3);
    for (const [data, versao] of versoes) {
      assert.equal(banco.get(data)!.versao, versao);
    }
  });

  it('alterar 1 dia regrava só esse dia', () => {
    const banco = new Map<string, Gravacao>();
    importarDias(banco, planilha);
    const alterada = planilha.map((dia) => (
      dia.data === '2026-10-02'
        ? { data: dia.data, linhas: [{ placa: 'DEF2E34', peso: 99 }, { placa: 'GHI3F45', peso: 8 }] }
        : dia
    ));
    const resultado = importarDias(banco, alterada);
    assert.deepEqual(resultado.regravar, ['2026-10-02']);
    assert.deepEqual(resultado.iguais, ['2026-10-01', '2026-10-03']);
    assert.deepEqual(resultado.apagados, ['2026-10-02']);
    assert.equal(banco.get('2026-10-01')!.versao, 1);
    assert.equal(banco.get('2026-10-02')!.versao, 2);
    assert.equal(banco.get('2026-10-03')!.versao, 1);
  });

  it('data de ciclo fechado não é regravada mesmo com conteúdo diferente', () => {
    const banco = new Map<string, Gravacao>([
      ['2026-09-01', { hash: 'hash-antigo', versao: 5 }],
    ]);
    const resultado = importarDias(
      banco,
      [{ data: '2026-09-01', linhas: [{ peso: 1 }] }],
      ['2026-09-01'],
    );
    assert.deepEqual(resultado.regravar, []);
    assert.deepEqual(resultado.iguais, []);
    assert.equal(banco.get('2026-09-01')!.versao, 5);
    assert.equal(banco.get('2026-09-01')!.hash, 'hash-antigo');
  });

  it('descreve dias atualizados e iguais', () => {
    assert.equal(fraseDiasHash(0, 30), '0 dias atualizados, 30 dias iguais');
    assert.equal(fraseDiasHash(1, 1), '1 dia atualizado, 1 dia igual');
  });
});
