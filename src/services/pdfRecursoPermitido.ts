const CDN_PERMITIDO = new Set(['cdn.jsdelivr.net']);

/** Recurso que o Chromium do PDF pode carregar. O resto (arquivo local, rede interna, metadados) é bloqueado. */
export function urlPermitidaNoPdf(raw: string): boolean {
  const texto = String(raw || '').trim();
  if (!texto) return false;
  if (texto === 'about:blank' || texto.startsWith('about:') || texto.startsWith('data:') || texto.startsWith('blob:')) {
    return true;
  }

  let parsed: URL;
  try {
    parsed = new URL(texto);
  } catch {
    return false;
  }

  if (parsed.username || parsed.password) return false;
  if (parsed.protocol === 'https:' && CDN_PERMITIDO.has(parsed.hostname)) return true;
  return false;
}

/** Recusa HTML que pede arquivo local ou URL ativa antes mesmo de abrir o navegador. */
export function htmlPdfBloqueado(html: string): string | null {
  if (html.length > 8_000_000) return 'HTML excede o limite permitido para PDF';
  if (/file\s*:/i.test(html)) return 'HTML com acesso a arquivo local não é permitido';
  if (/javascript\s*:/i.test(html)) return 'HTML com URL javascript: não é permitido';
  if (/vbscript\s*:/i.test(html)) return 'HTML com URL vbscript: não é permitido';
  return null;
}
