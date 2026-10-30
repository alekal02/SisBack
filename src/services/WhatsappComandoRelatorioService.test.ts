import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolverQualCicloMenu,
  textoPedeCicloAnterior,
  extrairDataIsoComando,
  ehPedidoRelatorioDia,
  extrairTipoServicoComando,
  ehPedidoMenuRelatorio,
  resolverEscolhaIndice,
  ehPedidoFormatoDiario,
  ehPedidoFormatoCiclo,
  ehPedidoSaude,
  ehPedidoOperacional,
  ehPedidoEvolucao,
  textoMereceProcessamento,
  interpretarPedidoRelatorio,
  legendaRelatorioPdf,
  resolverEscolhasLista,
  textoMenuRelatorio,
  textoMenuServicos,
  TEXTO_EVOLUCAO_SO_COLETA,
  TEXTO_LISTA_INVALIDA,
} from './WhatsappComandoRelatorioTexto';
import { Contract } from '../entities/Contract';
import { Servico } from '../entities/Servico';
import {
  formatoDaOpcaoMenu,
  processarComandoTextoWhatsapp,
  sessaoComandoAtiva,
} from './WhatsappComandoRelatorioService';
import wuzapiService from './WuzapiService';

describe('WhatsApp — data no comando do dia', () => {
  it('lê 16/09, 16/09/2026 e ISO', () => {
    assert.equal(extrairDataIsoComando('dia 16/09', '2026-09-21'), '2026-09-16');
    assert.equal(extrairDataIsoComando('relatorio 16/09/2026'), '2026-09-16');
    assert.equal(extrairDataIsoComando('diario 2026-09-16'), '2026-09-16');
    assert.equal(extrairDataIsoComando('ciclo'), null);
  });

  it('reconhece pedido de relatório do dia', () => {
    assert.equal(ehPedidoRelatorioDia('dia 16/09'), true);
    assert.equal(ehPedidoRelatorioDia('relatorio'), false);
    assert.equal(ehPedidoRelatorioDia('ciclo'), false);
    assert.equal(ehPedidoRelatorioDia('relatorio anterior'), false);
    assert.equal(ehPedidoRelatorioDia('relatorio rocada'), false);
    assert.equal(ehPedidoRelatorioDia('relatorio ciclo'), false);
  });
});

describe('WhatsApp — menu relatorio (serviço → diário/ciclo)', () => {
  it('abre o menu com relatorio e com o nome do tipo', () => {
    assert.equal(ehPedidoMenuRelatorio('relatorio'), true);
    assert.equal(ehPedidoMenuRelatorio('relatorio rocada'), true);
    assert.equal(ehPedidoMenuRelatorio('rocada'), true);
    assert.equal(ehPedidoMenuRelatorio('dia 16/09'), false);
    assert.equal(ehPedidoMenuRelatorio('ciclo'), false);
    assert.equal(ehPedidoMenuRelatorio('relatorio ciclo'), false);
    assert.equal(ehPedidoMenuRelatorio('relatorio saude'), false);
    assert.equal(ehPedidoMenuRelatorio('saude'), false);
  });

  it('reconhece pedido de saúde e de operacional', () => {
    assert.equal(ehPedidoSaude('saude'), true);
    assert.equal(ehPedidoSaude('relatorio saude'), true);
    assert.equal(ehPedidoSaude('relatorio de saude'), true);
    assert.equal(ehPedidoSaude('relatorio'), false);
    assert.equal(ehPedidoOperacional('operacional'), true);
    assert.equal(ehPedidoOperacional('relatorio operacional'), true);
    assert.equal(ehPedidoOperacional('relatorio'), false);
  });

  it('reconhece pedido de evolução diária (gráficos)', () => {
    assert.equal(ehPedidoEvolucao('evolucao'), true);
    assert.equal(ehPedidoEvolucao('evolucao diaria'), true);
    assert.equal(ehPedidoEvolucao('pdf evolucao'), true);
    assert.equal(ehPedidoEvolucao('relatorio evolucao'), true);
    assert.equal(ehPedidoEvolucao('graficos'), true);
    assert.equal(ehPedidoEvolucao('relatorio'), false);
    assert.equal(ehPedidoEvolucao('evolucao anterior'), false);
    assert.equal(ehPedidoMenuRelatorio('relatorio evolucao'), false);
  });

  it('lê o número da opção e o formato diário/ciclo', () => {
    assert.equal(resolverEscolhaIndice('1', 4), 1);
    assert.equal(resolverEscolhaIndice('3 — roçada', 4), 3);
    assert.equal(resolverEscolhaIndice('9', 4), null);
    assert.equal(ehPedidoFormatoDiario('1'), true);
    assert.equal(ehPedidoFormatoDiario('diario'), true);
    assert.equal(ehPedidoFormatoCiclo('2'), true);
    assert.equal(ehPedidoFormatoCiclo('ciclo completo'), true);
    assert.equal(ehPedidoFormatoCiclo('diario'), false);
  });
});

describe('WhatsApp — o que entra na fila', () => {
  it('aceita relatório, atalho e número de menu', () => {
    assert.equal(textoMereceProcessamento('Relatório'), true);
    assert.equal(textoMereceProcessamento('relatório de saúde'), true);
    assert.equal(textoMereceProcessamento('ciclo anterior'), true);
    assert.equal(textoMereceProcessamento('dia 16/09'), true);
    assert.equal(textoMereceProcessamento('1'), true);
    assert.equal(textoMereceProcessamento('evolucao'), true);
  });

  it('descarta conversa que não é comando', () => {
    assert.equal(textoMereceProcessamento('bom dia pessoal'), false);
    assert.equal(textoMereceProcessamento('pode mandar a foto do caminhão'), false);
    assert.equal(textoMereceProcessamento(''), false);
  });
});

describe('WhatsApp — tipo de serviço no comando', () => {
  it('lê o tipo pedido no texto', () => {
    assert.equal(extrairTipoServicoComando('relatorio rocada'), 'rocadeira');
    assert.equal(extrairTipoServicoComando('relatorio varricao'), 'varricao');
    assert.equal(extrairTipoServicoComando('pdf poda 16/09'), 'poda');
    assert.equal(extrairTipoServicoComando('capina'), 'capina');
    assert.equal(extrairTipoServicoComando('relatorio'), null);
    assert.equal(extrairTipoServicoComando('ciclo'), null);
  });
});

describe('WhatsApp — ciclo anterior nos relatórios', () => {
  it('reconhece pedido de ciclo anterior no texto', () => {
    assert.equal(textoPedeCicloAnterior('ciclo anterior'), true);
    assert.equal(textoPedeCicloAnterior('relatorio anterior'), true);
    assert.equal(textoPedeCicloAnterior('peso anterior'), true);
    assert.equal(textoPedeCicloAnterior('mes passado'), true);
    assert.equal(textoPedeCicloAnterior('ciclo atual'), false);
    assert.equal(textoPedeCicloAnterior('ciclo'), false);
  });

  it('menu atual/anterior: 1 = atual, 2 = anterior', () => {
    assert.equal(resolverQualCicloMenu('1'), 'atual');
    assert.equal(resolverQualCicloMenu('2'), 'anterior');
    assert.equal(resolverQualCicloMenu('atual'), 'atual');
    assert.equal(resolverQualCicloMenu('anterior'), 'anterior');
    assert.equal(resolverQualCicloMenu('ciclo fechado'), 'anterior');
    assert.equal(resolverQualCicloMenu('xyz'), null);
  });
});

describe('WhatsApp — mensagens curtas do relatório', () => {
  it('menu de tipo e de serviço cabem em poucas linhas', () => {
    assert.equal(textoMenuRelatorio(), 'Qual relatório?\n1 Dia · 2 Ciclo · 3 Evolução · 4 Saúde');
    assert.equal(
      textoMenuServicos(['Coleta', 'Roçada', 'Varrição']),
      'Qual serviço?\n1 Coleta · 2 Roçada · 3 Varrição · 0 Todos\n(pode escolher vários: 1,3)',
    );
    assert.equal(TEXTO_LISTA_INVALIDA, 'Responda com o número da lista.');
    assert.equal(TEXTO_EVOLUCAO_SO_COLETA, 'Evolução só está disponível para Coleta.');
    assert.equal(textoMenuRelatorio().includes('16/09'), false);
    assert.equal(textoMenuRelatorio().includes('4 Saúde'), true);
  });

  it('atalho completo não abre menu; relatório sozinho abre', () => {
    const ciclo = interpretarPedidoRelatorio('ciclo coleta');
    assert.equal(ciclo?.formato, 'ciclo');
    assert.equal(ciclo?.tipoServico, 'coleta_caminhao');
    assert.equal(ciclo?.abrirMenuTipo, false);

    const dia = interpretarPedidoRelatorio('dia 29/10 rocada', '2026-10-30');
    assert.equal(dia?.formato, 'dia');
    assert.equal(dia?.tipoServico, 'rocadeira');
    assert.equal(dia?.dataIso, '2026-10-29');

    const todos = interpretarPedidoRelatorio('evolucao todos');
    assert.equal(todos?.formato, 'evolucao');
    assert.equal(todos?.todos, true);

    const menu = interpretarPedidoRelatorio('relatorio');
    assert.equal(menu?.abrirMenuTipo, true);
    assert.equal(menu?.formato, null);
  });

  it('aceita vários números e rejeita texto fora da lista', () => {
    assert.deepEqual(resolverEscolhasLista('1,3', 4), [1, 3]);
    assert.deepEqual(resolverEscolhasLista('0', 4), 'todos');
    assert.equal(resolverEscolhasLista('9', 4), null);
    assert.equal(resolverEscolhasLista('coleta', 4), null);
  });

  it('4, saude, saúde e hodometro escolhem Saúde', () => {
    for (const texto of ['4', 'saude', 'saúde', 'hodometro']) {
      assert.equal(formatoDaOpcaoMenu(texto, null), 'saude');
    }
    assert.equal(formatoDaOpcaoMenu('1', null), 'dia');
    assert.equal(formatoDaOpcaoMenu('2', null), 'ciclo');
    assert.equal(formatoDaOpcaoMenu('3', null), 'evolucao');
  });

  it('legenda do PDF é uma linha', () => {
    assert.equal(
      legendaRelatorioPdf('Ciclo', 'Coleta', 'Aparecida', '2026-10-25', '2026-10-30'),
      'Ciclo · Coleta · Aparecida · 25/10 a 30/10',
    );
  });
});

function respostaEhSaude(textos: string[], documentos: string[]): boolean {
  if (documentos.some((nome) => /saude/i.test(nome))) return true;
  return textos.some((texto) => /saúde dos dados|saude dos dados/i.test(texto));
}

describe('WhatsApp — saúde no menu e com o menu aberto', () => {
  const servico = {
    id: 'servico-saude',
    contract_id: 'contrato-saude',
    nome: 'Coleta',
    tipo: 'coleta_caminhao',
  } as Servico;
  const contrato = {
    id: 'contrato-saude',
    numeroContrato: 'Aparecida',
  } as Contract;
  const jid = 'chat-saude-menu@s.whatsapp.net';
  const textos: string[] = [];
  const documentos: string[] = [];
  const enviarTextoOriginal = wuzapiService.enviarTexto;
  const enviarDocumentoOriginal = wuzapiService.enviarDocumento;
  const urlOriginal = process.env.WUZAPI_URL;
  const tokenOriginal = process.env.WUZAPI_TOKEN;

  it('relatorio mostra a opção 4; 4 e saude com menu aberto geram a saúde', async () => {
    process.env.WUZAPI_URL = 'http://127.0.0.1:9';
    process.env.WUZAPI_TOKEN = 'token-teste';
    wuzapiService.enviarTexto = async (_destino: string, body: string) => {
      textos.push(body);
      return {};
    };
    wuzapiService.enviarDocumento = async (_destino: string, nome: string) => {
      documentos.push(nome);
      return {};
    };
    try {
      const menu = await processarComandoTextoWhatsapp({
        grupoJid: jid,
        texto: 'relatorio',
        contextoContrato: { servico, contrato },
      });
      assert.equal(menu.processado, true);
      assert.equal(textos.at(-1), textoMenuRelatorio());
      assert.match(textos.at(-1) || '', /4 Saúde/);

      textos.length = 0;
      documentos.length = 0;
      const quatro = await processarComandoTextoWhatsapp({
        grupoJid: jid,
        texto: '4',
        contextoContrato: { servico, contrato },
      });
      assert.equal(quatro.processado, true);
      assert.equal(sessaoComandoAtiva(jid), false);
      assert.equal(respostaEhSaude(textos, documentos), true);
      assert.equal(textos.some((texto) => texto === TEXTO_LISTA_INVALIDA), false);

      await processarComandoTextoWhatsapp({
        grupoJid: jid,
        texto: 'relatorio',
        contextoContrato: { servico, contrato },
      });
      assert.equal(sessaoComandoAtiva(jid), true);
      textos.length = 0;
      documentos.length = 0;
      const atalho = await processarComandoTextoWhatsapp({
        grupoJid: jid,
        texto: 'saude',
        contextoContrato: { servico, contrato },
      });
      assert.equal(atalho.processado, true);
      assert.equal(sessaoComandoAtiva(jid), false);
      assert.equal(respostaEhSaude(textos, documentos), true);
      assert.equal(textos.some((texto) => texto.startsWith('Qual relatório?')), false);
    } finally {
      if (sessaoComandoAtiva(jid)) {
        await processarComandoTextoWhatsapp({
          grupoJid: jid,
          texto: 'cancelar',
          contextoContrato: { servico, contrato },
        });
      }
      wuzapiService.enviarTexto = enviarTextoOriginal;
      wuzapiService.enviarDocumento = enviarDocumentoOriginal;
      if (urlOriginal === undefined) delete process.env.WUZAPI_URL;
      else process.env.WUZAPI_URL = urlOriginal;
      if (tokenOriginal === undefined) delete process.env.WUZAPI_TOKEN;
      else process.env.WUZAPI_TOKEN = tokenOriginal;
    }
  });
});
