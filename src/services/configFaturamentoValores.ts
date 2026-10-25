import type { Contract } from '../entities/Contract';

type ConfigFaturamento = {
  ativo?: boolean;
  valorTonelada?: number | null;
  valorMini?: number | null;
  valorTruck?: number | null;
  valorToco?: number | null;
  valorBasculante?: number | null;
  valorKmLinear?: number | null;
  valorM2?: number | null;
  /** Roçada: R$/m² execução manual */
  valorM2Manual?: number | null;
  /** Roçada: R$/m² execução mecanizada */
  valorM2Mecanizada?: number | null;
  valorPorArvore?: number | null;
  valorPorEquipe?: number | null;
  valorPorUnidade?: number | null;
} | null | undefined;

function setIfPositive(target: Record<string, number>, key: string, value: unknown) {
  if (value !== null && value !== undefined && value !== '' && !Number.isNaN(Number(value))) {
    const n = Number(value);
    if (n > 0) target[key] = n;
  }
}

/** Aliases legados usados em templates antigos e KPIs já salvos nos serviços. */
function aplicarAliasesLegadosFaturamento(valores: Record<string, number>): void {
  const alias = (de: string, para: string) => {
    if (valores[para] !== undefined && valores[de] === undefined) {
      valores[de] = valores[para];
    }
  };
  alias('VALOR_ROCADA_M2', 'VALOR_M2');
  alias('VALOR_PODA_ARVORE', 'VALOR_POR_ARVORE');
  alias('VALOR_CAPINA_ML', 'VALOR_KM_LINEAR');
  alias('VALOR_VARRICAO_KM', 'VALOR_KM_LINEAR');
  alias('VALOR_PINTURA_M', 'VALOR_KM_LINEAR');
  alias('VALOR_REMOCAO_TON', 'VALOR_TONELADA');
  alias('VALOR_HORA_ROCADA', 'VALOR_M2');
}

/** ⭐ Aplica fallback: se VALOR_TRUCK/TOCO/MINI/BASCULANTE não foram definidos, usa VALOR_TONELADA */
function aplicarFallbackPorTipo(valores: Record<string, number>): void {
  const tonelada = valores['VALOR_TONELADA'];
  if (tonelada !== undefined && tonelada > 0) {
    if (valores['VALOR_TRUCK'] === undefined || valores['VALOR_TRUCK'] === 0) {
      valores['VALOR_TRUCK'] = tonelada;
    }
    if (valores['VALOR_TOCO'] === undefined || valores['VALOR_TOCO'] === 0) {
      valores['VALOR_TOCO'] = tonelada;
    }
    if (valores['VALOR_MINI'] === undefined || valores['VALOR_MINI'] === 0) {
      valores['VALOR_MINI'] = tonelada;
    }
    if (valores['VALOR_BASCULANTE'] === undefined || valores['VALOR_BASCULANTE'] === 0) {
      valores['VALOR_BASCULANTE'] = tonelada;
    }
  }
}

/** Monta constantes VALOR_* usadas nas fórmulas de receita dos KPIs universais. */
export function buildValoresFixosFaturamento(
  contract?: Contract | null,
  configFaturamento?: ConfigFaturamento
): Record<string, number> {
  const valores: Record<string, number> = {};
  const cfgAtivo = configFaturamento?.ativo === true;

  if (cfgAtivo && configFaturamento) {
    setIfPositive(valores, 'VALOR_TONELADA', configFaturamento.valorTonelada);
    setIfPositive(valores, 'VALOR_MINI', configFaturamento.valorMini);
    setIfPositive(valores, 'VALOR_TRUCK', configFaturamento.valorTruck);
    setIfPositive(valores, 'VALOR_TOCO', configFaturamento.valorToco);
    setIfPositive(valores, 'VALOR_BASCULANTE', configFaturamento.valorBasculante);
    setIfPositive(valores, 'VALOR_KM_LINEAR', configFaturamento.valorKmLinear);
    setIfPositive(valores, 'VALOR_M2_MANUAL', configFaturamento.valorM2Manual);
    setIfPositive(valores, 'VALOR_M2_MECANIZADA', configFaturamento.valorM2Mecanizada);
    setIfPositive(valores, 'VALOR_M2', configFaturamento.valorM2);
    // Fallback: se só houver tarifas por tipo, preenche VALOR_M2 para KPIs legados
    if (valores.VALOR_M2 === undefined) {
      const man = valores.VALOR_M2_MANUAL;
      const mec = valores.VALOR_M2_MECANIZADA;
      if (man !== undefined && mec !== undefined && man === mec) {
        valores.VALOR_M2 = man;
      } else if (mec !== undefined) {
        valores.VALOR_M2 = mec;
      } else if (man !== undefined) {
        valores.VALOR_M2 = man;
      }
    }
    // Se só valorM2 genérico, replica nos dois tipos
    if (valores.VALOR_M2 !== undefined) {
      if (valores.VALOR_M2_MANUAL === undefined) valores.VALOR_M2_MANUAL = valores.VALOR_M2;
      if (valores.VALOR_M2_MECANIZADA === undefined) valores.VALOR_M2_MECANIZADA = valores.VALOR_M2;
    }
    setIfPositive(valores, 'VALOR_POR_ARVORE', configFaturamento.valorPorArvore);
    setIfPositive(valores, 'VALOR_POR_EQUIPE', configFaturamento.valorPorEquipe);
    setIfPositive(valores, 'VALOR_POR_UNIDADE', configFaturamento.valorPorUnidade);
    aplicarFallbackPorTipo(valores);
    aplicarAliasesLegadosFaturamento(valores);
    return valores;
  }

  if (contract) {
    setIfPositive(valores, 'VALOR_TONELADA', contract.valorTonelada);
    setIfPositive(valores, 'VALOR_MINI', contract.valorMini);
    setIfPositive(valores, 'VALOR_TRUCK', contract.valorTruck);
    setIfPositive(valores, 'VALOR_TOCO', contract.valorToco);
    setIfPositive(valores, 'VALOR_BASCULANTE', contract.valorBasculante);
  }

  aplicarFallbackPorTipo(valores);
  aplicarAliasesLegadosFaturamento(valores);
  return valores;
}

/** Copia tarifas do serviço para o contrato quando o contrato ainda não tem valor. */
export function syncContractTarifasFromConfig(
  contract: Contract,
  configFaturamento?: ConfigFaturamento,
): boolean {
  if (!configFaturamento?.ativo) return false;
  let alterado = false;
  const copiar = (
    campo: 'valorTonelada' | 'valorMini' | 'valorTruck' | 'valorToco' | 'valorBasculante',
    valor: unknown,
  ) => {
    if (contract[campo] != null && Number(contract[campo]) > 0) return;
    if (valor == null || valor === '' || Number.isNaN(Number(valor)) || Number(valor) <= 0) return;
    contract[campo] = Number(valor);
    alterado = true;
  };
  copiar('valorTonelada', configFaturamento.valorTonelada);
  copiar('valorMini', configFaturamento.valorMini);
  copiar('valorTruck', configFaturamento.valorTruck);
  copiar('valorToco', configFaturamento.valorToco);
  copiar('valorBasculante', configFaturamento.valorBasculante);
  return alterado;
}
