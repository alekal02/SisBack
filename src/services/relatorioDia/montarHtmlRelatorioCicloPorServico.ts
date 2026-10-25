/**
 * HTML do PDF de ciclo conforme o tipo do serviço (coleta / roçada / unidade).
 */
import { metricaOficialServico } from '@sistemma/shared';
import { Servico } from '../../entities/Servico';
import { Contract } from '../../entities/Contract';
import PlanilhaService from '../PlanilhaService';
import { getAgregacaoColeta } from '../coletaAgregacaoService';
import { getAgregacaoRocada } from '../rocadaAgregacaoService';
import { buildValoresFixosFaturamento } from '../configFaturamentoValores';
import { gerarHtmlCicloOperacionalWhatsapp } from '../WhatsappRelatorioHtml';
import { carregarViagensCapacidadePeriodo } from './capacidadeViagemDia';
import {
  gerarHtmlRelatorioCicloRocada,
  gerarHtmlRelatorioCicloUnidade,
  type DiaCicloPdf,
} from './gerarHtmlRelatorioCicloPorTipo';
import { listarDatasIntervalo } from '../../utils/periodoCicloContrato';

export interface HtmlRelatorioCicloServico {
  html: string;
  nomeArquivo: string;
}

function slug(s: string): string {
  return String(s || 'servico')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'servico';
}

function fmtArquivo(iso: string): string {
  return iso.split('-').reverse().join('-');
}

function rotuloTipo(tipo: string): string {
  switch (tipo) {
    case 'rocadeira': return 'Roçada';
    case 'varricao': return 'Varrição';
    case 'capina': return 'Capina';
    case 'poda': return 'Poda';
    case 'pintura_meio_fio': return 'Pintura';
    case 'remocao': return 'Remoção';
    case 'geral': return 'Feiras';
    default: return 'Serviço';
  }
}

function metricaUnidade(tipo: string, d: {
  areaM2: number;
  metroLinear: number;
  kmLinear: number;
  qtdArvore: number;
  quantitativo: number;
}): { valor: number; sufixo: string; label: string; tipoLabel: string } {
  const m = metricaOficialServico(tipo, d);
  return { valor: m.valor, sufixo: m.sufixo, label: m.label, tipoLabel: rotuloTipo(tipo) };
}

async function htmlColeta(
  servico: Servico,
  contrato: Contract | null,
  dataInicio: string,
  dataFim: string,
  label: string,
): Promise<string | null> {
  const dias = await PlanilhaService.getMetricasPorDia(servico.id, dataInicio, dataFim);
  const totais = dias.reduce(
    (acc, d) => ({
      rotas: acc.rotas + d.rotas,
      viagens: acc.viagens + d.viagens,
      pesoTotalKg: acc.pesoTotalKg + d.pesoTotalKg,
      kmTotal: acc.kmTotal + d.kmTotal,
    }),
    { rotas: 0, viagens: 0, pesoTotalKg: 0, kmTotal: 0 },
  );
  if (totais.viagens <= 0 && totais.rotas <= 0 && totais.pesoTotalKg <= 0) return null;

  const valoresFixos = buildValoresFixosFaturamento(
    contrato,
    servico.configFaturamento?.ativo ? servico.configFaturamento : null,
  );
  const agregacao = await getAgregacaoColeta(servico.id, { dataInicio, dataFim, valoresFixos });
  const cfgOp = contrato?.configOperacional;
  const capacidade = await carregarViagensCapacidadePeriodo(servico.id, dataInicio, dataFim, {
    volumeL: cfgOp?.volumeL || null,
    pesoMaximoKg: cfgOp?.pesoMaximoKg || null,
    densidadeResiduoKgL: cfgOp?.densidadeResiduoKgL ?? null,
    densidadeKgL: cfgOp?.densidadeKgL || null,
    densidadeKgLPorPlaca: cfgOp?.densidadeKgLPorPlaca || null,
  });

  return gerarHtmlCicloOperacionalWhatsapp({
    servicoNome: servico.nome,
    contratoNome: contrato?.numeroContrato || '—',
    periodo: { dataInicio, dataFim, label },
    dias,
    totais,
    resumo: agregacao.resumo,
    porPlaca: agregacao.porPlaca.slice(0, 40),
    porMotorista: agregacao.porMotorista.slice(0, 25),
    porDistrito: agregacao.porDistrito.slice(0, 25),
    porTipoFat: agregacao.resumo.fatPorTipo || {},
    capacidade,
  });
}

async function htmlRocada(
  servico: Servico,
  contrato: Contract | null,
  dataInicio: string,
  dataFim: string,
  label: string,
  todasDatas: string[],
): Promise<string | null> {
  const diasApi = await PlanilhaService.getMetricasPorDia(servico.id, dataInicio, dataFim);
  const porData = new Map(diasApi.map((d) => [d.data, d]));
  const dias: DiaCicloPdf[] = todasDatas.map((iso) => {
    const d = porData.get(iso);
    return {
      data: iso,
      rotas: Number(d?.rotas || 0),
      areaM2: metricaOficialServico('rocadeira', { areaM2: d?.areaM2 }).valor,
    };
  });
  const areaTotal = dias.reduce((s, d) => s + (d.areaM2 || 0), 0);
  const rotas = dias.reduce((s, d) => s + d.rotas, 0);
  const diasComDados = dias.filter((d) => (d.areaM2 || 0) > 0 || d.rotas > 0).length;
  if (areaTotal <= 0 && rotas <= 0) return null;

  const agg = await getAgregacaoRocada(servico.id, { dataInicio, dataFim, topN: 50 });
  const valorM2 = Number(servico.configFaturamento?.valorM2 || 0) || null;

  return gerarHtmlRelatorioCicloRocada({
    servicoNome: servico.nome,
    contratoNome: contrato?.numeroContrato || '—',
    cicloLabel: label,
    dataInicio,
    dataFim,
    dias,
    diasComDados,
    totaisRotas: rotas,
    areaTotal,
    analise: {
      resumo: {
        registros: agg.resumo.registros,
        areaM2: agg.resumo.areaM2,
        bairros: agg.resumo.bairros,
        operadores: agg.resumo.operadores,
        equipes: agg.resumo.equipes,
        equipamentos: agg.resumo.equipamentos,
      },
      porBairro: agg.porBairro,
      porOperador: agg.porOperador,
      porEquipe: agg.porEquipe,
      porEquipamento: agg.porEquipamento,
    },
    valorM2,
  });
}

async function htmlUnidade(
  servico: Servico,
  contrato: Contract | null,
  dataInicio: string,
  dataFim: string,
  label: string,
  todasDatas: string[],
): Promise<string | null> {
  const diasApi = await PlanilhaService.getMetricasPorDia(servico.id, dataInicio, dataFim);
  const porData = new Map(diasApi.map((d) => [d.data, d]));
  let sufixo = 'pts';
  let labelMetrica = 'Pontos';
  let tipoLabel = servico.nome;
  const dias: DiaCicloPdf[] = todasDatas.map((iso) => {
    const d = porData.get(iso);
    const m = metricaUnidade(servico.tipo, {
      areaM2: Number(d?.areaM2 || 0),
      metroLinear: Number(d?.metroLinear || 0),
      kmLinear: Number(d?.kmLinear || 0),
      qtdArvore: Number(d?.qtdArvore || 0),
      quantitativo: Number(d?.quantitativo || 0),
    });
    sufixo = m.sufixo;
    labelMetrica = m.label;
    tipoLabel = m.tipoLabel;
    return {
      data: iso,
      rotas: Number(d?.rotas || 0),
      metricaUnidade: m.valor,
      metricaSufixo: m.sufixo,
      metricaLabel: m.label,
    };
  });
  const metricaTotal = dias.reduce((s, d) => s + Number(d.metricaUnidade || 0), 0);
  const rotas = dias.reduce((s, d) => s + d.rotas, 0);
  const diasComDados = dias.filter((d) => Number(d.metricaUnidade || 0) > 0 || d.rotas > 0).length;
  if (metricaTotal <= 0 && rotas <= 0) return null;

  return gerarHtmlRelatorioCicloUnidade({
    servicoNome: servico.nome,
    contratoNome: contrato?.numeroContrato || '—',
    tipoLabel,
    cicloLabel: label,
    dataInicio,
    dataFim,
    dias,
    diasComDados,
    totaisRotas: rotas,
    metricaTotal,
    sufixo,
    labelMetrica,
  });
}

export async function montarHtmlRelatorioCicloPorServico(
  servico: Servico,
  contrato: Contract | null,
  opts: { dataInicio: string; dataFim: string; label: string },
): Promise<HtmlRelatorioCicloServico | null> {
  const tipo = String(servico.tipo || '');
  const datas = listarDatasIntervalo(opts.dataInicio, opts.dataFim);
  let html: string | null = null;

  if (tipo === 'coleta_caminhao') {
    html = await htmlColeta(servico, contrato, opts.dataInicio, opts.dataFim, opts.label);
  } else if (tipo === 'rocadeira') {
    html = await htmlRocada(servico, contrato, opts.dataInicio, opts.dataFim, opts.label, datas);
    if (!html) {
      html = await htmlUnidade(servico, contrato, opts.dataInicio, opts.dataFim, opts.label, datas);
    }
  } else {
    html = await htmlUnidade(servico, contrato, opts.dataInicio, opts.dataFim, opts.label, datas);
  }

  if (!html) return null;
  const nomeArquivo = `${slug(contrato?.numeroContrato || 'contrato')}_Ciclo_${slug(servico.nome)}_${fmtArquivo(opts.dataInicio)}_a_${fmtArquivo(opts.dataFim)}.pdf`;
  return { html, nomeArquivo };
}
