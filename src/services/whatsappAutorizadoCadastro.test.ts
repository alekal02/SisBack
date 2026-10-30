import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Repository } from 'typeorm';
import { WhatsappAutorizado } from '../entities/WhatsappAutorizado';
import {
  criarAutorizado,
  definirRepoAutorizadoParaTeste,
} from './whatsappAutorizadoService';
import { executarLote, mensagemErroLotePublica } from './whatsappAgendaContatos';

const TELEFONE = '5562999998888';
const CONTRATO = 'b92df807-e233-4f4d-a254-86ed7491be34';

describe('cadastro de pessoa autorizada', () => {
  afterEach(() => definirRepoAutorizadoParaTeste(null));

  it('a aba Digitar grava sem mandar id e fica com o id gerado pelo banco', async () => {
    definirRepoAutorizadoParaTeste({
      create: (row: Partial<WhatsappAutorizado>) => row,
      findOne: async () => null,
      save: async (row: WhatsappAutorizado) => {
        assert.equal(row.id, undefined);
        row.id = '11111111-1111-4111-8111-111111111111';
        return row;
      },
    } as unknown as Repository<WhatsappAutorizado>);

    const criado = await criarAutorizado({
      contractId: CONTRATO,
      nome: 'Sala Técnica',
      telefone: TELEFONE,
      podeEnviarPlanilha: true,
      podePedirRelatorio: true,
    });

    assert.equal(criado.id, '11111111-1111-4111-8111-111111111111');
    assert.equal(criado.nome, 'Sala Técnica');
    assert.equal(criado.telefone, TELEFONE);
    assert.equal(criado.contractId, CONTRATO);
  });

  it('o lote grava a pessoa e, se o id vier vazio, devolve a mensagem clara sem SQL', async () => {
    const gravados: string[] = [];
    const ok = await executarLote({
      role: 'admin',
      contractId: CONTRATO,
      body: {
        pessoas: [{
          nome: 'Sala Técnica',
          telefone: TELEFONE,
          podeEnviarPlanilha: true,
          podePedirRelatorio: true,
        }],
      },
      lerExistentes: async () => [],
      salvar: async (pessoa) => {
        gravados.push(pessoa.telefone);
        return { id: '22222222-2222-4222-8222-222222222222' };
      },
    });
    assert.equal(ok.status, 201);
    if (!('criados' in ok.body)) throw new Error('lote sem criados');
    assert.equal(ok.body.criados.length, 1);
    assert.equal(ok.body.criados[0].id, '22222222-2222-4222-8222-222222222222');
    assert.deepEqual(gravados, [TELEFONE]);

    const sql = `INSERT INTO "whatsapp_autorizado"("id", "telefone") VALUES (DEFAULT, '${TELEFONE}')`;
    const falha = await executarLote({
      role: 'admin',
      contractId: CONTRATO,
      body: [{ nome: 'Sala Técnica', telefone: TELEFONE, podeEnviarPlanilha: true, podePedirRelatorio: true }],
      lerExistentes: async () => [],
      salvar: async () => {
        throw new Error(
          `query failed: ${sql} -- PARAMETERS: ["${TELEFONE}"] `
          + 'null value in column "id" of relation "whatsapp_autorizado" violates not-null constraint',
        );
      },
    });
    assert.equal(falha.status, 500);
    if (!('error' in falha.body)) throw new Error('lote sem erro');
    assert.equal(falha.body.error, mensagemErroLotePublica(new Error('null value in column "id"')));
    assert.equal(/insert|select|update|delete|default|parameters/i.test(falha.body.error), false);
    assert.equal(falha.body.error.includes(TELEFONE), false);
  });
});
