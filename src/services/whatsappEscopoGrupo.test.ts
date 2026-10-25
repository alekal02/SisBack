import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decidirEscopoWhatsapp } from './whatsappEscopoGrupo';

const autorizados = new Set(['120363@g.us']);

describe('escopo do WhatsApp', () => {
  it('descarta conversa privada do número', () => {
    assert.equal(decidirEscopoWhatsapp({
      isGroup: false,
      grupoJid: '5511999999999@s.whatsapp.net',
      autorizados,
    }), 'privado');
  });

  it('descarta grupo que não foi selecionado', () => {
    assert.equal(decidirEscopoWhatsapp({
      isGroup: true,
      grupoJid: '999@g.us',
      autorizados,
    }), 'grupo_fora');
  });

  it('aceita só o grupo mapeado', () => {
    assert.equal(decidirEscopoWhatsapp({
      isGroup: true,
      grupoJid: '120363@g.us',
      autorizados,
    }), 'autorizado');
  });
});
