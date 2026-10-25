/**
 * Provider Anthropic — usa Claude 3.5 Sonnet com visão.
 * Formato de API diferente dos demais (Mensagens API).
 * Endpoint: https://api.anthropic.com/v1/messages
 */
import axios from 'axios';
import { LLMProvider } from './LLMProvider';
import { LLMProviderConfig, ExtracaoResultado } from './types';
import { normalizarBase64, extrairDadosDoTexto } from './utils';

const PROMPT_SISTEMA = `Você é um especialista em leitura de bombas de abastecimento.
Analise a imagem da bomba de combustível e extraia APENAS:
- Litragem abastecida (número com até 2 casas decimais)
- Valor total (número com até 2 casas decimais)

Responda APENAS no formato JSON abaixo, sem markdown, sem explicações:
{"litragem": 0.00, "valor": 0.00}`;

export class AnthropicProvider implements LLMProvider {
  readonly nome = 'anthropic';
  private config: Required<LLMProviderConfig>;

  constructor(config: LLMProviderConfig) {
    this.config = {
      apiUrl: config.apiUrl || 'https://api.anthropic.com/v1/messages',
      apiKey: config.apiKey || '',
      model: config.model || 'claude-3-5-sonnet-20241022',
      timeout: config.timeout || 30000,
    };
  }

  async extrairDadosImagem(base64Data: string): Promise<ExtracaoResultado> {
    try {
      if (!this.config.apiKey) {
        throw new Error('ANTHROPIC_API_KEY não configurada');
      }

      const { base64, mediaType } = normalizarBase64(base64Data);

      const response = await axios.post(
        this.config.apiUrl,
        {
          model: this.config.model,
          system: PROMPT_SISTEMA,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: mediaType,
                    data: base64,
                  },
                },
                {
                  type: 'text',
                  text: 'Extraia os dados desta bomba de abastecimento.',
                },
              ],
            },
          ],
          max_tokens: 256,
          temperature: 0.1,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.config.apiKey,
            'anthropic-version': '2023-06-01',
          },
          timeout: this.config.timeout,
        }
      );

      const textoResposta = response.data?.content?.[0]?.text || '';
      return extrairDadosDoTexto(textoResposta, this.nome);
    } catch (error: any) {
      return {
        litragem: null,
        valor: null,
        confianca: 0,
        textoRaw: '',
        erroExtracao: `Anthropic: ${error.message || 'Erro na requisição'}`,
      };
    }
  }
}
