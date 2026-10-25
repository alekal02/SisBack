import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ColetaData } from '../entities/ColetaData';
import {
  sanitizarKmHodometro,
  validarViagemParaDashboard,
  prepararViagemParaImportacao,
  MAX_KM_DASHBOARD,
} from './validacaoViagemService';

/** Monta uma coleta mínima com colunas de hodômetro cruas (planilha) via `dados` */
function coleta(overrides: Record<string, unknown> = {}): ColetaData {
  return {
    id: 1,
    placa: 'ABC1D23',
    motorista: 'João',
    dataSaida: new Date('2026-01-10'),
    pesoTotal: 8000,
    kmTotal: null,
    kmSaida: null,
    kmChegada: null,
    kmRota1: null,
    kmRota2: null,
    kmRota3: null,
    kmRota4: null,
    dados: {},
    ...overrides,
  } as unknown as ColetaData;
}

describe('sanitizarKmHodometro', () => {
  it('mantém KM normal quando todos os trechos batem', () => {
    const c = coleta({
      dados: {
        ' KM SAIDA BASE ': 1000,
        ' KM CHEGADA ROTA 01 ': 1020,
        ' KM SAÍDA ROTA 01 ': 1020,
        ' KM CHEGADA BASE ': 1040,
      },
    });
    const r = sanitizarKmHodometro(c);
    assert.equal(r.kmInvalidadoPorHodometro, false);
    assert.equal(r.problemas.length, 0);
    assert.equal(c.kmTotal, 40);
  });

  it('detecta hodômetro quebrado/reiniciado (chegada < saída) e ignora só esse trecho', () => {
    const c = coleta({
      dados: {
        ' KM SAIDA BASE ': 1000,
        ' KM CHEGADA ROTA 01 ': 1020,
        ' KM SAÍDA ROTA 01 ': 1020,
        // Retorno à base com hodômetro reiniciado
        ' KM CHEGADA BASE ': 50,
      },
    });
    const r = sanitizarKmHodometro(c);
    assert.ok(r.problemas.length >= 1);
    assert.ok(r.problemas.some(p => /menor que/i.test(p.motivo)));
    assert.equal(r.kmInvalidadoPorHodometro, false);
    assert.equal(c.kmTotal, 20); // só base → rota 01
  });

  it('detecta salto absurdo de hodômetro (> MAX_KM_DASHBOARD) e soma só trechos válidos', () => {
    const c = coleta({
      dados: {
        ' KM SAIDA BASE ': 1000,
        ' KM CHEGADA ROTA 01 ': 1020,
        ' KM SAÍDA ROTA 01 ': 1020,
        // salto de 5000km — hodômetro “pulou”
        ' KM CHEGADA ROTA 02 ': 6020,
        ' KM SAÍDA ROTA 02 ': 6020,
        ' KM CHEGADA BASE ': 6040,
      },
    });
    const r = sanitizarKmHodometro(c);
    assert.ok(r.problemas.some(p => /Salto absurdo de hodômetro/i.test(p.motivo)));
    // base→r01 (20) + r02→base (20) = 40; salto do meio ignorado
    assert.equal(c.kmTotal, 40);
  });

  it('zera KM (mantendo peso) quando nenhum trecho é confiável e KM TOTAL parece leitura absoluta', () => {
    const c = coleta({
      kmTotal: 45210, // hodômetro absoluto colado na planilha por engano
      dados: {
        ' KM CHEGADA ROTA 01 ': 10, // < saída/base ausente -> sem segmento válido
      },
    });
    const r = sanitizarKmHodometro(c);
    assert.equal(r.kmInvalidadoPorHodometro, true);
    assert.equal(c.kmTotal, 0);
    assert.match(r.ajustes.join(' | '), /KM zerado por hodômetro inconsistente/);
    assert.equal((c.dados as Record<string, unknown>)._alertaKmHodometro != null, true);
  });

  it('zera KM quando saída base = chegada base (hodômetro parado/igual) e há peso', () => {
    const c = coleta({
      kmTotal: 0,
      dados: {
        ' KM SAIDA BASE ': 21491,
        ' KM CHEGADA ROTA 01 ': 21491,
        ' KM SAÍDA ROTA 01 ': 21491,
        ' KM CHEGADA BASE ': 21491,
        'KM TOTAL': 0,
      },
    });
    const r = sanitizarKmHodometro(c);
    assert.equal(r.kmInvalidadoPorHodometro, true);
    assert.equal(c.kmTotal, 0);
    assert.ok(r.problemas.some(p => /parado\/igual/.test(p.motivo)));
    assert.match(String((c.dados as Record<string, unknown>)._alertaKmHodometro), /KM zerado/);
  });

  it('descarta leitura que volta e usa saída/chegada base (caso RKH2D22: total 62 km)', () => {
    // Saída base 170453 → Chegada base 170515 = 62 km.
    // KM SAÍDA ROTA 01 = 170385 está errado (menor que a chegada da rota) e era
    // usado como âncora, inventando 145 km. Agora a leitura é descartada.
    const c = coleta({
      kmTotal: 62,
      dados: {
        ' KM SAIDA BASE ': 170453,
        ' KM CHEGADA ROTA 01 ': 170468,
        ' KM SAÍDA ROTA 01 ': 170385,
        ' KM CHEGADA BASE ': 170515,
        'KM TOTAL': 62,
      },
    });
    const r = sanitizarKmHodometro(c);
    assert.ok(r.problemas.some(p => /menor que/i.test(p.motivo) && /KM SAÍDA ROTA 01/i.test(p.motivo)));
    assert.equal(c.kmTotal, 62);
    assert.ok(r.ajustes.some(a => /KM TOTAL mantido \(62 km\)/i.test(a) && /Motivo do tratamento/i.test(a)));
    assert.match(String((c.dados as Record<string, unknown>)._alertaKmHodometro), /KM SAÍDA ROTA 01/);
  });

  it('corrige KM TOTAL 145 → 62 quando leitura intermediária volta (RKH2D22)', () => {
    const c = coleta({
      kmTotal: 145,
      dados: {
        ' KM SAIDA BASE ': 170453,
        ' KM CHEGADA ROTA 01 ': 170468,
        ' KM SAÍDA ROTA 01 ': 170385,
        ' KM CHEGADA BASE ': 170515,
        'KM TOTAL': 145,
      },
    });
    const r = sanitizarKmHodometro(c);
    assert.equal(c.kmTotal, 62);
    assert.ok(r.ajustes.some(a => /corrigido para 62/i.test(a) && /KM SAÍDA ROTA 01/i.test(a)));
  });

  it('zera KM quando KM TOTAL ausente, sem trechos e há peso (evita desfalque na importação)', () => {
    const c = coleta({
      kmTotal: null,
      dados: {},
    });
    const r = sanitizarKmHodometro(c);
    assert.equal(r.kmInvalidadoPorHodometro, true);
    assert.equal(c.kmTotal, 0);
    assert.match(r.ajustes.join(' | '), /KM inicial=final ou sem leituras válidas/);
  });

  it('corrige KM TOTAL quando ele é menor que a soma dos trechos válidos (planilha com fórmula desatualizada)', () => {
    const c = coleta({
      kmTotal: 5, // fórmula da planilha não recalculou
      dados: {
        ' KM SAIDA BASE ': 1000,
        ' KM CHEGADA ROTA 01 ': 1030,
        ' KM SAÍDA ROTA 01 ': 1030,
        ' KM CHEGADA BASE ': 1050,
      },
    });
    const r = sanitizarKmHodometro(c);
    assert.equal(r.kmInvalidadoPorHodometro, false);
    assert.equal(c.kmTotal, 50);
  });

  it('soma rota de 50 km com rota de 20 km (saída antes da chegada, formato ROTA 1)', () => {
    const c = coleta({
      kmTotal: 0,
      dados: {
        'KM SAIDA ROTA 1': 100000,
        'KM CHEGADA ROTA 1': 100050,
        'KM SAIDA ROTA 2': 100050,
        'KM CHEGADA ROTA 2': 100070,
        'KM TOTAL': 0,
      },
    });
    const r = sanitizarKmHodometro(c);
    assert.equal(r.kmInvalidadoPorHodometro, false);
    assert.equal(r.problemas.length, 0);
    assert.equal(c.kmTotal, 70);
  });

  it('interpreta ROTA 01 com acento como o mesmo trecho de ROTA 1', () => {
    const c = coleta({
      kmTotal: null,
      dados: {
        'KM SAÍDA ROTA 01': 100000,
        'KM CHEGADA ROTA 01': 100050,
        'KM SAIDA ROTA 02': 100050,
        'KM CHEGADA ROTA 02': 100070,
      },
    });
    sanitizarKmHodometro(c);
    assert.equal(c.kmTotal, 70);
  });

  it('planilha padrão com chegada da rota menor que a saída continua somando 50 km + 20 km', () => {
    const c = coleta({
      kmTotal: null,
      dados: {
        ' KM CHEGADA ROTA 01 ': 1000,
        ' KM SAÍDA ROTA 01 ': 1050,
        ' KM CHEGADA ROTA 02 ': 1050,
        ' KM SAÍDA ROTA 02 ': 1070,
      },
    });
    const r = sanitizarKmHodometro(c);
    assert.equal(r.problemas.length, 0);
    assert.equal(c.kmTotal, 70);
  });
});

describe('validarViagemParaDashboard — integração com alerta de hodômetro', () => {
  it('viagem com hodômetro quebrado e sem nenhum trecho confiável ainda entra no dashboard (peso ok, KM 0)', () => {
    const c = coleta({
      kmTotal: 0,
      dados: { _alertaKmHodometro: 'KM zerado por hodômetro inconsistente (sem trechos válidos). Peso/viagens mantidos.' },
    });
    const resultado = validarViagemParaDashboard(c);
    assert.equal(resultado.validoDashboard, true);
    assert.deepEqual(resultado.motivos, []);
    assert.equal(resultado.kmEfetivo, null);
    assert.equal(resultado.pesoEfetivo, 8000);
  });

  it('reconhece alerta de hodômetro no topo do objeto plano (após converterColetasParaBrutos)', () => {
    const c = coleta({
      kmTotal: 0,
      dados: undefined as unknown as Record<string, unknown>,
    });
    // Simula objeto plano sem `dados` aninhado
    const plano = {
      ...c,
      dados: undefined,
      _alertaKmHodometro: 'KM zerado por hodômetro inconsistente (teste). Peso/viagens mantidos.',
      pesoTotal: 8000,
      placa: 'PAM5914',
      motorista: 'TESTE',
      dataSaida: c.dataSaida,
    };
    const resultado = validarViagemParaDashboard(plano as Partial<ColetaData>);
    assert.equal(resultado.validoDashboard, true, `motivos: ${resultado.motivos.join('; ')}`);
  });

  it('sem alerta de hodômetro, KM zerado É bloqueado normalmente', () => {
    const c = coleta({ kmTotal: 0 });
    const resultado = validarViagemParaDashboard(c);
    assert.equal(resultado.validoDashboard, false);
    assert.ok(resultado.motivos.some(m => /KM Total (zerado|ausente)/i.test(m)));
  });

  it('fluxo completo (prepararViagemParaImportacao): hodômetro igual não derruba a viagem do dashboard', () => {
    const c = coleta({
      kmTotal: null,
      dados: {
        ' KM SAIDA BASE ': 21491,
        ' KM CHEGADA ROTA 01 ': 21491,
        ' KM SAÍDA ROTA 01 ': 21491,
        ' KM CHEGADA BASE ': 21491,
      },
    });
    const resultado = prepararViagemParaImportacao(c);
    assert.equal(resultado.validoDashboard, true);
    assert.equal(c.kmTotal, 0);
    assert.equal(c.validoDashboard, true);
    assert.ok((resultado.correcoes || []).some(c => /hodômetro|hodometro|KM zerado/i.test(c)));
  });

  it('KM/peso negativo em coluna ociosa da planilha não exclui toneladas válidas do dashboard', () => {
    const c = coleta({
      kmTotal: 42,
      pesoTotal: 12500,
      dados: {
        'KM TOTAL': 42,
        'PESO TOTAL': 12500,
        'KM ROTA 04': -1,
        'PESO 5': -999,
      },
    });
    const resultado = prepararViagemParaImportacao(c);
    assert.equal(resultado.validoDashboard, true, `motivos: ${resultado.motivos.join('; ')}`);
    assert.equal(c.pesoTotal, 12500);
    assert.equal(c.validoDashboard, true);
  });

  it('fluxo completo: hodômetro quebrado em todas as rotas não derruba a viagem do dashboard', () => {
    const c = coleta({
      kmTotal: null,
      dados: {
        ' KM SAIDA BASE ': 1000,
        ' KM CHEGADA ROTA 01 ': 200, // reset — chegada < saída
      },
    });
    const resultado = prepararViagemParaImportacao(c);
    assert.equal(resultado.validoDashboard, true);
    assert.equal(c.kmTotal, 0);
    assert.equal(c.validoDashboard, true);
  });

  it('revalidação com id persistido não copia o id para PESO 2–5 nem infla o total', () => {
    const c = coleta({
      id: 2535,
      peso1: 8300,
      peso2: 2535,
      peso3: 2535,
      peso4: 2535,
      peso5: 2535,
      pesoTotal: 18440,
      kmTotal: 80,
      numeroViagens: 4,
      dados: {
        'PESO 1': 8300,
        'PESO TOTAL': 18440,
        'KM TOTAL': 80,
        'CONTADOR DE VIAGENS': 1,
        'PLACA': 'SDG1J76',
        'MOTORISTA': 'João',
      },
    });
    const resultado = prepararViagemParaImportacao(c);
    assert.equal(resultado.validoDashboard, true, `motivos: ${resultado.motivos.join('; ')}`);
    assert.equal(c.peso1, 8300);
    assert.equal(c.peso2, null);
    assert.equal(c.peso3, null);
    assert.equal(c.peso4, null);
    assert.equal(c.peso5, null);
    assert.equal(c.pesoTotal, 8300);
  });
});
