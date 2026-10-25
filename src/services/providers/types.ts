/**
 * Tipos compartilhados entre providers de LLM
 * Define o contrato de dados para extração de imagem de bombas de abastecimento.
 */

/** Configuração de um provider de LLM */
export interface LLMProviderConfig {
  /** URL base da API */
  apiUrl: string;
  /** Chave de autenticação (se aplicável) */
  apiKey?: string;
  /** Nome do modelo a usar */
  model?: string;
  /** Timeout em milissegundos */
  timeout?: number;
}

/** Resultado da extração de dados de uma imagem de bomba de abastecimento */
export interface ExtracaoResultado {
  /** Litragem abastecida (litros) */
  litragem: number | null;
  /** Valor total do abastecimento (R$) */
  valor: number | null;
  /** Nível de confiança da extração (0–1) */
  confianca: number;
  /** Texto bruto identificado na imagem */
  textoRaw: string;
  /** Mensagem de erro caso a extração falhe */
  erroExtracao?: string;
}

/** Nomes de provedores suportados */
export type ProviderName = 'lmstudio' | 'openai' | 'deepseek' | 'anthropic' | 'ollama';

/** Lista de todos os provedores disponíveis */
export const PROVIDER_NAMES: ProviderName[] = ['lmstudio', 'openai', 'deepseek', 'anthropic', 'ollama'];

/** Mapa de nome → label amigável */
export const PROVIDER_LABELS: Record<ProviderName, string> = {
  lmstudio: 'LM Studio (local)',
  openai: 'OpenAI (ChatGPT / GPT-4o)',
  deepseek: 'DeepSeek',
  anthropic: 'Anthropic (Claude)',
  ollama: 'Ollama (local)',
};
