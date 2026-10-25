/* ============================================
   PdfCacheManager — Gerencia cache de PDF executivo
   Centraliza a lógica de cache para evitar dependência circular
   entre ContractController e DashboardExecutivoController
   ============================================ */

const PDF_CACHE_DURACAO = 60 * 60 * 1000; // 1 hora
const pdfCache = new Map<string, { buffer: Buffer; timestamp: number; filename: string }>();

export function getPdfCache(): Map<string, { buffer: Buffer; timestamp: number; filename: string }> {
  return pdfCache;
}

export function getPdfCacheDuracao(): number {
  return PDF_CACHE_DURACAO;
}

export function invalidarPdfCache(chave?: string): void {
  if (chave) {
    pdfCache.delete(chave);
  } else {
    pdfCache.clear();
  }
}
