/* ============================================
   DashboardCacheManager — Cache do Dashboard Executivo
   Memória + disco (uploads/dashboard-cache) para máquinas fracas.
   TTL padrão: 24h (atualizado 1x/dia ou após upload).
   ============================================ */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getCurrentTenantDb } from '../database/data-source';

const CACHE_DURACAO = parseInt(
  process.env.DASHBOARD_EXECUTIVO_CACHE_TTL_MS || String(24 * 60 * 60 * 1000),
  10,
);
const INTERVALO_LIMPEZA = 5 * 60 * 1000;
const CACHE_DIR = process.env.DASHBOARD_CACHE_DIR
  || path.join(process.cwd(), 'uploads', 'dashboard-cache');
const PERSISTIR_DISCO = process.env.DASHBOARD_CACHE_DISCO !== 'false';

export interface ExecutivoCacheParams {
  periodo: string;
  dataInicio?: string;
  dataFim?: string;
  contractId?: string;
  servicoId?: string;
  mesReferencia?: number;
  anoReferencia?: number;
  /** Banco em uso: separa o cache de contratos diferentes no modo multi-banco. */
  escopo?: string;
}

interface CacheEntry {
  dados: unknown;
  timestamp: number;
}

export interface ExecutivoCacheInfo {
  hit: boolean;
  idadeSegundos: number;
  validoAte: string;
  origem: 'memoria' | 'disco' | 'miss';
}

class DashboardCacheManager {
  private cache = new Map<string, CacheEntry>();
  private timerId: ReturnType<typeof setInterval> | null = null;
  private carregouDisco = false;

  constructor() {
    const suite = process.execArgv.includes('--test') || process.argv.includes('--test');
    if (suite) return;
    this.garantirDir();
    this.carregarDisco();
    this.iniciarLimpezaPeriodica();
  }

  private garantirDir(): void {
    if (!PERSISTIR_DISCO) return;
    try {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    } catch {
      /* ignore */
    }
  }

  gerarChave(params: ExecutivoCacheParams): string {
    return JSON.stringify({
      periodo: params.periodo,
      dataInicio: params.dataInicio || null,
      dataFim: params.dataFim || null,
      contractId: params.contractId || null,
      servicoId: params.servicoId || null,
      mesReferencia: params.mesReferencia ?? null,
      anoReferencia: params.anoReferencia ?? null,
      escopo: params.escopo || getCurrentTenantDb() || 'banco-unico',
    });
  }

  private hashArquivo(chave: string): string {
    return crypto.createHash('sha256').update(chave).digest('hex');
  }

  private caminhoArquivo(chave: string): string {
    return path.join(CACHE_DIR, `${this.hashArquivo(chave)}.json`);
  }

  private carregarDisco(): void {
    if (!PERSISTIR_DISCO || this.carregouDisco) return;
    this.carregouDisco = true;
    try {
      if (!fs.existsSync(CACHE_DIR)) return;
      const arquivos = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.json'));
      const agora = Date.now();
      for (const arquivo of arquivos) {
        try {
          const raw = fs.readFileSync(path.join(CACHE_DIR, arquivo), 'utf8');
          const parsed = JSON.parse(raw) as { chave: string; timestamp: number; dados: unknown };
          if (!parsed.chave || !parsed.timestamp) continue;
          if (agora - parsed.timestamp >= CACHE_DURACAO) {
            fs.unlinkSync(path.join(CACHE_DIR, arquivo));
            continue;
          }
          this.cache.set(parsed.chave, { dados: parsed.dados, timestamp: parsed.timestamp });
        } catch {
          /* arquivo corrompido */
        }
      }
      if (arquivos.length > 0) {
        console.log(`[DashboardCache] ${this.cache.size} entrada(s) carregada(s) do disco`);
      }
    } catch (err) {
      console.warn('[DashboardCache] Falha ao carregar disco:', (err as Error)?.message);
    }
  }

  private persistirDisco(chave: string, entry: CacheEntry): void {
    if (!PERSISTIR_DISCO) return;
    try {
      this.garantirDir();
      const payload = JSON.stringify({ chave, timestamp: entry.timestamp, dados: entry.dados });
      fs.writeFileSync(this.caminhoArquivo(chave), payload, 'utf8');
    } catch (err) {
      console.warn('[DashboardCache] Falha ao gravar disco:', (err as Error)?.message);
    }
  }

  obter(params: ExecutivoCacheParams): unknown | null {
    const chave = this.gerarChave(params);
    const entry = this.cache.get(chave);
    if (!entry) return null;

    if (Date.now() - entry.timestamp >= CACHE_DURACAO) {
      this.cache.delete(chave);
      this.removerArquivo(chave);
      return null;
    }

    return entry.dados;
  }

  info(params: ExecutivoCacheParams): ExecutivoCacheInfo {
    const chave = this.gerarChave(params);
    const entry = this.cache.get(chave);
    if (!entry || Date.now() - entry.timestamp >= CACHE_DURACAO) {
      return { hit: false, idadeSegundos: 0, validoAte: '', origem: 'miss' };
    }
    const idadeSegundos = Math.floor((Date.now() - entry.timestamp) / 1000);
    return {
      hit: true,
      idadeSegundos,
      validoAte: new Date(entry.timestamp + CACHE_DURACAO).toISOString(),
      origem: 'memoria',
    };
  }

  armazenar(params: ExecutivoCacheParams, dados: unknown): void {
    const chave = this.gerarChave(params);
    const entry: CacheEntry = { dados, timestamp: Date.now() };
    this.cache.set(chave, entry);
    this.persistirDisco(chave, entry);
  }

  idade(params: ExecutivoCacheParams): number | null {
    const info = this.info(params);
    return info.hit ? info.idadeSegundos : null;
  }

  invalidar(prefixo?: string): void {
    if (!prefixo) {
      this.cache.clear();
      if (PERSISTIR_DISCO && fs.existsSync(CACHE_DIR)) {
        for (const f of fs.readdirSync(CACHE_DIR)) {
          if (f.endsWith('.json')) {
            try { fs.unlinkSync(path.join(CACHE_DIR, f)); } catch { /* ignore */ }
          }
        }
      }
      return;
    }

    for (const k of [...this.cache.keys()]) {
      if (k.includes(prefixo)) {
        this.cache.delete(k);
        this.removerArquivo(k);
      }
    }
  }

  private removerArquivo(chave: string): void {
    if (!PERSISTIR_DISCO) return;
    try {
      const p = this.caminhoArquivo(chave);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch { /* ignore */ }
  }

  private iniciarLimpezaPeriodica(): void {
    if (this.timerId) clearInterval(this.timerId);
    this.timerId = setInterval(() => {
      const agora = Date.now();
      for (const [chave, entry] of this.cache.entries()) {
        if (agora - entry.timestamp >= CACHE_DURACAO) {
          this.cache.delete(chave);
          this.removerArquivo(chave);
        }
      }
    }, INTERVALO_LIMPEZA);
    this.timerId.unref?.();
  }

  get duracaoMs(): number {
    return CACHE_DURACAO;
  }

  estatisticas(): { memoria: number; disco: number } {
    let disco = 0;
    if (PERSISTIR_DISCO && fs.existsSync(CACHE_DIR)) {
      disco = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.json')).length;
    }
    return { memoria: this.cache.size, disco };
  }

  destruir(): void {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    this.cache.clear();
  }
}

export const dashboardCache = new DashboardCacheManager();
