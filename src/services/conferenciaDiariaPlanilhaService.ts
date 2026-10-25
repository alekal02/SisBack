export interface MetricasDiaOperacao {
  rotas: number;
  viagens: number;
  pesoKg: number;
  km: number;
}

export type StatusDiaConferencia = 'novo' | 'igual' | 'divergente' | 'bloqueado' | 'somente_sistema';

export interface DiaConferenciaOperacao {
  data: string;
  dataBr: string;
  status: StatusDiaConferencia;
  planilha: MetricasDiaOperacao | null;
  sistema: MetricasDiaOperacao | null;
  diferencas: string[];
}

export interface ConferenciaDiariaPlanilha {
  totalDatasPlanilha: number;
  diasNovos: number;
  diasIguais: number;
  diasDivergentes: number;
  diasBloqueados: number;
  /** Dias no sistema que não estão na planilha nova — serão removidos na importação */
  diasSomenteSistema: number;
  temDivergencia: boolean;
  ultimaDataPlanilha: string | null;
  ultimaDataSistema: string | null;
  recomendacao: string;
  dias: DiaConferenciaOperacao[];
}

export function formatarDataBr(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function compararMetricasDia(
  planilha: MetricasDiaOperacao,
  sistema: MetricasDiaOperacao,
): string[] {
  const difs: string[] = [];
  if (planilha.rotas !== sistema.rotas) {
    difs.push(`Rotas: sistema ${sistema.rotas} → planilha ${planilha.rotas}`);
  }
  if (planilha.viagens !== sistema.viagens) {
    difs.push(`Viagens: sistema ${sistema.viagens} → planilha ${planilha.viagens}`);
  }
  const pesoPlan = Math.round(planilha.pesoKg);
  const pesoSis = Math.round(sistema.pesoKg);
  if (Math.abs(pesoPlan - pesoSis) > 1) {
    difs.push(`Peso: sistema ${(sistema.pesoKg / 1000).toFixed(1)} t → planilha ${(planilha.pesoKg / 1000).toFixed(1)} t`);
  }
  const kmPlan = Math.round(planilha.km);
  const kmSis = Math.round(sistema.km);
  if (Math.abs(kmPlan - kmSis) > 1) {
    difs.push(`KM: sistema ${Math.round(sistema.km)} → planilha ${Math.round(planilha.km)}`);
  }
  return difs;
}

export function montarRecomendacaoConferencia(r: {
  diasNovos: number;
  diasDivergentes: number;
  diasBloqueados: number;
  diasSomenteSistema?: number;
  temPlanilhaAnterior: boolean;
}): string {
  if (r.diasBloqueados > 0) {
    return `${r.diasBloqueados} dia(s) em ciclo fechado — remova da planilha ou reabra o ciclo antes de importar.`;
  }
  const partes: string[] = [];
  if (r.diasDivergentes > 0 && r.temPlanilhaAnterior) {
    partes.push(`${r.diasDivergentes} dia(s) serão atualizados com a planilha nova`);
  }
  if (r.diasNovos > 0) {
    partes.push(`${r.diasNovos} dia(s) novo(s) serão adicionados`);
  }
  if ((r.diasSomenteSistema || 0) > 0) {
    partes.push(`${r.diasSomenteSistema} dia(s) só no sistema serão removidos`);
  }
  if (partes.length > 0) {
    return `${partes.join('; ')}. A planilha antiga será substituída pela nova.`;
  }
  if (!r.temPlanilhaAnterior) {
    return 'Primeira importação — todos os dias válidos da planilha entrarão no sistema.';
  }
  return 'Planilha confere com o sistema — ao importar, a planilha antiga será substituída pela nova.';
}
