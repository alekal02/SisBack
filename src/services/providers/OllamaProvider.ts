/**
 * Provider Ollama — usa API nativa do Ollama com suporte a modelos de visão.
 * Endpoint padrão: http://localhost:11434/api/chat
 * Modelos recomendados: llava, bakllava, moondream, qwen2-vl
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

export class OllamaProvider implements LLMProvider {
  readonly nome = 'ollama';
  private config: Required<LLMProviderConfig>;

  constructor(config: LLMProviderConfig) {
    this.config = {
      apiUrl: config.apiUrl || 'http://localhost:11434/api/chat',
      apiKey: config.apiKey || '',
      model: config.model || 'llava',
      timeout: config.timeout || 120000, // Ollama pode ser lento na primeira execução
    };
  }

  async extrairDadosImagem(base64Data: string): Promise<ExtracaoResultado> {
    try {
      const { base64 } = normalizarBase64(base64Data);

      const response = await axios.post(
        this.config.apiUrl,
        {
          model: this.config.model,
          messages: [
            {
              role: 'user',
              content: PROMPT_SISTEMA,
              images: [base64],
            },
          ],
          options: {
            temperature: 0.1,
            num_predict: 256,
          },
          stream: false,
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: this.config.timeout,
        }
      );

      const textoResposta = response.data?.message?.content || '';
      return extrairDadosDoTexto(textoResposta, this.nome);
    } catch (error: any) {
      return {
        litragem: null,
        valor: null,
        confianca: 0,
        textoRaw: '',
        erroExtracao: `Ollama: ${error.message || 'Erro na requisição'}`,
      };
    }
  }
}
