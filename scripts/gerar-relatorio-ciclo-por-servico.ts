/**
 * Gera um PDF de ciclo por serviço do contrato (mesmo formato do CicloDateSelector).
 * Uso: npx ts-node --transpile-only scripts/gerar-relatorio-ciclo-por-servico.ts [nome-contrato]
 */
import 'reflect-metadata';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { ILike } from 'typeorm';

dotenv.config();

import AppDataSource from '../src/database/data-source';
import { Contract } from '../src/entities/Contract';
import { Servico } from '../src/entities/Servico';
import PlanilhaService from '../src/services/PlanilhaService';
import { htmlToPdf } from '../src/services/PdfGeneratorService';
import { getAgregacaoRocada } from '../src/services/rocadaAgregacaoService';
import { getAgregacaoColeta } from '../src/services/coletaAgregacaoService';
import { carregarViagensCapacidadePeriodo } from '../src/services/relatorioDia/capacidadeViagemDia';
import { buildValoresFixosFaturamento } from '../src/services/configFaturamentoValores';
import { gerarHtmlCicloOperacionalWhatsapp } from '../src/services/WhatsappRelatorioHtml';
import {
  gerarHtmlRelatorioCicloRocada,
  gerarHtmlRelatorioCicloUnidade,
  type DiaCicloPdf,
} from '../src/services/relatorioDia/gerarHtmlRelatorioCicloPorTipo';
import {
  calcularCicloMensalContrato,
  inferirMesReferenciaAtual,
  inferirMesReferenciaDeData,
  listarDatasIntervalo,
  normalizarDiaInicioCiclo,
  recortarPeriodoAteReferencia,
} from '../src/utils/periodoCicloContrato';

const OUT_DIR = 'C:/Users/Sistemma/Downloads/relatorios-ciclo-ap-por-servico';

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

function metricaUnidade(tipo: string, d: {
  rotas: number;
  areaM2: number;
  metroLinear: number;
  kmLinear: number;
  qtdArvore: number;
  quantitativo: number;
}): { valor: number; sufixo: string; label: string; tipoLabel: string } {
  switch (tipo) {
    case 'rocadeira':
      return { valor: d.areaM2, sufixo: 'm²', label: 'Área', tipoLabel: 'Roçada' };
    case 'varricao':
      return { valor: d.kmLinear, sufixo: 'km', label: 'KM linear', tipoLabel: 'Varrição' };
    case 'capina':
      if (d.kmLinear > 0) return { valor: d.kmLinear, sufixo: 'km', label: 'Extensão', tipoLabel: 'Capina' };
      return { valor: d.metroLinear || d.quantitativo, sufixo: 'm', label: 'Metro linear', tipoLabel: 'Capina' };
    case 'poda':
      return { valor: d.qtdArvore || d.quantitativo || d.rotas, sufixo: 'arv', label: 'Árvores', tipoLabel: 'Poda' };
    case 'pintura_meio_fio':
      return { valor: d.metroLinear || d.quantitativo, sufixo: 'm', label: 'Metro linear', tipoLabel: 'Pintura' };
    case 'remocao':
      return { valor: d.quantitativo || d.qtdArvore || d.rotas, sufixo: 'pts', label: 'Pontos', tipoLabel: 'Remoção' };
    default:
      return { valor: d.quantitativo || d.qtdArvore || d.rotas, sufixo: 'pts', label: 'Pontos', tipoLabel: 'Serviço' };
  }
}

async function htmlColeta(servico: Servico, contrato: Contract, dataInicio: string, dataFim: string, label: string) {
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
  if (totais.viagens <= 0 && totais.rotas <= 0) return null;

  const valoresFixos = buildValoresFixosFaturamento(
    contrato,
    servico.configFaturamento?.ativo ? servico.configFaturamento : null,
  );
  const agregacao = await getAgregacaoColeta(servico.id, { dataInicio, dataFim, valoresFixos });
  const cfgOp = contrato.configOperacional;
  const capacidade = await carregarViagensCapacidadePeriodo(servico.id, dataInicio, dataFim, {
    volumeL: cfgOp?.volumeL || null,
    pesoMaximoKg: cfgOp?.pesoMaximoKg || null,
    densidadeResiduoKgL: cfgOp?.densidadeResiduoKgL ?? null,
    densidadeKgL: cfgOp?.densidadeKgL || null,
    densidadeKgLPorPlaca: cfgOp?.densidadeKgLPorPlaca || null,
  });

  return gerarHtmlCicloOperacionalWhatsapp({
    servicoNome: servico.nome,
    contratoNome: contrato.numeroContrato || 'ap',
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

async function htmlRocada(servico: Servico, contrato: Contract, dataInicio: string, dataFim: string, label: string, todasDatas: string[]) {
  const diasApi = await PlanilhaService.getMetricasPorDia(servico.id, dataInicio, dataFim);
  const porData = new Map(diasApi.map((d) => [d.data, d]));
  const dias: DiaCicloPdf[] = todasDatas.map((iso) => {
    const d = porData.get(iso);
    return { data: iso, rotas: Number(d?.rotas || 0), areaM2: Number(d?.areaM2 || 0) };
  });
  const areaTotal = dias.reduce((s, d) => s + (d.areaM2 || 0), 0);
  const rotas = dias.reduce((s, d) => s + d.rotas, 0);
  const diasComDados = dias.filter((d) => (d.areaM2 || 0) > 0 || d.rotas > 0).length;
  if (areaTotal <= 0 && rotas <= 0) return null;

  const agg = await getAgregacaoRocada(servico.id, { dataInicio, dataFim, topN: 50 });
  const valorM2 = Number(servico.configFaturamento?.valorM2 || 0) || null;

  return gerarHtmlRelatorioCicloRocada({
    servicoNome: servico.nome,
    contratoNome: contrato.numeroContrato || 'ap',
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

async function htmlUnidade(servico: Servico, contrato: Contract, dataInicio: string, dataFim: string, label: string, todasDatas: string[]) {
  const diasApi = await PlanilhaService.getMetricasPorDia(servico.id, dataInicio, dataFim);
  const porData = new Map(diasApi.map((d) => [d.data, d]));
  let sufixo = 'pts';
  let labelMetrica = 'Pontos';
  let tipoLabel = servico.nome;
  const dias: DiaCicloPdf[] = todasDatas.map((iso) => {
    const d = porData.get(iso);
    const m = metricaUnidade(servico.tipo, {
      rotas: Number(d?.rotas || 0),
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
    contratoNome: contrato.numeroContrato || 'ap',
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

async function main() {
  const nomeBusca = (process.argv[2] || 'ap').trim();
  await AppDataSource.initialize();
  const repoC = AppDataSource.getRepository(Contract);
  const repoS = AppDataSource.getRepository(Servico);

  const contrato = await repoC.findOne({ where: { numeroContrato: ILike(nomeBusca) } })
    || await repoC.findOne({ where: { numeroContrato: ILike(`%${nomeBusca}%`) } });
  if (!contrato) throw new Error(`Contrato "${nomeBusca}" não encontrado.`);

  const servicos = await repoS.find({
    where: { contract_id: contrato.id },
    order: { criadoEm: 'ASC' },
  });

  const diaInicio = normalizarDiaInicioCiclo(contrato.diaInicioCiclo);
  const ref = inferirMesReferenciaAtual(diaInicio);
  const ciclo = calcularCicloMensalContrato(ref.ano, ref.mes, diaInicio);
  const recorte = recortarPeriodoAteReferencia(ciclo.dataInicio, ciclo.dataFim);
  const label = recorte.emAndamento
    ? `${ciclo.label} — ${recorte.diasDecorridos} dias decorridos`
    : ciclo.label;
  const todasDatas = listarDatasIntervalo(recorte.dataInicio, recorte.dataFim);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const gerados: string[] = [];
  const omitidos: string[] = [];

  for (const s of servicos) {
    let ini = recorte.dataInicio;
    let fim = recorte.dataFim;
    let lab = label;
    let datas = todasDatas;

    if (s.tipo === 'coleta_caminhao') {
      const periodo = await PlanilhaService.getPeriodoDadosPorServico(s.id);
      if (periodo?.dataFim && (periodo.dataFim < recorte.dataInicio || periodo.dataInicio > recorte.dataFim)) {
        const refColeta = inferirMesReferenciaDeData(periodo.dataFim, diaInicio);
        const cicloColeta = calcularCicloMensalContrato(refColeta.ano, refColeta.mes, diaInicio);
        const recorteColeta = recortarPeriodoAteReferencia(
          cicloColeta.dataInicio,
          cicloColeta.dataFim,
          periodo.dataFim,
        );
        ini = recorteColeta.dataInicio;
        fim = recorteColeta.dataFim;
        lab = `${cicloColeta.label} — último ciclo com dados`;
        datas = listarDatasIntervalo(ini, fim);
      }
    }

    let html: string | null = null;
    if (s.tipo === 'coleta_caminhao') {
      html = await htmlColeta(s, contrato, ini, fim, lab);
    } else if (s.tipo === 'rocadeira') {
      html = await htmlRocada(s, contrato, ini, fim, lab, datas);
    } else {
      html = await htmlUnidade(s, contrato, ini, fim, lab, datas);
    }

    if (!html) {
      omitidos.push(`${s.nome} (${s.tipo})`);
      console.log(`SKIP ${s.nome} — sem operação no ciclo`);
      continue;
    }

    const pdf = await htmlToPdf(html, {
      useCache: false,
      margin: { top: '8mm', bottom: '8mm', left: '8mm', right: '8mm' },
    });
    const nome = `${slug(contrato.numeroContrato || 'ap')}_Ciclo_${slug(s.nome)}_${fmtArquivo(ini)}_a_${fmtArquivo(fim)}.pdf`;
    const dest = path.join(OUT_DIR, nome);
    fs.writeFileSync(dest, pdf);
    gerados.push(nome);
    console.log(`OK ${s.nome} → ${nome}`);
  }

  console.log(`PDFs: ${gerados.length} · omitidos: ${omitidos.length}`);
  if (omitidos.length) console.log(`Sem dados: ${omitidos.join(' · ')}`);
  console.log(OUT_DIR);
  await AppDataSource.destroy();
}

main()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(err);
    try { await AppDataSource.destroy(); } catch { /* ignore */ }
    process.exit(1);
  });
