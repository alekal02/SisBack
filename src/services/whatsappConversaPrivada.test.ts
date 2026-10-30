import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import whatsappPlanilhaPipeline from './WhatsappPlanilhaPipelineService';
import * as XLSX from 'xlsx';
import {
  avaliarLimiteRemetente,
  citarContratoNoTexto,
  consumirCotaRemetente,
  decidirConversaPrivada,
  desfazimentoImportacaoSeguro,
  ehPedidoCancelarImportacao,
  expiraCancelamentoAposImportacao,
  extrairIdentidadePayload,
  extrairPistasPlanilha,
  identificarContratoPlanilha,
  limparCotaRemetente,
  limparPendenciasWhatsapp,
  mensagemDeGrupo,
  normalizarTextoWhatsapp,
  telefoneDeRespostaLid,
  textoEscolhaContrato,
  textoPlanilhaOutroContrato,
  textoPlanilhaRecebida,
  textoRelatorioContratoDia,
  validarTelefoneComDdi,
  type CancelamentoImportacaoWhatsapp,
  type ContratoAutorizadoWhatsapp,
  type PendenciaWhatsapp,
} from './whatsappConversaPrivada';
import { ehPedidoSaude, interpretarPedidoRelatorio } from './WhatsappComandoRelatorioTexto';

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

  it('saude com o contrato citado gera a saúde dele; saude sozinho pergunta e a escolha não volta ao menu', () => {
    const citado = decidir({
      texto: 'saude aparecida',
      textoMerece: true,
      pessoas: [APARECIDA, CENTRO],
    });
    assert.equal(citado.acao, 'relatorio');
    if (citado.acao === 'relatorio') {
      assert.equal(citado.contractId, 'c-aparecida');
      const texto = normalizarTextoWhatsapp(citado.texto);
      assert.equal(ehPedidoSaude(texto), true);
      assert.equal(interpretarPedidoRelatorio(texto), null);
    }

    const frase = decidir({
      texto: 'relatorio aparecida saude',
      textoMerece: true,
      pessoas: [APARECIDA, CENTRO],
    });
    assert.equal(frase.acao, 'relatorio');
    if (frase.acao === 'relatorio') {
      assert.equal(frase.contractId, 'c-aparecida');
      const texto = normalizarTextoWhatsapp(frase.texto);
      assert.equal(ehPedidoSaude(texto), true);
      assert.equal(interpretarPedidoRelatorio(texto), null);
    }

    const pergunta = decidir({ texto: 'saude', textoMerece: true, pessoas: [APARECIDA, CENTRO] });
    assert.equal(pergunta.acao, 'perguntar_relatorio');
    if (pergunta.acao !== 'perguntar_relatorio') return;
    assert.equal(pergunta.texto, 'saude');

    const agora = 2_000_000;
    const escolha = decidir({
      texto: '1',
      textoMerece: true,
      pessoas: [APARECIDA, CENTRO],
      agora,
      pendencia: {
        tipo: 'relatorio',
        expiraEm: agora + 60_000,
        contratos: [
          { contractId: 'c-aparecida', nome: 'Aparecida' },
          { contractId: 'c-centro', nome: 'Centro' },
        ],
        texto: pergunta.texto,
      },
    });
    assert.equal(escolha.acao, 'usar_relatorio_pendente');
    if (escolha.acao === 'usar_relatorio_pendente') {
      assert.equal(escolha.contractId, 'c-aparecida');
      assert.equal(escolha.texto, 'saude');
      assert.equal(ehPedidoSaude(normalizarTextoWhatsapp(escolha.texto)), true);
      assert.equal(interpretarPedidoRelatorio(normalizarTextoWhatsapp(escolha.texto)), null);
    }
  });

  it('sem permissão de pedir relatório, saude não recebe resposta', () => {
    assert.equal(decidir({ texto: 'saude', textoMerece: true, pessoas: [SO_PLANILHA] }).acao, 'silencio');
    assert.equal(
      decidir({ texto: 'saude aparecida', textoMerece: true, pessoas: [SO_PLANILHA] }).acao,
      'silencio',
    );
    assert.equal(
      decidir({
        texto: 'saude',
        textoMerece: true,
        pessoas: [
          { ...APARECIDA, podePedirRelatorio: false },
          { ...CENTRO, podePedirRelatorio: false },
        ],
      }).acao,
      'silencio',
    );
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

const GOIANIA: ContratoAutorizadoWhatsapp = {
  contractId: 'c-goiania',
  nome: 'Aparecida de Goiânia',
  numero: '045/2024',
  podeEnviarPlanilha: true,
  podePedirRelatorio: true,
};

const UNAI: ContratoAutorizadoWhatsapp = {
  contractId: 'c-unai',
  nome: 'Unaí',
  numero: '099/2024',
  podeEnviarPlanilha: false,
  podePedirRelatorio: true,
};

function bufferPlanilha(abas: Array<{ nome: string; linhas: unknown[][] }>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const aba of abas) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aba.linhas), aba.nome);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('WhatsApp privado — contrato lido na planilha', () => {
  const autorizados = [GOIANIA, CENTRO, UNAI];

  it('reconhece o nome completo no arquivo e ignora palavra solta', () => {
    const buffer = bufferPlanilha([
      { nome: 'CONSOLIDADO', linhas: [['SERVIÇO', 'DATA', 'QUANTIDADE'], ['Varrição', '16/09/2026', 10]] },
    ]);
    const pistas = extrairPistasPlanilha(buffer, 'PRODUÇÃO - APARECIDA DE GOIÂNIA.xlsx');
    const achado = identificarContratoPlanilha(pistas, autorizados);
    assert.equal(achado?.contractId, 'c-goiania');

    const solta = extrairPistasPlanilha(buffer, 'PRODUÇÃO - APARECIDA.xlsx');
    assert.equal(identificarContratoPlanilha(solta, autorizados), null);

    const decisao = decidir({ parecePlanilha: true, pessoas: autorizados, pistasPlanilha: pistas });
    assert.equal(decisao.acao, 'importar');
    assert.equal((decisao as { contractId: string }).contractId, 'c-goiania');
    assert.equal((decisao as { detectado?: boolean }).detectado, true);
  });

  it('Centro no cabeçalho não decide sozinho', () => {
    const pistas = extrairPistasPlanilha(
      bufferPlanilha([{
        nome: 'Coleta',
        linhas: [['PLANILHA PRODUTIVIDADE COLETA'], ['Centro', 'PLACA', 'PESO TOTAL']],
      }]),
      'envio.xlsx',
    );
    assert.equal(identificarContratoPlanilha(pistas, autorizados), null);
    assert.equal(decidir({ parecePlanilha: true, pessoas: autorizados, pistasPlanilha: pistas }).acao, 'perguntar_planilha');
  });

  it('reconhece a filial só no cabeçalho, com acento', () => {
    const buffer = bufferPlanilha([
      {
        nome: 'Coleta',
        linhas: [
          ['PLANILHA PRODUTIVIDADE COLETA'],
          ['Filial: Aparecida de Goiânia'],
          ['PLACA', 'PESO TOTAL', 'MOTORISTA'],
        ],
      },
    ]);
    const pistas = extrairPistasPlanilha(buffer, 'envio.xlsx');
    assert.equal(identificarContratoPlanilha(pistas, autorizados)?.contractId, 'c-goiania');

    const peloNumero = extrairPistasPlanilha(
      bufferPlanilha([{ nome: 'Coleta', linhas: [['PLANILHA PRODUTIVIDADE COLETA'], ['Contrato 045/2024']] }]),
      'envio.xlsx',
    );
    assert.equal(identificarContratoPlanilha(peloNumero, autorizados)?.contractId, 'c-goiania');
  });

  it('pergunta quando o arquivo cita mais de um contrato ou nenhum', () => {
    const ambigua = extrairPistasPlanilha(
      bufferPlanilha([{ nome: 'CONSOLIDADO', linhas: [['PRODUÇÃO - APARECIDA E CENTRO']] }]),
      'planilha.xlsx',
    );
    assert.equal(identificarContratoPlanilha(ambigua, autorizados), null);
    assert.equal(decidir({ parecePlanilha: true, pessoas: autorizados, pistasPlanilha: ambigua }).acao, 'perguntar_planilha');

    const semPista = extrairPistasPlanilha(
      bufferPlanilha([{ nome: 'CONSOLIDADO', linhas: [['SERVIÇO', 'DATA']] }]),
      'planilha.xlsx',
    );
    assert.equal(decidir({ parecePlanilha: true, pessoas: [APARECIDA, CENTRO], pistasPlanilha: semPista }).acao, 'perguntar_planilha');
  });

  it('não importa em contrato sem permissão de enviar planilha', () => {
    const buffer = bufferPlanilha([
      { nome: 'CONSOLIDADO', linhas: [['PRODUÇÃO - UNAÍ']] },
    ]);
    const pistas = extrairPistasPlanilha(buffer, 'PRODUÇÃO - UNAÍ.xlsx');
    assert.equal(identificarContratoPlanilha(pistas, autorizados), null);
    assert.notEqual(identificarContratoPlanilha(pistas, autorizados)?.contractId, 'c-unai');

    const soNaoAutorizado = identificarContratoPlanilha(pistas, [UNAI]);
    assert.equal(soNaoAutorizado, null);
    assert.equal(decidir({ parecePlanilha: true, pessoas: [UNAI], pistasPlanilha: pistas }).acao, 'silencio');

    const decisao = decidir({ parecePlanilha: true, pessoas: autorizados, pistasPlanilha: pistas });
    assert.equal(decisao.acao, 'perguntar_planilha');
    const ids = (decisao as { contratos: Array<{ contractId: string }> }).contratos.map((c) => c.contractId);
    assert.deepEqual(ids, ['c-goiania', 'c-centro']);
  });

  it('não importa quando a pessoa tem um contrato e a planilha cita outro', () => {
    const deGoiania = extrairPistasPlanilha(
      bufferPlanilha([{ nome: 'Coleta', linhas: [['Filial: Aparecida de Goiânia'], ['PLACA']] }]),
      'envio.xlsx',
    );
    const bloqueio = decidir({
      parecePlanilha: true,
      pessoas: [CENTRO],
      pistasPlanilha: deGoiania,
      catalogo: [CENTRO, GOIANIA, UNAI],
    });
    assert.equal(bloqueio.acao, 'planilha_outro_contrato');
    assert.equal(
      textoPlanilhaOutroContrato((bloqueio as { nome: string }).nome),
      'Esta planilha parece ser de Aparecida de Goiânia, em que você não está autorizado. Nada foi importado.',
    );

    const peloNumero = extrairPistasPlanilha(
      bufferPlanilha([{ nome: 'Coleta', linhas: [['Contrato 099/2024']] }]),
      'envio.xlsx',
    );
    const porNumero = decidir({
      parecePlanilha: true,
      pessoas: [GOIANIA],
      pistasPlanilha: peloNumero,
      catalogo: [GOIANIA, UNAI],
    });
    assert.equal(porNumero.acao, 'planilha_outro_contrato');
    assert.equal((porNumero as { nome: string }).nome, 'Unaí');

    const semCitacao = extrairPistasPlanilha(
      bufferPlanilha([{ nome: 'CONSOLIDADO', linhas: [['SERVIÇO', 'DATA', 'Centro']] }]),
      'planilha.xlsx',
    );
    const segue = decidir({
      parecePlanilha: true,
      pessoas: [GOIANIA],
      pistasPlanilha: semCitacao,
      catalogo: [GOIANIA, UNAI, CENTRO],
    });
    assert.equal(segue.acao, 'importar');
    assert.equal((segue as { contractId: string }).contractId, 'c-goiania');
  });

  it('o prazo de CANCELAR começa no fim da importação', () => {
    const inicio = 1_000_000;
    const fim = inicio + 8 * 60 * 1000;
    assert.equal(expiraCancelamentoAposImportacao(fim), fim + 10 * 60 * 1000);
    assert.ok(expiraCancelamentoAposImportacao(fim) > inicio + 10 * 60 * 1000);

    const src = readFileSync(path.join(__dirname, 'WhatsappPlanilhaPipelineService.ts'), 'utf8');
    const importacao = src.indexOf("await importarPlanilha(buffer, nome, ctx.servico, 'atualizar_data')");
    const aviso = src.indexOf('textoPlanilhaRecebida(nomeContrato)');
    const prazo = src.indexOf('expiraCancelamentoAposImportacao(Date.now())');
    assert.ok(importacao > 0);
    assert.ok(prazo > importacao);
    assert.ok(aviso > importacao);
  });

  it('desfaz só a importação que não substituiu dado anterior e aceita CANCELAR por 10 minutos', () => {
    assert.equal(desfazimentoImportacaoSeguro({ uploadIds: [12], registrosRemovidos: 0 }), true);
    assert.equal(desfazimentoImportacaoSeguro({ uploadIds: [12], registrosRemovidos: 4 }), false);
    assert.equal(desfazimentoImportacaoSeguro({ uploadIds: [], registrosRemovidos: 0 }), false);
    assert.equal(ehPedidoCancelarImportacao('CANCELAR'), true);
    assert.equal(ehPedidoCancelarImportacao('cancelar a planilha'), false);
    assert.equal(
      textoPlanilhaRecebida('Aparecida de Goiânia'),
      'Planilha recebida para Aparecida de Goiânia. Se não for esse, responda CANCELAR em até 10 minutos.',
    );
    assert.equal(textoRelatorioContratoDia('Aparecida de Goiânia', '16/09/2026'), 'Relatório de Aparecida de Goiânia, dia 16/09/2026');
    assert.equal(
      textoEscolhaContrato('Para qual contrato é este relatório?', [
        { nome: 'Aparecida de Goiânia' },
        { nome: 'Unaí' },
      ]),
      'Qual contrato?\n1 Aparecida de Goiânia · 2 Unaí',
    );

    const agora = 1_000_000;
    const cancelamento: CancelamentoImportacaoWhatsapp = {
      expiraEm: agora + 10 * 60 * 1000,
      contractId: 'c-goiania',
      nome: 'Aparecida de Goiânia',
      uploadIds: [12],
      desfazimentoSeguro: true,
    };
    const noPrazo = decidir({ texto: 'CANCELAR', textoMerece: true, agora, cancelamento, pessoas: autorizados });
    assert.equal(noPrazo.acao, 'cancelar_importacao');
    assert.equal((noPrazo as { desfazimentoSeguro: boolean }).desfazimentoSeguro, true);

    const tarde = decidir({
      texto: 'cancelar',
      textoMerece: true,
      agora,
      cancelamento: { ...cancelamento, expiraEm: agora - 1 },
      pessoas: autorizados,
    });
    assert.equal(tarde.acao, 'cancelar_expirado');

    const relatorio = decidir({
      texto: 'dia 16/09',
      textoMerece: true,
      agora,
      cancelamento,
      pessoas: [GOIANIA],
    });
    assert.equal(relatorio.acao, 'relatorio');
  });
});
