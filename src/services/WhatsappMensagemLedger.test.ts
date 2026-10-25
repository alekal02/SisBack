import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  _lerLedgerMemoriaParaTeste,
  _resetLedgerMemoriaParaTeste,
  decidirReservaMensagem,
  decidirRetomadaAposQueda,
  listarMensagensRecuperaveis,
  marcarFalhaMensagemWhatsapp,
  marcarSucessoMensagemWhatsapp,
  MOTIVO_INTERROMPIDO,
  reservarMensagemWhatsapp,
  textoFalhaImportacao,
  textoGrupoNaoConfigurado,
} from './WhatsappMensagemLedger';

describe('ledger do chatbot — decisão de reserva', () => {
  const agora = 1_000_000;

  it('cria a primeira reserva', () => {
    assert.equal(decidirReservaMensagem(null, agora).acao, 'criar');
  });

  it('ignora sucesso e processamento ainda fresco', () => {
    assert.equal(
      decidirReservaMensagem({ estado: 'sucesso', atualizadoEm: agora, tentativas: 1, motivo: null }, agora).acao,
      'ignorar',
    );
    assert.equal(
      decidirReservaMensagem({ estado: 'processando', atualizadoEm: agora - 1000, tentativas: 1, motivo: null }, agora).acao,
      'ignorar',
    );
    assert.equal(
      decidirReservaMensagem({ estado: 'processando', atualizadoEm: agora - 5 * 60 * 1000, tentativas: 1, motivo: null }, agora).acao,
      'ignorar',
    );
  });

  it('reprocessa falha, processamento velho e processamento órfão no reinício', () => {
    assert.equal(
      decidirReservaMensagem({ estado: 'falha', atualizadoEm: agora - 10_000, tentativas: 1, motivo: 'erro_processamento' }, agora).acao,
      'reprocessar',
    );
    assert.equal(
      decidirReservaMensagem({
        estado: 'processando',
        atualizadoEm: agora - 16 * 60 * 1000,
        tentativas: 1,
        motivo: null,
      }, agora).acao,
      'reprocessar',
    );
    assert.equal(
      decidirReservaMensagem({
        estado: 'processando',
        atualizadoEm: agora,
        tentativas: 1,
        motivo: null,
      }, agora, { recuperarInterrompidos: true }).acao,
      'reprocessar',
    );
  });

  it('não retoma sozinho grupo não configurado, mas aceita novo envio', () => {
    const atual = {
      estado: 'falha' as const,
      atualizadoEm: agora,
      tentativas: 1,
      motivo: 'grupo_nao_mapeado',
    };
    assert.equal(decidirReservaMensagem(atual, agora, { recuperacaoAutomatica: true }).acao, 'ignorar');
    assert.equal(decidirReservaMensagem(atual, agora).acao, 'reprocessar');
  });
});

describe('ledger do chatbot — memória com concorrência', () => {
  it('uma falha preserva o payload e o reprocessamento volta a reservar', async () => {
    _resetLedgerMemoriaParaTeste();
    const payload = { event: { Info: { ID: 'MSG-1' } }, base64: 'planilha' };
    const primeira = await reservarMensagemWhatsapp({ messageId: 'MSG-1', grupoJid: '1@g.us', payload });
    const paralela = await Promise.all([
      reservarMensagemWhatsapp({ messageId: 'MSG-1', payload }),
      reservarMensagemWhatsapp({ messageId: 'MSG-1', payload }),
    ]);
    assert.equal(primeira.acao, 'processar');
    assert.equal(paralela.filter((r) => r.acao === 'processar').length, 0);

    await marcarFalhaMensagemWhatsapp('MSG-1', 'queda no meio da importação', 'erro_processamento');
    const depois = _lerLedgerMemoriaParaTeste('MSG-1');
    assert.equal(depois?.estado, 'falha');
    assert.deepEqual(depois?.payload, payload);

    const retomada = await reservarMensagemWhatsapp({ messageId: 'MSG-1', payload });
    assert.equal(retomada.acao, 'processar');
    await marcarSucessoMensagemWhatsapp('MSG-1', 'importada');
    const repetida = await reservarMensagemWhatsapp({ messageId: 'MSG-1', payload });
    assert.equal(repetida.acao, 'ignorar');
    assert.equal(_lerLedgerMemoriaParaTeste('MSG-1')?.estado, 'sucesso');
  });

  it('avisa grupo não configurado e falha de importação sem apagar o detalhe', () => {
    assert.match(textoGrupoNaoConfigurado(), /não está configurado/);
    assert.match(textoFalhaImportacao('ciclo fechado'), /ciclo fechado/);
  });

  it('depois da queda retoma uma vez, abandona na segunda e não repete no pull seguinte', async () => {
    assert.equal(decidirRetomadaAposQueda(1, null), 'retomar');
    assert.equal(decidirRetomadaAposQueda(2, null), 'abandonar');
    assert.equal(decidirRetomadaAposQueda(4, MOTIVO_INTERROMPIDO), 'ignorar');

    _resetLedgerMemoriaParaTeste();
    await reservarMensagemWhatsapp({ messageId: 'QUEDA', grupoJid: '1@g.us', payload: { ok: true } });
    const primeiraLista = await listarMensagensRecuperaveis();
    assert.equal(primeiraLista.some((item) => item.messageId === 'QUEDA'), true);

    await marcarFalhaMensagemWhatsapp('QUEDA', 'servidor reiniciou', MOTIVO_INTERROMPIDO);
    const depoisDoPull = await listarMensagensRecuperaveis();
    assert.equal(depoisDoPull.some((item) => item.messageId === 'QUEDA'), false);
  });
});
