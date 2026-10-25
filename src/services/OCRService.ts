import { DadosExtraidosOCR } from '../types/Abastecimento';
import { criarProvider, getProviderNameFromEnv } from './providers/ProviderFactory';
import { ProviderName } from './providers/types';

interface OCRApiResponse {
  litragem: number | null;
  valor: number | null;
  confianca: number;
  texto_raw: string;
  erro_extracao?: string;
}

export class OCRService {
  private limiteConfianca: number = 0.6;
  private readonly pythonApiUrl: string;
  private readonly providerName: ProviderName;
  private readonly usarFallbackPython: boolean;

  constructor() {
    this.pythonApiUrl = process.env.PYTHON_OCR_API_URL || 'http://localhost:8000';
    this.providerName = getProviderNameFromEnv();
    this.usarFallbackPython = process.env.OCR_FALLBACK_PYTHON !== 'false';
  }

  private normalizarImagemEntrada(imagemBase64: string): string {
    if (!imagemBase64) {
      return '';
    }

    const base64 = imagemBase64.includes(',')
      ? imagemBase64.split(',')[1]
      : imagemBase64;

    return base64.trim();
  }

  private async chamarApiPython(imagemBase64: string): Promise<OCRApiResponse> {
    console.log(`[OCRService] Fallback para Python OCR em: ${this.pythonApiUrl}`);
    const response = await fetch(`${this.pythonApiUrl}/ocr`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ imagem: imagemBase64 }),
    });

    if (!response.ok) {
      const detalhe = await response.text().catch(() => '');
      throw new Error(`Falha na API Python (${response.status}): ${detalhe || response.statusText}`);
    }

    return (await response.json()) as OCRApiResponse;
  }

  async extrairDadosImagem(imagemBase64: string): Promise<DadosExtraidosOCR> {
    try {
      const imagemNormalizada = this.normalizarImagemEntrada(imagemBase64);

      if (!imagemNormalizada) {
        throw new Error('Imagem vazia ou inválida após normalização');
      }

      // Tenta extrair via LLM Provider primeiro
      const provider = criarProvider(this.providerName);
      console.log(`[OCRService] Usando provider: ${provider.nome}`);

      const resultado = await provider.extrairDadosImagem(imagemNormalizada);

      // Se o provider retornou erro de extração, tenta fallback
      if ((resultado.erroExtracao || resultado.confianca === 0) && this.usarFallbackPython) {
        console.warn(`[OCRService] Provider ${provider.nome} falhou: ${resultado.erroExtracao}. Tentando fallback Python...`);
        const fallback = await this.chamarApiPython(imagemNormalizada);
        return {
          litragem: fallback.litragem,
          valor: fallback.valor,
          confianca: fallback.confianca ?? 0,
          textoRaw: fallback.texto_raw ?? '',
          erroExtracao: fallback.erro_extracao,
        };
      }

      // Converte ExtracaoResultado para DadosExtraidosOCR
      return {
        litragem: resultado.litragem,
        valor: resultado.valor,
        confianca: resultado.confianca,
        textoRaw: resultado.textoRaw ?? '',
        erroExtracao: resultado.erroExtracao,
      };
    } catch (erro) {
      // Se o provider principal lançou exceção, tenta fallback Python
      if (this.usarFallbackPython) {
        try {
          console.warn(`[OCRService] Exceção no provider principal. Tentando fallback Python...`);
          const imagemNormalizada = this.normalizarImagemEntrada(imagemBase64);
          if (imagemNormalizada) {
            const fallback = await this.chamarApiPython(imagemNormalizada);
            return {
              litragem: fallback.litragem,
              valor: fallback.valor,
              confianca: fallback.confianca ?? 0,
              textoRaw: fallback.texto_raw ?? '',
              erroExtracao: fallback.erro_extracao,
            };
          }
        } catch (fallbackErro) {
          console.error('[OCRService] Fallback Python também falhou:', fallbackErro);
        }
      }

      console.error('[OCRService] Erro ao processar OCR:', erro);
      return {
        litragem: null,
        valor: null,
        confianca: 0,
        textoRaw: '',
        erroExtracao: `Erro ao processar imagem: ${erro instanceof Error ? erro.message : String(erro)}`,
      };
    }
  }

  ehConfiavel(dados: { litragem: number | null; valor: number | null; confianca?: number }, limiteConfianca: number = this.limiteConfianca): boolean {
    return (
      dados.litragem !== null &&
      dados.valor !== null &&
      typeof dados.litragem === 'number' &&
      typeof dados.valor === 'number' &&
      (dados.confianca ?? 0) >= limiteConfianca
    );
  }
}
