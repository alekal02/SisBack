import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import DeduplicacaoService from './DeduplicacaoService';
import ConsolidadoProducaoImportService from './consolidadoProducaoImportService';
import { classificarPlanilhaContrato } from './planilhaContratoClassifier';
import { prepararViagemParaImportacao } from './validacaoViagemService';
import { obterPesoTotalRegistro } from './viagensPorRotaService';
import { calcularHorasProdutivasTotal } from './horasProdutivasService';
import { calcularMetricaExecutivaDeDados } from './metricaExecutivaService';
import { analiseOperacaoDeAgregacaoSql } from './relatorioDia/operacaoDia';
import { agruparViagensPesoPorLinha, montarViagensPesoDoRegistro } from './viagemPesoRotaService';
import PlanilhaService from './PlanilhaService';
import {
  agruparLinhasPorServicoAba,
  parsearPlanilhaConsolidadoProducao,
  type LinhaConsolidadoProducao,
} from './consolidadoProducaoPlanilhaParser';
import { restringirDatasAoCicloDaDataMaisRecente } from '../utils/periodoCicloContrato';
import { filtrarColetasProducaoNovas } from './producaoDedupService';
import { ColetaData } from '../entities/ColetaData';
import { nomeAbaColeta, linhasExcelPreenchidas } from './abaColeta';
import { razoesKmDeRegistros } from './kmValido';

const FIXTURES = path.join(__dirname, '..', '..', 'test', 'fixtures');

function lerFixture(nome: string): Buffer {
  return fs.readFileSync(path.join(FIXTURES, nome));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function isoDia(d: Date | null): string | null {
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

type DedupInterno = {
  parsearLinhas: (buffer: Buffer) => Array<{ dataSaida: Date | null }>;
  montarColetaDeLinha: (linha: unknown, uploadId: number) => ColetaData;
};

type ConsolidadoInterno = {
  montarColeta: (linha: LinhaConsolidadoProducao, uploadId: number) => ColetaData;
};

/**
 * Mesmo trecho do upload/WhatsApp de coleta: parsear, montar e validar.
 * Sem banco — o filtro de data do ciclo fechado não se aplica a planilha nova.
 */
function importarColetaComoUpload(buffer: Buffer): {
  lidas: number;
  importadas: ColetaData[];
  ignoradas: Array<{ excel: number; motivos: string[] }>;
} {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const sheet = wb.Sheets[nomeAbaColeta(wb)];
  const json = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true });
  const excel = linhasExcelPreenchidas(sheet);
  const dedup = DeduplicacaoService as unknown as DedupInterno;
  const linhas = dedup.parsearLinhas(buffer);
  assert.equal(
    linhas.length,
    excel.length,
    `parse e linhas do Excel divergiram: parse=${linhas.length} excel=${excel.length}`,
  );

  const importadas: ColetaData[] = [];
  const ignoradas: Array<{ excel: number; motivos: string[] }> = [];
  linhas.forEach((linha, i) => {
    if (!linha.dataSaida) {
      ignoradas.push({ excel: excel[i], motivos: ['sem data'] });
      return;
    }
    const coleta = dedup.montarColetaDeLinha(linha, 0);
    const validacao = prepararViagemParaImportacao(coleta);
    if (validacao.descartada || !validacao.validoDashboard) {
      ignoradas.push({ excel: excel[i], motivos: validacao.motivos || [] });
      return;
    }
    importadas.push(coleta);
  });

  return { lidas: json.length, importadas, ignoradas };
}

function totaisDashboard(rows: ColetaData[]): { ton: number; viagens: number; km: number } {
  let viagens = 0;
  let pesoKg = 0;
  let km = 0;
  for (const c of rows) {
    if (!c.validoDashboard) continue;
    viagens += Number(c.viagensPorRota) || Number(c.numeroViagens) || 0;
    pesoKg += obterPesoTotalRegistro(c);
    km += Number(c.kmTotal) || 0;
  }
  return { ton: round2(pesoKg / 1000), viagens, km: round2(km) };
}

function totaisRelatorioDia(rows: ColetaData[]): { ton: number; viagens: number; km: number } {
  const porDia = new Map<string, ColetaData[]>();
  for (const c of rows) {
    if (!c.validoDashboard || !c.dataSaida) continue;
    const dia = isoDia(c.dataSaida)!;
    const grupo = porDia.get(dia) || [];
    grupo.push(c);
    porDia.set(dia, grupo);
  }

  let viagens = 0;
  let ton = 0;
  let km = 0;
  for (const [data, dia] of porDia) {
    const m = totaisDashboard(dia);
    const viagensPeso = dia.flatMap((c) => {
      const obj = {
        ...c,
        ...(c.dados && typeof c.dados === 'object' ? c.dados : {}),
        horaSaida: c.horaSaida,
        horaChegada: c.horaChegada,
        horasForaUnidade: c.horasForaUnidade,
        tempoForaUnidade: c.tempoForaUnidade,
        dados: c.dados,
      };
      return montarViagensPesoDoRegistro({
        data,
        rota: String(c.distrito || c.regional || ''),
        placa: String(c.placa || ''),
        motorista: String(c.motorista || ''),
        tipo: c.tipoCaminhao,
        pesos: [c.peso1, c.peso2, c.peso3, c.peso4],
        objHoras: obj,
        pesoIdealKg: null,
        nViagens: Number(c.viagensPorRota) || Number(c.numeroViagens) || 0,
      });
    });
    let kmDia = m.km;
    if (!(kmDia > 0) && viagensPeso.length) {
      const kmRotas = agruparViagensPesoPorLinha(viagensPeso)
        .reduce((s, g) => s + (g.kmTotalRota || 0), 0);
      if (kmRotas > 0) kmDia = round2(kmRotas);
    }
    const op = analiseOperacaoDeAgregacaoSql({
      resumo: {
        registros: dia.length,
        viagens: m.viagens,
        pesoTotalTon: m.ton,
        kmTotal: kmDia,
        horasProdutivas: 0,
        placas: 0,
        motoristas: 0,
      },
      porMotorista: [],
      porPlaca: [],
      porDistrito: [],
    });
    viagens += op.resumo.viagens;
    ton += op.resumo.toneladas;
    km += op.resumo.km;
  }
  return { ton: round2(ton), viagens, km: round2(km) };
}

function importarProducaoComoUpload(buffer: Buffer, diaInicioCiclo: number) {
  const parsed = parsearPlanilhaConsolidadoProducao(buffer);
  const datas = [...new Set(
    parsed.linhas
      .map((l) => (l.dataSaida ? l.dataSaida.toISOString().slice(0, 10) : null))
      .filter((d): d is string => !!d),
  )];
  const restrito = restringirDatasAoCicloDaDataMaisRecente(datas, diaInicioCiclo);
  const permitidas = new Set(restrito.datas);
  const cons = ConsolidadoProducaoImportService as unknown as ConsolidadoInterno;

  let foraCiclo = 0;
  let repetidas = 0;
  const foraPorServico: Record<string, number> = {};
  const porServico = new Map<string, { nome: string; regs: number; areaM2: number; km: number }>();

  for (const [, linhasServico] of agruparLinhasPorServicoAba(parsed.linhas)) {
    const nome = linhasServico[0].nomeServico;
    const noCiclo = linhasServico.filter((l) => {
      const d = l.dataSaida ? l.dataSaida.toISOString().slice(0, 10) : null;
      return Boolean(d && permitidas.has(d));
    });
    const fora = linhasServico.length - noCiclo.length;
    foraCiclo += fora;
    if (fora > 0) foraPorServico[nome] = fora;

    const { novas, ignoradas } = filtrarColetasProducaoNovas(
      noCiclo,
      (l) => cons.montarColeta(l, 0),
      new Set(),
    );
    repetidas += ignoradas;

    let areaM2 = 0;
    let km = 0;
    for (const c of novas) {
      const dados = (c.dados || {}) as Record<string, unknown>;
      areaM2 += Number(dados['Area m²'] || dados.AREA_M2) || 0;
      km += Number(dados['KM Linear'] || dados.KM_LINEAR) || 0;
    }
    porServico.set(nome, {
      nome,
      regs: novas.length,
      areaM2: round2(areaM2),
      km: round2(km),
    });
  }

  const importadas = [...porServico.values()].reduce((s, v) => s + v.regs, 0);
  return {
    lidas: parsed.totalLinhasBrutas,
    importadas,
    foraCiclo,
    foraPorServico,
    repetidas,
    porServico,
    datasIgnoradas: restrito.ignoradas,
  };
}

describe('planilhas reais Aparecida — mesmo caminho do upload', () => {
  const coletaBuf = lerFixture('coleta-aparecida-out26.xlsx');
  const producaoBuf = lerFixture('producao-aparecida-out26.xlsx');

  it('coleta: 935 lidas, 932 importadas, totais e período', () => {
    assert.equal(classificarPlanilhaContrato(coletaBuf).tipo, 'coleta');
    const r = importarColetaComoUpload(coletaBuf);
    const diffs: string[] = [];
    if (r.lidas !== 935) diffs.push(`linhas lidas ${r.lidas} (esperado 935)`);
    if (r.importadas.length !== 932) diffs.push(`importadas ${r.importadas.length} (esperado 932)`);
    const excelIgnoradas = r.ignoradas.map((i) => i.excel);
    if (excelIgnoradas.join(',') !== '817,818,858') {
      diffs.push(`ignoradas Excel ${excelIgnoradas.join(', ') || 'nenhuma'} (esperado 817, 818, 858)`);
    }

    const dash = totaisDashboard(r.importadas);
    if (dash.ton !== 11069.39) diffs.push(`tonelagem ${dash.ton} t (esperado 11069.39)`);
    if (dash.viagens !== 1539) diffs.push(`viagens ${dash.viagens} (esperado 1539)`);

    const brutos = (PlanilhaService as unknown as {
      converterColetasParaBrutos: (d: ColetaData[], apenasValidos: boolean) => Record<string, unknown>[];
    }).converterColetasParaBrutos(r.importadas, true);
    const horas = calcularHorasProdutivasTotal(brutos);
    const limiteHoras = 8868 * 0.005;
    if (Math.abs(horas - 8868) > limiteHoras) {
      diffs.push(`horas fora da base ${horas} h (esperado 8868 ±0,5%)`);
    }

    const datas = r.importadas
      .map((c) => isoDia(c.dataSaida))
      .filter((d): d is string => !!d)
      .sort();
    const dias = new Set(datas);
    if (datas[0] !== '2026-09-25' || datas[datas.length - 1] !== '2026-10-23' || dias.size !== 29) {
      diffs.push(
        `período ${datas[0]} a ${datas[datas.length - 1]}, ${dias.size} dias (esperado 25/09/2026 a 23/10/2026, 29 dias)`,
      );
    }

    const razao = razoesKmDeRegistros(r.importadas.map((c) => ({
      viagens: Number(c.viagensPorRota) || Number(c.numeroViagens) || 0,
      km: Number(c.kmTotal) || 0,
      ton: obterPesoTotalRegistro(c) / 1000,
    })));
    if (razao.kmPorViagem !== 61.63) diffs.push(`km/viagem ${razao.kmPorViagem} (esperado 61.63)`);
    if (razao.tonPorKm !== 0.1168) diffs.push(`ton/km ${razao.tonPorKm} (esperado 0.1168)`);
    if (razao.pctViagensKmValido !== 78) diffs.push(`% KM válido ${razao.pctViagensKmValido} (esperado 78)`);

    assert.equal(diffs.length, 0, diffs.join('; '));
  });

  it('coleta: dashboard do serviço, executivo e relatório do dia coincidem', () => {
    const r = importarColetaComoUpload(coletaBuf);
    const dashboard = totaisDashboard(r.importadas);
    const brutos = (PlanilhaService as unknown as {
      converterColetasParaBrutos: (d: ColetaData[], apenasValidos: boolean) => Record<string, unknown>[];
    }).converterColetasParaBrutos(r.importadas, true);
    const exec = calcularMetricaExecutivaDeDados(brutos, {}, 'coleta-aparecida');
    const executivo = {
      ton: exec.pesoTotalTon,
      viagens: exec.viagens,
      km: exec.kmTotal,
    };
    const relatorio = totaisRelatorioDia(r.importadas);

    const diffs: string[] = [];
    const razao = razoesKmDeRegistros(r.importadas.map((c) => ({
      viagens: Number(c.viagensPorRota) || Number(c.numeroViagens) || 0,
      km: Number(c.kmTotal) || 0,
      ton: obterPesoTotalRegistro(c) / 1000,
    })));
    if (exec.kmMedioViagem !== razao.kmPorViagem || exec.tonKm !== razao.tonPorKm || exec.pctViagensKmValido !== 78) {
      diffs.push(
        `km válido: executivo ${exec.kmMedioViagem} km/viagem, ${exec.tonKm} ton/km, ${exec.pctViagensKmValido}% | referência ${razao.kmPorViagem}, ${razao.tonPorKm}, 78%`,
      );
    }
    for (const campo of ['ton', 'viagens', 'km'] as const) {
      if (dashboard[campo] !== executivo[campo] || dashboard[campo] !== relatorio[campo]) {
        diffs.push(
          `${campo}: dashboard ${dashboard[campo]} | executivo ${executivo[campo]} | relatório do dia ${relatorio[campo]}`,
        );
      }
    }
    assert.equal(diffs.length, 0, diffs.join('; '));
  });

  it('produção: ciclo dia 25, repetidas e totais por serviço', () => {
    assert.equal(classificarPlanilhaContrato(producaoBuf).tipo, 'consolidado_producao');
    const r = importarProducaoComoUpload(producaoBuf, 25);
    const diffs: string[] = [];
    if (r.lidas !== 7680) diffs.push(`linhas lidas ${r.lidas} (esperado 7680)`);
    if (r.importadas !== 7653) diffs.push(`importadas ${r.importadas} (esperado 7653)`);
    if (r.foraCiclo !== 21) diffs.push(`fora do ciclo ${r.foraCiclo} (esperado 21)`);
    if (r.foraPorServico['Roçada Manual'] !== 21) {
      diffs.push(`fora do ciclo por serviço ${JSON.stringify(r.foraPorServico)} (esperado Roçada Manual 21)`);
    }
    if (r.repetidas !== 6) diffs.push(`repetidas ${r.repetidas} (esperado 6)`);

    const esperado: Array<{ nome: string; regs: number; areaM2?: number; km?: number }> = [
      { nome: 'Roçada Mecanizada', regs: 3909, areaM2: 2657770.71 },
      { nome: 'Roçada Manual', regs: 1346, areaM2: 1726220.26 },
      { nome: 'Varrição Manual', regs: 1842, km: 11100.93 },
      { nome: 'Varrição Mecanizada', regs: 60, km: 3136.97 },
      { nome: 'Remoção de Entulho', regs: 275 },
      { nome: 'Feiras', regs: 188 },
      { nome: 'Poda', regs: 33 },
    ];
    for (const e of esperado) {
      const got = r.porServico.get(e.nome);
      if (!got) {
        diffs.push(`${e.nome}: ausente (esperado ${e.regs} reg.)`);
        continue;
      }
      if (got.regs !== e.regs) diffs.push(`${e.nome}: ${got.regs} reg. (esperado ${e.regs})`);
      if (e.areaM2 != null && got.areaM2 !== e.areaM2) {
        diffs.push(`${e.nome}: ${got.areaM2} m² (esperado ${e.areaM2})`);
      }
      if (e.km != null && got.km !== e.km) {
        diffs.push(`${e.nome}: ${got.km} km (esperado ${e.km})`);
      }
    }

    assert.equal(diffs.length, 0, diffs.join('; '));
  });
});
