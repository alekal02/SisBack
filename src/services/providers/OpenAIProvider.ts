/**
 * Provider OpenAI — usa GPT-4o com visão para extrair dados de bombas.
 * Endpoint: https://api.openai.com/v1/chat/completions
 */
import axios from 'axios';
import { LLMProvider } from './LLMProvider';
import { LLMProviderConfig, ExtracaoResultado } from './types';
import { normalizarBase64, extrairDadosDoTexto } from './utils';

const PROMPT_SISTEMA = `Você é um especialista em leitura de bombas de abastecimento.
Analise a imagem da bomba de combustível e extraia APENAS:
- Litragem abastecida (número com até 2 casas decimais, seguido de "L" ou "litros")
- Valor total (número com até 2 casas decimais, precedido de "R$" ou "$")

Responda APENAS no formato JSON abaixo, sem markdown, sem explicações:
{"litragem": 0.00, "valor": 0.00}`;

export class OpenAIProvider implements LLMProvider {
  readonly nome = 'openai';
  private config: Required<LLMProviderConfig>;

  constructor(config: LLMProviderConfig) {
    this.config = {
      apiUrl: config.apiUrl || 'https://api.openai.com/v1/chat/completions',
      apiKey: config.apiKey || '',
      model: config.model || 'gpt-4o',
      timeout: config.timeout || 30000,
    };
  }

  async extrairDadosImagem(base64Data: string): Promise<ExtracaoResultado> {
    try {
      if (!this.config.apiKey) {
        throw new Error('OPENAI_API_KEY não configurada');
      }

      const { base64, mediaType } = normalizarBase64(base64Data);
      const dataUrl = `data:${mediaType};base64,${base64}`;

      const response = await axios.post(
        this.config.apiUrl,
        {
          model: this.config.model,
          messages: [
            { role: 'system', content: PROMPT_SISTEMA },
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Extraia os dados desta bomba de abastecimento:' },
                { type: 'image_url', image_url: { url: dataUrl } },
              ],
            },
          ],
          max_tokens: 256,
          temperature: 0.1,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          timeout: this.config.timeout,
        }
      );

      const textoResposta = response.data?.choices?.[0]?.message?.content || '';
      return extrairDadosDoTexto(textoResposta, this.nome);
    } catch (error: any) {
      return {
        litragem: null,
        valor: null,
        confianca: 0,
        textoRaw: '',
        erroExtracao: `OpenAI: ${error.message || 'Erro na requisição'}`,
      };
    }
  }
}
