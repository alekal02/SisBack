import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  obterContadorViagensRegistro,
  obterPesoTotalRegistro,
  sqlDataIsoDia,
  sqlExprPesoEfetivoKg,
  sqlSumPesoEfetivoKg,
} from './viagensPorRotaService';

describe('sql peso efetivo / data ISO do ciclo', () => {
  it('soma células PESO 1–5 da planilha (JSON), não id/PESO 2–5 tipados', () => {
    const expr = sqlExprPesoEfetivoKg('c');
    assert.match(expr, /jsonb_extract_path_text\(c\.dados, 'PESO 1'\)/);
    assert.match(expr, /jsonb_extract_path_text\(c\.dados, 'PESO TOTAL'\)/);
    assert.match(expr, /\^\[\+-\]\?\[0-9\]/);
    assert.equal(expr.includes('AVG'), false);
    assert.equal(expr.includes('GREATEST'), false);
    const sum = sqlSumPesoEfetivoKg('c');
    assert.match(sum, /^COALESCE\(SUM\(/);
  });

  it('agrupa o dia civil em yyyy-MM-dd', () => {
    assert.equal(sqlDataIsoDia('c'), "TO_CHAR(c.dataSaida, 'YYYY-MM-DD')");
  });

  it('usa PESO 1–5 da planilha quando o pesoTotal tipado foi inflado com id', () => {
    const kg = obterPesoTotalRegistro({
      pesoTotal: 18440,
      peso1: 8300,
      peso2: 2535,
      dados: { 'PESO 1': 8300, 'PESO 2': '', 'PESO TOTAL': 8300 },
    });
    assert.equal(kg, 8300);
  });
});

describe('totais do dashboard de coleta', () => {
  it('resumo, regional, dia, placa e motorista fecham só com peso efetivo dos válidos', () => {
    const linhas = [
      {
        validoDashboard: true,
        regional: 'Norte',
        data: '2026-06-01',
        placa: 'AAA1A11',
        motorista: 'Ana',
        pesoTotal: 18440,
        dados: { 'PESO 1': 8000, 'PESO TOTAL': 8000 },
      },
      {
        validoDashboard: true,
        regional: 'Norte',
        data: '2026-06-01',
        placa: 'BBB2B22',
        motorista: 'Ana',
        pesoTotal: 2000,
        dados: { 'PESO TOTAL': 2000 },
      },
      {
        validoDashboard: false,
        regional: 'Norte',
        data: '2026-06-01',
        placa: 'CCC3C33',
        motorista: 'Ana',
        pesoTotal: 99999,
        dados: { 'PESO TOTAL': 99999 },
      },
      {
        validoDashboard: true,
        regional: 'Sul',
        data: '2026-06-02',
        placa: 'AAA1A11',
        motorista: 'Bia',
        pesoTotal: 9000,
        dados: { 'PESO 1': 3000, 'PESO 2': 3000, 'PESO TOTAL': 9000 },
      },
    ];

    const peso = (linha: (typeof linhas)[number]) => obterPesoTotalRegistro(linha);
    const validos = linhas.filter((linha) => linha.validoDashboard === true);
    const resumo = validos.reduce((soma, linha) => soma + peso(linha), 0);
    const somarGrupo = (chave: 'regional' | 'data' | 'placa' | 'motorista') => {
      const grupos = new Map<string, number>();
      for (const linha of validos) {
        const id = linha[chave];
        grupos.set(id, (grupos.get(id) || 0) + peso(linha));
      }
      return [...grupos.values()].reduce((soma, valor) => soma + valor, 0);
    };

    assert.equal(resumo, 16000);
    assert.equal(somarGrupo('regional'), resumo);
    assert.equal(somarGrupo('data'), resumo);
    assert.equal(somarGrupo('placa'), resumo);
    assert.equal(somarGrupo('motorista'), resumo);
    assert.equal(linhas.filter((linha) => linha.validoDashboard === false).length, 1);
  });

  it('as consultas do dashboard usam peso efetivo e validoDashboard', () => {
    const src = readFileSync(join(__dirname, 'PlanilhaService.ts'), 'utf8');
    const metodos = [
      'getDashboardData',
      'getPesoPorRegional',
      'getPesoPorDia',
      'getTopPlacas',
      'getTopMotoristas',
    ];
    for (const nome of metodos) {
      const inicio = src.indexOf(`async ${nome}(`);
      const fim = src.indexOf('\n  async ', inicio + 1);
      const corpo = src.slice(inicio, fim);
      assert.ok(inicio >= 0, nome);
      assert.match(corpo, /sqlSumPesoEfetivoKg\('c'\)/, nome);
      assert.match(corpo, /aplicarFiltroViagensValidasDashboard\(.*'c'\)/, nome);
      assert.equal(corpo.includes('SUM(c.pesoTotal)'), false, nome);
    }
  });
});

describe('contador de viagens no JSON da planilha', () => {
  it('lê CONTADOR DE VIAGENS de dados mesmo sem campo tipado', () => {
    const n = obterContadorViagensRegistro({
      peso1: 8390,
      numeroViagens: null,
      viagensPorRota: 0,
      dados: { 'CONTADOR DE VIAGENS': 2, 'PESO 1': 8390 },
    });
    assert.equal(n, 2);
  });
});
