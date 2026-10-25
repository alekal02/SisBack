/**
 * Gera um PDF diário por serviço do contrato (último dia com dados).
 * Uso: npx ts-node --transpile-only scripts/gerar-relatorio-dia-por-servico.ts [nome-contrato]
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
import { montarHtmlRelatorioDiaColeta } from '../src/services/relatorioDia/montarRelatorioDiaColeta';
import {
  gerarHtmlRelatorioDiaRocada,
  gerarHtmlRelatorioDiaUnidade,
  type LinhaGrupoDia,
} from '../src/services/relatorioDia/gerarHtmlRelatorioDiaPorTipo';

const OUT_DIR = 'C:/Users/Sistemma/Downloads/relatorios-dia-ap-por-servico';

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

function numDe(r: Record<string, unknown>, keys: string[]): number {
  for (const k of keys) {
    const v = r[k];
    if (v == null || v === '') continue;
    const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
    if (!Number.isNaN(n) && n > 0) return n;
  }
  return 0;
}

function textoDe(r: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = r[k];
    if (v == null || v === '') continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return '';
}

function agrupar(
  regs: Record<string, unknown>[],
  keys: string[],
  valorFn: (r: Record<string, unknown>) => number,
): LinhaGrupoDia[] {
  const mapa = new Map<string, LinhaGrupoDia>();
  for (const r of regs) {
    const label = textoDe(r, keys) || 'Não informado';
    const valor = valorFn(r);
    const atual = mapa.get(label) || { label, registros: 0, valor: 0 };
    atual.registros += 1;
    atual.valor += valor;
    mapa.set(label, atual);
  }
  return [...mapa.values()]
    .filter((l) => l.label !== 'Não informado' && l.valor > 0)
    .sort((a, b) => b.valor - a.valor);
}

function metricaLinha(tipo: string, r: Record<string, unknown>): { valor: number; sufixo: string; label: string; tipoLabel: string } {
  const area = numDe(r, ['Area m²', 'AREA_M2', 'M2']);
  const mLin = numDe(r, ['Metro Linear', 'METRO_LINEAR', 'COMPRIMENTO']);
  const kmLin = numDe(r, ['KM Linear', 'KM_LINEAR', 'QUILOMETROS_VARRIDOS']);
  const arv = numDe(r, ['Quantidade de Arvore', 'QTD_ARVORE', 'ARVORES_PODADAS']);
  const qtd = numDe(r, ['QUANTITATIVO']);
  switch (tipo) {
    case 'rocadeira':
      return { valor: area, sufixo: 'm²', label: 'Área', tipoLabel: 'Roçada' };
    case 'varricao':
      return { valor: kmLin || qtd, sufixo: 'km', label: 'KM linear', tipoLabel: 'Varrição' };
    case 'capina':
      if (kmLin > 0) return { valor: kmLin, sufixo: 'km', label: 'Extensão', tipoLabel: 'Capina' };
      return { valor: mLin || qtd, sufixo: 'm', label: 'Metro linear', tipoLabel: 'Capina' };
    case 'poda':
      return { valor: arv || qtd, sufixo: 'arv', label: 'Árvores', tipoLabel: 'Poda' };
    case 'pintura_meio_fio':
      return { valor: mLin || qtd, sufixo: 'm', label: 'Metro linear', tipoLabel: 'Pintura' };
    case 'remocao':
      return { valor: qtd || arv, sufixo: 'pts', label: 'Pontos', tipoLabel: 'Remoção' };
    default:
      return { valor: qtd || arv, sufixo: 'pts', label: 'Pontos', tipoLabel: 'Serviço' };
  }
}

async function htmlRocada(servico: Servico, contrato: Contract, dataIso: string): Promise<string | null> {
  const agg = await getAgregacaoRocada(servico.id, { data: dataIso, topN: 50 });
  if (agg.resumo.areaM2 <= 0 && agg.resumo.registros <= 0) return null;
  const toGrupo = (arr: Array<{ label: string; registros: number; areaM2: number }>): LinhaGrupoDia[] =>
    arr.map((l) => ({ label: l.label, registros: l.registros, valor: l.areaM2 }));
  return gerarHtmlRelatorioDiaRocada({
    servicoNome: servico.nome,
    contratoNome: contrato.numeroContrato || 'ap',
    dataIso,
    resumo: {
      registros: agg.resumo.registros,
      areaM2: agg.resumo.areaM2,
      areaManualM2: agg.resumo.areaManualM2,
      areaMecanizadaM2: agg.resumo.areaMecanizadaM2,
      registrosManual: agg.resumo.registrosManual,
      registrosMecanizada: agg.resumo.registrosMecanizada,
      bairros: agg.resumo.bairros,
      operadores: agg.resumo.operadores,
      equipes: agg.resumo.equipes,
      equipamentos: agg.resumo.equipamentos,
    },
    porTipo: agg.porTipo,
    porBairro: toGrupo(agg.porBairro),
    porOperador: toGrupo(agg.porOperador),
    porEquipe: toGrupo(agg.porEquipe),
    porEquipamento: toGrupo(agg.porEquipamento),
    frotaCiclo: agg.frotaCiclo,
    valorM2: Number(servico.configFaturamento?.valorM2 || 0) || null,
  });
}

async function htmlUnidade(servico: Servico, contrato: Contract, dataIso: string): Promise<string | null> {
  const dias = await PlanilhaService.getMetricasPorDia(servico.id, dataIso, dataIso);
  const d = dias[0];
  const brutos = await PlanilhaService.getDadosBrutosPorDia(servico.id, dataIso, {
    apenasValidos: true,
    pularValidacaoViagem: true,
  });
  const regs = brutos.dados || [];
  const valorFn = (r: Record<string, unknown>) => metricaLinha(servico.tipo, r).valor;
  const meta = metricaLinha(servico.tipo, {});
  const metricaTotal = d
    ? (servico.tipo === 'varricao'
      ? Number(d.kmLinear || 0)
      : servico.tipo === 'poda'
        ? Number(d.qtdArvore || d.quantitativo || d.rotas || 0)
        : servico.tipo === 'remocao'
          ? Number(d.quantitativo || d.qtdArvore || d.rotas || 0)
          : Number(d.quantitativo || d.metroLinear || d.kmLinear || d.rotas || 0))
    : regs.reduce((s, r) => s + valorFn(r), 0);
  const registros = Number(d?.rotas || brutos.total || regs.length);
  if (metricaTotal <= 0 && registros <= 0) return null;

  const porBairro = agrupar(regs, ['BAIRRO', 'bairro', 'Setor', 'SETOR', 'regional', 'DISTRITO'], valorFn);
  const porEquipe = agrupar(regs, ['Equipe', 'EQUIPE', 'turno', 'TURNO'], valorFn);
  const porOperador = agrupar(regs, ['Operador', 'OPERADOR', 'Funcionario', 'FUNCIONARIO', 'MOTORISTA'], valorFn);

  return gerarHtmlRelatorioDiaUnidade({
    servicoNome: servico.nome,
    contratoNome: contrato.numeroContrato || 'ap',
    dataIso,
    tipoLabel: meta.tipoLabel,
    labelMetrica: meta.label,
    sufixo: meta.sufixo,
    metricaTotal,
    registros,
    quantitativo: Number(d?.quantitativo || 0) || undefined,
    porBairro,
    porEquipe,
    porOperador,
    linhas: regs.map((r) => {
      const m = metricaLinha(servico.tipo, r);
      return {
        logradouro: textoDe(r, ['LOGRADOURO', 'logradouro', 'distrito', 'Avenida / Rua', 'DISTRITO']) || '—',
        bairro: textoDe(r, ['BAIRRO', 'bairro', 'Setor', 'regional']) || '—',
        und: textoDe(r, ['UND', '_undNormalizada']) || '—',
        qtd: numDe(r, ['QUANTITATIVO']),
        metrica: m.valor,
        equipe: textoDe(r, ['Equipe', 'EQUIPE', 'turno']) || '—',
        operador: textoDe(r, ['Operador', 'OPERADOR', 'Funcionario']) || '—',
      };
    }),
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

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const gerados: string[] = [];
  const omitidos: string[] = [];

  for (const s of servicos) {
    const periodo = await PlanilhaService.getPeriodoDadosPorServico(s.id);
    const dataIso = periodo?.dataFim || null;
    if (!dataIso) {
      omitidos.push(`${s.nome} (${s.tipo})`);
      console.log(`SKIP ${s.nome} — sem dia operacional`);
      continue;
    }

    let html: string | null = null;
    let nomePdf: string | null = null;

    if (s.tipo === 'coleta_caminhao') {
      const gerado = await montarHtmlRelatorioDiaColeta({ servico: s, contrato, dataIso });
      html = gerado.html;
      nomePdf = gerado.nomeArquivo.endsWith('.pdf') ? gerado.nomeArquivo : `${gerado.nomeArquivo}.pdf`;
    } else if (s.tipo === 'rocadeira') {
      html = await htmlRocada(s, contrato, dataIso);
    } else {
      html = await htmlUnidade(s, contrato, dataIso);
    }

    if (!html) {
      omitidos.push(`${s.nome} (${s.tipo})`);
      console.log(`SKIP ${s.nome} — sem operação em ${dataIso}`);
      continue;
    }

    const pdf = await htmlToPdf(html, {
      useCache: false,
      margin: { top: '8mm', bottom: '8mm', left: '8mm', right: '8mm' },
    });
    const nome = nomePdf
      || `${slug(contrato.numeroContrato || 'ap')}_Dia_${slug(s.nome)}_${fmtArquivo(dataIso)}.pdf`;
    const dest = path.join(OUT_DIR, nome);
    fs.writeFileSync(dest, pdf);
    gerados.push(nome);
    console.log(`OK ${s.nome} ${dataIso} → ${nome}`);
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
