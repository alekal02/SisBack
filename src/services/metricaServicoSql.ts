/**
 * Uma medida por linha (COALESCE / NULLIF). Não soma aliases.
 * Espelha a prioridade de packages/shared/src/metricaServico.ts.
 * Varrição não usa c.kmTotal: hodômetro de coleta não entra como KM linear.
 */
import { sqlJsonNumero } from './viagensPorRotaService';

function positivo(alias: string, chave: string): string {
  return `NULLIF(${sqlJsonNumero(alias, chave)}, 0)`;
}

export function sqlAreaM2(alias = 'c'): string {
  return `COALESCE(
    ${positivo(alias, 'Area m²')},
    ${positivo(alias, 'AREA_M2')},
    ${positivo(alias, 'M2')},
    ${positivo(alias, 'AREA_ROCADA')},
    0
  )`;
}

export function sqlMetroLinear(alias = 'c'): string {
  return `COALESCE(
    ${positivo(alias, 'Metro Linear')},
    ${positivo(alias, 'METRO_LINEAR')},
    ${positivo(alias, 'COMPRIMENTO')},
    ${positivo(alias, 'COMPRIMENTO TOTAL')},
    0
  )`;
}

export function sqlKmLinear(alias = 'c'): string {
  return `COALESCE(
    ${positivo(alias, 'KM Linear')},
    ${positivo(alias, 'KM_LINEAR')},
    ${positivo(alias, 'QUILOMETROS_VARRIDOS')},
    0
  )`;
}

export function sqlQtdArvore(alias = 'c'): string {
  return `COALESCE(
    ${positivo(alias, 'Quantidade de Arvore')},
    ${positivo(alias, 'QTD_ARVORE')},
    ${positivo(alias, 'ARVORES_PODADAS')},
    0
  )`;
}

export function sqlQuantitativo(alias = 'c'): string {
  return `COALESCE(
    ${positivo(alias, 'QUANTITATIVO')},
    ${positivo(alias, 'QUANTIDADE')},
    0
  )`;
}
