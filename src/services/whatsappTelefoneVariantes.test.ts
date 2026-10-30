import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FindOperator, type Repository } from 'typeorm';
import { WhatsappAutorizado } from '../entities/WhatsappAutorizado';
import {
  avisoGrupoNaoConfiguradoLigado,
  respostaAutomaticaNaoAutorizadoLigada,
} from './WhatsappMensagemLedger';
import {
  definirRepoAutorizadoParaTeste,
  gravarLidNasPessoas,
  pessoasAtivasPorTelefone,
  telefoneDoLid,
  variantesTelefoneBr,
} from './whatsappAutorizadoService';

const COM_NONO = '5562999998888';
const SEM_NONO = '556299998888';

function combina(where: Record<string, unknown>, row: WhatsappAutorizado): boolean {
  if ('ativo' in where && where.ativo !== row.ativo) return false;
  if ('lid' in where && where.lid !== row.lid) return false;
  if ('telefone' in where) {
    const filtro = where.telefone;
    if (filtro instanceof FindOperator) {
      assert.equal(filtro.type, 'in');
      if (!(filtro.value as string[]).includes(row.telefone)) return false;
    } else if (filtro !== row.telefone) return false;
  }
  return true;
}

function memoria(inicial: Partial<WhatsappAutorizado>[]) {
  const rows = inicial.map((row) => ({
    id: row.id || 'p1',
    contractId: row.contractId || 'c1',
    nome: row.nome || 'Ana',
    telefone: row.telefone || '',
    lid: row.lid ?? null,
    podeEnviarPlanilha: true,
    podePedirRelatorio: true,
    ativo: row.ativo !== false,
    criadoEm: new Date(),
  })) as WhatsappAutorizado[];

  definirRepoAutorizadoParaTeste({
    find: async (opts) => rows.filter((row) => combina(opts.where as Record<string, unknown>, row)),
    findOne: async (opts) => rows.find((row) => combina(opts.where as Record<string, unknown>, row)) || null,
    save: async (row) => row,
  } as unknown as Repository<WhatsappAutorizado>);
  return rows;
}

describe('variantes do telefone brasileiro', () => {
  afterEach(() => definirRepoAutorizadoParaTeste(null));

  it('trata o celular com e sem o nono dígito como o mesmo número', () => {
    assert.deepEqual(variantesTelefoneBr(SEM_NONO).sort(), [COM_NONO, SEM_NONO].sort());
    assert.deepEqual(variantesTelefoneBr(COM_NONO).sort(), [COM_NONO, SEM_NONO].sort());
  });

  it('pessoasAtivasPorTelefone acha o cadastro nas duas formas', async () => {
    memoria([{ telefone: COM_NONO }]);
    const pelaCurta = await pessoasAtivasPorTelefone(SEM_NONO);
    const pelaLonga = await pessoasAtivasPorTelefone(COM_NONO);
    assert.equal(pelaCurta.length, 1);
    assert.equal(pelaLonga.length, 1);
    assert.equal(pelaCurta[0].contractId, 'c1');

    memoria([{ telefone: SEM_NONO }]);
    const inversa = await pessoasAtivasPorTelefone(COM_NONO);
    assert.equal(inversa.length, 1);
    assert.equal(inversa[0].contractId, 'c1');
  });

  it('telefoneDoLid e gravarLidNasPessoas usam as duas formas', async () => {
    const rows = memoria([{ telefone: COM_NONO, lid: null }]);
    assert.equal(await telefoneDoLid(SEM_NONO), COM_NONO);

    await gravarLidNasPessoas(SEM_NONO, '999001@lid');
    assert.equal(rows[0].lid, '999001@lid');
    assert.equal(await telefoneDoLid('999001@lid'), COM_NONO);

    memoria([{ telefone: SEM_NONO, lid: '888@lid' }]);
    assert.equal(await telefoneDoLid(COM_NONO), SEM_NONO);
    assert.equal(await telefoneDoLid('888@lid'), SEM_NONO);
  });

  it('a resposta ao não autorizado e o aviso de grupo ficam desligados por padrão', () => {
    const resposta = process.env.WUZAPI_RESPONDER_NAO_AUTORIZADO;
    const aviso = process.env.WUZAPI_AVISAR_GRUPO;
    delete process.env.WUZAPI_RESPONDER_NAO_AUTORIZADO;
    delete process.env.WUZAPI_AVISAR_GRUPO;
    try {
      assert.equal(respostaAutomaticaNaoAutorizadoLigada(), false);
      assert.equal(avisoGrupoNaoConfiguradoLigado(), false);
    } finally {
      if (resposta === undefined) delete process.env.WUZAPI_RESPONDER_NAO_AUTORIZADO;
      else process.env.WUZAPI_RESPONDER_NAO_AUTORIZADO = resposta;
      if (aviso === undefined) delete process.env.WUZAPI_AVISAR_GRUPO;
      else process.env.WUZAPI_AVISAR_GRUPO = aviso;
    }
  });
});
