import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { EntityManager } from 'typeorm';
import {
  chaveLockImportacaoServico,
  estrategiaSubstituiDatasProducao,
  executarImportacaoAtomica,
  registroPertenceAImportacaoAnterior,
  type RegistroImportacao,
  type RunnerImportacao,
} from './substituicaoImportacaoProducao';

const SERVICO = 'srv-varri';
const OUTRO = 'srv-poda';
const DATAS = new Set(['2026-09-01', '2026-09-02']);

function reg(parcial: Partial<RegistroImportacao>): RegistroImportacao {
  return {
    servicoId: SERVICO,
    planilhaUploadId: 10,
    cicloFechado: false,
    dataIso: '2026-09-01',
    ...parcial,
  };
}

function aplicar(
  estado: Array<RegistroImportacao & { qtd: number }>,
  novas: Array<{ dataIso: string; qtd: number }>,
  substituir: boolean,
) {
  const alvo = { servicoId: SERVICO, datas: new Set(novas.map((n) => n.dataIso)) };
  const mantidos = substituir
    ? estado.filter((r) => !registroPertenceAImportacaoAnterior(r, alvo))
    : [...estado];
  const chaves = new Set(mantidos.map((r) => `${r.dataIso}|${r.qtd}|${r.planilhaUploadId ?? 'manual'}`));
  let importados = 0;
  for (const linha of novas) {
    const chave = `${linha.dataIso}|${linha.qtd}|novo`;
    if (!substituir && mantidos.some((r) => r.dataIso === linha.dataIso && r.qtd === linha.qtd && r.planilhaUploadId != null && !r.cicloFechado && r.servicoId === SERVICO)) {
      continue;
    }
    if (chaves.has(chave)) continue;
    chaves.add(chave);
    mantidos.push({
      servicoId: SERVICO,
      planilhaUploadId: 99,
      cicloFechado: false,
      dataIso: linha.dataIso,
      qtd: linha.qtd,
    });
    importados++;
  }
  return { mantidos, importados, total: mantidos.reduce((s, r) => s + r.qtd, 0) };
}

describe('chatbot atualizar_data — escopo da substituição', () => {
  it('trata atualizar_data e substituir como reposição de datas', () => {
    assert.equal(estrategiaSubstituiDatasProducao('atualizar_data'), true);
    assert.equal(estrategiaSubstituiDatasProducao('substituir'), true);
    assert.equal(estrategiaSubstituiDatasProducao('ignorar'), false);
    assert.equal(estrategiaSubstituiDatasProducao('inserir_data'), false);
    assert.equal(estrategiaSubstituiDatasProducao(undefined), false);
  });

  it('primeiro envio não encontra importação anterior', () => {
    const alvo = { servicoId: SERVICO, datas: DATAS };
    assert.equal(registroPertenceAImportacaoAnterior(reg({ planilhaUploadId: null }), alvo), false);
    const r = aplicar([], [{ dataIso: '2026-09-01', qtd: 10 }, { dataIso: '2026-09-02', qtd: 24 }], true);
    assert.equal(r.importados, 2);
    assert.equal(r.total, 34);
  });

  it('reenvio idêntico fica com o total da planilha, sem somar', () => {
    const estado = [
      reg({ qtd: 10 } as Partial<RegistroImportacao> & { qtd: number }),
      reg({ dataIso: '2026-09-02', qtd: 24 } as Partial<RegistroImportacao> & { qtd: number }),
    ] as Array<RegistroImportacao & { qtd: number }>;
    const planilha = [{ dataIso: '2026-09-01', qtd: 10 }, { dataIso: '2026-09-02', qtd: 24 }];
    const semSubstituir = aplicar(estado, planilha, false);
    assert.equal(semSubstituir.total, 34);
    const comSubstituir = aplicar(estado, planilha, true);
    assert.equal(comSubstituir.importados, 2);
    assert.equal(comSubstituir.total, 34);
    assert.equal(comSubstituir.mantidos.filter((r) => r.planilhaUploadId === 10).length, 0);
  });

  it('reenvio com quantitativo alterado substitui o valor antigo', () => {
    const estado = [Object.assign(reg({}), { qtd: 10 })];
    const r = aplicar(estado, [{ dataIso: '2026-09-01', qtd: 8 }], true);
    assert.equal(r.total, 8);
    assert.equal(r.mantidos.length, 1);
  });

  it('reenvio com linha removida não mantém o quantitativo antigo da mesma data', () => {
    const estado = [
      Object.assign(reg({}), { qtd: 10 }),
      Object.assign(reg({}), { qtd: 24 }),
    ];
    const r = aplicar(estado, [{ dataIso: '2026-09-01', qtd: 10 }], true);
    assert.equal(r.total, 10);
    assert.equal(r.mantidos.filter((row) => row.qtd === 24).length, 0);
  });

  it('preserva lançamento sem upload e serviço diferente', () => {
    const alvo = { servicoId: SERVICO, datas: DATAS };
    const manual = Object.assign(reg({ planilhaUploadId: null }), { qtd: 5 });
    const outro = Object.assign(reg({ servicoId: OUTRO }), { qtd: 7 });
    assert.equal(registroPertenceAImportacaoAnterior(manual, alvo), false);
    assert.equal(registroPertenceAImportacaoAnterior(outro, alvo), false);
    const r = aplicar([manual, outro], [{ dataIso: '2026-09-01', qtd: 10 }], true);
    assert.equal(r.mantidos.some((row) => row.planilhaUploadId == null && row.qtd === 5), true);
    assert.equal(r.mantidos.some((row) => row.servicoId === OUTRO && row.qtd === 7), true);
    assert.equal(r.total, 22);
  });

  it('não substitui data de ciclo fechado', () => {
    const fechado = Object.assign(reg({ cicloFechado: true }), { qtd: 100 });
    const alvo = { servicoId: SERVICO, datas: DATAS };
    assert.equal(registroPertenceAImportacaoAnterior(fechado, alvo), false);
    const r = aplicar([fechado], [{ dataIso: '2026-09-01', qtd: 10 }], true);
    assert.equal(r.mantidos.some((row) => row.cicloFechado && row.qtd === 100), true);
  });

  it('conferência do total importado contra a planilha', () => {
    const planilha = [
      { dataIso: '2026-09-01', qtd: 12000 },
      { dataIso: '2026-09-02', qtd: 22000 },
    ];
    const antigo = [Object.assign(reg({}), { qtd: 40000 }), Object.assign(reg({ dataIso: '2026-09-02' }), { qtd: 52000 })];
    const r = aplicar(antigo, planilha, true);
    const totalPlanilha = planilha.reduce((s, l) => s + l.qtd, 0);
    assert.equal(r.total, totalPlanilha);
    assert.equal(r.total, 34000);
  });
});

describe('importação atômica', () => {
  function runnerFalso(estado: { commits: number; rollbacks: number; locks: string[]; ocupado: boolean }) {
    const runner: RunnerImportacao = {
      manager: {} as EntityManager,
      async connect() {},
      async startTransaction() {},
      async commitTransaction() { estado.commits++; },
      async rollbackTransaction() { estado.rollbacks++; },
      async release() { estado.ocupado = false; },
      async query(_sql, params) {
        if (estado.ocupado) throw new Error('lock sobreposto');
        estado.ocupado = true;
        estado.locks.push(String(params?.[0] ?? ''));
        return [];
      },
    };
    return runner;
  }

  it('faz rollback quando a gravação falha e não confirma', async () => {
    const estado = { commits: 0, rollbacks: 0, locks: [] as string[], ocupado: false };
    await assert.rejects(
      () => executarImportacaoAtomica(SERVICO, async () => {
        throw new Error('falha na importação');
      }, () => runnerFalso(estado)),
    );
    assert.equal(estado.commits, 0);
    assert.equal(estado.rollbacks, 1);
    assert.equal(estado.locks[0], chaveLockImportacaoServico(SERVICO));
  });

  it('serializa dois uploads do mesmo serviço pelo mesmo lock', async () => {
    const locks: string[] = [];
    let commits = 0;
    let simultaneo = 0;
    let pico = 0;
    let fila = Promise.resolve();
    const runner = (): RunnerImportacao => {
      let soltar = () => {};
      return {
        manager: {} as EntityManager,
        async connect() {},
        async startTransaction() {},
        async commitTransaction() { commits++; },
        async rollbackTransaction() {},
        async release() { soltar(); },
        async query(_sql, params) {
          const anterior = fila;
          fila = new Promise<void>((resolve) => { soltar = resolve; });
          await anterior;
          locks.push(String(params?.[0] ?? ''));
          simultaneo++;
          pico = Math.max(pico, simultaneo);
          return [];
        },
      };
    };
    await Promise.all([
      executarImportacaoAtomica(SERVICO, async () => {
        await new Promise((r) => setTimeout(r, 30));
        simultaneo--;
      }, runner),
      executarImportacaoAtomica(SERVICO, async () => {
        await new Promise((r) => setTimeout(r, 30));
        simultaneo--;
      }, runner),
    ]);
    assert.equal(pico, 1);
    assert.equal(commits, 2);
    assert.equal(locks[0], chaveLockImportacaoServico(SERVICO));
    assert.equal(locks[1], locks[0]);
  });
});
