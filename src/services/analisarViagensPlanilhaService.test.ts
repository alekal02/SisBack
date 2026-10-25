import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { analisarViagensPlanilha, priorizarViagensForaDashboard } from './analisarViagensPlanilhaService';

const CABECALHO = [
  'Nº', 'DATA SAIDA', 'PLACA', 'MOTORISTA', 'ROTA', 'CONTADOR DE VIAGENS', 'VIAGENS POR ROTA',
  'KM SAIDA BASE', 'KM CHEGADA ROTA 01', 'KM CHEGADA BASE', 'KM TOTAL',
  'PESO 1', 'PESO 2', 'PESO TOTAL', 'TIPO DE CAMINHÃO',
];

function planilha(linhas: unknown[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet([CABECALHO, ...linhas]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'BANCO DE DADOS');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

const UMA_VIAGEM = [
  1, '01/08/2026', 'RCD3E01', 'ANDRE GERALDO', 'ROTA A', 1, 1,
  1000, 1000, 1000, 0, 9090, null, 9090, 'TOCO',
];

const DUAS_VIAGENS = [
  2, '18/08/2026', 'RBZ9B69', 'MIGUEL JUNIOR', 'ROTA B', 2, 2,
  2000, 2000, 2000, 0, 11420, 13870, 25290, 'TRUCK',
];

/** Rodapé/template da planilha: só o número sequencial e fórmulas devolvendo 0. */
const templateVazio = (n: number) => [n, '', '', '', '', 0, 0, 0, 0, 0, 0, 0, 0, 0, ''];

describe('analisarViagensPlanilha — linhas em branco da planilha', () => {
  it('não trata linha de template como viagem fora do dashboard', () => {
    const r = analisarViagensPlanilha(
      planilha([UMA_VIAGEM, ...Array.from({ length: 30 }, (_, i) => templateVazio(i + 2))]),
      'BDO.xlsx',
    );

    assert.equal(r.linhasEmBrancoIgnoradas, 30);
    assert.deepEqual(r.viagens.filter((v) => v.foraDashboard).map((v) => v.linha), []);
    assert.equal(r.viagensInconsistentesTotal, 0);
    assert.equal(r.percentualCompleto, 100);
  });

  it('não acusa placa inválida por causa de linha em branco', () => {
    const r = analisarViagensPlanilha(
      planilha([UMA_VIAGEM, ...Array.from({ length: 458 }, (_, i) => templateVazio(i + 2))]),
      'BDO.xlsx',
    );

    assert.equal(r.resumoPlacas?.alerta, null);
  });

  it('mantém no relatório a linha que tem CONTADOR mas não tem placa, KM nem peso', () => {
    const comContador = [
      2, '19/08/2026', '', '', '', 1, 1, null, null, null, null, null, null, null, '',
    ];
    const r = analisarViagensPlanilha(
      planilha([UMA_VIAGEM, comContador, templateVazio(3)]),
      'BDO.xlsx',
    );

    assert.equal(r.linhasEmBrancoIgnoradas, 1);
    const fora = r.viagens.filter((v) => v.foraDashboard);
    assert.equal(fora.length, 1);
    assert.equal(fora[0].linha, 3);
    assert.equal(fora[0].descartada, true);
    assert.equal(r.somaContadorForaDashboard, 1);
  });

  it('linha em branco não conta no CONTADOR nem nas toneladas', () => {
    const r = analisarViagensPlanilha(
      planilha([UMA_VIAGEM, DUAS_VIAGENS, ...Array.from({ length: 10 }, (_, i) => templateVazio(i + 3))]),
      'BDO.xlsx',
    );

    assert.equal(r.somaContadorViagens, 3);
    assert.equal(r.somaContadorNoDashboard, 3);
    assert.equal(r.somaContadorForaDashboard, 0);
    assert.equal(r.pesoKgDashboard, 9090 + 25290);
    assert.equal(r.pesoKgForaDashboard, 0);
  });
});

describe('analisarViagensPlanilha — pesagens da linha', () => {
  it('detalha as pesagens individuais para o total não parecer uma carga só', () => {
    const r = analisarViagensPlanilha(planilha([UMA_VIAGEM, DUAS_VIAGENS]), 'BDO.xlsx');

    const linhaDuas = r.viagens.find((v) => v.linha === 3);
    assert.ok(linhaDuas, 'linha de 2 viagens deve aparecer (KM tratado)');
    assert.equal(linhaDuas!.pesoTotal, 25290);
    assert.deepEqual(linhaDuas!.pesagensKg, [11420, 13870]);
  });

  it('linha de uma viagem tem uma pesagem só', () => {
    const r = analisarViagensPlanilha(planilha([UMA_VIAGEM]), 'BDO.xlsx');

    const linha = r.viagens.find((v) => v.linha === 2);
    assert.ok(linha);
    assert.deepEqual(linha!.pesagensKg, [9090]);
  });

  it('alerta de pesagem alta olha a pesagem, não o total da linha', () => {
    // 2 viagens somando 25.290 kg, nenhuma acima de 15.000 kg → sem alerta
    const r = analisarViagensPlanilha(planilha([DUAS_VIAGENS]), 'BDO.xlsx');
    assert.equal(r.pesagensAltas, 0);

    // 1 viagem de 15.360 kg → alerta
    const pesada = [
      1, '15/08/2026', 'RCL4C71', 'JULIO CESAR', 'ROTA C', 1, 1,
      100, 150, 200, 100, 15360, null, 15360, 'TRUCK',
    ];
    const r2 = analisarViagensPlanilha(planilha([pesada]), 'BDO.xlsx');
    assert.equal(r2.pesagensAltas, 1);
  });
});

describe('analisarViagensPlanilha — viagem sem pesagem', () => {
  const CABECALHO_HORAS = [
    'DATA SAIDA', 'PLACA', 'MOTORISTA', 'ROTA', 'CONTADOR DE VIAGENS',
    'KM TOTAL', 'PESO 1', 'PESO 2', 'PESO TOTAL',
    'HORA CHEGADA ROTA 01', 'HORA SAÍDA ROTA 01',
    'HORA CHEGADA ROTA 02', 'HORA SAÍDA ROTA 02',
  ];

  function planilhaHoras(linhas: unknown[][]): Buffer {
    const ws = XLSX.utils.aoa_to_sheet([CABECALHO_HORAS, ...linhas]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'BANCO DE DADOS');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  it('marca viagem 2 sem peso quando o trecho 2 tem horário e não barra o dashboard', () => {
    const linha = [
      '21/08/2026', 'RBL0C31', 'JOAO DE DEUS', 'AD02', 2,
      80, 7680, null, 7680,
      7.2 / 24, 11 / 24,
      12 / 24, 13 / 24,
    ];
    const r = analisarViagensPlanilha(planilhaHoras([linha]), 'Unai.xlsx');

    assert.equal(r.viagensValidasDashboard, 1);
    assert.equal(r.viagensInconsistentesTotal, 0);
    assert.equal(r.viagensSemPesagem, 1);
    assert.equal(r.linhasComSemPesagem, 1);
    const item = r.viagens.find((v) => v.alertaSemPesagem);
    assert.ok(item);
    assert.equal(item!.foraDashboard, false);
    assert.deepEqual(item!.viagensSemPesagem, [2]);
    assert.ok((item!.problemas || []).some((p) => /viagem 2 sem pesagem/i.test(p)));
  });

  it('não acusa sem pesagem quando só existe um trecho com peso', () => {
    const linha = [
      '21/08/2026', 'RBS8H87', 'LEONARDO', 'AD01', 1,
      40, 6780, null, 6780,
      7 / 24, 13.6 / 24,
      null, null,
    ];
    const r = analisarViagensPlanilha(planilhaHoras([linha]), 'Unai.xlsx');
    assert.equal(r.viagensSemPesagem, 0);
    assert.equal(r.viagens.filter((v) => v.alertaSemPesagem).length, 0);
  });

  it('coloca viagens fora do dashboard antes das que sobem', () => {
    const lista = [
      { linha: 10, foraDashboard: false, completa: true },
      { linha: 11, foraDashboard: true, completa: false },
      { linha: 12, foraDashboard: false, completa: true, corrigidaHodometro: true },
      { linha: 13, descartada: true, completa: false },
    ];
    const r = priorizarViagensForaDashboard(lista, 3);
    assert.equal(r[0].linha, 11);
    assert.equal(r[1].linha, 13);
    assert.equal(r.length, 3);
    assert.equal(r[2].linha, 10);
  });
});
