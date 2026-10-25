import axios, { AxiosError, AxiosInstance } from 'axios';
import { urlSemSegredoWebhook } from './wuzapiWebhookAuth';

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

/**
 * Cliente HTTP para WuzAPI (whatsmeow).
 * Auth de instância: header `token` (não Authorization).
 */
export class WuzapiService {
  private readonly client: AxiosInstance;
  private readonly token: string;
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = (process.env.WUZAPI_URL || 'http://localhost:8080').replace(/\/$/, '');
    this.token = process.env.WUZAPI_TOKEN || '';
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: parseInt(process.env.WUZAPI_TIMEOUT_MS || '120000', 10),
      headers: {
        'Content-Type': 'application/json',
        token: this.token,
      },
    });
  }

  get isConfigured(): boolean {
    return !!(process.env.WUZAPI_URL?.trim() && process.env.WUZAPI_TOKEN?.trim());
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
      const code = error.code; // ECONNREFUSED, ETIMEDOUT, etc.
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

      return new Error(`${prefixo}: ${detalhe}`);
    }
    if (error instanceof Error) return new Error(`${prefixo}: ${error.message}`);
    return new Error(prefixo);
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

  /** true se o token de instância já existe e responde na WuzAPI */
  private async instanciaJaExiste(): Promise<boolean> {
    try {
      await this.getStatus();
      return true;
    } catch {
      return false;
    }
  }

  async getQRCode(): Promise<{ qrCode: string }> {
    try {
      const { data } = await this.client.get('/session/qr');
      const unwrapped = this.unwrap<{ QRCode?: string; qrcode?: string; qrCode?: string }>(data) || {};
      let qrCode = unwrapped.QRCode || unwrapped.qrcode || unwrapped.qrCode || '';
      if (!qrCode) {
        // Fallback: alguns builds da WuzAPI colocam o QR no status
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

  /** Extrai texto de erro da WuzAPI (body JSON ou string). */
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

  /**
   * Garante instância na WuzAPI (admin) e inicia sessão + webhook.
   * Se a sessão já estiver conectada, só renova webhook e segue (QR disponível).
   */
  async conectarSessao(): Promise<{ connected: boolean; jid: string; message: string }> {
    if (!this.isConfigured) {
      throw new Error('WUZAPI_URL e WUZAPI_TOKEN não configurados');
    }

    await this.criarOuObterInstancia(
      process.env.WUZAPI_INSTANCE_NAME || 'Sistemma',
      this.token,
    );

    let jid = '';
    let jaConectada = false;

    try {
      const st = await this.getStatus();
      jid = st.jid || '';
      jaConectada = !!st.connected;
    } catch { /* tenta connect abaixo */ }

    if (!jaConectada) {
      try {
        const { data } = await this.client.post('/session/connect', {
          Subscribe: ['Message', 'Connected', 'QR'],
          Immediate: true,
        });
        const raw = this.unwrap<any>(data) || {};
        jid = raw.jid || raw.JID || jid;
      } catch (error: unknown) {
        // WuzAPI devolve HTTP 500 com "already connected" — não é falha real
        if (!this.ehJaConectado(error)) {
          throw this.erroMsg('Falha ao conectar sessão', error);
        }
        jaConectada = true;
      }
    }

    try {
      if (this.webhookUrl) {
        await this.configurarWebhook(this.webhookUrl, ['Message', 'Connected', 'QR']);
      }
    } catch (error: unknown) {
      console.warn('[Wuzapi] Webhook não configurado:', (error as Error)?.message || error);
    }

    return {
      connected: true,
      jid,
      message: jaConectada
        ? 'Sessão já conectada. Escaneie o QR code no WhatsApp (se ainda não logado).'
        : 'Conexão iniciada. Escaneie o QR code no WhatsApp.',
    };
  }

  async criarOuObterInstancia(nome: string, token: string): Promise<void> {
    // Se o token de usuário já funciona, não precisa do admin
    if (await this.instanciaJaExiste()) {
      return;
    }

    const adminToken = (process.env.WUZAPI_ADMIN_TOKEN || '').trim();
    if (!adminToken) {
      throw new Error(
        `Instância WuzAPI não encontrada para o token informado. `
        + `Crie o usuário na WuzAPI ou defina WUZAPI_ADMIN_TOKEN (URL: ${this.baseUrl}).`,
      );
    }

    const adminHeaders = { Authorization: adminToken };
    try {
      const response = await this.client.get('/admin/users', { headers: adminHeaders });
      const raw = response.data?.data ?? response.data ?? [];
      const usuarios: Array<{ token?: string }> = Array.isArray(raw) ? raw : [];
      if (usuarios.some((u) => u.token === token)) return;
    } catch (error: unknown) {
      // Se admin falhar, ainda tenta criar (e reporta erro claro se falhar)
      console.warn('[Wuzapi] Listagem admin falhou, tentando criar instância:', (error as Error)?.message || error);
    }

    try {
      await this.client.post(
        '/admin/users',
        {
          name: nome,
          token,
          webhook: this.webhookUrl,
          events: 'Message,Connected,QR',
        },
        { headers: adminHeaders },
      );
    } catch (error: unknown) {
      if (error instanceof AxiosError && error.response?.status === 409) return;
      // Última chance: às vezes a criação falha mas o token já passou a existir
      if (await this.instanciaJaExiste()) return;
      throw this.erroMsg('Falha ao criar instância WuzAPI', error);
    }
  }

  async configurarWebhook(url: string, events: string[] = ['Message']): Promise<void> {
    try {
      await this.client.post('/webhook', {
        webhookurl: url,
        events,
      });
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
    } catch (error: unknown) {
      throw this.erroMsg('Falha ao configurar webhook', error);
    }
  }

  private async lerWebhook(): Promise<string> {
    const { data } = await this.client.get('/webhook');
    const raw = this.unwrap<{ webhook?: string; Webhook?: string }>(data) || {};
    return String(raw.webhook || raw.Webhook || '').trim();
  }

  async enviarTexto(destino: string, body: string): Promise<WuzapiSendResult> {
    const { data } = await this.client.post('/chat/send/text', {
      Phone: destino,
      Body: body,
    });
    return this.unwrap(data);
  }

  async enviarDocumento(
    destino: string,
    fileName: string,
    pdfBuffer: Buffer,
    caption?: string,
  ): Promise<WuzapiSendResult> {
    const b64 = pdfBuffer.toString('base64');
    const { data } = await this.client.post('/chat/send/document', {
      Phone: destino,
      FileName: fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`,
      Document: `data:application/octet-stream;base64,${b64}`,
      MimeType: 'application/pdf',
      Caption: caption || '',
    });
    return this.unwrap(data);
  }

  /**
   * A WuzAPI monta o DocumentMessage com Url E DirectPath separados; enviar o
   * directPath no campo Url faz o whatsmeow falhar (HTTP 500 no /chat/downloaddocument).
   */
  async downloadDocument(payload: {
    Url?: string;
    DirectPath?: string;
    Mimetype?: string;
    MediaKey: string;
    FileSHA256: string;
    FileEncSHA256?: string;
    FileLength: number;
  }): Promise<{ data: string; mimetype?: string }> {
    try {
      const { data } = await this.client.post('/chat/downloaddocument', {
        Url: payload.Url || '',
        DirectPath: payload.DirectPath || '',
        Mimetype: payload.Mimetype || '',
        MediaKey: payload.MediaKey,
        FileSHA256: payload.FileSHA256,
        FileEncSHA256: payload.FileEncSHA256 || '',
        FileLength: payload.FileLength,
      }, {
        timeout: parseInt(process.env.WUZAPI_DOWNLOAD_TIMEOUT_MS || '300000', 10),
      });
      const unwrapped = this.unwrap<{ Data?: string; data?: string; Mimetype?: string; mimetype?: string }>(data);
      return {
        data: unwrapped.Data || unwrapped.data || '',
        mimetype: unwrapped.Mimetype || unwrapped.mimetype,
      };
    } catch (error: unknown) {
      throw this.erroMsg('Falha ao baixar o documento do WhatsApp', error);
    }
  }

  /**
   * Lista grupos WhatsApp da conta conectada (GET /group/list).
   */
  /**
   * Encerra a sessão WhatsApp (logout). Remove o pareamento do aparelho.
   * Em seguida tenta disconnect para limpar a conexão TCP.
   */
  async desconectarSessao(): Promise<{ message: string }> {
    if (!this.isConfigured) {
      throw new Error('WUZAPI_URL e WUZAPI_TOKEN não configurados');
    }

    try {
      await this.client.post('/session/logout', {});
    } catch (error: unknown) {
      const msg = this.extrairErroApi(error).toLowerCase();
      // Já deslogado / sem sessão — trata como sucesso
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

    return { message: 'WhatsApp desconectado. Escaneie o QR novamente para reconectar.' };
  }

  async listarGruposWhatsApp(): Promise<Array<{ jid: string; nome: string; participantes: number }>> {
    try {
      const { data } = await this.client.get('/group/list');
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
