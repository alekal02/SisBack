/**
 * Interface base para todos os providers de LLM.
 * Cada provider deve implementar a extração de dados de imagem
 * de bombas de abastecimento usando seu formato de API específico.
 */
import { ExtracaoResultado } from './types';

export interface LLMProvider {
  /** Nome identificador do provider (ex: "openai", "lmstudio") */
  readonly nome: string;

  /**
   * Extrai litragem e valor de uma imagem de bomba de abastecimento.
   * @param base64Data URL Data URI ou base64 bruto da imagem
   * @returns Dados extraídos da imagem
   */
  extrairDadosImagem(base64Data: string): Promise<ExtracaoResultado>;
}
