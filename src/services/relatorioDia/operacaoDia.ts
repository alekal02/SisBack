/**
 * Port fiel de `frontend/src/utils/operacaoDia.ts` — partes usadas pelo PDF de operação.
 */
import { ehPlacaReserva } from '../../utils/placasReserva';
import { normalizarTipoCaminhaoPeso, type TipoCaminhaoPeso } from '../../config/pesoMaximoCaminhao';
import {
  LABEL_TIPO_CAMINHAO,
  calcularPesoIdealViagem,
  classificarPctIdeal,
  densidadeOptsToInput,
  notaDaFaixaIdeal,
  statusPctVsMargemIdeal,
  type NotaIdealViagem,
} from './escalaIdealPeso';
import { fmtNum } from './fmt';

export interface LinhaOperacaoGrupo {
  chave: string;
  registros: number;
  viagens: number;
  toneladas: number;
  km: number;
  horas: number;
  tonMediaViagem: number;
  kmMedioViagem: number;
  /** Tipo predominante (Mini/Toco/…) — eficiência vs ideal do tipo. */
  tipoCaminhao?: string | null;
}

export interface OperacaoDiaResumo {
  registros: number;
  viagens: number;
  toneladas: number;
  km: number;
  horas: number;
  caminhoes: number;
  coletores: number;
  motoristas: number;
  coletoresEquipe: number;
  tonMediaColeta: number;
  kmMedioViagem: number;
  tonKm: number;
  prodColetor: number;
}

export interface OperacaoDiaAnalise {
  resumo: OperacaoDiaResumo;
  porPlaca: LinhaOperacaoGrupo[];
  porTurno: LinhaOperacaoGrupo[];
  porRegional: LinhaOperacaoGrupo[];
  porMotorista: LinhaOperacaoGrupo[];
  porTipoCaminhao: LinhaOperacaoGrupo[];
  porDistrito: LinhaOperacaoGrupo[];
  registrosConsiderados: number;
}

export type SeveridadeInsight = 'critico' | 'atencao' | 'info';

export interface InsightOperacao {
  severidade: SeveridadeInsight;
  titulo: string;
  texto: string;
}

export interface LinhaEficienciaPlaca extends LinhaOperacaoGrupo {
  tonHora: number;
  pctMediaTonViag: number;
  status: 'bom' | 'medio' | 'ruim';
  ehReserva?: boolean;
  mediaRefLabel?: string;
  pesoIdealKg?: number | null;
  pctIdeal?: number | null;
  notaIdeal?: NotaIdealViagem | null;
}

export type OptsEficienciaContrato = {
  volumeL?: Partial<Record<TipoCaminhaoPeso, number>> | null;
  densidadeResiduoKgL?: number | null;
  densidadeKgL?: Partial<Record<TipoCaminhaoPeso, number>> | null;
  densidadeKgLPorPlaca?: Record<string, number> | null;
  /** Fallback placa → tipo a partir das viagens PESO 1–4. */
  tipoPorPlaca?: Map<string, TipoCaminhaoPeso> | null;
};

/** Converte agregação SQL do backend no formato do painel/PDF do dia. */
export function analiseOperacaoDeAgregacaoSql(agg: {
  resumo: {
    registros: number;
    viagens: number;
    pesoTotalTon: number;
    kmTotal: number;
    horasProdutivas: number;
    placas: number;
    motoristas: number;
  };
  porMotorista: Array<{
    label: string; viagens: number; tonelagem: number; kmTotal: number;
    horasProdutivas: number; tonPorViagem: number; kmPorViagem: number;
    tipoCaminhao?: string;
  }>;
  porPlaca: Array<{
    label: string; viagens: number; tonelagem: number; kmTotal: number;
    horasProdutivas: number; tonPorViagem: number; kmPorViagem: number;
    tipoCaminhao?: string;
  }>;
  porDistrito: Array<{
    label: string; viagens: number; tonelagem: number; kmTotal: number;
    horasProdutivas: number; tonPorViagem: number; kmPorViagem: number;
    tipoCaminhao?: string;
  }>;
}): OperacaoDiaAnalise {
  const mapLinha = (l: {
    label: string; viagens: number; tonelagem: number; kmTotal: number;
    horasProdutivas: number; tonPorViagem: number; kmPorViagem: number;
    tipoCaminhao?: string;
  }): LinhaOperacaoGrupo => ({
    chave: l.label,
    registros: l.viagens,
    viagens: l.viagens,
    toneladas: l.tonelagem,
    km: l.kmTotal,
    horas: l.horasProdutivas,
    tonMediaViagem: l.tonPorViagem,
    kmMedioViagem: l.kmPorViagem,
    tipoCaminhao: l.tipoCaminhao || null,
  });

  const r = agg.resumo;
  const tonMedia = r.viagens > 0 ? r.pesoTotalTon / r.viagens : 0;
  const kmMedio = r.viagens > 0 ? r.kmTotal / r.viagens : 0;
  const tonKm = r.kmTotal > 0 ? r.pesoTotalTon / r.kmTotal : 0;
  const prodColetor = r.placas > 0 ? r.pesoTotalTon / r.placas : 0;

  // Agrega por tipo a partir das placas tipadas
  const accTipo = new Map<string, { viagens: number; toneladas: number; km: number; horas: number }>();
  for (const p of agg.porPlaca) {
    const tipo = normalizarTipoCaminhaoPeso(p.tipoCaminhao);
    if (!tipo || !(p.viagens > 0)) continue;
    const a = accTipo.get(tipo) || { viagens: 0, toneladas: 0, km: 0, horas: 0 };
    a.viagens += p.viagens;
    a.toneladas += p.tonelagem;
    a.km += p.kmTotal;
    a.horas += p.horasProdutivas;
    accTipo.set(tipo, a);
  }
  const porTipoCaminhao: LinhaOperacaoGrupo[] = [...accTipo.entries()].map(([tipo, a]) => ({
    chave: LABEL_TIPO_CAMINHAO[tipo as TipoCaminhaoPeso] || tipo,
    tipoCaminhao: tipo,
    registros: a.viagens,
    viagens: a.viagens,
    toneladas: a.toneladas,
    km: a.km,
    horas: a.horas,
    tonMediaViagem: a.viagens > 0 ? a.toneladas / a.viagens : 0,
    kmMedioViagem: a.viagens > 0 ? a.km / a.viagens : 0,
  }));

  return {
    resumo: {
      registros: r.registros,
      viagens: r.viagens,
      toneladas: r.pesoTotalTon,
      km: r.kmTotal,
      horas: r.horasProdutivas,
      caminhoes: r.placas,
      coletores: r.placas,
      motoristas: r.motoristas,
      coletoresEquipe: 0,
      tonMediaColeta: Math.round(tonMedia * 100) / 100,
      kmMedioViagem: Math.round(kmMedio * 100) / 100,
      tonKm: Math.round(tonKm * 10000) / 10000,
      prodColetor: Math.round(prodColetor * 100) / 100,
    },
    porPlaca: agg.porPlaca.map(mapLinha),
    porTurno: [],
    porRegional: [],
    porMotorista: agg.porMotorista.map(mapLinha),
    porTipoCaminhao,
    porDistrito: agg.porDistrito.map(mapLinha),
    registrosConsiderados: r.registros,
  };
}

/** KPIs que já aparecem no hero/cards base — omitir na grade para evitar duplicação. */
export function isKpiMetricaBaseOperacao(nome: string): boolean {
  const n = nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const padroes = [
    'viagem', 'tonelada', 'quilometro', ' km', 'hora produtiva', 'horas prod',
    'veiculo', 'coletor', 'motorista', 'caminhao', 'placa unica', 'placas unicas',
    'ton/viag', 'km/viag', 'ton por viagem',
    'km por viagem', 'prod/coletor', 'produtividade coletor', 'ton/hora', 'km/h',
    'peso total', 'distancia', 'registro',
  ];
  return padroes.some((p) => n.includes(p));
}

function statusVsMedia(pct: number): 'bom' | 'medio' | 'ruim' {
  if (pct >= 90) return 'bom';
  if (pct >= 75) return 'medio';
  return 'ruim';
}

/** Insights automáticos para o gerente identificar gargalos do dia. */
export function gerarInsightsOperacao(
  analise: OperacaoDiaAnalise,
  placasReserva?: string[],
): InsightOperacao[] {
  const { resumo } = analise;
  const insights: InsightOperacao[] = [];
  if (!resumo.viagens) return insights;

  const avgTonViag = resumo.tonMediaColeta;
  const avgKmViag = resumo.kmMedioViagem;
  const avgTonH = resumo.horas > 0 ? resumo.toneladas / resumo.horas : 0;

  const reservaOperando = analise.porPlaca.filter(
    (p) => p.viagens > 0 && ehPlacaReserva(p.chave, placasReserva),
  );
  if (reservaOperando.length > 0) {
    insights.push({
      severidade: 'info',
      titulo: 'Veículo reserva em operação',
      texto: `${reservaOperando.map((p) => p.chave).join(', ')} operou no dia (${reservaOperando.reduce((s, p) => s + p.viagens, 0)} viagem(ns) no total).`,
    });
  }

  // Não compara Mini com média geral do dia — isso gera falso gargalo.

  if (analise.porPlaca.length >= 2) {
    const top = analise.porPlaca[0];
    const pct = resumo.toneladas > 0 ? (top.toneladas / resumo.toneladas) * 100 : 0;
    if (pct >= 45) {
      insights.push({
        severidade: pct >= 60 ? 'atencao' : 'info',
        titulo: 'Concentração de volume em um veículo',
        texto: `${top.chave} concentrou ${fmtNum(pct, 0)}% das toneladas do dia — verifique balanceamento da frota.`,
      });
    }
  }

  const turnos = analise.porTurno.filter((t) => t.viagens > 0);
  if (turnos.length >= 2) {
    const pior = [...turnos].sort((a, b) => a.tonMediaViagem - b.tonMediaViagem)[0];
    if (avgTonViag > 0 && pior.tonMediaViagem < avgTonViag * 0.85) {
      insights.push({
        severidade: 'atencao',
        titulo: 'Turno com menor rendimento',
        texto: `Turno ${pior.chave}: ${fmtNum(pior.tonMediaViagem, 2)} t/viagem vs média do dia ${fmtNum(avgTonViag, 2)} t.`,
      });
    }
  }

  const regionais = analise.porRegional.filter((r) => r.viagens > 0);
  if (regionais.length >= 2) {
    const pior = [...regionais].sort((a, b) => a.tonMediaViagem - b.tonMediaViagem)[0];
    if (avgTonViag > 0 && pior.tonMediaViagem < avgTonViag * 0.85) {
      insights.push({
        severidade: 'atencao',
        titulo: 'Regional com menor rendimento',
        texto: `${pior.chave}: ${fmtNum(pior.tonMediaViagem, 2)} t/viagem vs média ${fmtNum(avgTonViag, 2)} t — possível gargalo logístico.`,
      });
    }
  }

  const placasKmAlto = analise.porPlaca.filter(
    (p) =>
      p.viagens >= 1
      && !ehPlacaReserva(p.chave, placasReserva)
      && avgKmViag > 0
      && p.kmMedioViagem > avgKmViag * 1.35,
  );
  if (placasKmAlto.length > 0 && analise.porPlaca.length >= 2) {
    insights.push({
      severidade: 'atencao',
      titulo: 'Deslocamento elevado por viagem',
      texto: `${placasKmAlto.slice(0, 3).map((p) => p.chave).join(', ')} com KM/viagem acima de 135% da média (${fmtNum(avgKmViag, 1)} km).`,
    });
  }

  const placasTonHBaixo = analise.porPlaca.filter((p) => {
    const tonH = p.horas > 0 ? p.toneladas / p.horas : 0;
    return (
      p.horas > 0
      && !ehPlacaReserva(p.chave, placasReserva)
      && avgTonH > 0
      && tonH < avgTonH * 0.7
    );
  });
  if (placasTonHBaixo.length > 0 && analise.porPlaca.length >= 2) {
    insights.push({
      severidade: 'critico',
      titulo: 'Baixa produtividade por hora',
      texto: `${placasTonHBaixo.slice(0, 3).map((p) => p.chave).join(', ')} com ton/h abaixo de 70% da média (${fmtNum(avgTonH, 2)} t/h).`,
    });
  }

  const mot = analise.porMotorista.filter((m) => m.viagens > 0);
  if (mot.length >= 3) {
    const pior = [...mot].sort((a, b) => a.tonMediaViagem - b.tonMediaViagem)[0];
    if (avgTonViag > 0 && pior.tonMediaViagem < avgTonViag * 0.75) {
      insights.push({
        severidade: 'atencao',
        titulo: 'Motorista com menor média do dia',
        texto: `${pior.chave}: ${fmtNum(pior.tonMediaViagem, 2)} t/viagem em ${fmtNum(pior.viagens, 0)} viagem(ns).`,
      });
    }
  }

  if (insights.length === 0) {
    insights.push({
      severidade: 'info',
      titulo: 'Operação dentro dos parâmetros',
      texto: `Nenhum desvio crítico detectado. Média: ${fmtNum(avgTonViag, 2)} t/viagem, ${fmtNum(avgKmViag, 1)} km/viagem, ${fmtNum(resumo.prodColetor, 2)} t/veículo.`,
    });
  }

  return insights.slice(0, 6);
}

function resolverTipoGrupo(
  grupo: LinhaOperacaoGrupo,
  opts?: OptsEficienciaContrato,
): TipoCaminhaoPeso | null {
  const direto = normalizarTipoCaminhaoPeso(grupo.tipoCaminhao);
  if (direto) return direto;
  if (opts?.tipoPorPlaca) {
    const key = String(grupo.chave || '').trim().toUpperCase();
    return opts.tipoPorPlaca.get(key) || null;
  }
  return null;
}

/** Classifica t/viagem do grupo vs peso ideal do tipo (nunca vs média geral do dia). */
export function classificarGrupoVsIdealTipo(
  grupo: LinhaOperacaoGrupo,
  opts?: OptsEficienciaContrato,
): {
  status: 'bom' | 'medio' | 'ruim';
  pctIdeal: number | null;
  pesoIdealKg: number | null;
  mediaRefLabel: string;
  notaIdeal: NotaIdealViagem | null;
  pctMediaTonViag: number;
} {
  const avgDia = 0; // não usar média do dia como referência principal
  const tipo = resolverTipoGrupo(grupo, opts);
  const pesoIdealKg = tipo
    ? calcularPesoIdealViagem({
      placa: grupo.chave,
      tipo,
      volumeOverrides: opts?.volumeL,
      densidade: densidadeOptsToInput(opts),
      porPlaca: opts?.densidadeKgLPorPlaca,
    }) || null
    : null;
  const pesoKg = grupo.tonMediaViagem * 1000;

  if (pesoIdealKg != null && pesoIdealKg > 0 && pesoKg > 0) {
    const pctIdeal = Math.round((pesoKg / pesoIdealKg) * 1000) / 10;
    const nota = notaDaFaixaIdeal(classificarPctIdeal(pctIdeal));
    return {
      status: statusPctVsMargemIdeal(pctIdeal),
      pctIdeal,
      pesoIdealKg,
      mediaRefLabel: LABEL_TIPO_CAMINHAO[tipo!],
      notaIdeal: nota,
      pctMediaTonViag: pctIdeal,
    };
  }

  // Sem tipo/ideal: não marca Mini como gargalo — status neutro (médio)
  return {
    status: 'medio',
    pctIdeal: null,
    pesoIdealKg: null,
    mediaRefLabel: tipo ? LABEL_TIPO_CAMINHAO[tipo] : 'sem tipo',
    notaIdeal: null,
    pctMediaTonViag: avgDia,
  };
}

/** Linhas por placa — eficiência vs ideal do tipo (Mini/Toco/…). */
export function montarEficienciaPlacas(
  analise: OperacaoDiaAnalise,
  placasReserva?: string[],
  opts?: OptsEficienciaContrato,
): LinhaEficienciaPlaca[] {
  const ordem = { ruim: 0, medio: 1, bom: 2 };
  return analise.porPlaca
    .filter((p) => p.chave !== '—')
    .map((p) => {
      const classif = classificarGrupoVsIdealTipo(p, opts);
      return {
        ...p,
        tonHora: p.horas > 0 ? p.toneladas / p.horas : 0,
        pctMediaTonViag: classif.pctMediaTonViag,
        status: classif.status,
        ehReserva: ehPlacaReserva(p.chave, placasReserva),
        mediaRefLabel: classif.mediaRefLabel,
        pesoIdealKg: classif.pesoIdealKg,
        pctIdeal: classif.pctIdeal,
        notaIdeal: classif.notaIdeal,
      };
    })
    .sort((a, b) => {
      const ds = ordem[a.status] - ordem[b.status];
      if (ds !== 0) return ds;
      return (a.pctIdeal ?? 999) - (b.pctIdeal ?? 999);
    });
}

/** Eficiência de motorista/turno/regional vs ideal do tipo predominante. */
export function montarEficienciaGrupos(
  linhas: LinhaOperacaoGrupo[],
  opts?: OptsEficienciaContrato,
): LinhaEficienciaPlaca[] {
  const ordem = { ruim: 0, medio: 1, bom: 2 };
  return linhas
    .filter((l) => l.chave && l.chave !== '—' && l.viagens > 0)
    .map((l) => {
      const classif = classificarGrupoVsIdealTipo(l, opts);
      return {
        ...l,
        tonHora: l.horas > 0 ? l.toneladas / l.horas : 0,
        pctMediaTonViag: classif.pctMediaTonViag,
        status: classif.status,
        mediaRefLabel: classif.mediaRefLabel,
        pesoIdealKg: classif.pesoIdealKg,
        pctIdeal: classif.pctIdeal,
        notaIdeal: classif.notaIdeal,
      };
    })
    .sort((a, b) => {
      const ds = ordem[a.status] - ordem[b.status];
      if (ds !== 0) return ds;
      return (a.pctIdeal ?? 999) - (b.pctIdeal ?? 999);
    });
}
