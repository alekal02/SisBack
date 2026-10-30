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
import {
  agregarMetricasExecutivas,
  calcularMetricaExecutivaDeDados,
  metricaExecutivaNoContrato,
} from './metricaExecutivaService';
import { TipoServico } from '../enums/TipoServico';
import { analiseOperacaoDeAgregacaoSql } from './relatorioDia/operacaoDia';
import { agruparViagensPesoPorLinha, montarViagensPesoDoRegistro } from './viagemPesoRotaService';
import PlanilhaService from './PlanilhaService';
import {
  agruparLinhasPorServicoAba,
  parsearPlanilhaConsolidadoProducao,
  type LinhaConsolidadoProducao,
} from './consolidadoProducaoPlanilhaParser';
import { filtrarColetasProducaoNovas } from './producaoDedupService';
import { ColetaData } from '../entities/ColetaData';
import { nomeAbaColeta, linhasExcelPreenchidas } from './abaColeta';
import { razoesKmDeRegistros } from './kmValido';
import { linhasFormulaPesoTotalVazia, montarConferencia } from './conferenciaImportacaoService';
import { MOTIVO_LINHA_IGNORADA } from './importacaoLinhaIgnorada';
import { camposMetricaDeRegistro, metricaOficialServico } from '@sistemma/shared';
import { calcularKpisAtivos } from './kpiCalculoServicoService';

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
  ignoradas: Array<{ excel: number; motivos: string[]; motivo: string }>;
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
  const ignoradas: Array<{ excel: number; motivos: string[]; motivo: string }> = [];
  linhas.forEach((linha, i) => {
    if (!linha.dataSaida) {
      ignoradas.push({ excel: excel[i], motivos: ['sem data'], motivo: MOTIVO_LINHA_IGNORADA.semData });
      return;
    }
    const coleta = dedup.montarColetaDeLinha(linha, 0);
    const validacao = prepararViagemParaImportacao(coleta);
    if (validacao.descartada || !validacao.validoDashboard) {
      const semMedida = !((Number(coleta.kmTotal) || 0) > 0) && !((Number(coleta.pesoTotal) || 0) > 0);
      ignoradas.push({
        excel: excel[i],
        motivos: validacao.motivos || [],
        motivo: semMedida
          ? MOTIVO_LINHA_IGNORADA.semKmESemPeso
          : (validacao.motivos?.[0] || MOTIVO_LINHA_IGNORADA.semKmESemPeso),
      });
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

function importarProducaoComoUpload(buffer: Buffer, _diaInicioCiclo: number) {
  const parsed = parsearPlanilhaConsolidadoProducao(buffer);
  const cons = ConsolidadoProducaoImportService as unknown as ConsolidadoInterno;

  let foraCiclo = 0;
  let repetidas = 0;
  const foraPorServico: Record<string, number> = {};
  const porServico = new Map<string, { nome: string; regs: number; areaM2: number; km: number }>();
  const coletasPorServico = new Map<string, ColetaData[]>();

  for (const [, linhasServico] of agruparLinhasPorServicoAba(parsed.linhas)) {
    const nome = linhasServico[0].nomeServico;
    const noCiclo = linhasServico.filter((l) => l.dataSaida);
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
    coletasPorServico.set(nome, novas);
  }

  const importadas = [...porServico.values()].reduce((s, v) => s + v.regs, 0);
  return {
    lidas: parsed.totalLinhasBrutas,
    importadas,
    foraCiclo,
    foraPorServico,
    repetidas,
    porServico,
    coletasPorServico,
    datasIgnoradas: [] as string[],
  };
}

function totaisProducao(tipo: string, rows: ColetaData[]): { dashboard: number; relatorio: number } {
  const vazio = () => ({ areaM2: 0, metroLinear: 0, kmLinear: 0, qtdArvore: 0, quantitativo: 0 });
  const porDia = new Map<string, ReturnType<typeof vazio>>();
  const total = vazio();
  for (const c of rows) {
    if (c.validoDashboard === false || !c.dataSaida) continue;
    const dia = isoDia(c.dataSaida)!;
    const campos = camposMetricaDeRegistro((c.dados || {}) as Record<string, unknown>);
    const acc = porDia.get(dia) || vazio();
    for (const chave of ['areaM2', 'metroLinear', 'kmLinear', 'qtdArvore', 'quantitativo'] as const) {
      const n = Number(campos[chave]) || 0;
      acc[chave] += n;
      total[chave] += n;
    }
    porDia.set(dia, acc);
  }
  let relatorio = 0;
  for (const campos of porDia.values()) relatorio += metricaOficialServico(tipo, campos).valor;
  return {
    dashboard: round2(metricaOficialServico(tipo, total).valor),
    relatorio: round2(relatorio),
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

  it('coleta: conferência traz os números da mensagem', () => {
    const r = importarColetaComoUpload(coletaBuf);
    const conf = montarConferencia({
      nome: 'Coleta Aparecida',
      registros: r.importadas,
      ignoradas: r.ignoradas.map((i) => ({ linhaExcel: i.excel, motivo: i.motivo })),
      lidas: r.lidas,
      formulaPesoTotalVazia: linhasFormulaPesoTotalVazia(coletaBuf),
    });
    assert.equal(
      conf.mensagem,
      [
        '✅ Planilha recebida — Coleta Aparecida — 25/09 a 23/10',
        'Linhas: 935 lidas · 932 importadas · 3 ignoradas (linhas 817, 818, 858: sem km e sem peso)',
        'Totais: 11.069,39 t · 1.539 viagens · 61,6 km/viagem · 78% com KM válido',
        '⚠️ Alertas: hodômetro não preenchido em 203 viagens · placa suspeita SDG646 (4 linhas) · fórmula PESO TOTAL vazia em 35 linhas',
      ].join('\n'),
    );
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

  it('executivo do contrato: viagens e km/viagem só da coleta', () => {
    const r = importarColetaComoUpload(coletaBuf);
    const brutos = (PlanilhaService as unknown as {
      converterColetasParaBrutos: (d: ColetaData[], apenasValidos: boolean) => Record<string, unknown>[];
    }).converterColetasParaBrutos(r.importadas, true);
    const coleta = calcularMetricaExecutivaDeDados(brutos, {}, 'coleta-aparecida');
    const producao = {
      ...coleta,
      viagens: 7190,
      viagensComKmValido: 7190,
      kmTotal: 200000,
      pesoTotalTon: 0,
      tonComKmValido: 0,
      kmMedioViagem: 27.82,
    };
    const tiposProducao = [
      TipoServico.ROCADEIRA,
      TipoServico.VARRICAO,
      TipoServico.REMOCAO,
      TipoServico.GERAL,
      TipoServico.PODA,
    ];
    const aparecida = agregarMetricasExecutivas([
      metricaExecutivaNoContrato(TipoServico.COLETA_CAMINHAO, coleta),
      ...tiposProducao.map((tipo) => metricaExecutivaNoContrato(tipo, producao)),
    ], coleta.qtdColetores);
    assert.equal(aparecida.viagens, 1539);
    assert.equal(aparecida.kmMedioViagem, 61.63);
    assert.equal(aparecida.pesoTotalTon, 11069.39);

    const unaiColeta = {
      ...coleta,
      viagens: 176,
      viagensComKmValido: 176,
      kmTotal: 8057.28,
      pesoTotalTon: 1159.24,
      tonComKmValido: 1159.24,
    };
    const unai = agregarMetricasExecutivas([
      metricaExecutivaNoContrato(TipoServico.COLETA_CAMINHAO, unaiColeta),
      metricaExecutivaNoContrato(TipoServico.ROCADEIRA, producao),
      metricaExecutivaNoContrato(TipoServico.GERAL, producao),
    ], 0);
    assert.equal(unai.viagens, 176);
    assert.equal(unai.kmMedioViagem, 45.78);
  });

  it('conferência avisa serviço Feiras criado', () => {
    const conf = montarConferencia({
      nome: 'Produção',
      registros: [{ dataSaida: new Date('2026-10-01T12:00:00Z'), dados: { _modeloPlanilha: 'consolidado_producao', _tipoServico: 'geral' } }],
      ignoradas: [],
      lidas: 1,
      modelo: 'consolidado_producao',
      servicosCriados: ['Feiras'],
    });
    assert.match(conf.mensagem, /serviço Feiras criado/);
  });

  it('produção: ciclo aberto anterior entra; repetidas e totais por serviço', () => {
    assert.equal(classificarPlanilhaContrato(producaoBuf).tipo, 'consolidado_producao');
    const r = importarProducaoComoUpload(producaoBuf, 25);
    const diffs: string[] = [];
    if (r.lidas !== 7680) diffs.push(`linhas lidas ${r.lidas} (esperado 7680)`);
    if (r.importadas !== 7674) diffs.push(`importadas ${r.importadas} (esperado 7674)`);
    if (r.foraCiclo !== 0) diffs.push(`fora do ciclo ${r.foraCiclo} (esperado 0 — ciclo aberto não é descartado)`);
    if (r.repetidas !== 6) diffs.push(`repetidas ${r.repetidas} (esperado 6)`);

    const esperado: Array<{ nome: string; regs: number; areaM2?: number; km?: number }> = [
      { nome: 'Roçada Mecanizada', regs: 3909, areaM2: 2657770.71 },
      { nome: 'Roçada Manual', regs: 1367, areaM2: 1753038.77 },
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

  it('produção: dashboard do serviço, executivo e relatório do dia coincidem', () => {
    const r = importarProducaoComoUpload(producaoBuf, 25);
    const alvos = [
      { nome: 'Roçada Manual', tipo: 'rocadeira', expr: 'SUM(Area m²)', coluna: 'Area m²', campo: 'areaM2' as const },
      { nome: 'Roçada Mecanizada', tipo: 'rocadeira', expr: 'SUM(Area m²)', coluna: 'Area m²', campo: 'areaM2' as const },
      { nome: 'Varrição Manual', tipo: 'varricao', expr: 'SUM(KM Linear)', coluna: 'KM Linear', campo: 'km' as const },
      { nome: 'Varrição Mecanizada', tipo: 'varricao', expr: 'SUM(KM Linear)', coluna: 'KM Linear', campo: 'km' as const },
    ];
    const diffs: string[] = [];
    for (const alvo of alvos) {
      const rows = r.coletasPorServico.get(alvo.nome) || [];
      const esperado = r.porServico.get(alvo.nome);
      const tela = totaisProducao(alvo.tipo, rows);
      const brutos = (PlanilhaService as unknown as {
        converterColetasParaBrutos: (d: ColetaData[], apenasValidos: boolean) => Record<string, unknown>[];
      }).converterColetasParaBrutos(rows, true);
      const kpi = calcularKpisAtivos(brutos, {}, [{
        nome: 'Total',
        expressao: alvo.expr,
        ativo: true,
      }], 0, [alvo.coluna]);
      const executivo = round2(Number(kpi[0]?.valor) || 0);
      const referencia = round2(Number(esperado?.[alvo.campo]) || 0);
      if (tela.dashboard !== executivo || tela.dashboard !== tela.relatorio || tela.dashboard !== referencia) {
        diffs.push(
          `${alvo.nome}: dashboard ${tela.dashboard} | executivo ${executivo} | relatório do dia ${tela.relatorio} | referência ${referencia}`,
        );
      }
    }
    assert.equal(diffs.length, 0, diffs.join('; '));
  });

  it('produção: várias linhas no mesmo local e dia entram nos três relatórios', () => {
    const dia = new Date('2026-10-01T12:00:00.000Z');
    const localCheio = 'RUA DAS FLORES CENTO E TRINTA E SEIS';
    const linhas = [120.5, 80.25, 40].map((area) => {
      const c = new ColetaData();
      c.dataSaida = dia;
      c.validoDashboard = true;
      c.distrito = localCheio.slice(0, 50);
      c.regional = c.distrito;
      c.tipoCaminhao = 'ROÇADEIRA 01';
      c.dados = {
        'Area m²': area,
        AREA_M2: area,
        LOCAL: localCheio,
        DISTRITO_COMPLETO: localCheio,
        SETOR: 'SETOR 1',
        EQUIPAMENTO: 'ROÇADEIRA 01',
        _tipoServico: 'rocadeira',
      };
      return c;
    });
    const tela = totaisProducao('rocadeira', linhas);
    const brutos = (PlanilhaService as unknown as {
      converterColetasParaBrutos: (d: ColetaData[], apenasValidos: boolean) => Record<string, unknown>[];
    }).converterColetasParaBrutos(linhas, true);
    const kpi = calcularKpisAtivos(brutos, {}, [{
      nome: 'Total',
      expressao: 'SUM(Area m²)',
      ativo: true,
    }], 0, ['Area m²']);
    const executivo = round2(Number(kpi[0]?.valor) || 0);
    assert.equal(tela.dashboard, 240.75);
    assert.equal(executivo, 240.75);
    assert.equal(tela.relatorio, 240.75);
  });
});
