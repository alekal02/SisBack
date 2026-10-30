import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { authorize } from '../middlewares/authMiddleware';
import { WuzapiService } from './WuzapiService';
import {
  CACHE_CONTATOS_MS,
  MENSAGEM_SESSAO_DESCONECTADA,
  executarLote,
  filtrarAgendaWuzapi,
  limparCacheContatosAgenda,
  linhaLogContatos,
  listarContatosAgenda,
  listarParticipantesAgenda,
  marcarJaAutorizados,
  mascararTelefoneLista,
  normalizarTelefoneAgenda,
  redigirTelefones,
} from './whatsappAgendaContatos';

const TELEFONE = '5562999998888';
const SEM_NONO = '556299998888';
const TOKEN_INSTANCIA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TOKEN_AMBIENTE = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const PROPRIO = '5562777766666@s.whatsapp.net';

describe('agenda de contatos do WhatsApp', () => {
  beforeEach(() => limparCacheContatosAgenda());

  it('ignora grupo, @lid sem telefone, o próprio número e duplicados', () => {
    const lista = filtrarAgendaWuzapi({
      '120363111@g.us': { FullName: 'Grupo da obra', PushName: 'Grupo' },
      '999001@lid': { PushName: 'Só LID' },
      [PROPRIO]: { FullName: 'Eu mesmo' },
      '5562910101010@s.whatsapp.net': { FullName: 'Ana Agenda', PushName: 'Ana zap' },
      '5562910101010@lid': { Phone: '5562910101010', PushName: 'Ana de novo' },
      '5562920202020@s.whatsapp.net': { FirstName: 'Bruno', PushName: 'Bruno zap' },
      '5562930303030@c.us': { PushName: 'Caio' },
    }, PROPRIO);

    assert.deepEqual(lista.map((item) => item.nome), ['Ana Agenda', 'Bruno', 'Caio']);
    assert.equal(lista[1].nome, 'Bruno');
    assert.equal(new Set(lista.map((item) => item.telefone)).size, 3);
  });

  it('lê participantes do grupo e aplica o mesmo filtro', () => {
    const lista = filtrarAgendaWuzapi({
      JID: '120363111@g.us',
      Participants: [
        { JID: '111@lid', DisplayName: 'Sem fone' },
        { JID: '120363222@g.us', DisplayName: 'Outro grupo' },
        { JID: '5562940404040@s.whatsapp.net', DisplayName: 'Dora' },
        { JID: '222@lid', PhoneNumber: '5562940404040@s.whatsapp.net', DisplayName: 'Dora lid' },
        { JID: '5562950505050@s.whatsapp.net', DisplayName: 'Eva' },
        { JID: PROPRIO, DisplayName: 'Eu' },
      ],
    }, PROPRIO);

    assert.deepEqual(lista.map((item) => item.nome), ['Dora', 'Eva']);
  });

  it('normaliza o telefone para dígitos com DDI e o nono dígito', () => {
    assert.equal(normalizarTelefoneAgenda('+55 (62) 99999-8888'), TELEFONE);
    assert.equal(normalizarTelefoneAgenda('6299998888'), TELEFONE);
    assert.equal(normalizarTelefoneAgenda(SEM_NONO), TELEFONE);
    assert.equal(mascararTelefoneLista(TELEFONE), '(62) 9****-8888');
  });

  it('marca já autorizado com e sem o nono dígito', () => {
    const contatos = [
      { nome: 'Com nove', telefone: TELEFONE },
      { nome: 'Sem nove na base', telefone: '5562988887777' },
      { nome: 'Livre', telefone: '5562966665555' },
    ];
    const marcados = marcarJaAutorizados(contatos, [SEM_NONO, '556288887777']);
    assert.equal(marcados[0].jaAutorizado, true);
    assert.equal(marcados[1].jaAutorizado, true);
    assert.equal(marcados[2].jaAutorizado, false);
  });

  it('o lote pula quem já existe, inclusive a forma com e sem o nono dígito', async () => {
    const gravados = [TELEFONE];
    const logs: string[] = [];
    const primeiro = await executarLote({
      role: 'admin',
      contractId: 'contrato-1',
      body: {
        pessoas: [
          { nome: 'Ana', telefone: SEM_NONO, podeEnviarPlanilha: true, podePedirRelatorio: false },
          { nome: 'Bia', telefone: '62988887777', podeEnviarPlanilha: false, podePedirRelatorio: true },
          { nome: 'Bia de novo', telefone: '5562988887777', podeEnviarPlanilha: true, podePedirRelatorio: true },
        ],
      },
      lerExistentes: async () => gravados,
      salvar: async (pessoa) => {
        gravados.push(pessoa.telefone);
        return { id: `id-${gravados.length}` };
      },
      log: (linha) => logs.push(linha),
    });

    assert.equal(primeiro.status, 201);
    assert.ok(!('error' in primeiro.body));
    if (!('criados' in primeiro.body)) return;
    assert.equal(primeiro.body.criados.length, 1);
    assert.equal(primeiro.body.criados[0].nome, 'Bia');
    assert.equal(primeiro.body.criados[0].podePedirRelatorio, true);
    assert.equal(primeiro.body.ignorados.length, 2);
    assert.equal(primeiro.body.ignorados[0].motivo, 'já autorizado');
    assert.equal(logs.join('\n').includes(TELEFONE), false);

    const segundo = await executarLote({
      role: 'superadmin',
      contractId: 'contrato-1',
      body: [{ nome: 'Bia', telefone: '5562988887777', podeEnviarPlanilha: false, podePedirRelatorio: false }],
      lerExistentes: async () => gravados,
      salvar: async () => { throw new Error('não deveria gravar'); },
    });
    assert.equal(segundo.status, 201);
    if (!('ignorados' in segundo.body)) return;
    assert.equal(segundo.body.criados.length, 0);
    assert.equal(segundo.body.ignorados[0].motivo, 'já autorizado');
  });

  it('devolve 409 quando a sessão não está conectada', async () => {
    let chamadas = 0;
    const resultado = await listarContatosAgenda({
      role: 'admin',
      contractId: 'contrato-1',
      sessao: { logado: false, jidProprio: '' },
      buscarContatos: async () => { chamadas += 1; return {}; },
      telefonesAutorizados: [],
    });
    assert.equal(resultado.status, 409);
    assert.deepEqual(resultado.body, { error: MENSAGEM_SESSAO_DESCONECTADA });
    assert.equal(chamadas, 0);

    const grupo = await listarParticipantesAgenda({
      role: 'superadmin',
      contractId: 'contrato-1',
      jid: '120363111@g.us',
      gruposDoContrato: ['120363111@g.us'],
      sessao: { logado: false, jidProprio: '' },
      buscarGrupo: async () => { chamadas += 1; return {}; },
      telefonesAutorizados: [],
    });
    assert.equal(grupo.status, 409);
    assert.equal(chamadas, 0);
  });

  it('recusa quem não é gestor nem admin', async () => {
    const lista = await listarContatosAgenda({
      role: 'user',
      contractId: 'contrato-1',
      sessao: { logado: true, jidProprio: '' },
      buscarContatos: async () => { throw new Error('não deveria buscar'); },
      telefonesAutorizados: [],
    });
    assert.equal(lista.status, 403);

    const lote = await executarLote({
      role: 'user',
      contractId: 'contrato-1',
      body: [{ nome: 'Ana', telefone: TELEFONE }],
      lerExistentes: async () => [],
      salvar: async () => { throw new Error('não deveria gravar'); },
    });
    assert.equal(lote.status, 403);

    const app = express();
    app.get('/api/wuzapi/contatos', (req, _res, next) => {
      req.usuario = {
        id: '1', email: 'u@exemplo', nome: 'Usuário', role: 'user', contractId: 'contrato-1',
      };
      next();
    }, authorize('admin'), (_req, res) => { res.json({ ok: true }); });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const porta = (server.address() as { port: number }).port;
    try {
      const resposta = await fetch(`http://127.0.0.1:${porta}/api/wuzapi/contatos`);
      assert.equal(resposta.status, 403);
    } finally {
      server.close();
    }
  });

  it('não escreve telefone completo nem token no log', async () => {
    const logs: string[] = [];
    const falha = await listarContatosAgenda({
      role: 'admin',
      contractId: 'contrato-1',
      sessao: { logado: true, jidProprio: PROPRIO },
      buscarContatos: async () => {
        throw new Error(`falha ${TELEFONE} token ${TOKEN_INSTANCIA}`);
      },
      telefonesAutorizados: [],
      log: (linha) => logs.push(linha),
    });
    assert.equal(falha.status, 500);
    const textoFalha = logs.join('\n');
    assert.equal(textoFalha.includes(TELEFONE), false);
    assert.equal(textoFalha.includes(TOKEN_INSTANCIA), false);
    assert.equal(redigirTelefones(`numero ${TELEFONE}`).includes(TELEFONE), false);

    logs.length = 0;
    const ok = await listarContatosAgenda({
      role: 'admin',
      contractId: 'contrato-1',
      sessao: { logado: true, jidProprio: PROPRIO },
      buscarContatos: async () => ({
        [`${TELEFONE}@s.whatsapp.net`]: { FullName: 'Ana' },
      }),
      telefonesAutorizados: [],
      log: (linha) => logs.push(linha),
    });
    assert.equal(ok.status, 200);
    assert.equal(logs.join('\n'), linhaLogContatos(1));
    assert.equal(logs.join('\n').includes(TELEFONE), false);
  });

  it('guarda a lista de contatos por 5 minutos', async () => {
    let chamadas = 0;
    const agora = 1_000_000;
    const buscarContatos = async () => {
      chamadas += 1;
      return { '5562966665555@s.whatsapp.net': { FullName: 'Lia' } };
    };
    const base = {
      role: 'admin' as const,
      contractId: 'contrato-1',
      sessao: { logado: true, jidProprio: PROPRIO },
      buscarContatos,
      telefonesAutorizados: [] as string[],
      agora,
    };
    await listarContatosAgenda(base);
    await listarContatosAgenda({ ...base, agora: agora + 1000, telefonesAutorizados: [TELEFONE] });
    assert.equal(chamadas, 1);
    await listarContatosAgenda({ ...base, agora: agora + CACHE_CONTATOS_MS });
    assert.equal(chamadas, 2);
  });

  it('só aceita participantes de grupo cadastrado no contrato', async () => {
    const fora = await listarParticipantesAgenda({
      role: 'admin',
      contractId: 'contrato-1',
      jid: '120363999@g.us',
      gruposDoContrato: ['120363111@g.us'],
      sessao: { logado: true, jidProprio: PROPRIO },
      buscarGrupo: async () => { throw new Error('não deveria buscar'); },
      telefonesAutorizados: [],
    });
    assert.equal(fora.status, 404);

    const dentro = await listarParticipantesAgenda({
      role: 'admin',
      contractIdUsuario: 'contrato-1',
      contractId: 'contrato-1',
      jid: '120363111@g.us',
      gruposDoContrato: ['120363111@g.us'],
      sessao: { logado: true, jidProprio: PROPRIO },
      buscarGrupo: async () => ({
        Participants: [{ JID: '5562966665555@s.whatsapp.net', DisplayName: 'Lia' }],
      }),
      telefonesAutorizados: ['556266665555'],
    });
    assert.equal(dentro.status, 200);
    if (!Array.isArray(dentro.body)) return;
    assert.equal(dentro.body[0].jaAutorizado, true);
  });
});

describe('download da agenda usa o token da instância própria', () => {
  const anteriores = {
    url: process.env.WUZAPI_URL,
    token: process.env.WUZAPI_TOKEN,
  };
  let server: http.Server;
  const pedidos: Array<{ method: string; url: string; token: string }> = [];
  const saida: string[] = [];
  const consoles = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };

  beforeEach(async () => {
    pedidos.length = 0;
    saida.length = 0;
    const guardar = (...args: unknown[]) => {
      saida.push(args.map((item) => String(item)).join(' '));
    };
    console.log = guardar as typeof console.log;
    console.info = guardar as typeof console.info;
    console.warn = guardar as typeof console.warn;
    console.error = guardar as typeof console.error;

    server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      pedidos.push({
        method: req.method || '',
        url: `${url.pathname}${url.search}`,
        token: String(req.headers.token || ''),
      });
      res.setHeader('content-type', 'application/json');
      if (url.pathname === '/session/status') {
        res.end(JSON.stringify({
          success: true,
          data: { loggedIn: true, connected: true, jid: PROPRIO },
        }));
        return;
      }
      if (url.pathname === '/user/contacts') {
        res.end(JSON.stringify({
          success: true,
          data: {
            '120363111@g.us': { FullName: 'Grupo' },
            '999001@lid': { PushName: 'Só LID' },
            [`${TELEFONE}@s.whatsapp.net`]: { FullName: 'Ana', PushName: 'Ana zap' },
          },
        }));
        return;
      }
      if (url.pathname === '/group/info') {
        res.end(JSON.stringify({
          success: true,
          data: {
            Participants: [
              { JID: `${TELEFONE}@s.whatsapp.net`, DisplayName: 'Ana' },
              { JID: '888@lid', DisplayName: 'Sem fone' },
            ],
          },
        }));
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const porta = (server.address() as { port: number }).port;
    process.env.WUZAPI_URL = `http://127.0.0.1:${porta}`;
    process.env.WUZAPI_TOKEN = TOKEN_AMBIENTE;
  });

  afterEach(async () => {
    console.log = consoles.log;
    console.info = consoles.info;
    console.warn = consoles.warn;
    console.error = consoles.error;
    if (anteriores.url === undefined) delete process.env.WUZAPI_URL;
    else process.env.WUZAPI_URL = anteriores.url;
    if (anteriores.token === undefined) delete process.env.WUZAPI_TOKEN;
    else process.env.WUZAPI_TOKEN = anteriores.token;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('chama GET /user/contacts e GET /group/info com o token da instância, sem logar telefone', async () => {
    const servico = new WuzapiService({
      repositorio: {
        async obterAtiva() {
          return {
            id: 'inst-1',
            nomeInstancia: 'Sistemma',
            token: TOKEN_INSTANCIA,
            criadoEm: new Date(),
            ativo: true,
          };
        },
        async substituirAtiva() {
          throw new Error('não deveria trocar a instância');
        },
      },
    });

    const sessao = await servico.sessaoDaInstancia();
    const contatos = filtrarAgendaWuzapi(await servico.baixarContatos(), sessao.jidProprio);
    await servico.baixarInfoGrupo('120363111@g.us');

    assert.equal(sessao.logado, true);
    assert.deepEqual(contatos.map((item) => item.nome), ['Ana']);
    assert.equal(pedidos.some((p) => p.method === 'GET' && p.url === '/user/contacts'), true);
    assert.equal(pedidos.some((p) => p.method === 'GET' && p.url.startsWith('/group/info?') && p.url.includes('groupJID=120363111%40g.us')), true);
    assert.equal(pedidos.every((p) => p.token === TOKEN_INSTANCIA), true);
    assert.equal(pedidos.some((p) => p.token === TOKEN_AMBIENTE), false);
    const texto = saida.join('\n');
    assert.equal(texto.includes(TELEFONE), false);
    assert.equal(texto.includes(TOKEN_INSTANCIA), false);
    assert.equal(texto.includes(TOKEN_AMBIENTE), false);
  });
});
