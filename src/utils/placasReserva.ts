import { normalizarPlaca } from './normalizarPlaca';

export function normalizarListaPlacasReserva(raw: unknown): string[] {
  if (!raw) return [];
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((v) => normalizarPlaca(String(v))).filter(Boolean))];
}

export function ehPlacaReserva(placa: string | null | undefined, placasReserva?: string[]): boolean {
  if (!placasReserva?.length) return false;
  const p = normalizarPlaca(placa);
  if (!p) return false;
  const set = new Set(placasReserva.map(normalizarPlaca));
  return set.has(p);
}

export function resumirFrotaOperacao(
  placasAtivas: string[],
  placasReserva?: string[],
): { titulares: number; reserva: number; total: number; placasReservaAtivas: string[] } {
  const setReserva = new Set((placasReserva ?? []).map(normalizarPlaca));
  const placasReservaAtivas: string[] = [];
  for (const pl of placasAtivas) {
    const n = normalizarPlaca(pl);
    if (n && setReserva.has(n)) placasReservaAtivas.push(pl);
  }
  const total = placasAtivas.length;
  const reserva = placasReservaAtivas.length;
  return { titulares: total - reserva, reserva, total, placasReservaAtivas };
}
