/**
 * Quantidade oficial de cada serviço operacional.
 * Uma linha contribui com um único valor da unidade do cadastro.
 * Campos equivalentes não são somados. Sem Metro Linear / Area m² / KM Linear
 * / Quantidade de Arvore, não há conversão a partir de outro campo.
 */

export interface CamposMetricaServico {
  areaM2?: number | null;
  metroLinear?: number | null;
  kmLinear?: number | null;
  qtdArvore?: number | null;
  quantitativo?: number | null;
}

export interface MetricaOficialServico {
  valor: number;
  sufixo: string;
  label: string;
  pendencias: string[];
}

function numeroPositivo(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function primeiroNumero(origem: Record<string, unknown>, chaves: string[]): number {
  for (const chave of chaves) {
    const n = numeroPositivo(origem[chave]);
    if (n != null) return n;
  }
  return 0;
}

/** Lê os campos da linha sem somar aliases da mesma medida. */
export function camposMetricaDeRegistro(registro: Record<string, unknown> | null | undefined): CamposMetricaServico {
  const r = registro || {};
  return {
    areaM2: primeiroNumero(r, ['Area m²', 'AREA_M2', 'M2', 'AREA_ROCADA']),
    metroLinear: primeiroNumero(r, ['Metro Linear', 'METRO_LINEAR', 'COMPRIMENTO', 'COMPRIMENTO TOTAL']),
    kmLinear: primeiroNumero(r, ['KM Linear', 'KM_LINEAR', 'QUILOMETROS_VARRIDOS']),
    qtdArvore: primeiroNumero(r, ['Quantidade de Arvore', 'QTD_ARVORE', 'ARVORES_PODADAS']),
    quantitativo: primeiroNumero(r, ['QUANTITATIVO', 'QUANTIDADE']),
  };
}

export function metricaDeRegistro(
  tipoServico: string | null | undefined,
  registro: Record<string, unknown> | null | undefined,
): MetricaOficialServico {
  return metricaOficialServico(tipoServico, camposMetricaDeRegistro(registro));
}

export function metricaOficialServico(
  tipoServico: string | null | undefined,
  campos: CamposMetricaServico,
): MetricaOficialServico {
  const tipo = String(tipoServico || '');
  const area = numeroPositivo(campos.areaM2) ?? 0;
  const metro = numeroPositivo(campos.metroLinear) ?? 0;
  const km = numeroPositivo(campos.kmLinear) ?? 0;
  const arvores = numeroPositivo(campos.qtdArvore) ?? 0;
  const quantitativo = numeroPositivo(campos.quantitativo) ?? 0;

  switch (tipo) {
    case 'rocadeira':
      return {
        valor: area,
        sufixo: 'm²',
        label: 'Área',
        pendencias: area <= 0 && quantitativo > 0
          ? ['Roçada sem Area m²; QUANTITATIVO não foi somado como m².']
          : [],
      };
    case 'capina':
      return {
        valor: metro,
        sufixo: 'm',
        label: 'Metro linear',
        pendencias: metro <= 0 && (km > 0 || quantitativo > 0)
          ? ['Capina sem Metro Linear; KM Linear e QUANTITATIVO não foram convertidos.']
          : [],
      };
    case 'varricao':
      return {
        valor: km,
        sufixo: 'km',
        label: 'KM linear',
        pendencias: km <= 0 && (metro > 0 || quantitativo > 0)
          ? ['Varrição sem KM Linear; metro e QUANTITATIVO não foram convertidos para km.']
          : [],
      };
    case 'poda':
      return {
        valor: arvores,
        sufixo: 'arv',
        label: 'Árvores',
        pendencias: arvores <= 0 && quantitativo > 0
          ? ['Poda sem Quantidade de Arvore; QUANTITATIVO e a contagem de linhas não entram na soma.']
          : [],
      };
    case 'pintura_meio_fio':
      return {
        valor: metro,
        sufixo: 'm',
        label: 'Metro linear',
        pendencias: metro <= 0 && quantitativo > 0
          ? ['Pintura sem Metro Linear/COMPRIMENTO; QUANTITATIVO não foi usado como metragem.']
          : [],
      };
    case 'remocao':
      return {
        valor: quantitativo,
        sufixo: 'pts',
        label: 'Pontos',
        pendencias: [],
      };
    case 'geral':
      return {
        valor: quantitativo,
        sufixo: 'pts',
        label: 'Pontos',
        pendencias: [],
      };
    default:
      return { valor: 0, sufixo: '', label: '', pendencias: [] };
  }
}
