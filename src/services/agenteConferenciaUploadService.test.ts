import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { analisarConferenciaPlanilha } from './agenteConferenciaUploadService';

const CABECALHO = [
  'DATA SAIDA', 'TURNO', 'REGIONAL', 'DISTRITO', 'PLACA', 'MOTORISTA',
  'COLETOR 01', 'KM SAIDA BASE', 'KM CHEGADA BASE', 'KM TOTAL',
  'PESO TOTAL', 'CONTADOR DE VIAGENS',
];

function planilha(linhas: unknown[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet([CABECALHO, ...linhas]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'BANCO DE DADOS');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

const ROTA = [
  '17/09/2026', 'DIURNO', 'NOROESTE', 'NO16B', 'JAK7F60', 'WELLIGTON ANTONIO',
  'DARLYSON', 265123, 265247, 124, 13490, 2,
];

describe('agenteConferenciaUploadService', () => {
  it('conta rotas e ignora linha de template', () => {
    const r = analisarConferenciaPlanilha(
      planilha([ROTA, ['', '', '', '', '', '', '', 0, 0, 0, 0, 0]]),
      'medicao.xls',
    );
    assert.equal(r.rotasPlanilha, 1);
    assert.equal(r.viagensContador, 2);
    assert.equal(r.linhasTemplate, 1);
  });

  it('detecta retrabalho da mesma rota com equipe diferente', () => {
    const retrabalho = [
      '17/09/2026', 'DIURNO', 'NOROESTE', 'NO16B', 'JAK7F60', 'WELLINGTON ANTONIO OLAVO',
      'JONATHAN', 265123, 265247, 124, 13490, 2,
    ];
    const r = analisarConferenciaPlanilha(planilha([ROTA, retrabalho]), 'medicao.xls');
    assert.equal(r.rotasPlanilha, 2);
    assert.equal(r.retrabalhosMesmaRota.length, 1);
    assert.deepEqual(r.retrabalhosMesmaRota[0].linhas, [2, 3]);
    assert.match(r.mensagem, /equipe diferente/);
  });
});
