/** KM válido = distância informada e maior que zero. Zero não entra na média. */

export function kmInformadoValido(km: unknown): boolean {
  const n = Number(km);
  return Number.isFinite(n) && n > 0;
}

export interface RazaoKmValido {
  kmPorViagem: number;
  tonPorKm: number;
  /** 0–100, arredondado. */
  pctViagensKmValido: number;
  viagensComKm: number;
  kmValido: number;
  tonComKm: number;
}

export function fecharRazaoKm(opts: {
  viagens: number;
  viagensComKm: number;
  km: number;
  tonComKm: number;
}): RazaoKmValido {
  const viagens = Number(opts.viagens) || 0;
  const viagensComKm = Number(opts.viagensComKm) || 0;
  const km = Number(opts.km) || 0;
  const tonComKm = Number(opts.tonComKm) || 0;
  return {
    kmPorViagem: viagensComKm > 0 ? Math.round((km / viagensComKm) * 100) / 100 : 0,
    tonPorKm: km > 0 ? Math.round((tonComKm / km) * 10000) / 10000 : 0,
    pctViagensKmValido: viagens > 0 ? Math.round((viagensComKm / viagens) * 100) : 0,
    viagensComKm,
    kmValido: Math.round(km * 100) / 100,
    tonComKm: Math.round(tonComKm * 100) / 100,
  };
}

export function razoesKmDeRegistros(
  rows: Array<{ viagens: number; km: number; ton: number }>,
): RazaoKmValido {
  let viagens = 0;
  let viagensComKm = 0;
  let km = 0;
  let tonComKm = 0;
  for (const row of rows) {
    const v = Number(row.viagens) || 0;
    const k = Number(row.km) || 0;
    const t = Number(row.ton) || 0;
    viagens += v;
    if (kmInformadoValido(k)) {
      viagensComKm += v;
      km += k;
      tonComKm += t;
    }
  }
  return fecharRazaoKm({ viagens, viagensComKm, km, tonComKm });
}
