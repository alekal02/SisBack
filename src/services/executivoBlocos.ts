const blocos = new Map<string, { ms: number; n: number }>();

function somar(nome: string, ms: number): void {
  const atual = blocos.get(nome) || { ms: 0, n: 0 };
  atual.ms += ms;
  atual.n += 1;
  blocos.set(nome, atual);
}

export function medir<T>(nome: string, fn: () => T): T {
  const inicio = performance.now();
  try {
    return fn();
  } finally {
    somar(nome, performance.now() - inicio);
  }
}

export async function medirAsync<T>(nome: string, fn: () => Promise<T>): Promise<T> {
  const inicio = performance.now();
  try {
    return await fn();
  } finally {
    somar(nome, performance.now() - inicio);
  }
}

export function marcarBloco(nome: string, ms: number): void {
  somar(nome, ms);
}

export function rankingBlocos(): { nome: string; ms: number; n: number }[] {
  return [...blocos.entries()]
    .map(([nome, valor]) => ({ nome, ms: Math.round(valor.ms), n: valor.n }))
    .sort((a, b) => b.ms - a.ms);
}

export function limparBlocos(): void {
  blocos.clear();
}
