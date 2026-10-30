import axios, { AxiosError, AxiosHeaders, AxiosInstance } from 'axios';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import { urlSemSegredoWebhook } from './wuzapiWebhookAuth';
import { telefoneDeRespostaLid } from './whatsappConversaPrivada';
import {
  repositorioWhatsappInstanciaControl,
  type WhatsappInstanciaRepositorio,
} from './whatsappInstanciaRepositorio';

export interface WuzapiSessionStatus {
  connected?: boolean;
  loggedIn?: boolean;
  jid?: string;
  webhook?: string;
  events?: string;
  Connected?: boolean;
  LoggedIn?: boolean;
  JID?: string;
}

export interface WuzapiSendResult {
  Details?: string;
  Id?: string;
  Timestamp?: number | string;
}

export interface ResultadoConexao {
  connected: boolean;
  jid: string;
  message: string;
  logado: boolean;
  nomeInstancia: string | null;
  numeroMascarado: string;
  statusConexao: 'conectado' | 'deslogado';
  alertaWebhook: string | null;
}

export interface ResumoInstanciaTela {
  nomeInstancia: string | null;
  instanciaPropria: boolean;
  statusConexao: 'conectado' | 'deslogado';
  numeroMascarado: string;
  alertaWebhook: string | null;
  connected: boolean;
  loggedIn: boolean;
  erroSessao: string | null;
  offline: boolean;
}

interface UsuarioAdmin {
  id?: string | number;
  ID?: string | number;
  name?: string;
  token?: string;
}

const EVENTOS = ['Message', 'Connected', 'QR'] as const;

/**
 * Nome padrão de todos os projetos. Sufixo só quando "Sistemma" já é de outro token.
 * A comparação é exata: "PneuSistemma" não conta.
 */
export function escolherNomeInstancia(
  tokenNovo: string,
  tokenNosso: string | null,
  usuarios: Array<{ name?: string; token?: string }>,
): string {
  const nosso = String(tokenNosso || '');
  const ocupadoPorOutro = usuarios.some((usuario) => {
    if (String(usuario.name || '') !== 'Sistemma') return false;
    return String(usuario.token || '') !== nosso;
  });
  if (ocupadoPorOutro) return `Sistemma-${tokenNovo.slice(0, 6)}`;
  return 'Sistemma';
}

export function gerarTokenInstancia(): string {
  return randomBytes(24).toString('hex');
}

export function mascararNumeroWhatsapp(jid: string): string {
  const num = String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
  if (num.length < 8) return '';
  return `${num.slice(0, 4)}${'*'.repeat(num.length - 8)}${num.slice(-4)}`;
}

export function hostDeUrl(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return '';
  }
}

export function webhookApontaParaOutroHost(atual: string, desejado: string): boolean {
  const texto = String(atual || '').trim();
  if (!texto) return false;
  return hostDeUrl(texto) !== hostDeUrl(desejado);
}

/** Tira tokens hex longos de mensagem de erro, log ou resposta. */
export function redigirSegredos(texto: string): string {
  return String(texto || '')
    .replace(/\b[0-9a-f]{32,}\b/gi, '[redigido]')
    .replace(/token["']?\s*[:=]\s*["'][^"']+["']/gi, 'token=[redigido]');
}

/**
 * Cliente HTTP da WuzAPI.
 * A sessão usa somente o token gravado em whatsapp_instancia.
 * A lista de /admin/users serve só para escolher o nome e para apagar a instância anterior nossa.
 */
export class WuzapiService {
  private readonly client: AxiosInstance;
  private readonly baseUrl: string;
  private readonly repositorio: WhatsappInstanciaRepositorio;
  private readonly tokenAls = new AsyncLocalStorage<string>();
  private possuiInstanciaPropria = false;
  private ultimoAlertaWebhook: string | null = null;

  constructor(deps?: { repositorio?: WhatsappInstanciaRepositorio }) {
    this.baseUrl = (process.env.WUZAPI_URL || 'http://localhost:8080').replace(/\/$/, '');
    this.repositorio = deps?.repositorio ?? repositorioWhatsappInstanciaControl();
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: parseInt(process.env.WUZAPI_TIMEOUT_MS || '120000', 10),
      headers: { 'Content-Type': 'application/json' },
    });
    this.client.interceptors.request.use(async (config) => {
      const headers = AxiosHeaders.from(config.headers || {});
      const url = String(config.url || '');
      if (url.includes('/admin/')) {
        headers.delete('token');
        config.headers = headers;
        return config;
      }
      const jaDefinido = headers.get('token');
      const token = this.tokenAls.getStore()
        || (typeof jaDefinido === 'string' ? jaDefinido : '')
        || await this.resolverToken();
      if (token) headers.set('token', token);
      else headers.delete('token');
      config.headers = headers;
      return config;
    });
  }

  get isConfigured(): boolean {
    return !!(process.env.WUZAPI_URL?.trim() && (
      this.possuiInstanciaPropria
      || process.env.WUZAPI_TOKEN?.trim()
      || process.env.WUZAPI_ADMIN_TOKEN?.trim()
    ));
  }

  get webhookSecret(): string {
    return process.env.WUZAPI_WEBHOOK_SECRET || '';
  }

  /** URL pública que a WuzAPI deve chamar. Só o que vier em WUZAPI_WEBHOOK_URL. */
  get webhookUrl(): string {
    return resolverWebhookWuzapi(
      this.baseUrl,
      process.env.WUZAPI_WEBHOOK_URL || process.env.WEBHOOK_URL || '',
    );
  }

  async temInstanciaPropria(): Promise<boolean> {
    const ativa = await this.repositorio.obterAtiva();
    this.possuiInstanciaPropria = !!ativa?.token;
    return this.possuiInstanciaPropria;
  }

  private async resolverToken(): Promise<string> {
    const ativa = await this.repositorio.obterAtiva();
    if (ativa?.token) {
      this.possuiInstanciaPropria = true;
      return ativa.token;
    }
    return '';
  }

  private comToken<T>(token: string, fn: () => Promise<T>): Promise<T> {
    return this.tokenAls.run(token, fn);
  }

  private unwrap<T>(data: any): T {
    if (data && typeof data === 'object' && 'data' in data && data.success !== undefined) {
      return data.data as T;
    }
    return data as T;
  }

  private erroMsg(prefixo: string, error: unknown): Error {
    if (error instanceof AxiosError) {
      const data = error.response?.data as
        | { error?: string; message?: string; code?: number }
        | string
        | undefined;
      const detalheApi =
        typeof data === 'string'
          ? data
          : (data?.error || data?.message || '');
      const status = error.response?.status;
      const code = error.code;
      const partes = [
        detalheApi,
        status ? `HTTP ${status}` : '',
        code && !error.response ? code : '',
        !detalheApi && error.message ? error.message : '',
      ].filter(Boolean);
      let detalhe = partes.join(' · ') || 'erro desconhecido';

      if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EHOSTUNREACH') {
        detalhe = `WuzAPI inacessível em ${this.baseUrl} (${code}). Verifique se a WuzAPI está rodando e se WUZAPI_URL está correto.`;
      } else if (status === 401 || /unauthorized/i.test(detalhe)) {
        detalhe = `Admin não autorizado. WUZAPI_ADMIN_TOKEN do Sistemma deve ser igual ao da WuzAPI (hoje: ${this.baseUrl}).`;
      }

      return new Error(redigirSegredos(`${prefixo}: ${detalhe}`));
    }
    if (error instanceof Error) return new Error(redigirSegredos(`${prefixo}: ${error.message}`));
    return new Error(prefixo);
  }

  private classificarFalhaToken(error: unknown): 'ausente' | 'indisponivel' {
    if (error instanceof AxiosError) {
      const code = error.code;
      if (
        code === 'ECONNREFUSED'
        || code === 'ENOTFOUND'
        || code === 'EHOSTUNREACH'
        || code === 'ETIMEDOUT'
        || code === 'ECONNABORTED'
      ) {
        return 'indisponivel';
      }
      const status = error.response?.status;
      if (status === 401 || status === 403 || status === 404) return 'ausente';
      if (!error.response) return 'indisponivel';
      return 'ausente';
    }
    return 'indisponivel';
  }

  private async tokenResponde(token: string): Promise<'ok' | 'ausente' | 'indisponivel'> {
    try {
      await this.comToken(token, () => this.client.get('/session/status'));
      return 'ok';
    } catch (error) {
      return this.classificarFalhaToken(error);
    }
  }

  async getStatus(): Promise<WuzapiSessionStatus & { connected: boolean; loggedIn: boolean }> {
    const { data } = await this.client.get('/session/status');
    const raw = this.unwrap<WuzapiSessionStatus>(data) || {};
    return {
      ...raw,
      connected: !!(raw.connected ?? raw.Connected),
      loggedIn: !!(raw.loggedIn ?? raw.LoggedIn),
      jid: raw.jid || raw.JID || '',
    };
  }

  async consultarParaTela(): Promise<ResumoInstanciaTela> {
    const ativa = await this.repositorio.obterAtiva();
    const base: ResumoInstanciaTela = {
      nomeInstancia: ativa?.nomeInstancia ?? null,
      instanciaPropria: !!ativa,
      statusConexao: 'deslogado',
      numeroMascarado: '',
      alertaWebhook: this.ultimoAlertaWebhook,
      connected: false,
      loggedIn: false,
      erroSessao: null,
      offline: false,
    };
    if (!ativa?.token) return base;
    this.possuiInstanciaPropria = true;
    try {
      const sessao = await this.comToken(ativa.token, () => this.getStatus());
      return {
        ...base,
        statusConexao: sessao.loggedIn ? 'conectado' : 'deslogado',
        numeroMascarado: mascararNumeroWhatsapp(sessao.jid || ''),
        connected: sessao.connected,
        loggedIn: sessao.loggedIn,
      };
    } catch (error) {
      const offline = this.classificarFalhaToken(error) === 'indisponivel';
      return {
        ...base,
        offline,
        erroSessao: offline
          ? `WuzAPI inacessível em ${this.baseUrl}.`
          : 'A instância própria não responde na WuzAPI. Use Conectar para gerar outra.',
      };
    }
  }

  async getQRCode(): Promise<{ qrCode: string }> {
    try {
      const { data } = await this.client.get('/session/qr');
      const unwrapped = this.unwrap<{ QRCode?: string; qrcode?: string; qrCode?: string }>(data) || {};
      let qrCode = unwrapped.QRCode || unwrapped.qrcode || unwrapped.qrCode || '';
      if (!qrCode) {
        const st = await this.getStatus();
        qrCode = (st as any).qrcode || (st as any).QRCode || '';
      }
      return { qrCode };
    } catch (error: unknown) {
      try {
        const st = await this.getStatus();
        const qrCode = (st as any).qrcode || (st as any).QRCode || '';
        if (qrCode) return { qrCode };
      } catch { /* ignore */ }
      throw this.erroMsg('Falha ao obter QR code', error);
    }
  }

  private extrairErroApi(error: unknown): string {
    if (!(error instanceof AxiosError)) {
      return error instanceof Error ? error.message : String(error || '');
    }
    const data = error.response?.data as { error?: string; message?: string } | string | undefined;
    if (typeof data === 'string') return data;
    return String(data?.error || data?.message || error.message || '');
  }

  private ehJaConectado(error: unknown): boolean {
    const msg = this.extrairErroApi(error).toLowerCase();
    return msg.includes('already connected')
      || msg.includes('já conectad')
      || msg.includes('ja conectad');
  }

  private resultado(
    nomeInstancia: string | null,
    sessao: { connected?: boolean; loggedIn?: boolean; jid?: string },
    logado: boolean,
    message: string,
    alertaWebhook: string | null,
  ): ResultadoConexao {
    return {
      connected: !!(sessao.connected || logado),
      jid: sessao.jid || '',
      message,
      logado,
      nomeInstancia,
      numeroMascarado: mascararNumeroWhatsapp(sessao.jid || ''),
      statusConexao: logado ? 'conectado' : 'deslogado',
      alertaWebhook,
    };
  }

  /**
   * Cria usuário novo. Não lista e não reaproveita token, nome ou número existentes.
   */
  async criarOuObterInstancia(nome: string, token: string): Promise<void> {
    await this.criarUsuarioNovo(nome, token);
  }

  private async criarUsuarioNovo(nome: string, token: string): Promise<void> {
    const adminToken = (process.env.WUZAPI_ADMIN_TOKEN || '').trim();
    if (!adminToken) {
      throw new Error('WUZAPI_ADMIN_TOKEN não configurado. Sem ele o Sistemma não cria instância própria.');
    }
    try {
      await this.client.post('/admin/users', {
        name: nome,
        token,
        webhook: this.webhookUrl,
        events: 'Message,Connected,QR',
      }, { headers: { Authorization: adminToken } });
    } catch (error: unknown) {
      throw this.erroMsg('Falha ao criar instância WuzAPI', error);
    }
  }

  private extrairUsuarios(data: unknown): UsuarioAdmin[] {
    const bruto = data as { data?: unknown } | unknown;
    const raw = Array.isArray(bruto)
      ? bruto
      : (bruto && typeof bruto === 'object' && 'data' in bruto ? (bruto as { data?: unknown }).data : []);
    return Array.isArray(raw) ? raw as UsuarioAdmin[] : [];
  }

  /** Lê a lista só para decidir o nome ou achar o id do nosso token. Não escolhe instância. */
  private async listarUsuariosAdmin(): Promise<UsuarioAdmin[]> {
    const adminToken = (process.env.WUZAPI_ADMIN_TOKEN || '').trim();
    if (!adminToken) {
      throw new Error('WUZAPI_ADMIN_TOKEN não configurado.');
    }
    const response = await this.client.get('/admin/users', { headers: { Authorization: adminToken } });
    return this.extrairUsuarios(response.data);
  }

  private async nomeParaNovaInstancia(tokenNovo: string, tokenNosso: string | null): Promise<string> {
    try {
      const usuarios = await this.listarUsuariosAdmin();
      return escolherNomeInstancia(tokenNovo, tokenNosso, usuarios);
    } catch (error) {
      console.warn(
        '[Wuzapi] Não foi possível conferir o nome Sistemma. A instância nova usará sufixo.',
        redigirSegredos((error as Error)?.message || ''),
      );
      return `Sistemma-${tokenNovo.slice(0, 6)}`;
    }
  }

  private async removerUsuarioProprio(token: string): Promise<void> {
    const adminToken = (process.env.WUZAPI_ADMIN_TOKEN || '').trim();
    if (!adminToken) {
      throw new Error('WUZAPI_ADMIN_TOKEN ausente. A instância anterior do Sistemma não foi removida na WuzAPI.');
    }
    const usuarios = await this.listarUsuariosAdmin();
    const meus = usuarios.filter((usuario) => usuario.token === token);
    for (const usuario of meus) {
      const id = usuario.id ?? usuario.ID;
      if (id === undefined || id === null || String(id) === '') continue;
      await this.client.delete(`/admin/users/${id}`, { headers: { Authorization: adminToken } });
    }
  }

  private async iniciarSessao(): Promise<void> {
    let jaConectada = false;
    try {
      const st = await this.getStatus();
      jaConectada = !!st.connected;
    } catch { /* tenta connect abaixo */ }

    if (jaConectada) return;
    try {
      await this.client.post('/session/connect', {
        Subscribe: [...EVENTOS],
        Immediate: true,
      });
    } catch (error: unknown) {
      if (!this.ehJaConectado(error)) throw this.erroMsg('Falha ao conectar sessão', error);
    }
  }

  private async confirmarWebhookSePossivel(): Promise<string | null> {
    if (!this.webhookUrl) return null;
    try {
      const resultado = await this.configurarWebhook(this.webhookUrl, [...EVENTOS]);
      return resultado.alerta ?? null;
    } catch (error: unknown) {
      console.warn(
        '[Wuzapi] Webhook não configurado:',
        redigirSegredos((error as Error)?.message || String(error)),
      );
      return null;
    }
  }

  private async gravarInstancia(nome: string, token: string) {
    try {
      const gravada = await this.repositorio.substituirAtiva(nome, token);
      this.possuiInstanciaPropria = true;
      return gravada;
    } catch (error) {
      throw new Error(redigirSegredos(
        `Falha ao gravar a instância própria: ${(error as Error)?.message || error}`,
      ));
    }
  }

  private async criarInstanciaPropria(tokenNosso: string | null): Promise<ResultadoConexao> {
    const token = gerarTokenInstancia();
    const nome = await this.nomeParaNovaInstancia(token, tokenNosso);
    await this.criarUsuarioNovo(nome, token);
    const gravada = await this.gravarInstancia(nome, token);
    return this.comToken(token, async () => {
      await this.iniciarSessao();
      const alerta = await this.confirmarWebhookSePossivel();
      let sessao = { connected: true, loggedIn: false, jid: '' };
      try {
        const lida = await this.getStatus();
        sessao = {
          connected: !!lida.connected,
          loggedIn: !!lida.loggedIn,
          jid: String(lida.jid || ''),
        };
      } catch { /* o QR pode sair no passo seguinte */ }
      return this.resultado(
        gravada.nova.nomeInstancia,
        sessao,
        !!sessao.loggedIn,
        'Conexão iniciada na instância própria. Escaneie o QR code no WhatsApp.',
        alerta,
      );
    });
  }

  /**
   * Botão Conectar. Nunca escolhe instância pelo nome, pelo número ou pela lista.
   * a) própria logada → só confirma o webhook
   * b) própria deslogada → QR na mesma
   * c) sem própria, ou token ausente na WuzAPI → token novo
   */
  async conectarSessao(): Promise<ResultadoConexao> {
    if (!process.env.WUZAPI_URL?.trim()) {
      throw new Error('WUZAPI_URL não configurada');
    }

    const ativa = await this.repositorio.obterAtiva();
    if (ativa?.token) {
      const estado = await this.tokenResponde(ativa.token);
      if (estado === 'indisponivel') {
        throw new Error(`WuzAPI inacessível em ${this.baseUrl}. A instância própria não foi substituída.`);
      }
      if (estado === 'ok') {
        return this.comToken(ativa.token, async () => {
          const sessao = await this.getStatus();
          if (sessao.loggedIn) {
            const alerta = await this.confirmarWebhookSePossivel();
            return this.resultado(
              ativa.nomeInstancia,
              sessao,
              true,
              'Instância própria já conectada.',
              alerta,
            );
          }
          await this.iniciarSessao();
          const alerta = await this.confirmarWebhookSePossivel();
          let atual = sessao;
          try {
            atual = await this.getStatus();
          } catch { /* mantém a leitura anterior */ }
          return this.resultado(
            ativa.nomeInstancia,
            { ...atual, loggedIn: false },
            false,
            'QR gerado na instância própria do Sistemma.',
            alerta,
          );
        });
      }
    }

    return this.criarInstanciaPropria(ativa?.token ?? null);
  }

  async gerarNovaConexao(corpo: { confirmacao?: string }): Promise<ResultadoConexao> {
    if (corpo?.confirmacao !== 'NOVA CONEXAO') {
      throw new Error('Confirmação obrigatória. Envie confirmacao: "NOVA CONEXAO".');
    }
    if (!process.env.WUZAPI_URL?.trim()) {
      throw new Error('WUZAPI_URL não configurada');
    }

    const anterior = await this.repositorio.obterAtiva();
    const token = gerarTokenInstancia();
    const nome = await this.nomeParaNovaInstancia(token, anterior?.token ?? null);
    await this.criarUsuarioNovo(nome, token);
    const gravada = await this.gravarInstancia(nome, token);
    if (gravada.anterior?.token) {
      await this.removerUsuarioProprio(gravada.anterior.token);
    }
    return this.comToken(token, async () => {
      await this.iniciarSessao();
      const alerta = await this.confirmarWebhookSePossivel();
      let sessao = { connected: true, loggedIn: false, jid: '' };
      try {
        const lida = await this.getStatus();
        sessao = {
          connected: !!lida.connected,
          loggedIn: !!lida.loggedIn,
          jid: String(lida.jid || ''),
        };
      } catch { /* segue para o QR */ }
      return this.resultado(
        gravada.nova.nomeInstancia,
        sessao,
        !!sessao.loggedIn,
        'Nova instância própria criada. Escaneie o QR code no WhatsApp.',
        alerta,
      );
    });
  }

  async configurarWebhook(
    url: string,
    events: string[] = ['Message'],
  ): Promise<{ aplicado: boolean; alerta?: string }> {
    let atual = '';
    try {
      atual = await this.lerWebhook();
    } catch {
      atual = '';
    }
    const forcar = process.env.WUZAPI_WEBHOOK_FORCAR === 'true';
    if (webhookApontaParaOutroHost(atual, url) && !forcar) {
      const host = hostDeUrl(atual) || 'outro host';
      const alerta = `O webhook desta instância aponta para ${host}. Não foi alterado.`;
      this.ultimoAlertaWebhook = alerta;
      console.warn(`[Wuzapi] ${alerta}`);
      return { aplicado: false, alerta };
    }
    try {
      await this.client.post('/webhook', { webhookurl: url, events });
      let gravado = '';
      try {
        gravado = await this.lerWebhook();
      } catch {
        gravado = '';
      }
      if (gravado && gravado !== url) {
        console.warn(
          `[Wuzapi] Webhook gravado (${urlSemSegredoWebhook(gravado)}) difere do pedido (${urlSemSegredoWebhook(url)})`,
        );
      } else {
        console.log(`[Wuzapi] Webhook confirmado: ${urlSemSegredoWebhook(gravado || url)}`);
      }
      this.ultimoAlertaWebhook = null;
      return { aplicado: true };
    } catch (error: unknown) {
      throw this.erroMsg('Falha ao configurar webhook', error);
    }
  }

  private async lerWebhook(): Promise<string> {
    const { data } = await this.client.get('/webhook');
    const raw = this.unwrap<{ webhook?: string; Webhook?: string }>(data) || {};
    return String(raw.webhook || raw.Webhook || '').trim();
  }

  private async exigirTokenProprio(): Promise<string> {
    const token = this.tokenAls.getStore() || await this.resolverToken();
    if (!token) throw new Error('Sem instância própria do Sistemma.');
    return token;
  }

  async enviarTexto(destino: string, body: string): Promise<WuzapiSendResult> {
    const token = await this.exigirTokenProprio();
    const { data } = await this.comToken(token, () => this.client.post('/chat/send/text', {
      Phone: destino,
      Body: body,
    }));
    return this.unwrap(data);
  }

  async enviarDocumento(
    destino: string,
    fileName: string,
    pdfBuffer: Buffer,
    caption?: string,
  ): Promise<WuzapiSendResult> {
    const token = await this.exigirTokenProprio();
    const b64 = pdfBuffer.toString('base64');
    const { data } = await this.comToken(token, () => this.client.post('/chat/send/document', {
      Phone: destino,
      FileName: fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`,
      Document: `data:application/octet-stream;base64,${b64}`,
      MimeType: 'application/pdf',
      Caption: caption || '',
    }));
    return this.unwrap(data);
  }

  async downloadDocument(payload: {
    Url?: string;
    DirectPath?: string;
    Mimetype?: string;
    MediaKey: string;
    FileSHA256: string;
    FileEncSHA256?: string;
    FileLength: number;
  }): Promise<{ data: string; mimetype?: string }> {
    const token = await this.exigirTokenProprio();
    try {
      const { data } = await this.comToken(token, () => this.client.post('/chat/downloaddocument', {
        Url: payload.Url || '',
        DirectPath: payload.DirectPath || '',
        Mimetype: payload.Mimetype || '',
        MediaKey: payload.MediaKey,
        FileSHA256: payload.FileSHA256,
        FileEncSHA256: payload.FileEncSHA256 || '',
        FileLength: payload.FileLength,
      }, {
        timeout: parseInt(process.env.WUZAPI_DOWNLOAD_TIMEOUT_MS || '300000', 10),
      }));
      const unwrapped = this.unwrap<{ Data?: string; data?: string; Mimetype?: string; mimetype?: string }>(data);
      return {
        data: unwrapped.Data || unwrapped.data || '',
        mimetype: unwrapped.Mimetype || unwrapped.mimetype,
      };
    } catch (error: unknown) {
      throw this.erroMsg('Falha ao baixar o documento do WhatsApp', error);
    }
  }

  async desconectarSessao(): Promise<{ message: string }> {
    if (!process.env.WUZAPI_URL?.trim()) {
      throw new Error('WUZAPI_URL não configurada');
    }
    const ativa = await this.repositorio.obterAtiva();
    if (!ativa?.token) {
      throw new Error('Não há instância própria do Sistemma para desconectar.');
    }

    await this.comToken(ativa.token, async () => {
      try {
        await this.client.post('/session/logout', {});
      } catch (error: unknown) {
        const msg = this.extrairErroApi(error).toLowerCase();
        if (
          !msg.includes('no session')
          && !msg.includes('not logged')
          && !msg.includes('not connected')
          && !msg.includes('logged out')
        ) {
          throw this.erroMsg('Falha ao desconectar WhatsApp', error);
        }
      }
      try {
        await this.client.post('/session/disconnect', {});
      } catch {
        // Sem sessão após logout é esperado
      }
    });

    return { message: 'WhatsApp desconectado. Escaneie o QR novamente para reconectar.' };
  }

  /**
   * Quando o webhook manda LID (@lid) sem SenderAlt/sender_pn, pergunta o telefone à WuzAPI.
   * Tenta os caminhos conhecidos e desiste sem derrubar o webhook.
   */
  async resolverTelefonePorLid(lid: string): Promise<string | null> {
    if (!this.isConfigured || !lid) return null;
    const corpo = { LID: lid, lid, Phone: lid };
    const rotas = ['/user/pn', '/user/lid', '/user/info'];
    for (const rota of rotas) {
      try {
        const { data } = await this.client.post(rota, corpo);
        const telefone = telefoneDeRespostaLid(data);
        if (telefone) return telefone;
      } catch {
        /* o build da WuzAPI pode não ter esta rota */
      }
    }
    return null;
  }

  async listarGruposWhatsApp(): Promise<Array<{ jid: string; nome: string; participantes: number }>> {
    const token = await this.exigirTokenProprio();
    try {
      const { data } = await this.comToken(token, () => this.client.get('/group/list'));
      const unwrapped = this.unwrap<{ Groups?: any[]; groups?: any[] }>(data) || {};
      const groups = unwrapped.Groups || unwrapped.groups || (Array.isArray(unwrapped) ? unwrapped : []);
      if (!Array.isArray(groups)) return [];

      return groups
        .map((g: any) => {
          const jid = String(g.JID || g.jid || g.Id || g.id || '');
          const nome = String(g.Name || g.name || g.Subject || g.subject || jid);
          const participantes = Array.isArray(g.Participants || g.participants)
            ? (g.Participants || g.participants).length
            : Number(g.ParticipantCount || 0);
          return { jid, nome, participantes };
        })
        .filter((g) => g.jid.includes('@g.us'))
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    } catch (error: unknown) {
      throw this.erroMsg('Falha ao listar grupos do WhatsApp', error);
    }
  }

  /** Sessão da instância própria. Sem token ou sem login: desconectada. Não registra o token. */
  async sessaoDaInstancia(): Promise<{ logado: boolean; jidProprio: string }> {
    const ativa = await this.repositorio.obterAtiva();
    if (!ativa?.token) return { logado: false, jidProprio: '' };
    try {
      const sessao = await this.comToken(ativa.token, () => this.getStatus());
      return {
        logado: !!sessao.loggedIn,
        jidProprio: String(sessao.jid || ''),
      };
    } catch {
      return { logado: false, jidProprio: '' };
    }
  }

  async baixarContatos(): Promise<unknown> {
    const token = await this.exigirTokenProprio();
    const { data } = await this.comToken(token, () => this.client.get('/user/contacts'));
    return this.unwrap(data);
  }

  async baixarInfoGrupo(jid: string): Promise<unknown> {
    const token = await this.exigirTokenProprio();
    const { data } = await this.comToken(token, () => this.client.get('/group/info', {
      params: { groupJID: jid },
    }));
    return this.unwrap(data);
  }
}

const HOST_DOCKER_FIXO = /host\.docker\.internal|sistemma-backend/i;

/**
 * Usa somente a URL informada por variável. Endereços fixos de Docker são descartados.
 */
export function resolverWebhookWuzapi(_wuzapiUrl: string, webhookUrl: string): string {
  const fromEnv = String(webhookUrl || '').trim();
  if (!fromEnv || HOST_DOCKER_FIXO.test(fromEnv)) return '';
  return fromEnv;
}

export const wuzapiService = new WuzapiService();
export default wuzapiService;
