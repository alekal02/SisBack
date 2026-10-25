import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { montarProjecaoCiclo, type TotaisCicloProjecao } from '@sistemma/shared';

function totais(
  viagens: number,
  toneladas: number,
  rotas: number,
  km: number,
): TotaisCicloProjecao {
  return { viagens, toneladas, rotas, km };
}

function metrica(p: ReturnType<typeof montarProjecaoCiclo>, id: string) {
  assert.ok(p, 'projecao nao deveria ser nula');
  const m = p!.metricas.find((x) => x.id === id);
  assert.ok(m, `metrica ${id} nao encontrada`);
  return m!;
}

describe('montarProjecaoCiclo', () => {
  it('retorna null sem dias decorridos', () => {
    assert.equal(
      montarProjecaoCiclo({
        totaisAtual: totais(10, 100, 5, 500),
        diasDecorridos: 0,
        diasCicloCompleto: 30,
      }),
      null,
    );
  });

  it('projeta o fechamento pelo ritmo dos dias decorridos', () => {
    const p = montarProjecaoCiclo({
      totaisAtual: totais(100, 500, 40, 3000),
      diasDecorridos: 10,
      diasCicloCompleto: 30,
    });
    const viagens = metrica(p, 'viagens');
    assert.equal(p!.diasRestantes, 20);
    assert.equal(viagens.realizado, 100);
    assert.equal(viagens.ritmoAtual, 10);
    assert.equal(viagens.projecao, 300);
  });

  it('calcula o ritmo diario necessario para superar o ciclo anterior', () => {
    const p = montarProjecaoCiclo({
      totaisAtual: totais(100, 500, 40, 3000),
      totaisAnterior: totais(400, 2000, 150, 9000),
      diasDecorridos: 10,
      diasCicloCompleto: 30,
    });
    const viagens = metrica(p, 'viagens');
    assert.equal(viagens.alvo, 400);
    assert.equal(viagens.faltaParaAlvo, 300);
    assert.equal(viagens.ritmoNecessario, 15);
    assert.equal(viagens.projecao, 300);
    assert.equal(viagens.deltaProjecao, -100);
    assert.equal(viagens.noRumo, false);
    assert.match(p!.leitura, /viagens precisa de 15\/dia/);
  });

  it('marca no rumo quando a projecao supera o alvo', () => {
    const p = montarProjecaoCiclo({
      totaisAtual: totais(200, 1000, 80, 3000),
      totaisAnterior: totais(400, 2000, 150, 9000),
      diasDecorridos: 10,
      diasCicloCompleto: 20,
    });
    const toneladas = metrica(p, 'toneladas');
    assert.equal(toneladas.projecao, 2000);
    assert.equal(toneladas.noRumo, true);
    const rotas = metrica(p, 'rotas');
    assert.equal(rotas.projecao, 160);
    assert.equal(rotas.noRumo, true);
  });

  it('em KM o objetivo e conter: projecao acima do anterior sai fora de rumo', () => {
    const p = montarProjecaoCiclo({
      totaisAtual: totais(100, 500, 40, 5000),
      totaisAnterior: totais(400, 2000, 150, 9000),
      diasDecorridos: 10,
      diasCicloCompleto: 30,
    });
    const km = metrica(p, 'km');
    assert.equal(km.sentido, 'conter');
    assert.equal(km.projecao, 15000);
    assert.equal(km.noRumo, false);
    // Teto diario para nao passar dos 9.000 km do ciclo anterior.
    assert.equal(km.ritmoNecessario, 200);
    assert.match(p!.leitura, /km precisa ficar em/);
  });

  it('ritmo necessario nunca fica negativo quando o alvo ja foi batido', () => {
    const p = montarProjecaoCiclo({
      totaisAtual: totais(500, 2500, 200, 12000),
      totaisAnterior: totais(400, 2000, 150, 9000),
      diasDecorridos: 20,
      diasCicloCompleto: 30,
    });
    assert.equal(metrica(p, 'viagens').ritmoNecessario, 0);
    assert.equal(metrica(p, 'km').ritmoNecessario, 0);
  });

  it('ciclo fechado nao projeta nem pede ritmo', () => {
    const p = montarProjecaoCiclo({
      totaisAtual: totais(300, 1500, 120, 8000),
      totaisAnterior: totais(400, 2000, 150, 9000),
      diasDecorridos: 30,
      diasCicloCompleto: 30,
    });
    assert.equal(p!.cicloFechado, true);
    assert.equal(p!.diasRestantes, 0);
    const viagens = metrica(p, 'viagens');
    assert.equal(viagens.projecao, 300);
    assert.equal(viagens.ritmoNecessario, null);
    assert.match(p!.leitura, /Ciclo fechado abaixo do anterior/);
  });

  it('sem ciclo anterior mantem a projecao e avisa que falta alvo', () => {
    const p = montarProjecaoCiclo({
      totaisAtual: totais(100, 500, 40, 3000),
      totaisAnterior: totais(0, 0, 0, 0),
      diasDecorridos: 10,
      diasCicloCompleto: 30,
    });
    assert.equal(p!.temAlvo, false);
    const viagens = metrica(p, 'viagens');
    assert.equal(viagens.alvo, null);
    assert.equal(viagens.noRumo, null);
    assert.equal(viagens.ritmoNecessario, null);
    assert.equal(viagens.projecao, 300);
    assert.match(p!.leitura, /Sem ciclo anterior fechado/);
  });

  it('metrica sem operacao no ciclo anterior fica sem alvo, sem derrubar as outras', () => {
    const p = montarProjecaoCiclo({
      totaisAtual: totais(100, 500, 40, 3000),
      totaisAnterior: totais(400, 2000, 150, 0),
      diasDecorridos: 10,
      diasCicloCompleto: 30,
    });
    assert.equal(p!.temAlvo, true);
    assert.equal(metrica(p, 'km').alvo, null);
    assert.equal(metrica(p, 'km').noRumo, null);
    assert.equal(metrica(p, 'viagens').alvo, 400);
  });
});
