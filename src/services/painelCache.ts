import AppDataSource from '../database/data-source';

const memoria = new Map<string, unknown>();
let tabelaPronta = false;

export function lerCachePainel<T>(chave: string): T | null {
  if (!memoria.has(chave)) return null;
  return memoria.get(chave) as T;
}

export function gravarCachePainel(chave: string, payload: unknown): void {
  memoria.set(chave, payload);
  void gravarNoBanco(chave, payload);
}

/** Planilha importada ou preço/meta gravado: o ciclo deixa de valer. */
export function invalidarCachePainel(): void {
  memoria.clear();
  void apagarNoBanco();
}

export async function lerCachePainelBanco<T>(chave: string): Promise<T | null> {
  const naMemoria = lerCachePainel<T>(chave);
  if (naMemoria) return naMemoria;
  try {
    if (!AppDataSource.isInitialized) return null;
    const rows = await AppDataSource.query(
      'SELECT payload FROM painel_cache WHERE chave = $1',
      [chave],
    );
    const payload = rows?.[0]?.payload as T | undefined;
    if (!payload) return null;
    memoria.set(chave, payload);
    return payload;
  } catch {
    return null;
  }
}

async function gravarNoBanco(chave: string, payload: unknown): Promise<void> {
  try {
    if (!AppDataSource.isInitialized) return;
    await AppDataSource.query(
      `INSERT INTO painel_cache (chave, payload, calculado_em)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (chave) DO UPDATE SET payload = EXCLUDED.payload, calculado_em = now()`,
      [chave, JSON.stringify(payload)],
    );
    tabelaPronta = true;
  } catch (err) {
    if (tabelaPronta) {
      console.warn('[painel] cache não gravado:', (err as Error)?.message || err);
    }
  }
}

async function apagarNoBanco(): Promise<void> {
  try {
    if (!AppDataSource.isInitialized) return;
    await AppDataSource.query('DELETE FROM painel_cache');
  } catch {
    /* tabela ainda não existe no boot */
  }
}
