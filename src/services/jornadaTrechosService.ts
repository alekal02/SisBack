/* ============================================================
   JORNADA EM TRECHOS — onde a hora e o KM improdutivos são gastos

   A planilha registra hora e hodômetro em cada ponto da jornada:
   base → chegada/saída de cada rota (01–04) → base. Isso permite
   separar o tempo dentro da rota (coleta) do tempo fora dela, e
   dizer QUAL trecho consumiu a hora improdutiva:

     base → rota 01        deslocamento inicial
     chegada → saída rota  coleta (produtivo)
     saída rota → rota+1   entre rotas (inclui descarga/aterro)
     saída última → base   retorno final

   Os totais de hora e KM continuam vindo das funções canônicas
   (`calcularHorasProdutivaImprodutivaRegistro`, `KM TOTAL`), para
   que a decomposição nunca divirja dos números já exibidos.
   ============================================================ */

import {
  calcularHorasProdutivaImprodutivaRegistro,
  calcularKmNasRotasRegistro,
  diffHorasSaidaChegada,
  lerHoraChegadaBase,
  lerHoraChegadaRota,
  lerHoraSaidaBase,
  lerHoraSaidaRota,
  lerKmChegadaBase,
  lerKmChegadaRota,
  lerKmSaidaBase,
  lerKmSaidaRota,
} from './horasProdutivasService';
import { contarViagensPorRotaRegistro, obterPesoTotalRegistro } from './viagensPorRotaService';

/** Distância plausível para um trecho isolado da jornada (km). */
const MAX_KM_TRECHO = 300;
/** Total de rotas por linha de planilha. */
const TOTAL_ROTAS = 4;

export type TipoTrechoJornada =
  | 'coleta'
  | 'deslocamento_inicial'
  | 'entre_rotas'
  | 'retorno_final';

export const ROTULO_TRECHO: Record<TipoTrechoJornada, string> = {
  coleta: 'Coleta na rota',
  deslocamento_inicial: 'Deslocamento inicial',
  entre_rotas: 'Entre rotas (descarga/aterro)',
  retorno_final: 'Retorno à base',
};

export interface TrechoJornada {
  tipo: TipoTrechoJornada;
  /** Ex.: "Base → Rota 01", "Rota 01", "Rota 01 → Rota 02", "Rota 03 → Base". */
  rotulo: string;
  horas: number;
  km: number | null;
}

export interface JornadaDecomposta {
  horasTotais: number;
  horasProdutivas: number;
  horasImprodutivas: number;
  horasDeslocamentoInicial: number;
  horasEntreRotas: number;
  horasRetornoFinal: number;
  /** Improdutiva que a planilha não permitiu atribuir a um trecho. */
  horasImprodutivasNaoDetalhadas: number;

  kmTotal: number;
  kmProdutivo: number;
  kmImprodutivo: number;
  kmDeslocamentoInicial: number;
  kmEntreRotas: number;
  kmRetornoFinal: number;
  kmImprodutivoNaoDetalhado: number;

  trechos: TrechoJornada[];
  rotasComHorario: number;
  viagens: number;
  toneladas: number;
  /** true quando a soma dos trechos precisou ser ajustada ao total da jornada. */
  ajustado: boolean;
}

type TipoPonto = 'base_saida' | 'rota_chegada' | 'rota_saida' | 'base_chegada';

interface PontoJornada {
  tipo: TipoPonto;
  rota?: number;
  hora: number;
  km: number;
}

function arred(n: number): number {
  return Math.round(n * 100) / 100;
}

function kmTrechoPlausivel(km: number): boolean {
  return Number.isFinite(km) && km > 0 && km <= MAX_KM_TRECHO;
}

function nomePonto(p: PontoJornada): string {
  if (p.tipo === 'base_saida' || p.tipo === 'base_chegada') return 'Base';
  return `Rota 0${p.rota}`;
}

/** Pontos da jornada em ordem cronológica, só os que têm hora informada. */
function montarPontos(obj: Record<string, any>): PontoJornada[] {
  const pontos: PontoJornada[] = [];

  const horaSaidaBase = lerHoraSaidaBase(obj);
  if (horaSaidaBase > 0) {
    pontos.push({ tipo: 'base_saida', hora: horaSaidaBase, km: lerKmSaidaBase(obj) });
  }

  for (let n = 1; n <= TOTAL_ROTAS; n++) {
    const horaChegada = lerHoraChegadaRota(obj, n);
    if (horaChegada > 0) {
      pontos.push({ tipo: 'rota_chegada', rota: n, hora: horaChegada, km: lerKmChegadaRota(obj, n) });
    }
    const horaSaida = lerHoraSaidaRota(obj, n);
    if (horaSaida > 0) {
      pontos.push({ tipo: 'rota_saida', rota: n, hora: horaSaida, km: lerKmSaidaRota(obj, n) });
    }
  }

  const horaChegadaBase = lerHoraChegadaBase(obj);
  if (horaChegadaBase > 0) {
    pontos.push({ tipo: 'base_chegada', hora: horaChegadaBase, km: lerKmChegadaBase(obj) });
  }

  return pontos;
}

/** Classifica a transição entre dois pontos consecutivos; null = não classificável. */
function tipoDaTransicao(de: PontoJornada, para: PontoJornada): TipoTrechoJornada | null {
  if (de.tipo === 'base_saida' && para.tipo === 'rota_chegada') return 'deslocamento_inicial';
  if (de.tipo === 'rota_chegada' && para.tipo === 'rota_saida' && de.rota === para.rota) return 'coleta';
  if (de.tipo === 'rota_saida' && para.tipo === 'rota_chegada') return 'entre_rotas';
  if (de.tipo === 'rota_saida' && para.tipo === 'base_chegada') return 'retorno_final';
  return null;
}

function rotuloDaTransicao(tipo: TipoTrechoJornada, de: PontoJornada, para: PontoJornada): string {
  if (tipo === 'coleta') return nomePonto(de);
  return `${nomePonto(de)} → ${nomePonto(para)}`;
}

/**
 * Escala os componentes para que a soma bata exatamente com o total canônico.
 * Evita que a decomposição contradiga a hora improdutiva já exibida na tela.
 */
function ajustarAoTotal(
  componentes: number[],
  total: number,
): { valores: number[]; residuo: number; ajustado: boolean } {
  const soma = componentes.reduce((s, v) => s + v, 0);
  if (total <= 0) {
    return { valores: componentes.map(() => 0), residuo: 0, ajustado: soma > 0 };
  }
  if (soma <= total + 0.001) {
    return { valores: componentes.map(arred), residuo: arred(total - soma), ajustado: false };
  }
  const fator = total / soma;
  return { valores: componentes.map((v) => arred(v * fator)), residuo: 0, ajustado: true };
}

/** Decompõe a jornada de uma linha de planilha (uma rota do dia) em trechos. */
export function decomporJornadaRegistro(obj: Record<string, any>): JornadaDecomposta {
  const vazia = jornadaVazia();
  if (!obj) return vazia;

  const { horasTotais, horasProdutivas, horasImprodutivas } =
    calcularHorasProdutivaImprodutivaRegistro(obj);

  const kmTotalBruto = Number(obj.kmTotal) || 0;
  const kmProdutivo = calcularKmNasRotasRegistro(obj);
  const kmTotal = kmTotalBruto > 0 ? kmTotalBruto : kmProdutivo;
  const kmImprodutivo = arred(Math.max(0, kmTotal - kmProdutivo));

  const pontos = montarPontos(obj);
  const trechos: TrechoJornada[] = [];
  let hInicial = 0;
  let hEntre = 0;
  let hRetorno = 0;
  let kInicial = 0;
  let kEntre = 0;
  let kRetorno = 0;

  for (let i = 0; i < pontos.length - 1; i++) {
    const de = pontos[i];
    const para = pontos[i + 1];
    const tipo = tipoDaTransicao(de, para);
    if (!tipo) continue;

    const horas = diffHorasSaidaChegada(de.hora, para.hora);
    const kmDiff = de.km > 0 && para.km > 0 ? para.km - de.km : 0;
    const km = kmTrechoPlausivel(kmDiff) ? arred(kmDiff) : null;

    if (horas <= 0 && km === null) continue;

    trechos.push({ tipo, rotulo: rotuloDaTransicao(tipo, de, para), horas, km });

    if (tipo === 'deslocamento_inicial') {
      hInicial += horas;
      kInicial += km ?? 0;
    } else if (tipo === 'entre_rotas') {
      hEntre += horas;
      kEntre += km ?? 0;
    } else if (tipo === 'retorno_final') {
      hRetorno += horas;
      kRetorno += km ?? 0;
    }
  }

  const horas = ajustarAoTotal([hInicial, hEntre, hRetorno], horasImprodutivas);
  const kms = ajustarAoTotal([kInicial, kEntre, kRetorno], kmImprodutivo);

  return {
    horasTotais,
    horasProdutivas,
    horasImprodutivas,
    horasDeslocamentoInicial: horas.valores[0],
    horasEntreRotas: horas.valores[1],
    horasRetornoFinal: horas.valores[2],
    horasImprodutivasNaoDetalhadas: horas.residuo,

    kmTotal: arred(kmTotal),
    kmProdutivo,
    kmImprodutivo,
    kmDeslocamentoInicial: kms.valores[0],
    kmEntreRotas: kms.valores[1],
    kmRetornoFinal: kms.valores[2],
    kmImprodutivoNaoDetalhado: kms.residuo,

    trechos,
    rotasComHorario: pontos.filter((p) => p.tipo === 'rota_chegada').length,
    viagens: contarViagensPorRotaRegistro(obj),
    toneladas: arred(obterPesoTotalRegistro(obj) / 1000),
    ajustado: horas.ajustado || kms.ajustado,
  };
}

function jornadaVazia(): JornadaDecomposta {
  return {
    horasTotais: 0,
    horasProdutivas: 0,
    horasImprodutivas: 0,
    horasDeslocamentoInicial: 0,
    horasEntreRotas: 0,
    horasRetornoFinal: 0,
    horasImprodutivasNaoDetalhadas: 0,
    kmTotal: 0,
    kmProdutivo: 0,
    kmImprodutivo: 0,
    kmDeslocamentoInicial: 0,
    kmEntreRotas: 0,
    kmRetornoFinal: 0,
    kmImprodutivoNaoDetalhado: 0,
    trechos: [],
    rotasComHorario: 0,
    viagens: 0,
    toneladas: 0,
    ajustado: false,
  };
}

export interface JornadaAgregada {
  registros: number;
  viagens: number;
  toneladas: number;

  horasTotais: number;
  horasProdutivas: number;
  horasImprodutivas: number;
  horasDeslocamentoInicial: number;
  horasEntreRotas: number;
  horasRetornoFinal: number;
  horasImprodutivasNaoDetalhadas: number;

  kmTotal: number;
  kmProdutivo: number;
  kmImprodutivo: number;
  kmDeslocamentoInicial: number;
  kmEntreRotas: number;
  kmRetornoFinal: number;
  kmImprodutivoNaoDetalhado: number;

  /** Horas produtivas ÷ horas totais × 100. */
  pctProdutivo: number | null;
  /** Horas improdutivas por viagem realizada. */
  horasImprodutivasPorViagem: number | null;
  /** KM improdutivo por viagem realizada. */
  kmImprodutivoPorViagem: number | null;
}

const CAMPOS_SOMA = [
  'viagens', 'toneladas',
  'horasTotais', 'horasProdutivas', 'horasImprodutivas',
  'horasDeslocamentoInicial', 'horasEntreRotas', 'horasRetornoFinal',
  'horasImprodutivasNaoDetalhadas',
  'kmTotal', 'kmProdutivo', 'kmImprodutivo',
  'kmDeslocamentoInicial', 'kmEntreRotas', 'kmRetornoFinal',
  'kmImprodutivoNaoDetalhado',
] as const satisfies readonly (keyof JornadaDecomposta)[];

export function agregarJornadas(itens: JornadaDecomposta[]): JornadaAgregada {
  const soma = {} as Record<(typeof CAMPOS_SOMA)[number], number>;
  for (const campo of CAMPOS_SOMA) soma[campo] = 0;

  for (const item of itens) {
    for (const campo of CAMPOS_SOMA) soma[campo] += Number(item[campo]) || 0;
  }
  for (const campo of CAMPOS_SOMA) soma[campo] = arred(soma[campo]);

  return {
    registros: itens.length,
    viagens: soma.viagens,
    toneladas: soma.toneladas,

    horasTotais: soma.horasTotais,
    horasProdutivas: soma.horasProdutivas,
    horasImprodutivas: soma.horasImprodutivas,
    horasDeslocamentoInicial: soma.horasDeslocamentoInicial,
    horasEntreRotas: soma.horasEntreRotas,
    horasRetornoFinal: soma.horasRetornoFinal,
    horasImprodutivasNaoDetalhadas: soma.horasImprodutivasNaoDetalhadas,

    kmTotal: soma.kmTotal,
    kmProdutivo: soma.kmProdutivo,
    kmImprodutivo: soma.kmImprodutivo,
    kmDeslocamentoInicial: soma.kmDeslocamentoInicial,
    kmEntreRotas: soma.kmEntreRotas,
    kmRetornoFinal: soma.kmRetornoFinal,
    kmImprodutivoNaoDetalhado: soma.kmImprodutivoNaoDetalhado,

    pctProdutivo: soma.horasTotais > 0
      ? arred((soma.horasProdutivas / soma.horasTotais) * 100)
      : null,
    horasImprodutivasPorViagem: soma.viagens > 0
      ? arred(soma.horasImprodutivas / soma.viagens)
      : null,
    kmImprodutivoPorViagem: soma.viagens > 0
      ? arred(soma.kmImprodutivo / soma.viagens)
      : null,
  };
}

export interface JornadaPorChave extends JornadaAgregada {
  chave: string;
}

/**
 * Agrupa a decomposição por uma dimensão (placa, motorista, rota…).
 * Registros sem chave entram como "Não informado".
 */
export function agruparJornadaPor(
  registros: Record<string, any>[],
  chaveDe: (registro: Record<string, any>) => string,
): JornadaPorChave[] {
  const mapa = new Map<string, JornadaDecomposta[]>();

  for (const registro of registros || []) {
    const chave = (chaveDe(registro) || '').trim() || 'Não informado';
    const lista = mapa.get(chave);
    if (lista) lista.push(decomporJornadaRegistro(registro));
    else mapa.set(chave, [decomporJornadaRegistro(registro)]);
  }

  return [...mapa.entries()]
    .map(([chave, itens]) => ({ chave, ...agregarJornadas(itens) }))
    .sort((a, b) => b.horasImprodutivas - a.horasImprodutivas);
}
