/**
 * ProviderFactory — Factory para criar instâncias de LLMProvider
 * com base na variável de ambiente LLM_PROVIDER.
 *
 * Suporta: lmstudio, openai, deepseek, anthropic, ollama
 *
 * Variáveis de ambiente usadas:
 *   LLM_PROVIDER          — Nome do provider (default: "lmstudio")
 *   LLM_API_URL           — URL base (opcional, sobrescreve o default do provider)
 *   LLM_MODEL             — Modelo (opcional, sobrescreve o default do provider)
 *   LLM_TIMEOUT           — Timeout em ms (opcional, sobrescreve o default)
 *   OPENAI_API_KEY        — API Key OpenAI (obrigatório se provider = openai)
 *   DEEPSEEK_API_KEY      — API Key DeepSeek (obrigatório se provider = deepseek)
 *   ANTHROPIC_API_KEY     — API Key Anthropic (obrigatório se provider = anthropic)
 */

import { LLMProvider } from './LLMProvider';
import { LLMProviderConfig, ProviderName, PROVIDER_NAMES } from './types';
import { LMStudioProvider } from './LMStudioProvider';
import { OpenAIProvider } from './OpenAIProvider';
import { DeepSeekProvider } from './DeepSeekProvider';
import { AnthropicProvider } from './AnthropicProvider';
import { OllamaProvider } from './OllamaProvider';

/** Configurações padrão de cada provider */
const PROVIDER_DEFAULTS: Record<ProviderName, {
  apiUrl: string;
  model: string;
  timeout: number;
  requerApiKey: boolean;
}> = {
  lmstudio: {
    apiUrl: 'http://localhost:1234/v1/chat/completions',
    model: 'qwen3-vl-8b',
    timeout: 60000,
    requerApiKey: true,
  },
  openai: {
    apiUrl: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o',
    timeout: 30000,
    requerApiKey: true,
  },
  deepseek: {
    apiUrl: 'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-vl2',
    timeout: 30000,
    requerApiKey: true,
  },
  anthropic: {
    apiUrl: 'https://api.anthropic.com/v1/messages',
    model: 'claude-3-5-sonnet-20241022',
    timeout: 30000,
    requerApiKey: true,
  },
  ollama: {
    apiUrl: 'http://localhost:11434/api/chat',
    model: 'llava',
    timeout: 120000,
    requerApiKey: false,
  },
};

/** Mapa de variáveis de ambiente para chave de API de cada provider */
const API_KEY_ENV: Record<ProviderName, string | null> = {
  lmstudio: 'LMSTUDIO_API_KEY',
  openai: 'OPENAI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  ollama: null,
};

/**
 * Retorna o nome do provider a partir da variável de ambiente LLM_PROVIDER.
 * Se inválido ou não definido, retorna "lmstudio" como fallback.
 */
export function getProviderNameFromEnv(): ProviderName {
  const envValue = process.env.LLM_PROVIDER?.toLowerCase().trim() || '';
  if (PROVIDER_NAMES.includes(envValue as ProviderName)) {
    return envValue as ProviderName;
  }
  return 'lmstudio';
}

/**
 * Cria e retorna uma instância de LLMProvider com base na variável
 * de ambiente LLM_PROVIDER (ou no nome explicitamente passado).
 *
 * @param providerNameOverride  Nome do provider (opcional). Se omitido, lê de LLM_PROVIDER.
 * @returns Instância configurada de LLMProvider
 */
export function criarProvider(providerNameOverride?: ProviderName): LLMProvider {
  const nome = providerNameOverride || getProviderNameFromEnv();
  const defaults = PROVIDER_DEFAULTS[nome];

  // Lê overrides genéricos do ambiente
  const envApiUrl = process.env.LLM_API_URL || '';
  const envModel = process.env.LLM_MODEL || '';
  const envTimeout = process.env.LLM_TIMEOUT || '';

  // Lê chave de API específica do provider
  const envKeyName = API_KEY_ENV[nome];
  const apiKey = envKeyName ? (process.env[envKeyName] || '') : 'not-needed';

  const config: LLMProviderConfig = {
    apiUrl: envApiUrl || defaults.apiUrl,
    model: envModel || defaults.model,
    timeout: envTimeout ? parseInt(envTimeout, 10) : defaults.timeout,
    ...(apiKey ? { apiKey } : {}),
  };

  // Se provider requer apiKey e não foi fornecida, avisa mas não quebra
  if (defaults.requerApiKey && (!config.apiKey || config.apiKey === '')) {
    console.warn(
      `[ProviderFactory] ⚠️ Provider "${nome}" requer variável de ambiente ` +
      `"${envKeyName}" configurada. A extração pode falhar.`
    );
  }

  return instanciarProvider(nome, config);
}

/**
 * Instancia o provider correto de acordo com o nome.
 */
function instanciarProvider(nome: ProviderName, config: LLMProviderConfig): LLMProvider {
  switch (nome) {
    case 'lmstudio':
      return new LMStudioProvider(config);
    case 'openai':
      return new OpenAIProvider(config);
    case 'deepseek':
      return new DeepSeekProvider(config);
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'ollama':
      return new OllamaProvider(config);
    default:
      // Fallback seguro — nunca deve chegar aqui se getProviderNameFromEnv validou
      console.warn(`[ProviderFactory] Provider desconhecido "${nome}". Usando LM Studio.`);
      return new LMStudioProvider(config);
  }
}

/**
 * Retorna a lista de providers disponíveis com seus status de configuração.
 * Útil para exibir no frontend/admin quais opções estão prontas para uso.
 */
export function listarProvidersDisponiveis(): Array<{
  nome: ProviderName;
  label: string;
  configurado: boolean;
  modelo: string;
}> {
  return PROVIDER_NAMES.map((nome) => {
    const defaults = PROVIDER_DEFAULTS[nome];
    const envKeyName = API_KEY_ENV[nome];
    const configurado = envKeyName
      ? !!process.env[envKeyName]
      : true; // providers locais são sempre "configurados"
    return {
      nome,
      label: nome.charAt(0).toUpperCase() + nome.slice(1),
      configurado,
      modelo: process.env.LLM_MODEL || defaults.model,
    };
  });
}
