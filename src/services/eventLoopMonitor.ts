import { monitorEventLoopDelay } from 'perf_hooks';

const LIMITE_AVISO_MS = 500;
const INTERVALO_MS = 30_000;

/** Texto do aviso. Null enquanto o atraso máximo da janela cabe no limite. */
export function avisoAtrasoEventLoop(maxMs: number, limiteMs = LIMITE_AVISO_MS): string | null {
  if (!Number.isFinite(maxMs) || maxMs <= limiteMs) return null;
  return `[EventLoop] atraso máximo ${Math.round(maxMs)} ms`;
}

/** Mede o event loop e, a cada 30 s, avisa se a janela passou de 500 ms. */
export function iniciarMonitorEventLoop(): void {
  const hist = monitorEventLoopDelay({ resolution: 20 });
  hist.enable();
  const timer = setInterval(() => {
    const maxMs = hist.max / 1e6;
    const aviso = avisoAtrasoEventLoop(maxMs);
    if (aviso) {
      const p99Ms = Math.round(hist.percentile(99) / 1e6);
      console.warn(`${aviso} (p99 ${p99Ms} ms)`);
    }
    hist.reset();
  }, INTERVALO_MS);
  timer.unref?.();
}
