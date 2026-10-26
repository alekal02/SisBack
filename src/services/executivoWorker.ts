import 'reflect-metadata';
import { parentPort } from 'worker_threads';
import AppDataSource from '../database/data-source';
import { DashboardExecutivoController } from '../controllers/DashboardExecutivoController';
import { gravarExecutivoCache } from './executivoCacheTabela';
import { limparBlocos, rankingBlocos } from './executivoBlocos';
import { totalEsquemasColuna } from './FormulaEngine';

interface MensagemExecutivo {
  id: number;
  tipo: 'executivo';
  consulta: Record<string, string | undefined>;
  contratoId?: string;
  ciclo: string;
  iniciadoEm: string;
}

interface MensagemPdf {
  id: number;
  tipo: 'pdf';
  corpo: Record<string, unknown>;
}

let bancoPronto: Promise<void> | null = null;
let controller: DashboardExecutivoController | null = null;

function prepararBanco(): Promise<void> {
  if (!bancoPronto) {
    bancoPronto = (async () => {
      if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    })().catch((err) => {
      bancoPronto = null;
      throw err;
    });
  }
  return bancoPronto;
}

function ctrl(): DashboardExecutivoController {
  if (!controller) controller = new DashboardExecutivoController();
  return controller;
}

async function calcular(msg: MensagemExecutivo): Promise<Record<string, unknown>> {
  limparBlocos();
  const inicio = Date.now();
  const payload = await new Promise<Record<string, unknown>>((resolve, reject) => {
    let status = 200;
    const fakeRes = {
      status(code: number) {
        status = code;
        return this;
      },
      json(data: Record<string, unknown>) {
        if (status >= 400) {
          reject(new Error(String(data?.detalhe || data?.error || `status ${status}`)));
          return;
        }
        resolve(data);
      },
    };
    void ctrl().executivo(
      { __executivoInterno: true, query: { ...msg.consulta, refresh: '1' } } as never,
      fakeRes as never,
    ).catch(reject);
  });
  if (msg.contratoId) {
    try {
      await gravarExecutivoCache(msg.contratoId, msg.ciclo, payload, new Date(msg.iniciadoEm));
    } catch (err) {
      console.warn('[ExecutivoCache] Falha ao gravar:', (err as Error)?.message || err);
    }
  }
  console.log(`[ExecutivoWorker] cálculo ${msg.ciclo} em ${Date.now() - inicio} ms`);
  console.log(`[ExecutivoBlocos] ${JSON.stringify(rankingBlocos())}`);
  console.log(`[ExecutivoEsquemas] ${totalEsquemasColuna()}`);
  return payload;
}

async function pdf(msg: MensagemPdf): Promise<{ filename: string; buffer: Buffer }> {
  const inicio = Date.now();
  let filename = 'relatorio_executivo.pdf';
  const buffer = await new Promise<Buffer>((resolve, reject) => {
    let status = 200;
    const fakeRes = {
      status(code: number) {
        status = code;
        return this;
      },
      setHeader(name: string, value: string) {
        if (String(name).toLowerCase() === 'content-disposition') {
          const achado = /filename="?([^";]+)"?/i.exec(String(value));
          if (achado) filename = achado[1];
        }
        return this;
      },
      send(body: Buffer | Uint8Array) {
        resolve(Buffer.from(body));
      },
      json(data: { error?: string; detalhe?: string }) {
        reject(new Error(data?.detalhe || data?.error || `PDF status ${status}`));
      },
    };
    void ctrl().gerarPdf(
      { __executivoInterno: true, body: msg.corpo } as never,
      fakeRes as never,
    ).catch(reject);
  });
  console.log(`[ExecutivoWorker] PDF em ${Date.now() - inicio} ms`);
  return { filename, buffer };
}

parentPort?.on('message', (msg: MensagemExecutivo | MensagemPdf) => {
  console.log(`[ExecutivoWorker] recebeu ${msg.tipo}`);
  void (async () => {
    try {
      await prepararBanco();
      if (msg.tipo === 'pdf') {
        const gerado = await pdf(msg);
        const pdfBytes = new Uint8Array(gerado.buffer);
        parentPort?.postMessage(
          { id: msg.id, ok: true, filename: gerado.filename, pdf: pdfBytes },
          [pdfBytes.buffer],
        );
        return;
      }
      const body = await calcular(msg);
      parentPort?.postMessage({ id: msg.id, ok: true, body });
    } catch (err) {
      parentPort?.postMessage({
        id: msg.id,
        ok: false,
        erro: (err as Error)?.message || String(err),
      });
    }
  })();
});
