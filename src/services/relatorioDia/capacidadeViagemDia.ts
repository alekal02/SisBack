/**
 * Capacidade viagem a viagem (PESO 1–4) vs ideal do tipo — PDF WhatsApp / servidor.
 */
import AppDataSource from '../../database/data-source';
import { ColetaData } from '../../entities/ColetaData';
import { PlanilhaUpload } from '../../entities/PlanilhaUpload';
import {
  TIPOS_CAMINHAO_ORDEM,
  normalizarTipoCaminhaoPeso,
  resolverLimitesDoContrato,
  type LimitesPesoKg,
  type LimitesVolumeL,
  type TipoCaminhaoPeso,
} from '../../config/pesoMaximoCaminhao';
import { aplicarFiltroViagensValidasDashboard } from '../validacaoViagemService';
import {
  COR_NOTA_IDEAL,
  LABEL_FAIXA_IDEAL,
  LABEL_NOTA_IDEAL,
  LABEL_TIPO_CAMINHAO,
  PCT_IDEAL_MAX,
  PCT_IDEAL_MIN,
  calcularPesoIdealViagem,
  classificarPesoVsIdeal,
  densidadeOptsToInput,
  resolverDensidadeParaViagem,
  resolverPesosIdeaisKg,
  textoEscalaIdealCurto,
  type FaixaIdealViagem,
  type NotaIdealViagem,
} from './escalaIdealPeso';
import { normalizarPlaca } from '../../utils/normalizarPlaca';
import { esc, fmtNum } from './fmt';

export interface ViagemCapacidadeItem {
  placa: string;
  motorista: string;
  rota: string;
  tipo: TipoCaminhaoPeso | null;
  tipoLabel: string;
  pesoKg: number;
  limiteKg: number | null;
  pesoIdealKg: number | null;
  /** Densidade efetiva (kg/L) usada no ideal desta viagem. */
  densidadeKgL: number | null;
  mediaTipoKg: number | null;
  ocupacaoPct: number | null;
  pctMediaTipo: number | null;
  faixaIdeal: FaixaIdealViagem | null;
  notaIdeal: NotaIdealViagem | null;
  acimaPesoMax: boolean;
}

export interface ResumoCapacidadeDia {
  pesosIdeaisAplicados: Record<TipoCaminhaoPeso, number>;
  viagensComPeso: number;
  otimo: number;
  ruim: number;
  pessimo: number;
  viagens: ViagemCapacidadeItem[];
  porTipo: Array<{
    tipo: TipoCaminhaoPeso;
    label: string;
    viagens: number;
    mediaPesoKg: number;
    pesoIdealKg: number;
    otimo: number;
    ruim: number;
    pessimo: number;
  }>;
}

export interface RankingViagemItem {
  id: string;
  placa: string;
  tipo: TipoCaminhaoPeso | null;
  tipoLabel: string;
  rota: string;
  toneladas: number;
  pesoIdealKg: number | null;
  densidadeKgL: number | null;
  pctIdeal: number | null;
  pctMediaTipo: number | null;
  status: NotaIdealViagem;
  faixaLabel: string;
  pctRef: number;
  desvioAbsPct: number;
}

async function getUploadIds(servicoId: string): Promise<number[]> {
  const rows = await AppDataSource.getRepository(PlanilhaUpload).find({
    where: { servico_id: servicoId },
    select: ['id'],
  });
  return rows.map((u) => u.id);
}

export async function carregarViagensCapacidadeDia(
  servicoId: string,
  dataIso: string,
  opts?: {
    volumeL?: Partial<LimitesVolumeL> | null;
    pesoMaximoKg?: Partial<LimitesPesoKg> | null;
    densidadeResiduoKgL?: number | null;
    densidadeKgL?: Partial<Record<TipoCaminhaoPeso, number>> | null;
    densidadeKgLPorPlaca?: Record<string, number> | null;
  },
): Promise<ResumoCapacidadeDia> {
  return carregarViagensCapacidadePeriodo(servicoId, dataIso, dataIso, opts);
}

/** Capacidade PESO 1–4 no intervalo (ciclo / quinzena / semana). */
export async function carregarViagensCapacidadePeriodo(
  servicoId: string,
  dataInicio: string,
  dataFim: string,
  opts?: {
    volumeL?: Partial<LimitesVolumeL> | null;
    pesoMaximoKg?: Partial<LimitesPesoKg> | null;
    densidadeResiduoKgL?: number | null;
    densidadeKgL?: Partial<Record<TipoCaminhaoPeso, number>> | null;
    densidadeKgLPorPlaca?: Record<string, number> | null;
  },
): Promise<ResumoCapacidadeDia> {
  const densInput = densidadeOptsToInput(opts);
  const vazio: ResumoCapacidadeDia = {
    pesosIdeaisAplicados: resolverPesosIdeaisKg(opts?.volumeL, densInput),
    viagensComPeso: 0,
    otimo: 0,
    ruim: 0,
    pessimo: 0,
    viagens: [],
    porTipo: [],
  };

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataInicio) || !/^\d{4}-\d{2}-\d{2}$/.test(dataFim)) return vazio;
  const uploadIds = await getUploadIds(servicoId);
  if (!uploadIds.length) return vazio;

  const qb = AppDataSource.getRepository(ColetaData)
    .createQueryBuilder('c')
    .select([
      'c.placa',
      'c.motorista',
      'c.distrito',
      'c.regional',
      'c.tipoCaminhao',
      'c.peso1',
      'c.peso2',
      'c.peso3',
      'c.peso4',
    ])
    .where('c.planilhaUploadId IN (:...uploadIds)', { uploadIds })
    .andWhere('c.dataSaida >= :inicio', { inicio: `${dataInicio}T00:00:00.000Z` })
    .andWhere('c.dataSaida <= :fim', { fim: `${dataFim}T23:59:59.999Z` });
  aplicarFiltroViagensValidasDashboard(qb, 'c');

  const rows = await qb.getMany();
  const limites = resolverLimitesDoContrato({
    pesoMaximoKg: opts?.pesoMaximoKg,
    volumeL: opts?.volumeL,
  });
  const ideais = resolverPesosIdeaisKg(opts?.volumeL, densInput);

  const brutos: Array<Omit<ViagemCapacidadeItem, 'mediaTipoKg' | 'pctMediaTipo'>> = [];

  for (const row of rows) {
    const tipo = normalizarTipoCaminhaoPeso(row.tipoCaminhao);
    const limiteKg = tipo ? limites.peso[tipo] : null;
    const placaNorm = normalizarPlaca(row.placa) || '—';
    const densOpts = {
      placa: placaNorm !== '—' ? placaNorm : null,
      tipo,
      densidade: densInput,
      porPlaca: opts?.densidadeKgLPorPlaca,
    };
    const densidadeKgL = tipo ? resolverDensidadeParaViagem(densOpts) : null;
    const pesoIdealCalc = tipo
      ? calcularPesoIdealViagem({
        ...densOpts,
        volumeOverrides: opts?.volumeL,
      })
      : 0;
    const pesoIdealKg = pesoIdealCalc > 0 ? pesoIdealCalc : null;
    const placa = placaNorm;
    const rota = String(row.distrito || row.regional || '').trim() || '—';
    const pesos = [row.peso1, row.peso2, row.peso3, row.peso4]
      .map((p) => Number(p))
      .filter((p) => Number.isFinite(p) && p > 0);

    for (const pesoKg of pesos) {
      const tetoFiltro = limiteKg ?? (pesoIdealKg != null ? pesoIdealKg * 2 : null);
      if (tetoFiltro != null && pesoKg > tetoFiltro * 1.5) continue;

      const acimaPesoMax = limiteKg != null && limiteKg > 0 && pesoKg > limiteKg;
      let faixaIdeal: FaixaIdealViagem | null = null;
      let notaIdeal: NotaIdealViagem | null = null;
      let ocupacaoPct: number | null = null;

      const refKg = pesoIdealKg && pesoIdealKg > 0 ? pesoIdealKg : limiteKg;
      if (refKg && refKg > 0) {
        const classif = classificarPesoVsIdeal(pesoKg, refKg);
        faixaIdeal = classif.faixa;
        notaIdeal = classif.nota;
        ocupacaoPct = classif.pctIdeal;
        if (acimaPesoMax && notaIdeal === 'otimo') {
          notaIdeal = 'ruim';
          faixaIdeal = 'ruim_alto';
        }
      }

      brutos.push({
        placa,
        motorista: String(row.motorista || '').trim() || '—',
        rota,
        tipo,
        tipoLabel: tipo ? LABEL_TIPO_CAMINHAO[tipo] : (row.tipoCaminhao || 'Não informado'),
        pesoKg: Math.round(pesoKg * 100) / 100,
        limiteKg,
        pesoIdealKg,
        densidadeKgL,
        ocupacaoPct,
        faixaIdeal,
        notaIdeal,
        acimaPesoMax,
      });
    }
  }

  const somaPorTipo = new Map<TipoCaminhaoPeso, { soma: number; n: number }>();
  for (const item of brutos) {
    if (!item.tipo || !(item.pesoKg > 0)) continue;
    const acc = somaPorTipo.get(item.tipo) || { soma: 0, n: 0 };
    acc.soma += item.pesoKg;
    acc.n += 1;
    somaPorTipo.set(item.tipo, acc);
  }

  const viagens: ViagemCapacidadeItem[] = brutos.map((item) => {
    const mediaTipoKg = item.tipo
      ? (somaPorTipo.get(item.tipo) ? somaPorTipo.get(item.tipo)!.soma / somaPorTipo.get(item.tipo)!.n : null)
      : null;
    const pctMediaTipo = mediaTipoKg && mediaTipoKg > 0
      ? Math.round((item.pesoKg / mediaTipoKg) * 1000) / 10
      : null;
    return { ...item, mediaTipoKg, pctMediaTipo };
  });

  const porTipo = TIPOS_CAMINHAO_ORDEM
    .map((tipo) => {
      const doTipo = viagens.filter((v) => v.tipo === tipo);
      if (!doTipo.length) return null;
      const media = somaPorTipo.get(tipo);
      return {
        tipo,
        label: LABEL_TIPO_CAMINHAO[tipo],
        viagens: doTipo.length,
        mediaPesoKg: media ? Math.round((media.soma / media.n) * 100) / 100 : 0,
        pesoIdealKg: ideais[tipo],
        otimo: doTipo.filter((v) => v.notaIdeal === 'otimo').length,
        ruim: doTipo.filter((v) => v.notaIdeal === 'ruim').length,
        pessimo: doTipo.filter((v) => v.notaIdeal === 'pessimo').length,
      };
    })
    .filter(Boolean) as ResumoCapacidadeDia['porTipo'];

  return {
    pesosIdeaisAplicados: ideais,
    viagensComPeso: viagens.length,
    otimo: viagens.filter((v) => v.notaIdeal === 'otimo').length,
    ruim: viagens.filter((v) => v.notaIdeal === 'ruim').length,
    pessimo: viagens.filter((v) => v.notaIdeal === 'pessimo').length,
    viagens,
    porTipo,
  };
}

export function montarRankingViagensPorTipo(
  capacidade: ResumoCapacidadeDia | null | undefined,
): RankingViagemItem[] {
  if (!capacidade?.viagens?.length) return [];
  const ordem: Record<NotaIdealViagem, number> = { pessimo: 0, ruim: 1, otimo: 2 };

  return capacidade.viagens
    .filter((v) => v.pesoKg > 0)
    .map((v, i) => {
      const pctRef = v.ocupacaoPct ?? v.pctMediaTipo ?? 100;
      const status: NotaIdealViagem = v.notaIdeal || 'ruim';
      return {
        id: `${v.placa}-${v.tipo || 'x'}-${i}-${Math.round(v.pesoKg)}`,
        placa: v.placa,
        tipo: v.tipo,
        tipoLabel: v.tipoLabel,
        rota: v.rota,
        toneladas: Math.round((v.pesoKg / 1000) * 100) / 100,
        pesoIdealKg: v.pesoIdealKg,
        densidadeKgL: v.densidadeKgL ?? null,
        pctIdeal: v.ocupacaoPct,
        pctMediaTipo: v.pctMediaTipo,
        status,
        faixaLabel: v.faixaIdeal ? LABEL_FAIXA_IDEAL[v.faixaIdeal] : LABEL_NOTA_IDEAL[status],
        pctRef,
        desvioAbsPct: Math.abs(pctRef - 100),
      };
    })
    .sort((a, b) => {
      const ds = ordem[a.status] - ordem[b.status];
      if (ds !== 0) return ds;
      return b.desvioAbsPct - a.desvioAbsPct;
    });
}

function statusBadgeNota(status: NotaIdealViagem): string {
  const cls = status === 'pessimo' ? 'st-ruim' : status === 'ruim' ? 'st-medio' : 'st-bom';
  return `<span class="${cls}">${LABEL_NOTA_IDEAL[status]}</span>`;
}

/** HTML: desempenho médio por tipo vs ideal. */
export function blocoDesempenhoPorTipoHtml(capacidade: ResumoCapacidadeDia | null | undefined): string {
  if (!capacidade?.porTipo?.length) return '';

  const maxKg = Math.max(
    ...capacidade.porTipo.flatMap((t) => [t.pesoIdealKg, t.mediaPesoKg]),
    1,
  );

  const cards = capacidade.porTipo.map((t) => {
    const pct = t.pesoIdealKg > 0
      ? Math.round((t.mediaPesoKg / t.pesoIdealKg) * 1000) / 10
      : null;
    const fora = pct != null && (pct < PCT_IDEAL_MIN || pct > PCT_IDEAL_MAX);
    const wIdeal = Math.max(2, Math.round((t.pesoIdealKg / maxKg) * 100));
    const wCol = Math.max(2, Math.round((t.mediaPesoKg / maxKg) * 100));
    const cor = fora ? '#ef4444' : '#16a34a';
    return `
    <div class="vg-card${fora ? ' g' : ''}" style="border:1px solid #e2e8f0;border-radius:6px;padding:6px;margin-bottom:5px;${fora ? 'background:#fef2f2' : ''}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <strong style="font-size:8px">${esc(t.label)}</strong>
        <span class="${fora ? 'st-ruim' : 'st-bom'}">${fora ? 'FORA' : 'ÓTIMO'}${pct != null ? ` ${fmtNum(pct, 0)}%` : ''}</span>
      </div>
      <div style="font-size:6px;color:#64748b;margin-bottom:3px">
        ${fmtNum(t.viagens, 0)} viag. · média ${fmtNum(t.mediaPesoKg, 0)} kg · ideal ${fmtNum(t.pesoIdealKg, 0)} kg
        · P${fmtNum(t.pessimo, 0)} R${fmtNum(t.ruim, 0)} Ó${fmtNum(t.otimo, 0)}
      </div>
      <div style="height:7px;background:#f1f5f9;border-radius:3px;margin-bottom:2px;position:relative">
        <span style="display:block;width:${wIdeal}%;height:7px;background:#c4b5fd;border-radius:3px;opacity:0.7"></span>
      </div>
      <div style="height:7px;background:#f1f5f9;border-radius:3px">
        <span style="display:block;width:${wCol}%;height:7px;background:${cor};border-radius:3px"></span>
      </div>
    </div>`;
  }).join('');

  return `
  <div class="sec">Desempenho por tipo — peso ideal × média do dia</div>
  <p style="font-size:6.5px;color:#64748b;margin-bottom:5px">Barra roxa = ideal · colorida = média coletada. ${esc(textoEscalaIdealCurto())}</p>
  ${cards}`;
}

/** HTML: ranking viagem a viagem (substitui ranking por placa vs média do dia). */
export function blocoRankingViagensHtml(capacidade: ResumoCapacidadeDia | null | undefined): string {
  const ranking = montarRankingViagensPorTipo(capacidade);
  if (!ranking.length) {
    return `
    <div class="sec">Ranking de produção por viagem</div>
    <p style="font-size:6.5px;color:#94a3b8">Sem pesos individuais (PESO 1–4) no dia para rankear viagem a viagem.</p>`;
  }

  const tipos = TIPOS_CAMINHAO_ORDEM.filter((t) => ranking.some((r) => r.tipo === t));

  const blocos = tipos.map((tipo) => {
    const vs = ranking.filter((v) => v.tipo === tipo);
    if (!vs.length) return '';
    const ideal = capacidade?.pesosIdeaisAplicados[tipo];
    const maxTon = Math.max(...vs.map((v) => v.toneladas), 0.01);
    const nP = vs.filter((v) => v.status === 'pessimo').length;
    const nR = vs.filter((v) => v.status === 'ruim').length;
    const nO = vs.filter((v) => v.status === 'otimo').length;

    const rows = vs.map((v) => {
      const barW = Math.max(4, Math.round((v.toneladas / maxTon) * 100));
      const cor = COR_NOTA_IDEAL[v.status];
      const lbl = v.placa.length > 9 ? `${v.placa.slice(0, 9)}…` : v.placa;
      const detalhe = [
        '1 viag.',
        `${fmtNum(v.toneladas, 2)} t/viag`,
        v.densidadeKgL != null && v.densidadeKgL > 0 ? `dens. ${fmtNum(v.densidadeKgL, 2)} kg/L` : null,
        v.pesoIdealKg != null && v.pesoIdealKg > 0 ? `ideal ${fmtNum(v.pesoIdealKg, 0)} kg` : null,
        v.pctIdeal != null ? `${fmtNum(v.pctIdeal, 0)}% do ideal` : null,
        esc(v.faixaLabel),
        v.rota && v.rota !== '—' ? esc(v.rota.length > 18 ? `${v.rota.slice(0, 18)}…` : v.rota) : null,
      ].filter(Boolean).join(' · ');
      return `
        <div class="bar-row">
          <div class="bar-lbl">${esc(lbl)}<div>${statusBadgeNota(v.status)}</div></div>
          <div class="bar-track"><span class="bar-fill" style="width:${barW}%;background:${cor}"></span></div>
          <div class="bar-val" style="color:#1d4ed8">${fmtNum(v.toneladas, 1)} t</div>
        </div>
        <div class="bar-detail">${detalhe}</div>`;
    }).join('');

    return `
    <div class="bloco" style="margin-bottom:7px">
      <div class="bloco-hd">${esc(LABEL_TIPO_CAMINHAO[tipo])}
        — ${fmtNum(vs.length, 0)} viagem(ns)
        · Péssimo ${fmtNum(nP, 0)} · Ruim ${fmtNum(nR, 0)} · Ótimo ${fmtNum(nO, 0)}
        ${ideal != null && ideal > 0 ? ` · ideal tipo ${fmtNum(ideal, 0)} kg` : ''}
      </div>
      ${rows}
    </div>`;
  }).join('');

  const densLinhas = (() => {
    if (!capacidade?.viagens?.length) return '';
    const porPlaca = new Map<string, { dens: number; tipoLabel: string; ideal: number | null; n: number }>();
    for (const v of capacidade.viagens) {
      if (!(v.densidadeKgL != null && v.densidadeKgL > 0) || !v.placa || v.placa === '—') continue;
      const atual = porPlaca.get(v.placa);
      if (atual) { atual.n += 1; continue; }
      porPlaca.set(v.placa, {
        dens: v.densidadeKgL,
        tipoLabel: v.tipoLabel,
        ideal: v.pesoIdealKg,
        n: 1,
      });
    }
    if (!porPlaca.size) return '';
    const body = [...porPlaca.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([placa, info]) => `
      <tr>
        <td style="font-weight:700">${esc(placa)}</td>
        <td>${esc(info.tipoLabel)}</td>
        <td class="c" style="font-weight:700;color:#0f766e">${fmtNum(info.dens, 2)} kg/L</td>
        <td class="c">${info.ideal != null ? `${fmtNum(info.ideal, 0)} kg` : '—'}</td>
        <td class="c">${fmtNum(info.n, 0)}</td>
      </tr>`).join('');
    return `
    <div class="bloco" style="margin-bottom:7px">
      <div class="bloco-hd">Densidade por caminhão no dia</div>
      <table class="data">
        <thead><tr><th>Placa</th><th>Tipo</th><th class="c">Densidade</th><th class="c">Peso ideal</th><th class="c">Viag.</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
  })();

  return `
  <div class="sec">Ranking de produção por viagem</div>
  <p style="font-size:6.5px;color:#64748b;margin-bottom:5px">
    Cada barra = <strong>1 viagem</strong> (PESO 1–4) vs <strong>ideal da placa</strong> (volume × densidade; fallback = tipo).
    ${esc(textoEscalaIdealCurto())}.
  </p>
  ${densLinhas}
  <table class="kpi-grid" style="margin-bottom:6px"><tr>
    <td class="kpi-card"><div class="kpi-lbl">Péssimo</div><div class="kpi-val" style="color:#b91c1c">${fmtNum(capacidade?.pessimo ?? 0, 0)}</div></td>
    <td class="kpi-card"><div class="kpi-lbl">Ruim</div><div class="kpi-val" style="color:#ea580c">${fmtNum(capacidade?.ruim ?? 0, 0)}</div></td>
    <td class="kpi-card"><div class="kpi-lbl">Ótimo</div><div class="kpi-val" style="color:#16a34a">${fmtNum(capacidade?.otimo ?? 0, 0)}</div></td>
    <td class="kpi-card"><div class="kpi-lbl">Viagens</div><div class="kpi-val">${fmtNum(capacidade?.viagensComPeso ?? 0, 0)}</div></td>
  </tr></table>
  ${blocos}`;
}
