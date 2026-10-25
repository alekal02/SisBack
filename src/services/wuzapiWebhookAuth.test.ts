import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'crypto';
import {
  assinaturaHmacConfere,
  assinaturaRecebida,
  segredoRecebidoWebhook,
  segredoWebhookConfere,
  urlSemSegredoWebhook,
  webhookAbertoEmProducao,
  webhookHmacDeveRecusar,
} from './wuzapiWebhookAuth';

describe('webhook WuzAPI — segredo', () => {
  it('aceita o segredo certo e rejeita outro do mesmo tamanho', () => {
    assert.equal(segredoWebhookConfere('segredo-fase-2', 'segredo-fase-2'), true);
    assert.equal(segredoWebhookConfere('segredo-fase-2', 'segredo-fase-X'), false);
    assert.equal(segredoWebhookConfere('abc', ''), false);
  });

  it('em produção sem segredo o webhook fica aberto — o fechamento exige a WuzAPI enviar o segredo', () => {
    assert.equal(webhookAbertoEmProducao('production', ''), true);
    assert.equal(webhookAbertoEmProducao('production', 'segredo'), false);
    assert.equal(webhookAbertoEmProducao('development', ''), false);
  });

  it('confere o HMAC do corpo e não bloqueia enquanto a exigência estiver desligada', () => {
    const corpo = Buffer.from('{"type":"Message"}');
    const assinatura = createHmac('sha256', 'chave-hmac-de-teste-com-32-chars!!').update(corpo).digest('hex');
    assert.equal(assinaturaHmacConfere('chave-hmac-de-teste-com-32-chars!!', corpo, assinatura), true);
    assert.equal(assinaturaHmacConfere('chave-hmac-de-teste-com-32-chars!!', corpo, '00'), false);
    assert.equal(assinaturaRecebida({ 'x-hmac-signature': assinatura }), assinatura);
    assert.equal(webhookHmacDeveRecusar({
      exigir: false,
      segredo: '',
      corpo: null,
      assinatura: '',
    }), false);
    assert.equal(webhookHmacDeveRecusar({
      exigir: true,
      segredo: 'chave-hmac-de-teste-com-32-chars!!',
      corpo,
      assinatura,
    }), false);
    assert.equal(webhookHmacDeveRecusar({
      exigir: true,
      segredo: 'chave-hmac-de-teste-com-32-chars!!',
      corpo,
      assinatura: '',
    }), true);
  });

  it('não devolve o segredo que vai na query da URL', () => {
    const url = 'https://sistemma-api-va.onrender.com/api/wuzapi/webhook?secret=abc123&x=1';
    assert.equal(
      urlSemSegredoWebhook(url),
      'https://sistemma-api-va.onrender.com/api/wuzapi/webhook?x=1',
    );
    assert.equal(urlSemSegredoWebhook('https://api.exemplo.com/api/wuzapi/webhook'), 'https://api.exemplo.com/api/wuzapi/webhook');
    assert.equal(urlSemSegredoWebhook(''), '');
  });

  it('lê cabeçalho, bearer ou query sem exigir um formato só', () => {
    assert.equal(segredoRecebidoWebhook({ 'x-webhook-secret': 'h' }, {}), 'h');
    assert.equal(segredoRecebidoWebhook({ authorization: 'Bearer tok' }, {}), 'tok');
    assert.equal(segredoRecebidoWebhook({}, { secret: 'q' }), 'q');
  });
});
