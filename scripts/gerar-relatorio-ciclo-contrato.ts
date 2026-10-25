/**
 * Gera o PDF do ciclo atual com todos os serviços do contrato.
 * Uso: npx ts-node --transpile-only scripts/gerar-relatorio-ciclo-contrato.ts [nome-contrato]
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
import {
  calcularCicloMensalContrato,
  inferirMesReferenciaAtual,
  normalizarDiaInicioCiclo,
  recortarPeriodoAteReferencia,
} from '../src/utils/periodoCicloContrato';
import {
  gerarHtmlRelatorioCicloTodosServicos,
  type ServicoCicloContrato,
} from '../src/services/relatorioDia/gerarHtmlRelatorioCicloTodosServicos';

function metricaDoTipo(tipo: string, d: {
  rotas: number;
  viagens: number;
  pesoTotalTon: number;
  kmTotal: number;
  areaM2: number;
  metroLinear: number;
  kmLinear: number;
  qtdArvore: number;
  quantitativo: number;
}): { valor: number; und: string; extra?: string } {
  const t = String(tipo || '');
  if (t === 'coleta_caminhao') {
    const extra = [
      d.viagens > 0 ? `${d.viagens.toLocaleString('pt-BR')} viag.` : '',
      d.kmTotal > 0 ? `${Math.round(d.kmTotal).toLocaleString('pt-BR')} km` : '',
    ].filter(Boolean).join(' · ');
    return { valor: d.pesoTotalTon, und: 't', extra: extra || undefined };
  }
  if (t === 'rocadeira') return { valor: d.areaM2 || d.quantitativo, und: 'm²' };
  if (t === 'varricao') return { valor: d.kmLinear, und: 'km' };
  if (t === 'capina') {
    if (d.kmLinear > 0) return { valor: d.kmLinear, und: 'km' };
    return { valor: d.metroLinear || d.quantitativo, und: 'm' };
  }
  if (t === 'poda') return { valor: d.qtdArvore || d.quantitativo || d.rotas, und: 'arv' };
  if (t === 'pintura_meio_fio') return { valor: d.metroLinear || d.quantitativo, und: 'm' };
  return { valor: d.quantitativo || d.qtdArvore || d.rotas, und: 'pts' };
}

async function main() {
  const nomeBusca = (process.argv[2] || 'ap').trim();
  await AppDataSource.initialize();
  const repoC = AppDataSource.getRepository(Contract);
  const repoS = AppDataSource.getRepository(Servico);

  const contrato = await repoC.findOne({
    where: { numeroContrato: ILike(nomeBusca) },
  }) || await repoC.findOne({
    where: { numeroContrato: ILike(`%${nomeBusca}%`) },
  });
  if (!contrato) throw new Error(`Contrato "${nomeBusca}" não encontrado.`);

  const servicos = await repoS.find({
    where: { contract_id: contrato.id },
    order: { criadoEm: 'ASC' },
  });

  const diaInicio = normalizarDiaInicioCiclo(contrato.diaInicioCiclo);
  const ref = inferirMesReferenciaAtual(diaInicio);
  const ciclo = calcularCicloMensalContrato(ref.ano, ref.mes, diaInicio);
  const recorte = recortarPeriodoAteReferencia(ciclo.dataInicio, ciclo.dataFim);

  const itens: ServicoCicloContrato[] = [];
  const omitidos: Array<{ nome: string; motivo: string }> = [];

  for (const s of servicos) {
    const diasApi = await PlanilhaService.getMetricasPorDia(s.id, recorte.dataInicio, recorte.dataFim);
    const dias = diasApi
      .map((d) => {
        const m = metricaDoTipo(s.tipo, d);
        return {
          data: d.data,
          registros: Number(d.rotas || 0),
          quantitativo: m.valor,
          und: m.und,
          extra: m.extra,
        };
      })
      .filter((d) => d.registros > 0 || d.quantitativo > 0);
    if (dias.length === 0) {
      omitidos.push({ nome: s.nome, motivo: 'sem operação no ciclo' });
      continue;
    }
    const tot = dias.reduce(
      (a, d) => ({ registros: a.registros + d.registros, quantitativo: a.quantitativo + d.quantitativo }),
      { registros: 0, quantitativo: 0 },
    );
    const somaBruta = diasApi.reduce(
      (a, d) => ({
        rotas: a.rotas + Number(d.rotas || 0),
        viagens: a.viagens + Number(d.viagens || 0),
        pesoTotalTon: a.pesoTotalTon + Number(d.pesoTotalTon || 0),
        kmTotal: a.kmTotal + Number(d.kmTotal || 0),
        areaM2: a.areaM2 + Number(d.areaM2 || 0),
        metroLinear: a.metroLinear + Number(d.metroLinear || 0),
        kmLinear: a.kmLinear + Number(d.kmLinear || 0),
        qtdArvore: a.qtdArvore + Number(d.qtdArvore || 0),
        quantitativo: a.quantitativo + Number(d.quantitativo || 0),
      }),
      { rotas: 0, viagens: 0, pesoTotalTon: 0, kmTotal: 0, areaM2: 0, metroLinear: 0, kmLinear: 0, qtdArvore: 0, quantitativo: 0 },
    );
    itens.push({
      id: s.id,
      tipo: s.tipo,
      nome: s.nome,
      und: dias[0].und,
      registros: tot.registros,
      quantitativo: tot.quantitativo,
      diasComDados: dias.length,
      dias: dias.map(({ data, registros, quantitativo }) => ({ data, registros, quantitativo })),
      extra: metricaDoTipo(s.tipo, somaBruta).extra,
    });
  }

  if (itens.length === 0) {
    throw new Error('Nenhum serviço do contrato tem operação no ciclo atual.');
  }

  const html = gerarHtmlRelatorioCicloTodosServicos({
    contratoNome: contrato.numeroContrato || nomeBusca,
    cicloLabel: recorte.emAndamento
      ? `${ciclo.label} — ${recorte.diasDecorridos} dias decorridos`
      : ciclo.label,
    dataInicio: recorte.dataInicio,
    dataFim: recorte.dataFim,
    servicos: itens,
    omitidos,
  });

  const pdf = await htmlToPdf(html, {
    useCache: false,
    margin: { top: '8mm', bottom: '8mm', left: '8mm', right: '8mm' },
  });

  const fmt = (iso: string) => iso.split('-').reverse().join('-');
  const outDir = 'C:/Users/Sistemma/Downloads';
  const slug = String(contrato.numeroContrato || nomeBusca).replace(/[^\w]+/g, '_');
  const nome = `${slug}_Ciclo_Todos_Servicos_${fmt(recorte.dataInicio)}_a_${fmt(recorte.dataFim)}.pdf`;
  const dest = path.join(outDir, nome);
  fs.writeFileSync(dest, pdf);
  console.log(`OK ${itens.length} serviço(s) · omitidos ${omitidos.length}`);
  console.log(dest);
  await AppDataSource.destroy();
}

main()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(err);
    try { await AppDataSource.destroy(); } catch { /* ignore */ }
    process.exit(1);
  });
