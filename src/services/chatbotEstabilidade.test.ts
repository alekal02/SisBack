import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import express from 'express';
import { limiteCorpoPorRota, MAX_BODY_BYTES } from '../config/limitesRecursos';
import { deveFecharNavegadorAposPdf } from './PdfGeneratorService';
import { decidirAcaoVigia } from './WhatsappSessaoVigia';
import { liberarTrabalhoPesado, ocuparTrabalhoPesado, trabalhoPesadoEmAndamento } from './trabalhoPesado';
import {
  WEBHOOK_CORPO_MAX_BYTES,
  criarExtratorBase64,
  receberCorpoWebhook,
} from './webhookCorpoStream';
import {
  caminhoInboxPermitido,
  prepararPayloadPlanilhaWhatsapp,
  WhatsappPlanilhaPipelineService,
} from './WhatsappPlanilhaPipelineService';

describe('chatbot estável na imagem nova', () => {
  const inboxAnterior = process.env.WHATSAPP_INBOX_DIR;

  after(() => {
    if (inboxAnterior === undefined) delete process.env.WHATSAPP_INBOX_DIR;
    else process.env.WHATSAPP_INBOX_DIR = inboxAnterior;
    while (trabalhoPesadoEmAndamento()) liberarTrabalhoPesado();
  });

  it('o webhook aceita planilha grande e o restante da API continua no teto de 10 MB', () => {
    assert.ok(WEBHOOK_CORPO_MAX_BYTES >= 150 * 1024 * 1024);
    assert.equal(limiteCorpoPorRota('/api/contracts'), MAX_BODY_BYTES);
    assert.ok(MAX_BODY_BYTES <= 10 * 1024 * 1024);
    assert.equal(limiteCorpoPorRota('/api/sala-tecnica/pdf'), '40mb');
  });

  it('planilha de 65 MB entra pelo webhook gravando em disco, sem o teto antigo de 64 MB', async () => {
    const app = express();
    app.post('/api/wuzapi/webhook', (req, res, next) => {
      receberCorpoWebhook(req, res, (err?: unknown) => {
        if (err) {
          next(err);
          return;
        }
        const arquivo = String(req.body?.base64Arquivo || '');
        const tamanho = arquivo && fs.existsSync(arquivo) ? fs.statSync(arquivo).size : 0;
        res.json({ ok: true, tamanho, temBase64: typeof req.body?.base64 === 'string' });
        if (arquivo) fs.rmSync(arquivo, { force: true });
      });
    });
    app.post('/api/contracts', (req, res, next) => {
      express.json({ limit: limiteCorpoPorRota(req.path) })(req, res, (err?: unknown) => {
        if (err) {
          next(err);
          return;
        }
        res.json({ ok: true });
      });
    });
    app.use((err: { status?: number; type?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const status = err?.status || (err?.type === 'entity.too.large' ? 413 : 500);
      if (!res.headersSent) res.status(status).json({ ok: false });
    });

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const porta = (server.address() as { port: number }).port;
    const megas = 65;

    try {
      const webhook = await enviarPlanilha(`http://127.0.0.1:${porta}/api/wuzapi/webhook`, megas);
      const outra = await postar(
        `http://127.0.0.1:${porta}/api/contracts`,
        JSON.stringify({ base64: 'A'.repeat(11 * 1024 * 1024) }),
      );
      assert.equal(webhook.status, 200);
      assert.equal(webhook.tamanho, megas * 1024 * 1024);
      assert.equal(webhook.temBase64, false);
      assert.equal(outra.status, 413);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it('o extrator corta o base64 mesmo quando a chave vem partida no meio do pacote', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extrator-b64-'));
    const arquivo = path.join(dir, 'planilha.b64');
    const extrator = criarExtratorBase64(arquivo);
    const valor = 'ABC123+/==';
    const json = `{"fileName":"a.xlsx","base64":"${valor}","type":"Message"}`;
    extrator.push(Buffer.from(json.slice(0, 24)));
    extrator.push(Buffer.from(json.slice(24, 28)));
    extrator.push(Buffer.from(json.slice(28)));
    const extraido = extrator.finish();
    const meta = JSON.parse(extraido.meta) as { base64?: string; fileName?: string; type?: string };
    assert.equal(meta.fileName, 'a.xlsx');
    assert.equal(meta.type, 'Message');
    assert.equal(meta.base64, '');
    assert.equal(fs.readFileSync(arquivo, 'utf8'), valor);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('planilha grande vai para disco e o JSON do banco não leva o arquivo', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-whatsapp-'));
    process.env.WHATSAPP_INBOX_DIR = dir;
    const base64 = 'B'.repeat(512 * 1024);
    const preparado = await prepararPayloadPlanilhaWhatsapp(
      { base64, fileName: 'producao.xlsx' },
      'MSG/../../etc/passwd',
    );

    assert.equal(preparado.base64, undefined);
    assert.ok(preparado.base64Arquivo);
    assert.equal(caminhoInboxPermitido(preparado.base64Arquivo), path.resolve(preparado.base64Arquivo));
    assert.equal(fs.readFileSync(preparado.base64Arquivo, 'utf8'), base64);
    assert.ok(JSON.stringify(preparado).length < 5_000);
    assert.equal(JSON.stringify(preparado).includes(base64), false);
    assert.equal(caminhoInboxPermitido(path.join(dir, '..', 'segredo.txt')), null);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('se o disco falhar, o base64 não entra no JSON que vai para o banco', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-bloqueio-'));
    const arquivo = path.join(dir, 'nao-e-pasta');
    fs.writeFileSync(arquivo, 'x');
    process.env.WHATSAPP_INBOX_DIR = arquivo;
    const base64 = 'C'.repeat(512 * 1024);
    const preparado = await prepararPayloadPlanilhaWhatsapp({ base64 }, 'MSG-DISCO');

    assert.equal(preparado.base64, base64);
    assert.equal(JSON.stringify(preparado).includes(base64), false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('planilha e relatório não rodam juntos', async () => {
    const servico = new WhatsappPlanilhaPipelineService();
    let simultaneo = 0;
    let pico = 0;
    servico.processarWebhook = async () => {
      simultaneo += 1;
      pico = Math.max(pico, simultaneo);
      assert.equal(trabalhoPesadoEmAndamento(), true);
      await new Promise((resolve) => setTimeout(resolve, 40));
      simultaneo -= 1;
      return { processado: true };
    };

    await Promise.all([
      servico.processarEmFila({ type: 'Message' }),
      servico.processarEmFila({ type: 'Message' }),
    ]);
    assert.equal(pico, 1);
    assert.equal(trabalhoPesadoEmAndamento(), false);
  });

  it('um erro no relatório libera a fila para a próxima planilha', async () => {
    const servico = new WhatsappPlanilhaPipelineService();
    let chamadas = 0;
    servico.processarWebhook = async () => {
      chamadas += 1;
      if (chamadas === 1) throw new Error('pdf estourou');
      return { processado: true };
    };

    await assert.rejects(() => servico.processarEmFila({ type: 'Message' }), /pdf estourou/);
    const segunda = await servico.processarEmFila({ type: 'Message' });
    assert.equal((segunda as { processado: boolean }).processado, true);
    assert.equal(trabalhoPesadoEmAndamento(), false);
  });

  it('produção fecha o Chrome depois do PDF e a sessão caída reconecta sem novo QR', () => {
    assert.equal(deveFecharNavegadorAposPdf('production', undefined), true);
    assert.equal(deveFecharNavegadorAposPdf('production', 'true'), false);
    assert.equal(deveFecharNavegadorAposPdf('development', undefined), false);

    assert.equal(decidirAcaoVigia({ connected: false, loggedIn: false }), 'reconectar');
    assert.equal(decidirAcaoVigia({ connected: true, loggedIn: false }), 'aguardar_qr');
    assert.equal(decidirAcaoVigia({ connected: true, loggedIn: true }), 'ok');
  });

  it('o aquecimento do dashboard não entra enquanto a planilha está na fila', () => {
    assert.equal(trabalhoPesadoEmAndamento(), false);
    ocuparTrabalhoPesado();
    assert.equal(trabalhoPesadoEmAndamento(), true);
    liberarTrabalhoPesado();
    assert.equal(trabalhoPesadoEmAndamento(), false);
  });
});

function postar(url: string, corpo: string): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(corpo),
      },
    }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode || 0 }));
    });
    req.on('error', reject);
    req.end(corpo);
  });
}

function enviarPlanilha(url: string, megabytes: number): Promise<{ status: number; tamanho: number; temBase64: boolean }> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      const partes: Buffer[] = [];
      res.on('data', (parte) => partes.push(parte));
      res.on('end', () => {
        const texto = Buffer.concat(partes).toString('utf8');
        const json = texto ? JSON.parse(texto) as { tamanho?: number; temBase64?: boolean } : {};
        resolve({
          status: res.statusCode || 0,
          tamanho: Number(json.tamanho || 0),
          temBase64: json.temBase64 === true,
        });
      });
    });
    req.on('error', reject);
    req.write('{"fileName":"producao.xlsx","base64":"');
    const bloco = Buffer.alloc(1024 * 1024, 65);
    for (let i = 0; i < megabytes; i += 1) req.write(bloco);
    req.end('","type":"Message"}');
  });
}
