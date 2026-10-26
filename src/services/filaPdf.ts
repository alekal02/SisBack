/**
 * Puppeteer ocupa bastante RAM. Na Render só um PDF é gerado por vez.
 */
let cauda: Promise<void> = Promise.resolve();

export function enfileirarPdf<T>(trabalho: () => Promise<T>): Promise<T> {
  const execucao = cauda.then(trabalho, trabalho);
  cauda = execucao.then(() => undefined, () => undefined);
  return execucao;
}

export function resetarFilaPdfParaTeste(): void {
  cauda = Promise.resolve();
}
