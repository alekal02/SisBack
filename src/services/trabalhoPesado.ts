let profundidade = 0;

/** Planilha ou PDF do WhatsApp em andamento. O aquecimento do dashboard espera. */
export function ocuparTrabalhoPesado(): void {
  profundidade += 1;
}

export function liberarTrabalhoPesado(): void {
  profundidade = Math.max(0, profundidade - 1);
}

export function trabalhoPesadoEmAndamento(): boolean {
  return profundidade > 0;
}
