import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { NextFunction, Request, Response } from 'express';

/** Corpo do webhook acima disso vai para disco. O JSON de 64 MB recusava planilha de ~48 MB. */
export const WEBHOOK_CORPO_MAX_BYTES = 200 * 1024 * 1024;
const WEBHOOK_CORPO_DIRETO_BYTES = 1024 * 1024;
const MARCA = '"base64"';

export function diretorioInboxWhatsapp(): string {
  if (process.env.WHATSAPP_INBOX_DIR) return process.env.WHATSAPP_INBOX_DIR;
  return path.join(process.cwd(), 'whatsapp-inbox');
}

type ExtratorBase64 = {
  push(chunk: Buffer): void;
  finish(): { meta: string; base64Arquivo?: string };
};

/** Tira o valor de "base64" para um arquivo. O restante do JSON fica pequeno o bastante para o parse. */
export function criarExtratorBase64(arquivo: string): ExtratorBase64 {
  let pendente = '';
  let modo: 'busca' | 'ateAspas' | 'valor' = 'busca';
  let escape = false;
  const meta: string[] = [];
  let fd: number | null = null;
  let gravou = false;

  const escrever = (texto: string) => {
    if (!texto) return;
    if (fd === null) fd = fs.openSync(arquivo, 'w');
    fs.writeSync(fd, texto);
    gravou = true;
  };

  const consumir = () => {
    while (pendente.length > 0) {
      if (modo === 'busca') {
        const idx = pendente.indexOf(MARCA);
        if (idx === -1) {
          const guarda = MARCA.length - 1;
          if (pendente.length <= guarda) return;
          meta.push(pendente.slice(0, pendente.length - guarda));
          pendente = pendente.slice(pendente.length - guarda);
          return;
        }
        const depois = pendente.slice(idx + MARCA.length);
        if (!/^\s*:/.test(depois)) {
          if (depois.length < 8) return;
          meta.push(pendente.slice(0, idx + 1));
          pendente = pendente.slice(idx + 1);
          continue;
        }
        meta.push(pendente.slice(0, idx + MARCA.length));
        pendente = depois;
        modo = 'ateAspas';
        continue;
      }

      if (modo === 'ateAspas') {
        const aspas = pendente.indexOf('"');
        if (aspas === -1) {
          meta.push(pendente);
          pendente = '';
          return;
        }
        meta.push(pendente.slice(0, aspas + 1));
        pendente = pendente.slice(aspas + 1);
        modo = 'valor';
        escape = false;
        continue;
      }

      let i = 0;
      while (i < pendente.length) {
        const ch = pendente[i];
        if (escape) {
          escape = false;
          i += 1;
          continue;
        }
        if (ch === '\\') {
          escape = true;
          i += 1;
          continue;
        }
        if (ch === '"') {
          escrever(pendente.slice(0, i));
          meta.push('"');
          pendente = pendente.slice(i + 1);
          modo = 'busca';
          escape = false;
          break;
        }
        i += 1;
      }
      if (modo === 'valor') {
        escrever(pendente);
        pendente = '';
        return;
      }
    }
  };

  return {
    push(chunk: Buffer) {
      pendente += chunk.toString('utf8');
      consumir();
    },
    finish() {
      if (pendente && modo !== 'valor') meta.push(pendente);
      if (pendente && modo === 'valor') escrever(pendente);
      if (fd !== null) fs.closeSync(fd);
      return { meta: meta.join(''), base64Arquivo: gravou ? arquivo : undefined };
    },
  };
}

type RequisicaoWebhook = Request & { rawBody?: Buffer; hmacSha256?: string };

/**
 * Planilha grande não passa pelo express.json (isso estourava ~48 MB e ainda segurava o arquivo na RAM).
 * O corpo é lido em pedaços; o base64 vai para disco.
 */
export function receberCorpoWebhook(req: Request, res: Response, next: NextFunction): void {
  const declarado = Number(req.headers['content-length'] || 0);
  if (Number.isFinite(declarado) && declarado > WEBHOOK_CORPO_MAX_BYTES) {
    res.status(413).json({
      sucesso: false,
      erro: 'Planilha grande demais para receber de uma vez. Divida o arquivo ou envie de novo.',
    });
    req.resume();
    return;
  }

  const chave = (
    process.env.WUZAPI_WEBHOOK_HMAC_KEY
    || process.env.WUZAPI_GLOBAL_HMAC_KEY
    || ''
  ).trim();
  const hmac = chave ? crypto.createHmac('sha256', chave) : null;
  const pedacos: Buffer[] = [];
  let total = 0;
  let extrator: ExtratorBase64 | null = null;
  let recusado = false;
  const arquivo = path.join(diretorioInboxWhatsapp(), `wh-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.b64`);

  req.on('data', (chunk: Buffer) => {
    if (recusado) return;
    total += chunk.length;
    hmac?.update(chunk);
    if (total > WEBHOOK_CORPO_MAX_BYTES) {
      recusado = true;
      res.status(413).json({
        sucesso: false,
        erro: 'Planilha grande demais para receber de uma vez. Divida o arquivo ou envie de novo.',
      });
      req.destroy();
      return;
    }
    if (!extrator && total > WEBHOOK_CORPO_DIRETO_BYTES) {
      fs.mkdirSync(diretorioInboxWhatsapp(), { recursive: true });
      extrator = criarExtratorBase64(arquivo);
      for (const anterior of pedacos) extrator.push(anterior);
      pedacos.length = 0;
    }
    if (extrator) extrator.push(chunk);
    else pedacos.push(chunk);
  });

  req.on('error', (err) => {
    if (!res.headersSent) next(err);
  });

  req.on('end', () => {
    if (recusado || res.headersSent) return;
    try {
      const alvo = req as RequisicaoWebhook;
      alvo.hmacSha256 = hmac ? hmac.digest('hex') : undefined;
      if (!extrator) {
        const bruto = Buffer.concat(pedacos);
        alvo.rawBody = bruto;
        const texto = bruto.toString('utf8').trim();
        req.body = texto ? JSON.parse(texto) : {};
      } else {
        const extraido = extrator.finish();
        const texto = extraido.meta.trim();
        const body = (texto ? JSON.parse(texto) : {}) as { base64?: string; base64Arquivo?: string };
        if (typeof body.base64 === 'string') delete body.base64;
        if (extraido.base64Arquivo) body.base64Arquivo = extraido.base64Arquivo;
        req.body = body;
      }
      next();
    } catch (err) {
      next(err);
    }
  });
}
