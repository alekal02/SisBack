import puppeteer, { Browser } from 'puppeteer';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { PDF_CACHE_MAX_ENTRADAS } from '../config/limitesRecursos';
import { urlPermitidaNoPdf } from './pdfRecursoPermitido';

let browserInstance: Browser | null = null;
let browserLaunching: Promise<Browser> | null = null;
let chromePathCache: string | null | undefined;

async function resolveChromeExecutable(): Promise<string | undefined> {
  if (chromePathCache !== undefined) {
    return chromePathCache || undefined;
  }

  const candidatos: string[] = [];

  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    candidatos.push(process.env.PUPPETEER_EXECUTABLE_PATH);
  }

  try {
    const bundled = await puppeteer.executablePath();
    if (bundled) candidatos.push(bundled);
  } catch {
    /* puppeteer sem browser baixado */
  }

  if (process.platform === 'win32') {
    candidatos.push(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    );
  } else if (process.platform === 'linux') {
    candidatos.push('/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium');
  } else if (process.platform === 'darwin') {
    candidatos.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    );
  }

  for (const p of candidatos) {
    if (p && fs.existsSync(p)) {
      chromePathCache = p;
      return p;
    }
  }

  chromePathCache = null;
  return undefined;
}

const PDF_CACHE_TTL_MS = 10 * 60 * 1000;
const pdfCache = new Map<string, { buffer: Buffer; timestamp: number }>();

function evictarPdfCache(): void {
  const agora = Date.now();
  for (const [k, v] of pdfCache) {
    if (agora - v.timestamp > PDF_CACHE_TTL_MS) pdfCache.delete(k);
  }
  if (pdfCache.size <= PDF_CACHE_MAX_ENTRADAS) return;
  const ordenado = [...pdfCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
  while (pdfCache.size > PDF_CACHE_MAX_ENTRADAS && ordenado.length > 0) {
    const [k] = ordenado.shift()!;
    pdfCache.delete(k);
  }
}

export interface PdfGenerateOptions {
  margin?: { top: string; bottom: string; left: string; right: string };
  /** Espera extra em ms (ex.: Chart.js no PDF executivo) */
  waitMs?: number;
  useCache?: boolean;
}

async function getBrowser(): Promise<Browser> {
  if (browserInstance?.connected) return browserInstance;

  if (!browserLaunching) {
    browserLaunching = (async () => {
      const executablePath = await resolveChromeExecutable();
      if (!executablePath) {
        throw new Error(
          'Navegador para PDF não encontrado. Instale o Chrome/Edge ou execute: npx puppeteer browsers install chrome'
        );
      }

      return puppeteer.launch({
        headless: true,
        executablePath,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-extensions',
          '--disable-background-networking',
          '--font-render-hinting=none',
          '--renderer-process-limit=1',
          '--disable-features=Translate,BackForwardCache',
        ],
      });
    })()
      .then((browser) => {
        browserInstance = browser;
        browser.on('disconnected', () => {
          browserInstance = null;
        });
        browserLaunching = null;
        return browser;
      })
      .catch((err) => {
        browserLaunching = null;
        throw err;
      });
  }

  return browserLaunching;
}

function cacheKey(html: string, opts?: PdfGenerateOptions): string {
  return crypto
    .createHash('md5')
    .update(html)
    .update(':')
    .update(String(opts?.waitMs || 0))
    .digest('hex');
}

/**
 * Converte HTML em PDF reutilizando instância do Puppeteer (muito mais rápido).
 */
export async function htmlToPdf(html: string, opts?: PdfGenerateOptions): Promise<Buffer> {
  const useCache = opts?.useCache !== false;
  const key = cacheKey(html, opts);

  if (useCache) {
    const cached = pdfCache.get(key);
    if (cached && Date.now() - cached.timestamp < PDF_CACHE_TTL_MS) {
      return cached.buffer;
    }
  }

  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setViewport({ width: 1200, height: 900 });
    await page.setRequestInterception(true);
    page.on('request', (requisicao) => {
      const seguir = urlPermitidaNoPdf(requisicao.url())
        ? requisicao.continue()
        : requisicao.abort();
      seguir.catch(() => undefined);
    });
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 45000 });

    const waitMs = opts?.waitMs ?? 250;
    if (waitMs > 0) {
      await new Promise((r) => setTimeout(r, waitMs));
    }

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: opts?.margin ?? { top: '8mm', bottom: '8mm', left: '8mm', right: '8mm' },
    });

    const buffer = Buffer.from(pdfBuffer);
    if (useCache) {
      pdfCache.set(key, { buffer, timestamp: Date.now() });
      evictarPdfCache();
    }
    return buffer;
  } catch (err) {
    browserInstance = null;
    await browser.close().catch(() => undefined);
    throw err;
  } finally {
    await page.close().catch(() => undefined);
    if (deveFecharNavegadorAposPdf(process.env.NODE_ENV, process.env.PDF_MANTER_NAVEGADOR)) {
      await liberarNavegadorPdf();
    }
  }
}

/** Fecha o Chrome do PDF e devolve memória ao processo. */
export async function liberarNavegadorPdf(): Promise<void> {
  const browser = browserInstance;
  browserInstance = null;
  if (browser) {
    await browser.close().catch(() => undefined);
  }
  const gc = (global as { gc?: () => void }).gc;
  if (typeof gc === 'function') gc();
}

/** Em produção o Chrome do PDF não fica residente. É ele que estourava a memória no relatório. */
export function deveFecharNavegadorAposPdf(nodeEnv?: string, manterNavegador?: string): boolean {
  return manterNavegador !== 'true' && nodeEnv === 'production';
}

export function invalidarCachePdfDashboard(): void {
  pdfCache.clear();
}
