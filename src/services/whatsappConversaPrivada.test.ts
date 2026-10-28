import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import whatsappPlanilhaPipeline from './WhatsappPlanilhaPipelineService';
import {
  avaliarLimiteRemetente,
  citarContratoNoTexto,
  consumirCotaRemetente,
  decidirConversaPrivada,
  extrairIdentidadePayload,
  limparCotaRemetente,
  limparPendenciasWhatsapp,
  mensagemDeGrupo,
  telefoneDeRespostaLid,
  validarTelefoneComDdi,
  type ContratoAutorizadoWhatsapp,
  type PendenciaWhatsapp,
} from './whatsappConversaPrivada';

const APARECIDA: ContratoAutorizadoWhatsapp = {
  contractId: 'c-aparecida',
  nome: 'Aparecida',
  podeEnviarPlanilha: true,
  podePedirRelatorio: true,
};

const CENTRO: ContratoAutorizadoWhatsapp = {
  contractId: 'c-centro',
  nome: 'Centro',
  podeEnviarPlanilha: true,
  podePedirRelatorio: true,
};

const SO_PLANILHA: ContratoAutorizadoWhatsapp = {
  ...APARECIDA,
  podePedirRelatorio: false,
};

const SO_RELATORIO: ContratoAutorizadoWhatsapp = {
  ...APARECIDA,
  podeEnviarPlanilha: false,
};

function decidir(parcial: Partial<Parameters<typeof decidirConversaPrivada>[0]>) {
  return decidirConversaPrivada({
    grupo: false,
    parecePlanilha: false,
    texto: '',
    textoMerece: false,
    pessoas: [],
    pendencia: null,
    agora: 1_000_000,
    ...parcial,
  });
}

describe('WhatsApp privado — grupo, telefone e LID', () => {
  it('ignora toda mensagem de grupo, mesmo com o remetente autorizado', async () => {
    assert.equal(mensagemDeGrupo({ isGroup: true, chat: '5511@s.whatsapp.net' }), true);
    assert.equal(mensagemDeGrupo({ chat: '120363@g.us', sender: '5562999998888@s.whatsapp.net' }), true);
    assert.equal(decidir({ grupo: true, parecePlanilha: true, pessoas: [APARECIDA] }).acao, 'grupo');

    const aceite = await whatsappPlanilhaPipeline.aceitarWebhook({
      type: 'Message',
      event: {
        Info: {
          IsGroup: true,
          Chat: '120363@g.us',
          Sender: '5562999998888@s.whatsapp.net',
          ID: 'MSG-GRUPO',
        },
        Message: { conversation: 'relatorio' },
      },
    });
    assert.equal(aceite.body.ignorado, 'grupo');
    assert.equal(aceite.continuar, null);
  });

  it('lê o telefone no JID e, quando o remetente vem como LID, no SenderAlt e no sender_pn', () => {
    const porTelefone = extrairIdentidadePayload({
      event: { Info: { Chat: '5562999998888@s.whatsapp.net', Sender: '5562999998888@s.whatsapp.net', PushName: 'Maria' } },
    });
    assert.equal(porTelefone.telefone, '5562999998888');
    assert.equal(porTelefone.origem, 'telefone');
    assert.equal(porTelefone.lid, null);

    const porAlt = extrairIdentidadePayload({
      event: {
        Info: {
          Chat: '179349238472834@lid',
          Sender: '179349238472834@lid',
          SenderAlt: '5562999998888@s.whatsapp.net',
          PushName: 'Maria',
        },
      },
    });
    assert.equal(porAlt.telefone, '5562999998888');
    assert.equal(porAlt.lid, '179349238472834@lid');
    assert.equal(porAlt.origem, 'sender_alt');

    const porPn = extrairIdentidadePayload({
      sender_pn: '5562988887777',
      event: {
        Info: {
          Chat: '179349238472834@lid',
          Sender: '179349238472834@lid',
        },
      },
    });
    assert.equal(porPn.telefone, '5562988887777');
    assert.equal(porPn.lid, '179349238472834@lid');
    assert.equal(porPn.origem, 'sender_alt');

    assert.equal(telefoneDeRespostaLid({ data: { PN: '5562977776666@s.whatsapp.net' } }), '5562977776666');
  });

  it('exige DDI + DDD + número', () => {
    assert.equal(validarTelefoneComDdi('5562999998888').ok, true);
    assert.equal(validarTelefoneComDdi('+55 (62) 3333-4444').ok, true);
    assert.equal(validarTelefoneComDdi('62999998888').ok, false);
    assert.equal(validarTelefoneComDdi('5511999').ok, false);
  });
});

describe('WhatsApp privado — autorização, contratos e planilha pendente', () => {
  it('não autorizado fica em silêncio; autorizado com um contrato importa ou gera o relatório', () => {
    assert.deepEqual(decidir({ parecePlanilha: true, pessoas: [] }).acao, 'silencio');
    assert.equal(decidir({ parecePlanilha: true, textoMerece: false, pessoas: [] }).tipo, 'planilha');
    assert.equal(decidir({ texto: 'relatorio', textoMerece: true, pessoas: [] }).tipo, 'relatorio');
    assert.equal(decidir({ texto: 'oi', pessoas: [] }).acao, 'ignorar');

    assert.equal(decidir({ parecePlanilha: true, pessoas: [APARECIDA] }).acao, 'importar');
    assert.equal(
      (decidir({ parecePlanilha: true, pessoas: [APARECIDA] }) as { contractId: string }).contractId,
      'c-aparecida',
    );
    assert.equal(decidir({ parecePlanilha: true, pessoas: [SO_RELATORIO] }).acao, 'silencio');

    const relatorio = decidir({ texto: 'dia 16/09', textoMerece: true, pessoas: [APARECIDA] });
    assert.equal(relatorio.acao, 'relatorio');
    assert.equal(decidir({ texto: 'saude', textoMerece: true, pessoas: [SO_PLANILHA] }).acao, 'silencio');
  });

  it('com vários contratos pergunta a lista, aceita o nome e recusa contrato fora da autorização', () => {
    const planilha = decidir({ parecePlanilha: true, pessoas: [APARECIDA, CENTRO] });
    assert.equal(planilha.acao, 'perguntar_planilha');
    assert.equal((planilha as { contratos: unknown[] }).contratos.length, 2);

    const peloNome = decidir({
      texto: 'relatorio aparecida dia 16/09',
      textoMerece: true,
      pessoas: [APARECIDA, CENTRO],
    });
    assert.equal(peloNome.acao, 'relatorio');
    assert.equal((peloNome as { contractId: string }).contractId, 'c-aparecida');
    assert.match((peloNome as { texto: string }).texto, /dia 16\/09/);
    assert.doesNotMatch((peloNome as { texto: string }).texto, /aparecida/i);

    const pergunta = decidir({ texto: 'relatorio', textoMerece: true, pessoas: [APARECIDA, CENTRO] });
    assert.equal(pergunta.acao, 'perguntar_relatorio');

    const negado = decidir({
      texto: 'relatorio centro dia 16/09',
      textoMerece: true,
      pessoas: [APARECIDA],
    });
    assert.equal(negado.acao, 'contrato_nao_autorizado');
    assert.equal(citarContratoNoTexto('relatorio aparecida', [{ contractId: 'c-aparecida', nome: 'Aparecida' }])?.contractId, 'c-aparecida');
  });

  it('planilha pendente escolhe o número e, depois de 30 minutos, expira', () => {
    const agora = 1_000_000;
    const pendencia: PendenciaWhatsapp = {
      tipo: 'planilha',
      expiraEm: agora + 30 * 60 * 1000,
      contratos: [
        { contractId: 'c-aparecida', nome: 'Aparecida' },
        { contractId: 'c-centro', nome: 'Centro' },
      ],
      caminho: 'whatsapp/pendente/abc.xlsx',
      nomeArquivo: 'coleta.xlsx',
    };
    const escolha = decidir({ texto: '2', textoMerece: true, pendencia, agora, pessoas: [APARECIDA, CENTRO] });
    assert.equal(escolha.acao, 'usar_planilha_pendente');
    assert.equal((escolha as { contractId: string }).contractId, 'c-centro');

    const expirada = decidir({
      texto: '1',
      textoMerece: true,
      pendencia: { ...pendencia, expiraEm: agora - 1 },
      agora,
      pessoas: [APARECIDA, CENTRO],
    });
    assert.equal(expirada.acao, 'planilha_expirada');
  });

  it('aceita no máximo 10 mensagens por minuto do mesmo remetente', () => {
    limparCotaRemetente('5562999998888');
    const inicio = 5_000_000;
    for (let i = 0; i < 10; i += 1) {
      assert.equal(consumirCotaRemetente('5562999998888', inicio + i), true);
    }
    assert.equal(consumirCotaRemetente('5562999998888', inicio + 11), false);
    assert.equal(consumirCotaRemetente('5562999998888', inicio + 60_000), true);
    const estourado = avaliarLimiteRemetente(Array.from({ length: 10 }, (_, i) => inicio + i), inicio + 20);
    assert.equal(estourado.permitido, false);
    limparCotaRemetente();
    limparPendenciasWhatsapp();
  });
});
