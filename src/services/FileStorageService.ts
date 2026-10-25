import * as Minio from 'minio';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import AppDataSource from '../database/data-source';

const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');

const BUCKETS_ANTIGOS = new Set(['abastecimentos']);

/**
 * Ignora host e o nome do bucket antigo. O que resta é o caminho do objeto
 * no bucket configurado agora (MINIO_BUCKET).
 */
export function objectPathDeUrl(url: string, bucketAtual: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  const parts = pathname.split('/').filter(Boolean).map((parte) => {
    try { return decodeURIComponent(parte); } catch { return parte; }
  });
  if (parts.length === 0) return null;
  const primeiro = parts[0];
  const resto = (primeiro === bucketAtual || BUCKETS_ANTIGOS.has(primeiro))
    ? parts.slice(1)
    : parts;
  if (resto.length === 0) return null;
  return normalizarObjectPath(resto.join('/'));
}

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
 * STORAGE_DRIVER=postgres grava em arquivos_storage.
 * Com MINIO_ENDPOINT, usa MinIO/S3. Sem os dois, grava em disco (uploads/).
 * O cache do dashboard não passa por aqui.
 */
class FileStorageService {
  private client: Minio.Client | null = null;
  private bucket: string;
  private publicUrl: string;
  private local: boolean;
  private postgres: boolean;
  private region: string;

  constructor() {
    const driver = String(process.env.STORAGE_DRIVER || '').trim().toLowerCase();
    const endPoint = String(process.env.MINIO_ENDPOINT || '').trim();
    this.region = process.env.MINIO_REGION || 'us-east-1';
    this.bucket = process.env.MINIO_BUCKET || 'abastecimentos';

    if (driver === 'postgres') {
      this.postgres = true;
      this.local = false;
      this.publicUrl = '';
      this.client = null;
      console.log('[FileStorage] STORAGE_DRIVER=postgres. Arquivos vão para a tabela arquivos_storage.');
      return;
    }

    this.postgres = false;

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

  private async gravarPostgres(objectPath: string, buffer: Buffer, mimeType: string): Promise<string> {
    const pathNorm = normalizarObjectPath(objectPath);
    await AppDataSource.query(
      `INSERT INTO arquivos_storage (id, caminho, content_type, tamanho, conteudo)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (caminho) DO UPDATE
         SET content_type = EXCLUDED.content_type,
             tamanho = EXCLUDED.tamanho,
             conteudo = EXCLUDED.conteudo`,
      [uuidv4(), pathNorm, mimeType || 'application/octet-stream', buffer.length, buffer],
    );
    return `db://arquivos/${pathNorm}`;
  }

  private async lerPostgres(objectPath: string): Promise<Buffer> {
    const rows = await AppDataSource.query(
      'SELECT conteudo FROM arquivos_storage WHERE caminho = $1',
      [objectPath],
    );
    const conteudo = rows[0]?.conteudo;
    if (!conteudo) throw new Error('Arquivo não encontrado');
    return Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(conteudo);
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

    if (this.postgres) return this.gravarPostgres(filename, buffer, mimeType);
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
    if (this.postgres) return this.gravarPostgres(pathNorm, buffer, mimeType);
    if (this.local) return this.gravarLocal(pathNorm, buffer);

    await this.client!.putObject(this.bucket, pathNorm, buffer, buffer.length, {
      'Content-Type': mimeType,
      'Content-Disposition': `attachment; filename="${nomeDownload || path.basename(pathNorm)}"`,
    });

    return `${this.publicUrl}/${this.bucket}/${pathNorm}`;
  }

  async downloadArquivo(url: string): Promise<Buffer> {
    const local = this.caminhoDeUrlLocal(url);
    if (local) return fs.readFile(local);
    if (this.postgres) {
      const objectPath = objectPathDeUrl(url, this.bucket);
      if (!objectPath) throw new Error('URL de download inválida');
      return this.lerPostgres(objectPath);
    }
    if (this.local || !this.client) {
      throw new Error('URL de download inválida');
    }

    const objectPath = objectPathDeUrl(url, this.bucket);
    if (!objectPath) {
      throw new Error('URL de download inválida');
    }
    const stream = await this.client.getObject(this.bucket, objectPath);
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
      if (this.postgres) {
        const objectPath = objectPathDeUrl(url, this.bucket);
        if (objectPath) {
          await AppDataSource.query('DELETE FROM arquivos_storage WHERE caminho = $1', [objectPath]);
        }
        return;
      }
      if (!this.client) return;
      const objectPath = objectPathDeUrl(url, this.bucket);
      if (objectPath) {
        await this.client.removeObject(this.bucket, objectPath);
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
