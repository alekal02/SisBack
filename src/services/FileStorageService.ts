import * as Minio from 'minio';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';

const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');

function normalizarObjectPath(objectPath: string): string {
  const pathNorm = String(objectPath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/');
  if (!pathNorm || pathNorm.includes('..')) throw new Error('Caminho de arquivo inválido');
  return pathNorm;
}

function caminhoLocalSeguro(objectPath: string): string {
  const rel = normalizarObjectPath(objectPath);
  const abs = path.resolve(UPLOADS_DIR, rel);
  const relativo = path.relative(UPLOADS_DIR, abs);
  if (relativo.startsWith('..') || path.isAbsolute(relativo)) {
    throw new Error('Caminho de arquivo inválido');
  }
  return abs;
}

/**
 * Armazena arquivos no MinIO/S3 quando MINIO_ENDPOINT existe.
 * Sem endpoint, grava em disco local (pasta uploads), com aviso no log.
 */
class FileStorageService {
  private client: Minio.Client | null = null;
  private bucket: string;
  private publicUrl: string;
  private local: boolean;
  private region: string;

  constructor() {
    const endPoint = String(process.env.MINIO_ENDPOINT || '').trim();
    this.region = process.env.MINIO_REGION || 'us-east-1';
    this.bucket = process.env.MINIO_BUCKET || 'abastecimentos';

    if (!endPoint) {
      this.local = true;
      this.publicUrl = '';
      fsSync.mkdirSync(UPLOADS_DIR, { recursive: true });
      console.warn(
        '[FileStorage] MINIO_ENDPOINT ausente. Arquivos vão para a pasta local uploads/. '
        + 'Nesse modo o disco some a cada deploy.',
      );
      return;
    }

    this.local = false;
    const port = parseInt(process.env.MINIO_PORT || '9000', 10);
    const useSSL = process.env.MINIO_USE_SSL === 'true';
    const accessKey = process.env.MINIO_ACCESS_KEY || '';
    const secretKey = process.env.MINIO_SECRET_KEY || '';
    this.publicUrl = process.env.MINIO_PUBLIC_URL || `${useSSL ? 'https' : 'http'}://${endPoint}:${port}`;

    this.client = new Minio.Client({
      endPoint,
      port,
      useSSL,
      accessKey,
      secretKey,
      region: this.region,
    });

    void this.inicializarBucket();
  }

  private async inicializarBucket(): Promise<void> {
    if (!this.client) return;
    try {
      const existe = await this.client.bucketExists(this.bucket);
      if (!existe) {
        await this.client.makeBucket(this.bucket, this.region);
        console.log(`[MinIO] Bucket "${this.bucket}" criado.`);
      }
      const politica = JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { AWS: ['*'] },
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${this.bucket}/*`],
          },
        ],
      });
      await this.client.setBucketPolicy(this.bucket, politica);
      console.log(`[MinIO] Política pública aplicada ao bucket "${this.bucket}".`);
    } catch (error) {
      console.warn('[MinIO] Erro ao inicializar bucket (pode já existir):', error);
    }
  }

  private urlPublicaLocal(objectPath: string): string {
    const base = String(process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || '')
      .trim()
      .replace(/\/$/, '');
    const rel = `/uploads/${objectPath}`;
    return base ? `${base}${rel}` : rel;
  }

  private async gravarLocal(objectPath: string, buffer: Buffer): Promise<string> {
    const abs = caminhoLocalSeguro(objectPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, buffer);
    return this.urlPublicaLocal(objectPath);
  }

  private caminhoDeUrlLocal(url: string): string | null {
    if (url.startsWith('local://uploads/')) {
      return caminhoLocalSeguro(url.slice('local://uploads/'.length));
    }
    try {
      const urlObj = new URL(url, 'http://localhost');
      if (!urlObj.pathname.startsWith('/uploads/')) return null;
      return caminhoLocalSeguro(decodeURIComponent(urlObj.pathname.slice('/uploads/'.length)));
    } catch {
      return null;
    }
  }

  async uploadImagem(imagemBase64: string): Promise<string> {
    const base64Data = imagemBase64.includes(',')
      ? imagemBase64.split(',')[1]
      : imagemBase64;

    let mimeType = 'image/jpeg';
    if (imagemBase64.startsWith('data:image/png')) {
      mimeType = 'image/png';
    } else if (imagemBase64.startsWith('data:image/webp')) {
      mimeType = 'image/webp';
    } else if (imagemBase64.startsWith('data:image/gif')) {
      mimeType = 'image/gif';
    }

    const ext = mimeType.split('/')[1] || 'jpg';
    const filename = `abastecimentos/${uuidv4()}.${ext}`;
    const buffer = Buffer.from(base64Data, 'base64');

    if (this.local) return this.gravarLocal(filename, buffer);

    await this.client!.putObject(this.bucket, filename, buffer, buffer.length, {
      'Content-Type': mimeType,
    });
    return `${this.publicUrl}/${this.bucket}/${filename}`;
  }

  async uploadArquivo(buffer: Buffer, nomeOriginal: string, mimeType: string): Promise<string> {
    const ext = path.extname(nomeOriginal) || '.bin';
    const filename = `planilhas/${uuidv4()}${ext}`;
    return this.uploadEmPath(filename, buffer, mimeType, nomeOriginal);
  }

  async uploadEmPath(
    objectPath: string,
    buffer: Buffer,
    mimeType: string,
    nomeDownload?: string,
  ): Promise<string> {
    const pathNorm = normalizarObjectPath(objectPath);
    if (this.local) return this.gravarLocal(pathNorm, buffer);

    await this.client!.putObject(this.bucket, pathNorm, buffer, buffer.length, {
      'Content-Type': mimeType,
      'Content-Disposition': `attachment; filename="${nomeDownload || path.basename(pathNorm)}"`,
    });

    return `${this.publicUrl}/${this.bucket}/${pathNorm}`;
  }

  private extrairObjectPath(url: string): { bucket: string; objectPath: string } | null {
    try {
      const urlObj = new URL(url);
      const parts = urlObj.pathname.split('/').filter(Boolean);
      if (parts.length < 2) return null;
      const bucket = parts[0];
      const objectPath = parts.slice(1).join('/');
      if (!bucket || !objectPath) return null;
      return { bucket, objectPath };
    } catch {
      return null;
    }
  }

  async downloadArquivo(url: string): Promise<Buffer> {
    const local = this.caminhoDeUrlLocal(url);
    if (local) return fs.readFile(local);
    if (this.local || !this.client) {
      throw new Error('URL de download inválida');
    }

    const parsed = this.extrairObjectPath(url);
    if (!parsed) {
      throw new Error('URL de download inválida');
    }
    const bucket = parsed.bucket === this.bucket ? this.bucket : parsed.bucket;
    const stream = await this.client.getObject(bucket, parsed.objectPath);
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      stream.on('end', () => resolve());
      stream.on('error', reject);
    });
    return Buffer.concat(chunks);
  }

  async removerImagem(url: string): Promise<void> {
    try {
      const local = this.caminhoDeUrlLocal(url);
      if (local) {
        await fs.unlink(local).catch(() => undefined);
        return;
      }
      if (!this.client) return;
      const parsed = this.extrairObjectPath(url);
      if (parsed && parsed.bucket === this.bucket && parsed.objectPath) {
        await this.client.removeObject(this.bucket, parsed.objectPath);
      }
    } catch (error) {
      console.warn('[FileStorageService] Erro ao remover imagem:', error);
    }
  }
}

let instancia: FileStorageService | null = null;

function obterFileStorage(): FileStorageService {
  if (!instancia) instancia = new FileStorageService();
  return instancia;
}

/** Não abre o armazenamento na importação do módulo — a suíte de testes consegue encerrar sozinha. */
const fileStorageService: FileStorageService = new Proxy({} as FileStorageService, {
  get(_alvo, propriedade) {
    const servico = obterFileStorage();
    const valor = Reflect.get(servico, propriedade, servico);
    return typeof valor === 'function' ? valor.bind(servico) : valor;
  },
});

export default fileStorageService;
