/** Classifica execução de roçada (manual × mecanizada) a partir de texto da planilha. */

export type TipoExecucaoRocada = 'manual' | 'mecanizada' | 'desconhecido';

export function normalizarTextoRocada(texto: string | null | undefined): string {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
}

/**
 * Infere o tipo pela aba (ex.: "manual", "mecanizada", "Roçada Manual").
 * Retorna null se o nome for ambíguo (aí usa a coluna Tipo da linha).
 */
export function inferirTipoExecucaoAba(nomeAba: string | null | undefined): TipoExecucaoRocada | null {
  const n = normalizarTextoRocada(nomeAba).replace(/[_-]+/g, ' ');
  if (!n) return null;
  const temManual = /\bMANUAL\b/.test(n) || n.includes('MAO DE OBRA');
  const temMecan =
    n.includes('MECANIZ')
    || n.includes('MECANICA')
    || /\bMECAN\b/.test(n)
    || n.includes('TRATOR');
  if (temManual && !temMecan) return 'manual';
  if (temMecan && !temManual) return 'mecanizada';
  return null;
}

/**
 * Infere filtro de importação a partir do nome do serviço e/ou tarifas configuradas.
 * null = importar todos os tipos (serviço único com Manual + Mecanizada).
 */
export function inferirFiltroExecucaoServico(
  nomeServico?: string | null,
  configFaturamento?: {
    valorM2Manual?: number | null;
    valorM2Mecanizada?: number | null;
    valorM2?: number | null;
  } | null,
): 'manual' | 'mecanizada' | null {
  const daAba = inferirTipoExecucaoAba(nomeServico || '');
  if (daAba === 'manual' || daAba === 'mecanizada') return daAba;

  const man = Number(configFaturamento?.valorM2Manual || 0) > 0;
  const mec = Number(configFaturamento?.valorM2Mecanizada || 0) > 0;
  if (man && !mec) return 'manual';
  if (mec && !man) return 'mecanizada';
  return null;
}

export function classificarTipoExecucaoRocada(
  ...fontes: Array<string | null | undefined>
): TipoExecucaoRocada {
  const n = normalizarTextoRocada(fontes.filter(Boolean).join(' '));
  if (!n) return 'desconhecido';
  if (/\bMANUAL\b/.test(n) || n.includes('MAO DE OBRA') || n.includes('ENXADA')) return 'manual';
  if (
    n.includes('MECAN')
    || n.includes('TRATOR')
    || n.includes('ROCADEIRA')
    || n.includes('GIRO')
    || n.includes('MAQUINA')
    || n.includes('MOTORIZ')
  ) {
    return 'mecanizada';
  }
  return 'desconhecido';
}

export function labelTipoExecucao(tipo: TipoExecucaoRocada): string {
  if (tipo === 'manual') return 'MANUAL';
  if (tipo === 'mecanizada') return 'MECANIZADA';
  return 'ROÇADA';
}

export function resolverTarifasM2Rocada(valoresFixos: Record<string, number>): {
  manual: number;
  mecanizada: number;
  fallback: number;
} {
  const manual = Number(valoresFixos.VALOR_M2_MANUAL || 0);
  const mecanizada = Number(valoresFixos.VALOR_M2_MECANIZADA || 0);
  const unico = Number(valoresFixos.VALOR_M2 || 0);
  const vManual = manual > 0 ? manual : unico;
  const vMecanizada = mecanizada > 0 ? mecanizada : unico;
  const fallback =
    vManual > 0 && vMecanizada > 0
      ? (vManual === vMecanizada ? vManual : vMecanizada)
      : vManual > 0
        ? vManual
        : vMecanizada;
  return { manual: vManual, mecanizada: vMecanizada, fallback };
}

export function calcularFaturamentoRocadaPorAreas(
  areas: { manual: number; mecanizada: number; desconhecido?: number },
  valoresFixos: Record<string, number>,
): number {
  const t = resolverTarifasM2Rocada(valoresFixos);
  const desconhecido = Number(areas.desconhecido || 0);
  return (
    Number(areas.manual || 0) * t.manual
    + Number(areas.mecanizada || 0) * t.mecanizada
    + desconhecido * t.fallback
  );
}
