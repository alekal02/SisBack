import { numeroPlanilha } from './FormulaEngine';

/**
 * Hora de planilha como fração do dia (0 = meia-noite).
 * 0 e "00:00" são meia-noite, não valor vazio.
 */
export function horaFracaoPlanilha(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === '') return null;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;

  const texto = String(valor).trim().replace(/;/g, ':');
  const relogio = texto.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (relogio) {
    const h = Number(relogio[1]);
    const min = Number(relogio[2]);
    const sec = Number(relogio[3] || 0);
    if (h === 24 && min === 0 && sec === 0) return 0;
    if (h >= 0 && h < 24 && min >= 0 && min < 60 && sec >= 0 && sec < 60) {
      return (h + min / 60 + sec / 3600) / 24;
    }
    return null;
  }

  return numeroPlanilha(valor);
}
