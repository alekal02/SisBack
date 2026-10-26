import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import {
  escolherUploadParaBackup,
  gravarEmArquivosStorage,
  nomeArquivoBackupCiclo,
  pastaDestinoBackupCiclo,
  pathMinioCicloContrato,
  resolverPastaBackupPlanilhas,
} from './planilhaOriginalStorage';

describe('escolherUploadParaBackup', () => {
  it('prefere a última planilha do chatbot com arquivo original', () => {
    const escolhido = escolherUploadParaBackup([
      {
        id: 1,
        criadoEm: new Date('2026-09-01T10:00:00Z'),
        urlDownload: 'http://minio/a.xlsx',
        resumo: { origem: 'web' },
      },
      {
        id: 2,
        criadoEm: new Date('2026-09-08T10:00:00Z'),
        urlDownload: 'http://minio/chat.xlsx',
        resumo: { origem: 'whatsapp' },
      },
      {
        id: 3,
        criadoEm: new Date('2026-09-09T10:00:00Z'),
        urlDownload: 'http://minio/chat.xlsx',
        resumo: { modelo: 'continuacao-ciclo-aberto' },
      },
    ]);
    assert.equal(escolhido?.id, 2);
  });

  it('usa o último com urlDownload se nenhuma for do chatbot', () => {
    const escolhido = escolherUploadParaBackup([
      { id: 1, criadoEm: new Date('2026-09-01T10:00:00Z'), urlDownload: null },
      { id: 4, criadoEm: new Date('2026-09-08T10:00:00Z'), urlDownload: 'http://minio/b.xlsx' },
    ]);
    assert.equal(escolhido?.id, 4);
  });
});

describe('nomeArquivoBackupCiclo', () => {
  it('usa as datas do ciclo no nome do arquivo', () => {
    assert.equal(
      nomeArquivoBackupCiclo({
        dataInicio: '2026-07-25',
        dataFim: '2026-08-24',
        nomeServico: 'Coleta',
        nomeOriginal: 'planilha.xlsx',
      }),
      '25-07-2026_a_24-08-2026_Coleta.xlsx',
    );
  });
});

describe('pastaDestinoBackupCiclo', () => {
  it('grava em pasta relativa ao processo, com o nome do contrato', () => {
    const d = pastaDestinoBackupCiclo({
      numeroContrato: 'CT-99 BH',
      pastaConfigurada: 'C:\\Users\\foo\\backup',
      hostDir: 'planilhas-ciclo',
    });
    const esperado = path.join(process.cwd(), 'planilhas-ciclo', 'CT-99_BH');
    assert.equal(d.pastaAbs, esperado);
    assert.equal(d.caminhoHost, esperado);
  });
});

describe('pathMinioCicloContrato', () => {
  it('monta consolidado vivo e snapshot diário por contrato/ciclo', () => {
    const p = pathMinioCicloContrato({
      numeroContrato: 'ap',
      dataInicio: '2026-08-25',
      dataFim: '2026-09-24',
      ext: '.xlsm',
      dataDiario: '2026-09-16',
    });
    assert.equal(p.consolidado, 'contratos/ap/ciclo-2026-08-25_2026-09-24/consolidado.xlsm');
    assert.equal(p.diario, 'contratos/ap/ciclo-2026-08-25_2026-09-24/diario/2026-09-16.xlsm');
  });
});

describe('arquivo original em arquivos_storage', () => {
  it('grava o buffer e devolve url db://arquivos para tela e WhatsApp', async () => {
    const buffer = Buffer.from('planilha-original');
    const chamadas: Array<{ sql: string; params: unknown[] }> = [];
    const url = await gravarEmArquivosStorage(
      'contratos/ap/ciclo-2026-09-25_2026-10-24/diario/2026-10-23.xlsx',
      buffer,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      async (sql, params) => {
        chamadas.push({ sql, params: params || [] });
      },
    );
    assert.equal(url, 'db://arquivos/contratos/ap/ciclo-2026-09-25_2026-10-24/diario/2026-10-23.xlsx');
    assert.equal(chamadas.length, 1);
    assert.match(chamadas[0].sql, /INSERT INTO arquivos_storage/);
    assert.equal(chamadas[0].params[1], 'contratos/ap/ciclo-2026-09-25_2026-10-24/diario/2026-10-23.xlsx');
    assert.equal(chamadas[0].params[3], buffer.length);
    assert.equal(chamadas[0].params[4], buffer);
  });

  it('recusa planilha vazia', async () => {
    await assert.rejects(
      () => gravarEmArquivosStorage('planilhas/vazia.xlsx', Buffer.alloc(0), 'application/octet-stream', async () => {}),
      /vazio/,
    );
  });
});

describe('resolverPastaBackupPlanilhas', () => {
  it('cai no fallback se a pasta estiver vazia', () => {
    const fb = path.resolve('C:\\Sistemma\\planilhas-ciclo\\CT-1');
    const got = resolverPastaBackupPlanilhas('', fb);
    assert.ok(got.includes('planilhas-ciclo'));
  });
});
