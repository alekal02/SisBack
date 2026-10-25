/**
 * Mesmo PDF de operação do dia em todo contrato de coleta:
 * tela, upload no WhatsApp e comando *relatorio*.
 */
import { Contract } from '../../entities/Contract';
import { Servico } from '../../entities/Servico';
import { normalizarListaPlacasReserva } from '../../utils/placasReserva';
import { getAgregacaoColeta, getMapeamentoOperacional } from '../coletaAgregacaoService';
import { agruparViagensPesoPorLinha } from '../viagemPesoRotaService';
import { buildValoresFixosFaturamento } from '../configFaturamentoValores';
import { carregarViagensCapacidadeDia } from './capacidadeViagemDia';
import { diaSemanaPt } from './fmt';
import { gerarHtmlRelatorioDia } from './gerarHtmlRelatorioDiaOperacao';
import { gerarNomePdfRelatorioDia } from './gerarNomePdf';
import { calcularKpisOperacaoDiaSql } from './kpisOperacaoDia';
import { analiseOperacaoDeAgregacaoSql } from './operacaoDia';

export async function montarHtmlRelatorioDiaColeta(opts: {
  servico: Servico;
  contrato: Contract | null;
  dataIso: string;
}): Promise<{ html: string; nomeArquivo: string }> {
  const { servico, contrato, dataIso } = opts;
  const valoresFixos = buildValoresFixosFaturamento(contrato, servico.configFaturamento);
  const agg = await getAgregacaoColeta(servico.id, {
    data: dataIso,
    topN: 50,
    valoresFixos,
  });
  const cfgOp = contrato?.configOperacional;

  let viagensPesoRota: Awaited<ReturnType<typeof getMapeamentoOperacional>>['viagensPesoRota'] = [];
  let horasJornada = 0;
  try {
    const mapeamento = await getMapeamentoOperacional(servico.id, { data: dataIso });
    viagensPesoRota = mapeamento.viagensPesoRota || [];
    horasJornada = Number(mapeamento.resumo?.horasProdutivas || 0);
  } catch (err: any) {
    console.warn('[RelatorioDiaColeta] Mapeamento operacional:', err?.message || err);
  }
  if (!(horasJornada > 0) && viagensPesoRota.length) {
    horasJornada = Math.round(
      viagensPesoRota.reduce((s, v) => s + (v.horasProdutivasViagem || 0), 0) * 100,
    ) / 100;
  }
  // Ton/hora e velocidade usam hora/km da jornada (trechos), não HORAS FORA UNIDADE
  // — essa coluna costuma vir vazia e zera os indicadores do PDF do chatbot.
  if (horasJornada > 0) {
    agg.resumo.horasProdutivas = horasJornada;
  }
  if (!(Number(agg.resumo.kmTotal) > 0) && viagensPesoRota.length) {
    const kmDasRotas = agruparViagensPesoPorLinha(viagensPesoRota)
      .reduce((s, g) => s + (g.kmTotalRota || 0), 0);
    if (kmDasRotas > 0) agg.resumo.kmTotal = Math.round(kmDasRotas * 100) / 100;
  }

  const operacao = analiseOperacaoDeAgregacaoSql(agg);
  const placasReserva = normalizarListaPlacasReserva(contrato?.configOperacional?.placasReserva);
  const kpisOperacao = calcularKpisOperacaoDiaSql({
    servico,
    contract: contrato || null,
    metricas: agg.resumo,
    valoresFixos,
    limite: 8,
  });
  const capacidade = await carregarViagensCapacidadeDia(servico.id, dataIso, {
    volumeL: cfgOp?.volumeL || null,
    pesoMaximoKg: cfgOp?.pesoMaximoKg || null,
    densidadeResiduoKgL: cfgOp?.densidadeResiduoKgL ?? null,
    densidadeKgL: cfgOp?.densidadeKgL || null,
    densidadeKgLPorPlaca: cfgOp?.densidadeKgLPorPlaca || null,
  });

  const html = gerarHtmlRelatorioDia({
    aba: 'operacao',
    servicoNome: servico.nome,
    dataIso,
    diaSemana: diaSemanaPt(dataIso),
    operacao,
    kpisOperacao,
    placasReserva,
    capacidade,
    viagensPesoRota,
    volumeL: cfgOp?.volumeL || null,
    densidadeResiduoKgL: cfgOp?.densidadeResiduoKgL ?? null,
    densidadeKgL: cfgOp?.densidadeKgL || null,
    densidadeKgLPorPlaca: cfgOp?.densidadeKgLPorPlaca || null,
  });

  const nomeArquivo = `${gerarNomePdfRelatorioDia({
    servicoNome: servico.nome,
    aba: 'operacao',
    dataIso,
  })}.pdf`;

  return { html, nomeArquivo };
}
