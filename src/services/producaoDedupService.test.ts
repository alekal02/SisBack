import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chaveProducaoColeta, filtrarColetasProducaoNovas } from './producaoDedupService';
import { ColetaData } from '../entities/ColetaData';

function coleta(parcial: Partial<ColetaData>): ColetaData {
  const c = new ColetaData();
  c.dataSaida = parcial.dataSaida ?? new Date('2026-09-18T12:00:00.000Z');
  c.distrito = parcial.distrito ?? 'CENTRO';
  c.regional = parcial.regional ?? 'CENTRO';
  c.tipoCaminhao = parcial.tipoCaminhao ?? 'ROCADEIRA';
  c.turno = parcial.turno ?? 'manual';
  c.motorista = parcial.motorista ?? null;
  c.kmTotal = parcial.kmTotal ?? null;
  c.dados = parcial.dados ?? { QUANTITATIVO: 120, AREA_M2: 120 };
  return c;
}

describe('produção — não reimporta linha já existente', () => {
  it('gera a mesma chave para a mesma operação', () => {
    const a = chaveProducaoColeta(coleta({}));
    const b = chaveProducaoColeta(coleta({ distrito: 'centro', tipoCaminhao: 'rocadeira' }));
    assert.equal(a, b);
  });

  it('não descarta locais diferentes que só coincidem nos 50 primeiros caracteres', () => {
    const prefixo = 'RUA PROFESSOR JOSE VIEIRA DE MENDONCA JUNTO AO ';
    const a = coleta({
      distrito: prefixo.slice(0, 50),
      dados: { QUANTITATIVO: 10, LOCAL: `${prefixo}PARQUE`, DISTRITO_COMPLETO: `${prefixo}PARQUE` },
    });
    const b = coleta({
      distrito: prefixo.slice(0, 50),
      dados: { QUANTITATIVO: 10, LOCAL: `${prefixo}TERMINAL`, DISTRITO_COMPLETO: `${prefixo}TERMINAL` },
    });
    assert.notEqual(chaveProducaoColeta(a), chaveProducaoColeta(b));
    const { novas, ignoradas } = filtrarColetasProducaoNovas(
      [a, b],
      (linha) => linha,
      new Set<string>(),
    );
    assert.equal(novas.length, 2);
    assert.equal(ignoradas, 0);
  });

  it('mantém a chave histórica quando o nome cabe na coluna', () => {
    const curta = chaveProducaoColeta(coleta({ distrito: 'CENTRO', dados: { QUANTITATIVO: 120, LOCAL: 'CENTRO' } }));
    const igual = chaveProducaoColeta(coleta({ distrito: 'centro', dados: { QUANTITATIVO: 120, BAIRRO: 'Centro' } }));
    assert.equal(curta, igual);
  });

  it('pula duplicata do banco e duplicata no próprio arquivo', () => {
    const existentes = new Set([chaveProducaoColeta(coleta({ dados: { QUANTITATIVO: 120 } }))]);
    const linhas = [
      { q: 120 },
      { q: 120 },
      { q: 80 },
    ];
    const { novas, ignoradas } = filtrarColetasProducaoNovas(
      linhas,
      (l) => coleta({ dados: { QUANTITATIVO: l.q, AREA_M2: l.q } }),
      existentes,
    );
    assert.equal(novas.length, 1);
    assert.equal(ignoradas, 2);
    assert.equal((novas[0].dados as { QUANTITATIVO: number }).QUANTITATIVO, 80);
  });
});
