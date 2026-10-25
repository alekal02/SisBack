/* ============================================================
   PROJEÇÃO DE FECHAMENTO DO CICLO

   No meio do ciclo o total acumulado não diz se o mês vai fechar
   melhor ou pior que o anterior. O que decide é o ritmo:

     projeção  = realizado + ritmo atual × dias que faltam
     ritmo necessário = quanto falta para o alvo ÷ dias que faltam

   O alvo é o ciclo anterior fechado. Em toneladas, viagens e rotas
   o objetivo é superar; em KM é conter, então o ritmo necessário
   virou teto diário em vez de piso.
   ============================================================ */

export type SentidoMetaCiclo = 'superar' | 'conter';

export interface MetricaProjecaoCiclo {
  id: string;
  label: string;
  sufixo: string;
  casas: number;
  sentido: SentidoMetaCiclo;
  /** Acumulado no ciclo até agora. */
  realizado: number;
  /** Realizado ÷ dias decorridos. */
  ritmoAtual: number;
  /** Fechamento estimado se o ritmo atual se mantiver. */
  projecao: number;
  /** Total fechado do ciclo anterior, quando disponível. */
  alvo: number | null;
  /** Quanto falta (ou sobra, em KM) para bater o alvo. */
  faltaParaAlvo: number | null;
  /** Ritmo diário necessário nos dias restantes (piso ou teto). */
  ritmoNecessario: number | null;
  /** Projeção − alvo. */
  deltaProjecao: number | null;
  /** Projeção sobre o alvo, em %. */
  pctProjecao: number | null;
  /** true = a projeção bate o alvo no sentido desejado. */
  noRumo: boolean | null;
}

export interface TotaisCicloProjecao {
  viagens: number;
  toneladas: number;
  rotas: number;
  km: number;
}

export interface ProjecaoCiclo {
  diasDecorridos: number;
  diasCicloCompleto: number;
  diasRestantes: number;
  cicloFechado: boolean;
  temAlvo: boolean;
  metricas: MetricaProjecaoCiclo[];
  /** Frase curta com o que precisa mudar de ritmo. */
  leitura: string;
}

interface DefinicaoProjecao {
  id: string;
  label: string;
  sufixo: string;
  casas: number;
  sentido: SentidoMetaCiclo;
  ler: (t: TotaisCicloProjecao) => number;
}

const DEFINICOES: DefinicaoProjecao[] = [
  {
    id: 'toneladas',
    label: 'Toneladas',
    sufixo: ' t',
    casas: 1,
    sentido: 'superar',
    ler: (t) => t.toneladas,
  },
  {
    id: 'viagens',
    label: 'Viagens',
    sufixo: '',
    casas: 0,
    sentido: 'superar',
    ler: (t) => t.viagens,
  },
  {
    id: 'rotas',
    label: 'Rotas',
    sufixo: '',
    casas: 0,
    sentido: 'superar',
    ler: (t) => t.rotas,
  },
  {
    id: 'km',
    label: 'KM',
    sufixo: ' km',
    casas: 0,
    sentido: 'conter',
    ler: (t) => t.km,
  },
];

function arred(n: number, casas = 2): number {
  const f = 10 ** casas;
  return Math.round(n * f) / f;
}

function fmt(n: number, casas: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

function montarLeitura(m: ProjecaoCiclo): string {
  if (!m.temAlvo) {
    return m.cicloFechado
      ? 'Ciclo fechado. Sem ciclo anterior para comparar o fechamento.'
      : 'Sem ciclo anterior fechado para servir de alvo; a projeção usa só o ritmo atual.';
  }
  if (m.cicloFechado) {
    const atras = m.metricas.filter((x) => x.noRumo === false);
    if (!atras.length) return 'Ciclo fechado acima do ciclo anterior em todos os indicadores.';
    return `Ciclo fechado abaixo do anterior em ${atras.map((x) => x.label.toLowerCase()).join(', ')}.`;
  }

  const foraDeRumo = m.metricas.filter((x) => x.noRumo === false && x.ritmoNecessario != null);
  if (!foraDeRumo.length) {
    return `No ritmo atual, o ciclo fecha acima do anterior em todos os indicadores nos ${m.diasRestantes} dia(s) que faltam.`;
  }

  const ritmo = (x: MetricaProjecaoCiclo) =>
    `${fmt(x.ritmoNecessario as number, x.casas)}${x.sufixo}/dia`;

  const partes: string[] = [];
  const aSuperar = foraDeRumo.filter((x) => x.sentido === 'superar');
  if (aSuperar.length) {
    const frases = aSuperar.slice(0, 3).map((x) => `${x.label.toLowerCase()} precisa de ${ritmo(x)}`);
    partes.push(`Para superar o ciclo anterior nos ${m.diasRestantes} dia(s) restantes: ${frases.join(', ')}`);
  }

  // KM fora de rumo é estouro, não atraso: entra como teto diário.
  const aConter = foraDeRumo.filter((x) => x.sentido === 'conter');
  if (aConter.length) {
    const frases = aConter.map((x) => `${x.label.toLowerCase()} precisa ficar em ${ritmo(x)}`);
    partes.push(`${partes.length ? 'e ' : `Projeção acima do ciclo anterior: `}${frases.join(', ')}`);
  }

  return `${partes.join(', ')}.`;
}

/**
 * Projeta o fechamento do ciclo e o ritmo diário necessário para bater
 * o ciclo anterior. `diasDecorridos` é o calendário do recorte (não só
 * os dias operados), o mesmo denominador das médias diárias do ciclo.
 */
export function montarProjecaoCiclo(opts: {
  totaisAtual: TotaisCicloProjecao;
  totaisAnterior?: TotaisCicloProjecao | null;
  diasDecorridos: number;
  diasCicloCompleto: number;
}): ProjecaoCiclo | null {
  const diasDecorridos = Math.max(0, Math.floor(opts.diasDecorridos || 0));
  const diasCicloCompleto = Math.max(0, Math.floor(opts.diasCicloCompleto || 0));
  if (diasDecorridos <= 0 || diasCicloCompleto <= 0) return null;

  const diasRestantes = Math.max(0, diasCicloCompleto - diasDecorridos);
  const cicloFechado = diasRestantes === 0;
  const anterior = opts.totaisAnterior || null;
  const temAlvo = !!anterior
    && DEFINICOES.some((d) => d.ler(anterior) > 0);

  const metricas: MetricaProjecaoCiclo[] = DEFINICOES.map((def) => {
    const realizado = Math.max(0, Number(def.ler(opts.totaisAtual) || 0));
    const ritmoAtual = realizado / diasDecorridos;
    const projecao = realizado + ritmoAtual * diasRestantes;
    const alvoBruto = anterior ? Number(def.ler(anterior) || 0) : 0;
    const alvo = temAlvo && alvoBruto > 0 ? alvoBruto : null;

    const falta = alvo != null ? alvo - realizado : null;
    const deltaProjecao = alvo != null ? projecao - alvo : null;
    const superar = def.sentido === 'superar';

    let ritmoNecessario: number | null = null;
    if (alvo != null && diasRestantes > 0) {
      // Piso diário para superar; teto diário para conter. Nunca negativo.
      ritmoNecessario = Math.max(0, (falta as number) / diasRestantes);
    }

    let noRumo: boolean | null = null;
    if (deltaProjecao != null) {
      noRumo = superar ? deltaProjecao >= 0 : deltaProjecao <= 0;
    }

    return {
      id: def.id,
      label: def.label,
      sufixo: def.sufixo,
      casas: def.casas,
      sentido: def.sentido,
      realizado: arred(realizado, def.casas),
      ritmoAtual: arred(ritmoAtual, def.casas + 1),
      projecao: arred(projecao, def.casas),
      alvo: alvo != null ? arred(alvo, def.casas) : null,
      faltaParaAlvo: falta != null ? arred(falta, def.casas) : null,
      ritmoNecessario: ritmoNecessario != null ? arred(ritmoNecessario, def.casas + 1) : null,
      deltaProjecao: deltaProjecao != null ? arred(deltaProjecao, def.casas) : null,
      pctProjecao: alvo ? arred((projecao / alvo) * 100, 1) : null,
      noRumo,
    };
  });

  const resultado: ProjecaoCiclo = {
    diasDecorridos,
    diasCicloCompleto,
    diasRestantes,
    cicloFechado,
    temAlvo,
    metricas,
    leitura: '',
  };
  resultado.leitura = montarLeitura(resultado);
  return resultado;
}
