/**
 * Utilitários compartilhados entre os providers de LLM.
 * Funções de normalização de imagem e extração de dados do texto retornado.
 */
import { ExtracaoResultado } from './types';

/**
 * Normaliza uma string base64: extrai o mediaType do prefixo Data URL
 * e retorna apenas o Base64 puro junto com o tipo MIME.
 *
 * @param base64 - String base64 crua ou com prefixo data:image/...;base64,
 * @returns Objeto com base64 puro e mediaType (ex: "image/jpeg")
 */
export function normalizarBase64(base64: string): {
  base64: string;
  mediaType: string;
} {
  // Extrai o mediaType do prefixo Data URL se existir
  let mediaType = 'image/jpeg'; // default
  const mediaMatch = base64.match(/^data:(image\/[a-zA-Z+]+);base64,(.*)/);
  
  if (mediaMatch) {
    mediaType = mediaMatch[1];
    return {
      base64: mediaMatch[2].replace(/\s/g, ''),
      mediaType,
    };
  }

  // Se não tem prefixo, retorna base64 puro com mediaType padrão
  return {
    base64: base64.replace(/\s/g, ''),
    mediaType,
  };
}

/**
 * Tenta extrair litragem e valor de um texto JSON retornado pelo LLM.
 * O JSON pode vir solto na resposta ou dentro de ```json ... ```.
 * Retorna ExtracaoResultado com os valores encontrados ou nulls.
 *
 * @param texto - Texto de resposta do LLM
 * @param nomeProvider - Nome do provider (para contexto). Opcional.
 */
export function extrairDadosDoTexto(
  texto: string,
  nomeProvider?: string
): ExtracaoResultado {
  try {
    // Tenta extrair bloco JSON com markdown ```json ... ```
    let jsonStr = texto;
    const jsonMatch = texto.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    // Tenta encontrar o primeiro { ... } válido no texto
    const objetoMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (objetoMatch) {
      jsonStr = objetoMatch[0];
    }

    const parsed = JSON.parse(jsonStr);

    const litragem = typeof parsed.litragem === 'number'
      ? parsed.litragem
      : typeof parsed.litragem === 'string'
        ? parseFloat(parsed.litragem.replace(',', '.'))
        : null;

    const valor = typeof parsed.valor === 'number'
      ? parsed.valor
      : typeof parsed.valor === 'string'
        ? parseFloat(
            parsed.valor
              .replace('R$', '')
              .replace('$', '')
              .trim()
              .replace(',', '.')
          )
        : null;

    // Calcula confiança com base na presença e validade dos campos
    const camposPresentes = [litragem, valor].filter(v => v !== null && v > 0).length;
    const confianca = camposPresentes >= 2 ? 0.85 : camposPresentes === 1 ? 0.5 : 0;

    return {
      litragem,
      valor,
      confianca,
      textoRaw: texto,
      erroExtracao: undefined,
    };
  } catch {
    // Fallback: busca por padrões numéricos no texto
    const litroMatch = texto.match(/(?:litragem|litros|L)\s*:?\s*([\d.,]+)/i);
    const valorMatch = texto.match(/(?:valor|R?\$|total)\s*:?\s*R?\$?\s*([\d.,]+)/i);

    const litragem = litroMatch
      ? parseFloat(litroMatch[1].replace(',', '.'))
      : null;
    const valor = valorMatch
      ? parseFloat(valorMatch[1].replace(',', '.'))
      : null;

    const confianca = (litragem !== null && valor !== null) ? 0.6 : 0.3;

    return {
      litragem,
      valor,
      confianca,
      textoRaw: texto,
      erroExtracao: undefined,
    };
  }
}

/**
 * Converte o resultado extraído para o formato ExtracaoResultado,
 * incluindo o texto raw e informações de erro.
 * Útil quando a extração foi feita manualmente (fora de extrairDadosDoTexto).
 */
export function montarResultado(
  textoRaw: string,
  extraido: { litragem: number | null; valor: number | null; confianca: number },
  erro?: string
): ExtracaoResultado {
  return {
    litragem: extraido.litragem,
    valor: extraido.valor,
    confianca: extraido.confianca,
    textoRaw,
    erroExtracao: erro || undefined,
  };
}
