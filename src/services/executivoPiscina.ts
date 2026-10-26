import { Worker } from 'worker_threads';
import path from 'path';
import fs from 'fs';

export interface PedidoExecutivo {
  tipo: 'executivo';
  consulta: Record<string, string | undefined>;
  contratoId?: string;
  ciclo: string;
  iniciadoEm: string;
}

export interface PedidoPdf {
  tipo: 'pdf';
  corpo: Record<string, unknown>;
}

export interface ResultadoPdf {
  buffer: Buffer;
  filename: string;
}

interface Job {
  id: number;
  pedido: PedidoExecutivo | PedidoPdf;
  resolve: (valor: unknown) => void;
  reject: (erro: Error) => void;
  encerrado: boolean;
}

let worker: Worker | null = null;
let sequencia = 0;
const fila: Job[] = [];
const emCurso = new Map<number, Job>();
let ocupado = false;

function caminhoWorker(): string {
  const ts = path.join(__dirname, 'executivoWorker.ts');
  if (path.extname(__filename) === '.ts' && fs.existsSync(ts)) return ts;
  return path.join(__dirname, 'executivoWorker.js');
}

function rejeitarTodos(erro: Error): void {
  ocupado = false;
  for (const job of emCurso.values()) {
    if (!job.encerrado) {
      job.encerrado = true;
      job.reject(erro);
    }
  }
  emCurso.clear();
  while (fila.length) {
    const job = fila.shift()!;
    job.encerrado = true;
    job.reject(erro);
  }
  worker = null;
}

function garantirWorker(): Worker {
  if (worker) return worker;
  const envWorker: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(process.env)) {
    if (typeof valor === 'string') envWorker[chave] = valor;
  }
  envWorker.DB_POOL_MAX = '6';
  worker = new Worker(caminhoWorker(), {
    execArgv: process.execArgv.filter((arg) => arg !== '--test'),
    env: envWorker,
    stdout: true,
    stderr: true,
    resourceLimits: { maxOldGenerationSizeMb: 460 },
  });
  worker.stdout?.on('data', (chunk: Buffer) => process.stdout.write(chunk));
  worker.stderr?.on('data', (chunk: Buffer) => process.stderr.write(chunk));
  worker.on('message', (msg: { id: number; ok: boolean; body?: unknown; pdf?: Uint8Array; filename?: string; erro?: string }) => {
    const job = emCurso.get(msg.id);
    emCurso.delete(msg.id);
    ocupado = false;
    if (job && !job.encerrado) {
      job.encerrado = true;
      if (!msg.ok) job.reject(new Error(msg.erro || 'Falha no worker do executivo'));
      else if (job.pedido.tipo === 'pdf') {
        job.resolve({
          buffer: Buffer.from(msg.pdf || new Uint8Array()),
          filename: msg.filename || 'relatorio_executivo.pdf',
        });
      } else job.resolve(msg.body);
    }
    bombear();
  });
  worker.on('error', (err: unknown) => {
    const erro = err instanceof Error ? err : new Error(String(err));
    console.error('[ExecutivoWorker] erro:', erro.message);
    rejeitarTodos(erro);
  });
  worker.on('exit', (code) => {
    if (code !== 0) {
      rejeitarTodos(new Error(`[ExecutivoWorker] encerrou com código ${code}`));
    } else {
      worker = null;
    }
  });
  return worker;
}

function bombear(): void {
  if (ocupado || fila.length === 0) return;
  const job = fila.shift()!;
  ocupado = true;
  emCurso.set(job.id, job);
  const mensagem = job.pedido.tipo === 'pdf'
    ? { id: job.id, tipo: 'pdf', corpo: job.pedido.corpo }
    : {
      id: job.id,
      tipo: 'executivo',
      consulta: job.pedido.consulta,
      contratoId: job.pedido.contratoId,
      ciclo: job.pedido.ciclo,
      iniciadoEm: job.pedido.iniciadoEm,
    };
  garantirWorker().postMessage(mensagem);
}

function enfileirar(pedido: PedidoExecutivo | PedidoPdf): Promise<unknown> {
  garantirWorker();
  const id = ++sequencia;
  return new Promise((resolve, reject) => {
    const job: Job = {
      id,
      pedido,
      encerrado: false,
      resolve: (valor) => {
        clearTimeout(timer);
        resolve(valor);
      },
      reject: (erro) => {
        clearTimeout(timer);
        reject(erro);
      },
    };
    const timer = setTimeout(() => {
      if (job.encerrado) return;
      job.encerrado = true;
      reject(new Error('cálculo do executivo excedeu 3 minutos'));
    }, 300_000);
    fila.push(job);
    bombear();
  });
}

/** O cálculo roda no único worker. O processo principal só espera a mensagem. */
export function calcularNoWorker(pedido: Omit<PedidoExecutivo, 'tipo'>): Promise<Record<string, unknown>> {
  return enfileirar({ tipo: 'executivo', ...pedido }) as Promise<Record<string, unknown>>;
}

export function gerarPdfNoWorker(corpo: Record<string, unknown>): Promise<ResultadoPdf> {
  return enfileirar({ tipo: 'pdf', corpo }) as Promise<ResultadoPdf>;
}
