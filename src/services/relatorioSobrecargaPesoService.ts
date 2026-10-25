import {
  limiteParaTipo,
  normalizarTipoCaminhaoPeso,
  resolverLimitesPesoKg,
  type LimitesPesoKg,
  type TipoCaminhaoPeso,
} from '../config/pesoMaximoCaminhao';
import { encontrarValorColuna, parseNumeroBr } from './FormulaEngine';
import { COLUNAS_PESO_VIAGEM, obterPesoViagemRegistro } from './viagensPorRotaService';
import { formatarDataSaida } from '../utils/formatarDataPlanilha';

function registroUnificado(reg: Record<string, any>): Record<string, any> {
  const raw: Record<string, any> = { ...reg };
  if (reg.dados && typeof reg.dados === 'object') {
    for (const [k, v] of Object.entries(reg.dados)) {
      if (v !== null && v !== undefined && v !== '') raw[k] = v;
    }
  }
  return raw;
}

function obterTipoCaminhao(reg: Record<string, any>): string | null {
  if (reg.tipoCaminhao) return String(reg.tipoCaminhao).trim();
  const raw = registroUnificado(reg);
  const v = encontrarValorColuna(raw, 'TIPO DE CAMINHÃO')
    ?? encontrarValorColuna(raw, 'TIPO DE CAMINHAO')
    ?? encontrarValorColuna(raw, 'TIPO CAMINHAO');
  return v ? String(v).trim() : null;
}

function formatarKg(kg: number): string {
  return `${kg.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} kg`;
}

export interface ViagemSobrecargaItem {
  id: number | string;
  data: string | null;
  placa: string | null;
  motorista: string | null;
  regional: string | null;
  distrito: string | null;
  turno: string | null;
  tipoCaminhao: string;
  tipoCaminhaoNormalizado: TipoCaminhaoPeso | 'DESCONHECIDO';
  rota: string;
  pesoKg: number;
  pesoMaximoKg: number;
  excessoKg: number;
  excessoPct: number;
  pesoFormatado: string;
  limiteFormatado: string;
}

export interface RelatorioSobrecargaPeso {
  limitesAplicados: LimitesPesoKg;
  totalRegistrosAnalisados: number;
  totalOcorrencias: number;
  resumoPorTipo: Array<{ tipo: string; ocorrencias: number; excessoMedioKg: number }>;
  resumoPorRota: Array<{ rota: string; ocorrencias: number }>;
  resumoPorMotorista: Array<{ motorista: string; ocorrencias: number; maiorExcessoKg: number }>;
  itens: ViagemSobrecargaItem[];
}

export function gerarRelatorioSobrecargaPeso(
  dados: Array<Record<string, any>>,
  limitesOverrides?: Partial<LimitesPesoKg> | null,
): RelatorioSobrecargaPeso {
  const limites = resolverLimitesPesoKg(limitesOverrides);
  const itens: ViagemSobrecargaItem[] = [];

  for (const reg of dados) {
    const tipoRaw = obterTipoCaminhao(reg);
    const tipoNorm = normalizarTipoCaminhaoPeso(tipoRaw);
    const limiteKg = limiteParaTipo(tipoNorm, limites);

    const base = {
      id: reg.id ?? `${reg.placa}-${reg.dataSaida}`,
      data: reg.dataSaida ? formatarDataSaida(reg.dataSaida) : null,
      placa: reg.placa ? String(reg.placa).trim() : null,
      motorista: reg.motorista ? String(reg.motorista).trim() : null,
      regional: reg.regional ? String(reg.regional).trim() : null,
      distrito: reg.distrito ? String(reg.distrito).trim() : null,
      turno: reg.turno ? String(reg.turno).trim() : null,
      tipoCaminhao: tipoRaw || '—',
      tipoCaminhaoNormalizado: (tipoNorm || 'DESCONHECIDO') as TipoCaminhaoPeso | 'DESCONHECIDO',
    };

    let tevePesoPorViagem = false;
    for (const slot of COLUNAS_PESO_VIAGEM) {
      const peso = obterPesoViagemRegistro(reg, slot);
      if (peso === null) continue;
      tevePesoPorViagem = true;
      if (peso > limiteKg) {
        const excessoKg = Math.round((peso - limiteKg) * 100) / 100;
        itens.push({
          ...base,
          rota: slot.label,
          pesoKg: peso,
          pesoMaximoKg: limiteKg,
          excessoKg,
          excessoPct: Math.round((excessoKg / limiteKg) * 10000) / 100,
          pesoFormatado: formatarKg(peso),
          limiteFormatado: formatarKg(limiteKg),
        });
      }
    }

    if (!tevePesoPorViagem) {
      const pesoTotal = reg.pesoTotal != null && Number(reg.pesoTotal) > 0
        ? Number(reg.pesoTotal)
        : parseNumeroBr(encontrarValorColuna(registroUnificado(reg), 'PESO TOTAL'));
      if (!isNaN(pesoTotal) && pesoTotal > limiteKg) {
        const excessoKg = Math.round((pesoTotal - limiteKg) * 100) / 100;
        itens.push({
          ...base,
          rota: 'PESO TOTAL',
          pesoKg: pesoTotal,
          pesoMaximoKg: limiteKg,
          excessoKg,
          excessoPct: Math.round((excessoKg / limiteKg) * 10000) / 100,
          pesoFormatado: formatarKg(pesoTotal),
          limiteFormatado: formatarKg(limiteKg),
        });
      }
    }
  }

  itens.sort((a, b) => b.excessoKg - a.excessoKg);

  const resumoPorTipoMap = new Map<string, { ocorrencias: number; somaExcesso: number }>();
  const resumoPorRotaMap = new Map<string, number>();
  const resumoMotoristaMap = new Map<string, { ocorrencias: number; maiorExcesso: number }>();

  for (const item of itens) {
    const t = resumoPorTipoMap.get(item.tipoCaminhaoNormalizado) || { ocorrencias: 0, somaExcesso: 0 };
    t.ocorrencias += 1;
    t.somaExcesso += item.excessoKg;
    resumoPorTipoMap.set(item.tipoCaminhaoNormalizado, t);
    resumoPorRotaMap.set(item.rota, (resumoPorRotaMap.get(item.rota) || 0) + 1);
    const mot = item.motorista || 'Sem motorista';
    const m = resumoMotoristaMap.get(mot) || { ocorrencias: 0, maiorExcesso: 0 };
    m.ocorrencias += 1;
    m.maiorExcesso = Math.max(m.maiorExcesso, item.excessoKg);
    resumoMotoristaMap.set(mot, m);
  }

  return {
    limitesAplicados: limites,
    totalRegistrosAnalisados: dados.length,
    totalOcorrencias: itens.length,
    resumoPorTipo: Array.from(resumoPorTipoMap.entries())
      .map(([tipo, v]) => ({
        tipo,
        ocorrencias: v.ocorrencias,
        excessoMedioKg: Math.round((v.somaExcesso / v.ocorrencias) * 100) / 100,
      }))
      .sort((a, b) => b.ocorrencias - a.ocorrencias),
    resumoPorRota: Array.from(resumoPorRotaMap.entries())
      .map(([rota, ocorrencias]) => ({ rota, ocorrencias }))
      .sort((a, b) => b.ocorrencias - a.ocorrencias),
    resumoPorMotorista: Array.from(resumoMotoristaMap.entries())
      .map(([motorista, v]) => ({
        motorista,
        ocorrencias: v.ocorrencias,
        maiorExcessoKg: v.maiorExcesso,
      }))
      .sort((a, b) => b.ocorrencias - a.ocorrencias)
      .slice(0, 20),
    itens,
  };
}

export function extrairLimitesDeConfig(configFaturamento: any): Partial<LimitesPesoKg> | null {
  const cfg = configFaturamento?.pesoMaximoKg;
  if (!cfg || typeof cfg !== 'object') return null;
  const out: Partial<LimitesPesoKg> = {};
  if (cfg.MINI > 0) out.MINI = Number(cfg.MINI);
  if (cfg.TOCO > 0) out.TOCO = Number(cfg.TOCO);
  if (cfg.BASCULANTE > 0) out.BASCULANTE = Number(cfg.BASCULANTE);
  if (cfg.TRUCK > 0) out.TRUCK = Number(cfg.TRUCK);
  return Object.keys(out).length > 0 ? out : null;
}
