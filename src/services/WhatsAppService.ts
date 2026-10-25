import axios from 'axios';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';

/**
 * WhatsAppService — Envio de dashboards via WhatsApp Cloud API (Meta)
 * 
 * 🔧 Setup necessário:
 *   1. Criar app em https://developers.facebook.com (tipo "Business")
 *   2. Adicionar produto "WhatsApp Cloud API"
 *   3. Vincular número de telefone da empresa
 *   4. Copiar WHATSAPP_TOKEN e WHATSAPP_PHONE_ID para o .env
 * 
 * 💰 Gratuito: até 1.000 conversas/mês
 *    Com 20-40 dashboards/dia para ~10 destinatários, fica ~300 conversas/mês ✅
 */

interface EnvioResult {
  sucesso: boolean;
  mensagemId?: string;
  erro?: string;
}

export class WhatsAppService {
  private readonly apiVersion = 'v18.0';
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly phoneNumberId: string;

  constructor() {
    this.token = process.env.WHATSAPP_TOKEN || '';
    this.phoneNumberId = process.env.WHATSAPP_PHONE_ID || '';
    this.baseUrl = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}`;

    if (!this.token || !this.phoneNumberId) {
      console.warn('⚠️ WhatsAppService: WHATSAPP_TOKEN ou WHATSAPP_PHONE_ID não configurados.');
    }
  }

  get isConfigured(): boolean {
    return !!(this.token && this.phoneNumberId);
  }

  /**
   * Envia um dashboard PDF via WhatsApp
   * @param telefoneDestino Número com DDI (ex: 5511999999999)
   * @param pdfPath Caminho absoluto do arquivo PDF no servidor
   * @param mensagem Legenda opcional
   */
  async enviarDashboard(
    telefoneDestino: string,
    pdfPath: string,
    mensagem?: string
  ): Promise<EnvioResult> {
    try {
      if (!this.isConfigured) {
        return { sucesso: false, erro: 'WhatsApp não configurado. Defina WHATSAPP_TOKEN e WHATSAPP_PHONE_ID no .env' };
      }

      if (!fs.existsSync(pdfPath)) {
        return { sucesso: false, erro: `Arquivo PDF não encontrado: ${pdfPath}` };
      }

      // 1. Upload do PDF para a mídia temporária do Meta
      const mediaId = await this.uploadMedia(pdfPath);

      // 2. Envio da mensagem com o PDF anexado
      const result = await this.enviarMensagem(telefoneDestino, mediaId, mensagem);

      return result;
    } catch (error: any) {
      console.error('[WhatsAppService] Erro ao enviar dashboard:', error?.response?.data || error?.message || error);
      return {
        sucesso: false,
        erro: error?.response?.data?.error?.message || error?.message || 'Erro desconhecido ao enviar WhatsApp'
      };
    }
  }

  /**
   * Envia dashboard diretamente de um buffer (sem precisar salvar em disco)
   * @param telefoneDestino Número com DDI
   * @param pdfBuffer Buffer do PDF
   * @param nomeArquivo Nome do arquivo (ex: dashboard_coleta.pdf)
   * @param mensagem Legenda opcional
   */
  async enviarDashboardBuffer(
    telefoneDestino: string,
    pdfBuffer: Buffer,
    nomeArquivo: string = 'dashboard.pdf',
    mensagem?: string
  ): Promise<EnvioResult> {
    try {
      if (!this.isConfigured) {
        return { sucesso: false, erro: 'WhatsApp não configurado.' };
      }

      // Salva temporariamente para fazer upload
      const tempDir = path.resolve(process.env.TEMP_DIR || './temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const tempPath = path.join(tempDir, `whatsapp_${Date.now()}_${nomeArquivo}`);
      fs.writeFileSync(tempPath, pdfBuffer);

      try {
        const result = await this.enviarDashboard(telefoneDestino, tempPath, mensagem);
        return result;
      } finally {
        // Limpa arquivo temporário
        try { fs.unlinkSync(tempPath); } catch { /* ignora */ }
      }
    } catch (error: any) {
      console.error('[WhatsAppService] Erro ao enviar dashboard por buffer:', error?.message || error);
      return { sucesso: false, erro: error?.message || 'Erro desconhecido' };
    }
  }

  // ─── Upload do PDF para mídia do Meta ───
  private async uploadMedia(pdfPath: string): Promise<string> {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('file', fs.createReadStream(pdfPath));

    const response = await axios.post(
      `${this.baseUrl}/media`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${this.token}`,
        },
      }
    );

    return response.data.id;
  }

  // ─── Envio da mensagem com o PDF ───
  private async enviarMensagem(
    telefone: string,
    mediaId: string,
    mensagem?: string
  ): Promise<EnvioResult> {
    // Limpa formatação do telefone
    const telefoneLimpo = telefone.replace(/\D/g, '');

    const response = await axios.post(
      `${this.baseUrl}/messages`,
      {
        messaging_product: 'whatsapp',
        to: telefoneLimpo,
        type: 'document',
        document: {
          id: mediaId,
          filename: 'dashboard_coleta.pdf',
          caption: mensagem || '📊 Dashboard de Coleta — Atualização automática',
        },
      },
      {
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return {
      sucesso: true,
      mensagemId: response.data?.messages?.[0]?.id,
    };
  }

  /**
   * Envia para múltiplos destinatários de uma vez
   */
  async enviarDashboardMultiplos(
    telefones: string[],
    pdfPath: string,
    mensagem?: string
  ): Promise<{ resultados: EnvioResult[]; sucessos: number; falhas: number }> {
    const resultados: EnvioResult[] = [];
    let sucessos = 0;
    let falhas = 0;

    for (const telefone of telefones) {
      const resultado = await this.enviarDashboard(telefone, pdfPath, mensagem);
      resultados.push({ ...resultado, telefone } as any);
      if (resultado.sucesso) sucessos++;
      else falhas++;
    }

    return { resultados, sucessos, falhas };
  }
}

// Singleton
export const whatsAppService = new WhatsAppService();
