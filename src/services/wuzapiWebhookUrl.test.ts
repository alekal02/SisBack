import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolverWebhookWuzapi } from './WuzapiService';

describe('URL do webhook WhatsApp', () => {
  it('descarta endereço fixo de Docker mesmo se a WuzAPI parecer interna', () => {
    assert.equal(
      resolverWebhookWuzapi('http://wuzapi:8080', 'http://host.docker.internal:3200/api/wuzapi/webhook'),
      '',
    );
    assert.equal(
      resolverWebhookWuzapi('http://wuzapi:8080/', 'http://sistemma-backend:3200/api/wuzapi/webhook'),
      '',
    );
  });

  it('usa a URL informada por variável', () => {
    assert.equal(
      resolverWebhookWuzapi('http://24.199.86.195:8080', 'https://api.exemplo.com/api/wuzapi/webhook'),
      'https://api.exemplo.com/api/wuzapi/webhook',
    );
  });

  it('sem URL configurada não inventa host', () => {
    assert.equal(resolverWebhookWuzapi('http://localhost:8080', ''), '');
  });
});
