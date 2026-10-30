import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WuzapiService } from './WuzapiService';

const ADMIN = 'admin-teste-nao-logar';
const TOKEN_PNEU = 'pneu-token-compartilhado-nao-reusar';
const TOKEN_SEG = 'segtrack-token-compartilhado-nao-reusar';
const TOKEN_MED = 'medzup-token-compartilhado-nao-reusar';
const TOKEN_PROPRIO = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TOKEN_ALHEIO = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const WEBHOOK_SISTEMMA = 'https://sistemma.example/api/wuzapi/webhook';
const JID_PNEU = '5511999887766@s.whatsapp.net';

interface UsuarioFalso {
  id: number;
  name: string;
  token: string;
  webhook: string;
  connected: boolean;
  loggedIn: boolean;
  jid: string;
}

interface Registro {
  id: string;
  nomeInstancia: string;
  token: string;
  criadoEm: Date;
  ativo: boolean;
}

function usuariosIniciais(): UsuarioFalso[] {
  return [
    {
      id: 1,
      name: 'PneuSistemma',
      token: TOKEN_PNEU,
      webhook: 'https://pneusistemma.example/api/wuzapi/webhook',
      connected: true,
      loggedIn: true,
      jid: JID_PNEU,
    },
    {
      id: 2,
      name: 'SEGTRACK',
      token: TOKEN_SEG,
      webhook: 'https://segtrack.example/hook',
      connected: true,
      loggedIn: true,
      jid: JID_PNEU,
    },
    {
      id: 3,
      name: 'medzup',
      token: TOKEN_MED,
      webhook: 'https://medzup.example/hook',
      connected: false,
      loggedIn: false,
      jid: '',
    },
  ];
}

function criarRepositorioMemoria() {
  const linhas: Registro[] = [];
  return {
    linhas,
    async obterAtiva(): Promise<Registro | null> {
      return linhas.find((l) => l.ativo) ?? null;
    },
    async substituirAtiva(nomeInstancia: string, token: string) {
      const anterior = linhas.find((l) => l.ativo) ?? null;
      for (const linha of linhas) {
        if (linha.ativo) linha.ativo = false;
      }
      const nova: Registro = {
        id: `id-${linhas.length + 1}`,
        nomeInstancia,
        token,
        criadoEm: new Date(),
        ativo: true,
      };
      linhas.push(nova);
      return { nova, anterior };
    },
  };
}

function criarWuzapiFalsa(inicial: UsuarioFalso[]) {
  const usuarios = inicial.map((u) => ({ ...u }));
  const requisicoes: Array<{ method: string; url: string; token: string; body: unknown }> = [];
  let seq = usuarios.reduce((max, u) => Math.max(max, u.id), 0);

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let body: unknown = {};
      const cru = Buffer.concat(chunks).toString('utf8');
      if (cru) {
        try { body = JSON.parse(cru); } catch { body = {}; }
      }
      const url = req.url || '';
      const token = String(req.headers.token || '');
      requisicoes.push({ method: req.method || '', url, token, body });
      const json = (code: number, data: unknown) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      const authorization = String(req.headers.authorization || '');
      const adminOk = authorization === ADMIN;

      if (url === '/admin/users' && req.method === 'GET') {
        if (!adminOk) return json(401, { error: 'unauthorized' });
        return json(200, {
          success: true,
          data: usuarios.map((u) => ({ id: u.id, name: u.name, token: u.token, webhook: u.webhook })),
        });
      }
      if (url === '/admin/users' && req.method === 'POST') {
        if (!adminOk) return json(401, { error: 'unauthorized' });
        const pedido = body as { name?: string; token?: string; webhook?: string };
        if (usuarios.some((u) => u.token === pedido.token)) {
          return json(409, { error: 'token exists' });
        }
        const novo: UsuarioFalso = {
          id: ++seq,
          name: String(pedido.name || ''),
          token: String(pedido.token || ''),
          webhook: String(pedido.webhook || ''),
          connected: false,
          loggedIn: false,
          jid: '',
        };
        usuarios.push(novo);
        return json(201, { success: true, data: { id: novo.id, name: novo.name } });
      }
      if (req.method === 'DELETE' && url.startsWith('/admin/users/')) {
        if (!adminOk) return json(401, { error: 'unauthorized' });
        const id = Number(url.split('/').pop());
        const idx = usuarios.findIndex((u) => u.id === id);
        if (idx < 0) return json(404, { error: 'not found' });
        const [removido] = usuarios.splice(idx, 1);
        return json(200, { success: true, data: { id: removido.id, name: removido.name } });
      }

      const user = usuarios.find((u) => u.token === token);
      if (!user) return json(401, { error: 'unauthorized' });

      if (url === '/session/status' && req.method === 'GET') {
        return json(200, {
          success: true,
          data: {
            connected: user.connected,
            loggedIn: user.loggedIn,
            jid: user.jid,
            webhook: user.webhook,
          },
        });
      }
      if (url === '/session/connect' && req.method === 'POST') {
        user.connected = true;
        return json(200, { success: true, data: { jid: user.jid } });
      }
      if (url === '/session/qr' && req.method === 'GET') {
        return json(200, { success: true, data: { QRCode: 'qr-falso' } });
      }
      if (url === '/webhook' && req.method === 'GET') {
        return json(200, { success: true, data: { webhook: user.webhook } });
      }
      if (url === '/webhook' && req.method === 'POST') {
        const pedido = body as { webhookurl?: string };
        user.webhook = String(pedido.webhookurl || '');
        return json(200, { success: true });
      }
      if (url === '/session/logout' && req.method === 'POST') {
        user.loggedIn = false;
        user.connected = false;
        user.jid = '';
        return json(200, { success: true });
      }
      if (url === '/session/disconnect' && req.method === 'POST') {
        user.connected = false;
        return json(200, { success: true });
      }
      return json(404, { error: 'not found' });
    });
  });

  return { server, usuarios, requisicoes };
}

const wuz = criarWuzapiFalsa(usuariosIniciais());
let baseUrl = '';
const logs: string[] = [];
const origLog = console.log;
const origWarn = console.warn;
const origErr = console.error;

function espelhar(nivel: string, args: unknown[]) {
  logs.push(`${nivel} ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`);
}

before(async () => {
  await new Promise<void>((resolve) => {
    wuz.server.listen(0, '127.0.0.1', () => resolve());
  });
  const endereco = wuz.server.address();
  const porta = typeof endereco === 'object' && endereco ? endereco.port : 0;
  baseUrl = `http://127.0.0.1:${porta}`;
  console.log = (...args: unknown[]) => { espelhar('log', args); };
  console.warn = (...args: unknown[]) => { espelhar('warn', args); };
  console.error = (...args: unknown[]) => { espelhar('err', args); };
});

after(async () => {
  console.log = origLog;
  console.warn = origWarn;
  console.error = origErr;
  await new Promise<void>((resolve, reject) => {
    wuz.server.close((err) => (err ? reject(err) : resolve()));
  });
});

function ambiente() {
  process.env.WUZAPI_URL = baseUrl;
  process.env.WUZAPI_TOKEN = TOKEN_PNEU;
  process.env.WUZAPI_ADMIN_TOKEN = ADMIN;
  process.env.WUZAPI_WEBHOOK_URL = WEBHOOK_SISTEMMA;
  process.env.WUZAPI_INSTANCE_NAME = 'Sistemma';
  delete process.env.WUZAPI_WEBHOOK_FORCAR;
}

function novoServico(repo: ReturnType<typeof criarRepositorioMemoria>) {
  ambiente();
  return new WuzapiService({ repositorio: repo } as ConstructorParameters<typeof WuzapiService>[0]);
}

function criacoes() {
  return wuz.requisicoes.filter((r) => r.method === 'POST' && r.url === '/admin/users');
}

function assertSemTokens(texto: string, extras: string[] = []) {
  const proibidos = [TOKEN_PNEU, TOKEN_SEG, TOKEN_MED, TOKEN_PROPRIO, TOKEN_ALHEIO, ADMIN, ...extras];
  for (const segredo of proibidos) {
    if (segredo.length >= 8) assert.equal(texto.includes(segredo), false, 'token vazou');
  }
  assert.equal(/"token"\s*:/.test(texto), false);
}

describe('instância própria do Sistemma na WuzAPI', { concurrency: 1 }, () => {
  beforeEach(() => {
    wuz.usuarios.splice(0, wuz.usuarios.length, ...usuariosIniciais());
    wuz.requisicoes.length = 0;
    logs.length = 0;
    ambiente();
  });

  it('sem instância própria cria token novo com o nome Sistemma e não usa token da lista', async () => {
    const repo = criarRepositorioMemoria();
    const svc = novoServico(repo);
    const resultado = await svc.conectarSessao();
    const posts = criacoes();
    assert.equal(posts.length, 1);
    const pedido = posts[0].body as { name?: string; token?: string; webhook?: string };
    const tokenNovo = String(pedido.token || '');
    assert.match(tokenNovo, /^[0-9a-f]{48}$/);
    assert.equal(pedido.name, 'Sistemma');
    assert.equal(pedido.webhook, WEBHOOK_SISTEMMA);
    const existentes = new Set([TOKEN_PNEU, TOKEN_SEG, TOKEN_MED]);
    assert.equal(existentes.has(tokenNovo), false);
    const sessao = wuz.requisicoes.filter((r) => r.url.startsWith('/session') || r.url === '/webhook');
    assert.ok(sessao.length > 0);
    assert.ok(sessao.every((r) => r.token === tokenNovo));
    assert.equal(wuz.usuarios.find((u) => u.token === TOKEN_PNEU)?.webhook, 'https://pneusistemma.example/api/wuzapi/webhook');
    assert.equal(repo.linhas.filter((l) => l.ativo).length, 1);
    assert.equal(repo.linhas.find((l) => l.ativo)?.nomeInstancia, 'Sistemma');
    assert.equal(repo.linhas.find((l) => l.ativo)?.token, tokenNovo);
    const texto = `${JSON.stringify(resultado)}\n${logs.join('\n')}`;
    assertSemTokens(texto, [tokenNovo]);
    assert.equal((resultado as { nomeInstancia?: string }).nomeInstancia, 'Sistemma');
  });

  it('se já existe Sistemma com outro token, cria Sistemma-xxxxxx e não adota esse token', async () => {
    wuz.usuarios.push({
      id: 4,
      name: 'Sistemma',
      token: TOKEN_ALHEIO,
      webhook: 'https://outro-sistemma.example/hook',
      connected: true,
      loggedIn: true,
      jid: JID_PNEU,
    });
    const repo = criarRepositorioMemoria();
    const svc = novoServico(repo);
    const resultado = await svc.conectarSessao();
    const posts = criacoes();
    assert.equal(posts.length, 1);
    const pedido = posts[0].body as { name?: string; token?: string };
    const tokenNovo = String(pedido.token || '');
    assert.match(tokenNovo, /^[0-9a-f]{48}$/);
    assert.equal(pedido.name, `Sistemma-${tokenNovo.slice(0, 6)}`);
    assert.notEqual(tokenNovo, TOKEN_ALHEIO);
    assert.equal(wuz.requisicoes.some((r) => r.token === TOKEN_ALHEIO), false);
    assert.equal(wuz.usuarios.find((u) => u.token === TOKEN_ALHEIO)?.webhook, 'https://outro-sistemma.example/hook');
    assert.equal(wuz.usuarios.find((u) => u.token === TOKEN_ALHEIO)?.loggedIn, true);
    assert.equal(repo.linhas.find((l) => l.ativo)?.nomeInstancia, pedido.name);
    const texto = `${JSON.stringify(resultado)}\n${logs.join('\n')}`;
    assertSemTokens(texto, [tokenNovo]);
  });

  it('não adota PneuSistemma mesmo logado no mesmo número', async () => {
    const repo = criarRepositorioMemoria();
    const svc = novoServico(repo);
    await svc.conectarSessao();
    const pneu = wuz.usuarios.find((u) => u.name === 'PneuSistemma');
    assert.ok(pneu);
    assert.equal(pneu.loggedIn, true);
    assert.equal(pneu.connected, true);
    assert.equal(pneu.jid, JID_PNEU);
    assert.equal(pneu.webhook, 'https://pneusistemma.example/api/wuzapi/webhook');
    assert.equal(wuz.requisicoes.some((r) => r.token === TOKEN_PNEU), false);
    assert.equal(wuz.requisicoes.some((r) => r.method === 'DELETE'), false);
    assert.equal(wuz.requisicoes.some((r) => r.url === '/session/logout'), false);
    const criado = wuz.usuarios.find((u) => u.name === 'Sistemma');
    assert.ok(criado);
    assert.equal(criado.name, 'Sistemma');
    assert.notEqual(criado.token, TOKEN_PNEU);
    assert.notEqual(criado.token, TOKEN_SEG);
    assert.notEqual(criado.jid, JID_PNEU);
  });

  it('instância própria deslogada gera o QR nela e não cria outra', async () => {
    wuz.usuarios.push({
      id: 9,
      name: 'Sistemma-aaaaaa',
      token: TOKEN_PROPRIO,
      webhook: WEBHOOK_SISTEMMA,
      connected: false,
      loggedIn: false,
      jid: '',
    });
    const repo = criarRepositorioMemoria();
    repo.linhas.push({
      id: 'propria',
      nomeInstancia: 'Sistemma-aaaaaa',
      token: TOKEN_PROPRIO,
      criadoEm: new Date(),
      ativo: true,
    });
    const antes = wuz.usuarios.length;
    const svc = novoServico(repo);
    await svc.conectarSessao();
    const qr = await svc.getQRCode();
    assert.equal(qr.qrCode, 'qr-falso');
    assert.equal(criacoes().length, 0);
    assert.equal(wuz.usuarios.length, antes);
    const qrReq = wuz.requisicoes.filter((r) => r.url === '/session/qr');
    assert.equal(qrReq.length, 1);
    assert.equal(qrReq[0].token, TOKEN_PROPRIO);
    const connects = wuz.requisicoes.filter((r) => r.url === '/session/connect');
    assert.ok(connects.length >= 1);
    assert.ok(connects.every((r) => r.token === TOKEN_PROPRIO));
    assert.equal(wuz.requisicoes.some((r) => r.token === TOKEN_PNEU), false);
    assert.equal(wuz.usuarios.filter((u) => u.name === 'PneuSistemma').length, 1);
    const texto = `${JSON.stringify(qr)}\n${logs.join('\n')}`;
    assertSemTokens(texto);
  });

  it('gerar nova conexão recusa sem confirmação e, com ela, só remove a instância do Sistemma', async () => {
    wuz.usuarios.push({
      id: 9,
      name: 'Sistemma-aaaaaa',
      token: TOKEN_PROPRIO,
      webhook: WEBHOOK_SISTEMMA,
      connected: true,
      loggedIn: true,
      jid: '5511888777666@s.whatsapp.net',
    });
    const repo = criarRepositorioMemoria();
    repo.linhas.push({
      id: 'propria',
      nomeInstancia: 'Sistemma-aaaaaa',
      token: TOKEN_PROPRIO,
      criadoEm: new Date(),
      ativo: true,
    });
    const svc = novoServico(repo) as WuzapiService & {
      gerarNovaConexao?: (corpo: { confirmacao?: string }) => Promise<unknown>;
    };
    assert.equal(typeof svc.gerarNovaConexao, 'function');
    await assert.rejects(() => svc.gerarNovaConexao!({}), /NOVA CONEXAO/);
    await assert.rejects(() => svc.gerarNovaConexao!({ confirmacao: 'sim' }), /NOVA CONEXAO/);
    assert.equal(criacoes().length, 0);
    assert.equal(wuz.requisicoes.some((r) => r.method === 'DELETE'), false);
    assert.equal(wuz.usuarios.some((u) => u.token === TOKEN_PROPRIO), true);

    const resultado = await svc.gerarNovaConexao!({ confirmacao: 'NOVA CONEXAO' });
    const posts = criacoes();
    assert.equal(posts.length, 1);
    const pedido = posts[0].body as { name?: string; token?: string };
    const tokenNovo = String(pedido.token || '');
    assert.match(tokenNovo, /^[0-9a-f]{48}$/);
    assert.notEqual(tokenNovo, TOKEN_PROPRIO);
    assert.equal(pedido.name, 'Sistemma');
    assert.equal(wuz.usuarios.some((u) => u.token === TOKEN_PROPRIO), false);
    assert.equal(wuz.usuarios.some((u) => u.token === TOKEN_PNEU), true);
    assert.equal(wuz.usuarios.some((u) => u.token === TOKEN_SEG), true);
    assert.equal(wuz.usuarios.some((u) => u.token === TOKEN_MED), true);
    const removidos = wuz.requisicoes.filter((r) => r.method === 'DELETE');
    assert.equal(removidos.length, 1);
    assert.equal(removidos[0].url, '/admin/users/9');
    assert.equal(repo.linhas.find((l) => l.token === TOKEN_PROPRIO)?.ativo, false);
    assert.equal(repo.linhas.find((l) => l.ativo)?.token, tokenNovo);
    const texto = `${JSON.stringify(resultado)}\n${logs.join('\n')}`;
    assertSemTokens(texto, [tokenNovo]);
  });

  it('não sobrescreve webhook que aponta para outro host', async () => {
    wuz.usuarios.push({
      id: 9,
      name: 'Sistemma-aaaaaa',
      token: TOKEN_PROPRIO,
      webhook: 'https://outro-sistema.example/hook',
      connected: true,
      loggedIn: true,
      jid: '5511777666555@s.whatsapp.net',
    });
    const repo = criarRepositorioMemoria();
    repo.linhas.push({
      id: 'propria',
      nomeInstancia: 'Sistemma-aaaaaa',
      token: TOKEN_PROPRIO,
      criadoEm: new Date(),
      ativo: true,
    });
    const svc = novoServico(repo);
    const resultado = await svc.conectarSessao() as { alertaWebhook?: string };
    assert.equal(wuz.requisicoes.some((r) => r.method === 'POST' && r.url === '/webhook'), false);
    assert.match(String(resultado.alertaWebhook || ''), /outro-sistema\.example/);
    assert.equal(
      wuz.usuarios.find((u) => u.token === TOKEN_PROPRIO)?.webhook,
      'https://outro-sistema.example/hook',
    );
    const texto = `${JSON.stringify(resultado)}\n${logs.join('\n')}`;
    assertSemTokens(texto);
  });
});
