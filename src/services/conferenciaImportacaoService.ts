/**
 * Conferência depois da importação, lida dos dados já gravados
 * (coleta_dados + importacao_linha_ignorada + alertas do arquivo no upload).
 * WhatsApp e a tela usam o mesmo objeto.
 */
import * as XLSX from 'xlsx';
import AppDataSource from '../database/data-source';
import { ColetaData } from '../entities/ColetaData';
import { ImportacaoLinhaIgnorada } from '../entities/ImportacaoLinhaIgnorada';
import { PlanilhaUpload } from '../entities/PlanilhaUpload';
import { Servico } from '../entities/Servico';
import { metricaDeRegistro } from '@sistemma/shared';
import { parseDataPlanilha } from '../utils/formatarDataPlanilha';
import {
  calcularCicloMensalContrato,
  deslocarMesReferencia,
  inferirCicloReferenciaDeDatas,
  normalizarDiaInicioCiclo,
} from '../utils/periodoCicloContrato';
import { nomeAbaColeta, linhasExcelPreenchidas } from './abaColeta';
import {
  catalogoAbaProducao,
  sheetEhConsolidado,
} from './consolidadoProducaoPlanilhaParser';
import { razoesKmDeRegistros } from './kmValido';
import {
  sqlAreaM2,
  sqlKmLinear,
  sqlMetroLinear,
  sqlQtdArvore,
  sqlQuantitativo,
} from './metricaServicoSql';
import { contarViagensPorRotaRegistro, obterPesoTotalRegistro } from './viagensPorRotaService';

const LIMITE_LINHAS_MENSAGEM = 10;

export interface RegistroConferencia {
  dataSaida?: Date | null;
  placa?: string | null;
  placaSuspeita?: boolean;
  kmTotal?: number | null;
  pesoTotal?: number | null;
  peso1?: number | null;
  peso2?: number | null;
  peso3?: number | null;
  peso4?: number | null;
  peso5?: number | null;
  viagensPorRota?: number | null;
  numeroViagens?: number | null;
  validoDashboard?: boolean;
  dados?: Record<string, unknown> | null;
}

export interface LinhaIgnoradaConferencia {
  linhaExcel: number;
  motivo: string;
}

export interface TotalServicoConferencia {
  nome: string;
  registros: number;
  areaM2: number;
  km: number;
  equipes: number;
}

export interface AlertaConferencia {
  codigo: 'hodometro' | 'placa' | 'formula_peso' | 'consolidado' | 'servico_criado' | 'valor_fora';
  texto: string;
  quantidade: number;
  linhas: number[];
  placa?: string;
}

export interface DiaQuantidade {
  data: string;
  valor: number;
}

export interface ConferenciaImportacao {
  tipo: 'coleta' | 'producao';
  nome: string;
  periodoInicio: string | null;
  periodoFim: string | null;
  lidas: number;
  importadas: number;
  ignoradas: LinhaIgnoradaConferencia[];
  totaisColeta: {
    toneladas: number;
    viagens: number;
    kmPorViagem: number;
    pctKmValido: number;
  } | null;
  totaisServico: TotalServicoConferencia[];
  alertas: AlertaConferencia[];
  mensagem: string;
}

export interface AlertasArquivo {
  formulaPesoTotalVazia: number[];
  consolidadoDesatualizado: boolean;
  dataConsolidado: string | null;
  dataAbasServico: string | null;
  servicosCriados?: string[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function formatarNumeroPt(n: number, casas: number): string {
  const neg = n < 0;
  const [inteiro, frac] = Math.abs(n).toFixed(casas).split('.');
  const comPonto = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const corpo = casas > 0 && frac != null ? `${comPonto},${frac}` : comPonto;
  return neg ? `-${corpo}` : corpo;
}

export function formatarListaLinhas(nums: number[], limite = LIMITE_LINHAS_MENSAGEM): string {
  const ordenados = [...nums].filter((n) => n > 0).sort((a, b) => a - b);
  const mostra = ordenados.slice(0, limite);
  const resto = ordenados.length - mostra.length;
  const base = mostra.join(', ');
  return resto > 0 ? `${base} e mais ${resto}` : base;
}

function isoDia(d: Date | null | undefined): string | null {
  if (!d || Number.isNaN(d.getTime())) return null;
  const meiaNoiteUtc = d.getUTCHours() === 0
    && d.getUTCMinutes() === 0
    && d.getUTCSeconds() === 0
    && d.getUTCMilliseconds() === 0;
  const y = meiaNoiteUtc ? d.getUTCFullYear() : d.getFullYear();
  const m = (meiaNoiteUtc ? d.getUTCMonth() : d.getMonth()) + 1;
  const dia = meiaNoiteUtc ? d.getUTCDate() : d.getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

function periodoTexto(inicio: string | null, fim: string | null): string {
  if (!inicio || !fim) return '';
  const [ya, ma, da] = inicio.split('-');
  const [yb, mb, db] = fim.split('-');
  if (ya === yb) return `${da}/${ma} a ${db}/${mb}`;
  return `${da}/${ma}/${ya} a ${db}/${mb}/${yb}`;
}

function normCab(s: string): string {
  return s
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function registroEhProducao(r: RegistroConferencia): boolean {
  const d = r.dados || {};
  const modelo = String(d._modeloPlanilha || '');
  if (modelo && modelo !== 'coleta') return true;
  return d.QUANTITATIVO != null
    || d['Area m²'] != null
    || d.AREA_M2 != null
    || d.KM_LINEAR != null
    || d['KM Linear'] != null;
}

function undEquipe(dados: Record<string, unknown>): boolean {
  const und = String(dados._undNormalizada || dados.UND || dados.UNIDADE || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return und === 'equipe' || und.includes('equipe');
}

function metricasProducao(registros: RegistroConferencia[], nomePadrao: string): TotalServicoConferencia[] {
  const mapa = new Map<string, TotalServicoConferencia>();
  for (const r of registros) {
    if (r.validoDashboard === false) continue;
    const d = r.dados || {};
    const nome = (nomePadrao || String(d['Tipo de serviço'] || d.SERVIÇO || d.TIPO_SERVICO || 'Serviço')).trim()
      || 'Serviço';
    const atual = mapa.get(nome) || { nome, registros: 0, areaM2: 0, km: 0, equipes: 0 };
    atual.registros += 1;
    atual.areaM2 += Number(d['Area m²'] || d.AREA_M2) || 0;
    atual.km += Number(d['KM Linear'] || d.KM_LINEAR) || 0;
    if (undEquipe(d)) {
      const q = Number(d.QUANTITATIVO || d.QUANTIDADE) || 0;
      atual.equipes += q > 0 ? q : 1;
    }
    mapa.set(nome, atual);
  }
  return [...mapa.values()].map((t) => ({
    ...t,
    areaM2: round2(t.areaM2),
    km: round2(t.km),
    equipes: round2(t.equipes),
  }));
}

function textoTotaisServico(totais: TotalServicoConferencia[]): string {
  return totais.map((t) => {
    const partes: string[] = [];
    if (t.areaM2 > 0) partes.push(`${formatarNumeroPt(t.areaM2, 2)} m²`);
    if (t.km > 0) partes.push(`${formatarNumeroPt(t.km, 2)} km`);
    if (t.equipes > 0) partes.push(`${formatarNumeroPt(t.equipes, t.equipes % 1 === 0 ? 0 : 2)} equipes`);
    if (!partes.length) partes.push(`${formatarNumeroPt(t.registros, 0)} registros`);
    return `${t.nome}: ${partes.join(' · ')}`;
  }).join(' · ');
}

function textoIgnoradas(ignoradas: LinhaIgnoradaConferencia[]): { resumo: string; detalhe: string | null } {
  if (ignoradas.length === 0) return { resumo: '0 ignoradas', detalhe: null };
  const porMotivo = new Map<string, number[]>();
  for (const linha of ignoradas) {
    const arr = porMotivo.get(linha.motivo) || [];
    arr.push(linha.linhaExcel);
    porMotivo.set(linha.motivo, arr);
  }
  const grupos = [...porMotivo.entries()].map(([motivo, linhas]) => {
    const lista = formatarListaLinhas(linhas);
    return `${formatarNumeroPt(linhas.length, 0)} ${motivo} (linhas ${lista})`;
  });
  if (porMotivo.size === 1) {
    const [motivo, linhas] = [...porMotivo.entries()][0];
    return {
      resumo: `${formatarNumeroPt(ignoradas.length, 0)} ignoradas (linhas ${formatarListaLinhas(linhas)}: ${motivo})`,
      detalhe: null,
    };
  }
  return {
    resumo: `${formatarNumeroPt(ignoradas.length, 0)} ignoradas`,
    detalhe: `Ignoradas: ${grupos.join(' · ')}`,
  };
}

function alertasColeta(
  registros: RegistroConferencia[],
  formulaLinhas: number[],
): AlertaConferencia[] {
  const validos = registros.filter((r) => r.validoDashboard !== false);
  const semHodometro = validos.filter((r) => !((Number(r.kmTotal) || 0) > 0)).length;
  const alertas: AlertaConferencia[] = [];
  if (semHodometro > 0) {
    alertas.push({
      codigo: 'hodometro',
      quantidade: semHodometro,
      linhas: [],
      texto: `hodômetro não preenchido em ${formatarNumeroPt(semHodometro, 0)} viagens`,
    });
  }
  const placas = new Map<string, number>();
  for (const r of validos) {
    if (!r.placaSuspeita) continue;
    const placa = String(r.placa || '').trim();
    if (!placa) continue;
    placas.set(placa, (placas.get(placa) || 0) + 1);
  }
  const ordenadas = [...placas.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  for (const [placa, qtd] of ordenadas) {
    alertas.push({
      codigo: 'placa',
      placa,
      quantidade: qtd,
      linhas: [],
      texto: `placa suspeita ${placa} (${formatarNumeroPt(qtd, 0)} ${qtd === 1 ? 'linha' : 'linhas'})`,
    });
  }
  if (formulaLinhas.length > 0) {
    alertas.push({
      codigo: 'formula_peso',
      quantidade: formulaLinhas.length,
      linhas: [...formulaLinhas].sort((a, b) => a - b),
      texto: `fórmula PESO TOTAL vazia em ${formatarNumeroPt(formulaLinhas.length, 0)} ${formulaLinhas.length === 1 ? 'linha' : 'linhas'}`,
    });
  }
  return alertas;
}

export function formatarMensagemConferencia(conf: Omit<ConferenciaImportacao, 'mensagem'>): string {
  const periodo = periodoTexto(conf.periodoInicio, conf.periodoFim);
  const cabeca = periodo
    ? `✅ Planilha recebida — ${conf.nome} — ${periodo}`
    : `✅ Planilha recebida — ${conf.nome}`;
  const ign = textoIgnoradas(conf.ignoradas);
  const linhas = `Linhas: ${formatarNumeroPt(conf.lidas, 0)} lidas · ${formatarNumeroPt(conf.importadas, 0)} importadas · ${ign.resumo}`;
  let totais = 'Totais: —';
  if (conf.tipo === 'coleta' && conf.totaisColeta) {
    const t = conf.totaisColeta;
    totais = `Totais: ${formatarNumeroPt(t.toneladas, 2)} t · ${formatarNumeroPt(t.viagens, 0)} viagens · ${formatarNumeroPt(t.kmPorViagem, 1)} km/viagem · ${formatarNumeroPt(t.pctKmValido, 0)}% com KM válido`;
  } else if (conf.totaisServico.length) {
    totais = `Totais: ${textoTotaisServico(conf.totaisServico)}`;
  }
  const partes = [cabeca, linhas];
  if (ign.detalhe) partes.push(ign.detalhe);
  partes.push(totais);
  if (conf.alertas.length) {
    partes.push(`⚠️ Alertas: ${conf.alertas.map((a) => a.texto).join(' · ')}`);
  }
  return partes.join('\n');
}

const DIAS_SEGUIDOS_IGUAIS = 5;

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function formatarQuantidadeAlerta(n: number): string {
  const arred = round3(n);
  const texto = arred.toFixed(3).replace(/\.?0+$/, '');
  const negativo = texto.startsWith('-');
  const [inteiroBruto, frac] = texto.replace('-', '').split('.');
  const comPonto = inteiroBruto.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const corpo = frac ? `${comPonto},${frac}` : comPonto;
  return negativo ? `-${corpo}` : corpo;
}

function diaMes(iso: string): string {
  const partes = iso.split('-');
  if (partes.length !== 3) return iso;
  return `${partes[2]}/${partes[1]}`;
}

function diaSeguinte(iso: string): string {
  const [ano, mes, dia] = iso.split('-').map((p) => parseInt(p, 10));
  const data = new Date(Date.UTC(ano, mes - 1, dia + 1));
  return data.toISOString().slice(0, 10);
}

export function somarQuantidadePorDia(dias: DiaQuantidade[]): DiaQuantidade[] {
  const mapa = new Map<string, number>();
  for (const dia of dias) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia.data) || !(dia.valor > 0)) continue;
    mapa.set(dia.data, (mapa.get(dia.data) || 0) + dia.valor);
  }
  return [...mapa.entries()]
    .map(([data, valor]) => ({ data, valor }))
    .sort((a, b) => a.data.localeCompare(b.data));
}

export function medianaNumerica(valores: number[]): number | null {
  const nums = valores.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const meio = Math.floor(nums.length / 2);
  if (nums.length % 2 === 1) return nums[meio];
  return (nums[meio - 1] + nums[meio]) / 2;
}

function textoValorFora(nome: string, data: string, valor: number, unidade: string, mediana: number | null): string {
  const sufixo = unidade ? ` ${unidade}` : '';
  const base = `${nome} ${diaMes(data)}: ${formatarQuantidadeAlerta(valor)}${sufixo}`;
  if (mediana != null && mediana > 0) {
    return `${base}, mediana ${formatarQuantidadeAlerta(mediana)}${sufixo} — confira`;
  }
  return `${base} — confira`;
}

/**
 * Compara cada dia importado com a mediana dos dias dos dois ciclos anteriores.
 * Mais de 3× acima, abaixo de 1/3, ou o mesmo valor em 5+ dias seguidos: só avisa.
 */
export function alertasQuantidadeForaDoNormal(opts: {
  nome: string;
  unidade: string;
  dias: DiaQuantidade[];
  historico: DiaQuantidade[];
  diasCiclo?: DiaQuantidade[];
}): AlertaConferencia[] {
  const nome = String(opts.nome || '').trim() || 'Serviço';
  const alvo = somarQuantidadePorDia(opts.dias);
  if (alvo.length === 0) return [];
  const ciclo = somarQuantidadePorDia(opts.diasCiclo && opts.diasCiclo.length ? opts.diasCiclo : opts.dias);
  const porData = new Map(ciclo.map((dia) => [dia.data, dia.valor]));
  const mediana = medianaNumerica(somarQuantidadePorDia(opts.historico).map((dia) => dia.valor));
  const repetidos = new Set<string>();
  let sequencia: DiaQuantidade[] = [];
  const fechar = () => {
    if (sequencia.length >= DIAS_SEGUIDOS_IGUAIS) {
      for (const dia of sequencia) repetidos.add(dia.data);
    }
    sequencia = [];
  };
  for (const dia of ciclo) {
    const anterior = sequencia[sequencia.length - 1];
    const continua = anterior
      && diaSeguinte(anterior.data) === dia.data
      && round3(anterior.valor) === round3(dia.valor);
    if (continua) sequencia.push(dia);
    else {
      fechar();
      sequencia = [dia];
    }
  }
  fechar();

  const alertas: AlertaConferencia[] = [];
  for (const dia of alvo) {
    const valor = porData.get(dia.data) ?? dia.valor;
    const foraDaMediana = mediana != null && mediana > 0
      && (round3(valor) > round3(mediana * 3) || round3(valor) < round3(mediana / 3));
    if (!foraDaMediana && !repetidos.has(dia.data)) continue;
    alertas.push({
      codigo: 'valor_fora',
      quantidade: 1,
      linhas: [],
      texto: textoValorFora(nome, dia.data, valor, opts.unidade, mediana),
    });
  }
  return alertas;
}

function metricaSqlDoTipo(tipo: string | null | undefined): { expr: string; unidade: string } | null {
  switch (String(tipo || '')) {
    case 'rocadeira':
      return { expr: sqlAreaM2('d'), unidade: 'm²' };
    case 'capina':
      return { expr: sqlMetroLinear('d'), unidade: 'm' };
    case 'varricao':
      return { expr: sqlKmLinear('d'), unidade: 'km' };
    case 'poda':
      return { expr: sqlQtdArvore('d'), unidade: 'arv' };
    case 'pintura_meio_fio':
      return { expr: sqlMetroLinear('d'), unidade: 'm' };
    case 'remocao':
    case 'geral':
      return { expr: sqlQuantitativo('d'), unidade: 'pts' };
    default:
      return null;
  }
}

function diasDaImportacao(registros: RegistroConferencia[], tipo: string): DiaQuantidade[] {
  const dias: DiaQuantidade[] = [];
  for (const registro of registros) {
    if (registro.validoDashboard === false) continue;
    const data = isoDia(registro.dataSaida ?? null);
    if (!data) continue;
    const valor = metricaDeRegistro(tipo, (registro.dados || {}) as Record<string, unknown>).valor;
    if (valor > 0) dias.push({ data, valor });
  }
  return somarQuantidadePorDia(dias);
}

async function alertasValorForaDoUpload(
  servico: Servico,
  registros: RegistroConferencia[],
): Promise<AlertaConferencia[]> {
  const metrica = metricaSqlDoTipo(servico.tipo);
  if (!metrica) return [];
  const diasUpload = diasDaImportacao(registros, servico.tipo);
  if (diasUpload.length === 0) return [];
  const diaInicio = normalizarDiaInicioCiclo(servico.contract?.diaInicioCiclo);
  const ref = inferirCicloReferenciaDeDatas(diasUpload.map((dia) => dia.data), diaInicio);
  if (!ref) return [];
  const ciclo = calcularCicloMensalContrato(ref.anoReferencia, ref.mesReferencia, diaInicio);
  const anterior = deslocarMesReferencia(ref.mesReferencia, ref.anoReferencia, -1);
  const doisAtras = deslocarMesReferencia(ref.mesReferencia, ref.anoReferencia, -2);
  const inicioHistorico = calcularCicloMensalContrato(
    doisAtras.ano,
    doisAtras.mes,
    diaInicio,
  ).dataInicio;
  const fimAnterior = calcularCicloMensalContrato(anterior.ano, anterior.mes, diaInicio).dataFim;
  const linhas = await AppDataSource.query(
    `SELECT to_char(d."dataSaida", 'YYYY-MM-DD') AS dia,
            SUM(${metrica.expr}) AS valor
     FROM coleta_dados d
     WHERE d."planilhaUploadId" IN (
       SELECT u.id FROM planilha_uploads u WHERE u.servico_id = $1
     )
       AND COALESCE(d."validoDashboard", true) = true
       AND d."dataSaida" >= $2
       AND d."dataSaida" <= $3
     GROUP BY 1
     HAVING SUM(${metrica.expr}) > 0
     ORDER BY 1`,
    [servico.id, inicioHistorico, ciclo.dataFim],
  ) as Array<{ dia: string; valor: string | number }>;
  const lidos = linhas
    .map((linha) => ({ data: String(linha.dia).slice(0, 10), valor: Number(linha.valor) }))
    .filter((dia) => dia.valor > 0);
  const historico = lidos.filter((dia) => dia.data >= inicioHistorico && dia.data <= fimAnterior);
  const diasCiclo = lidos.filter((dia) => dia.data >= ciclo.dataInicio && dia.data <= ciclo.dataFim);
  return alertasQuantidadeForaDoNormal({
    nome: servico.nome,
    unidade: metrica.unidade,
    dias: diasUpload,
    historico,
    diasCiclo: diasCiclo.length ? diasCiclo : diasUpload,
  });
}

export function montarConferencia(opts: {
  nome: string;
  registros: RegistroConferencia[];
  ignoradas: LinhaIgnoradaConferencia[];
  lidas?: number;
  modelo?: string | null;
  formulaPesoTotalVazia?: number[];
  consolidadoDesatualizado?: boolean;
  servicosCriados?: string[];
  alertasQuantidade?: AlertaConferencia[];
}): ConferenciaImportacao {
  const modelo = opts.modelo || null;
  const producaoPorModelo = !!modelo && modelo !== 'coleta';
  const producaoPorLinha = opts.registros.some(registroEhProducao);
  const tipo: 'coleta' | 'producao' = producaoPorModelo || (producaoPorLinha && modelo !== 'coleta')
    ? 'producao'
    : 'coleta';
  const usados = opts.registros.filter((r) => r.validoDashboard !== false);
  const datas = usados
    .map((r) => isoDia(r.dataSaida ?? null))
    .filter((d): d is string => !!d)
    .sort();
  const formula = opts.formulaPesoTotalVazia || [];
  const alertas = tipo === 'coleta'
    ? alertasColeta(usados, formula)
    : [];
  if (tipo === 'producao' && opts.consolidadoDesatualizado) {
    alertas.push({
      codigo: 'consolidado',
      quantidade: 1,
      linhas: [],
      texto: 'CONSOLIDADO possivelmente desatualizado',
    });
  }
  for (const nome of opts.servicosCriados || []) {
    const limpo = String(nome || '').trim();
    if (!limpo) continue;
    alertas.push({
      codigo: 'servico_criado',
      quantidade: 1,
      linhas: [],
      texto: `serviço ${limpo} criado`,
    });
  }
  for (const extra of opts.alertasQuantidade || []) {
    if (extra.codigo !== 'valor_fora' || !extra.texto) continue;
    alertas.push(extra);
  }
  let totaisColeta: ConferenciaImportacao['totaisColeta'] = null;
  let totaisServico: TotalServicoConferencia[] = [];
  if (tipo === 'coleta') {
    let viagens = 0;
    for (const r of usados) viagens += contarViagensPorRotaRegistro(r as ColetaData);
    const razao = razoesKmDeRegistros(usados.map((r) => ({
      viagens: contarViagensPorRotaRegistro(r as ColetaData),
      km: Number(r.kmTotal) || 0,
      ton: obterPesoTotalRegistro(r as ColetaData) / 1000,
    })));
    const pesoKg = usados.reduce((s, r) => s + obterPesoTotalRegistro(r as ColetaData), 0);
    totaisColeta = {
      toneladas: round2(pesoKg / 1000),
      viagens,
      kmPorViagem: razao.kmPorViagem,
      pctKmValido: razao.pctViagensKmValido,
    };
  } else {
    totaisServico = metricasProducao(usados, opts.nome);
  }
  const base = {
    tipo,
    nome: opts.nome,
    periodoInicio: datas[0] || null,
    periodoFim: datas[datas.length - 1] || null,
    lidas: opts.lidas ?? (usados.length + opts.ignoradas.length),
    importadas: usados.length,
    ignoradas: [...opts.ignoradas].sort((a, b) => a.linhaExcel - b.linhaExcel || a.motivo.localeCompare(b.motivo)),
    totaisColeta,
    totaisServico,
    alertas,
  };
  return { ...base, mensagem: formatarMensagemConferencia(base) };
}

export function juntarConferencias(lista: ConferenciaImportacao[], nome: string): ConferenciaImportacao | null {
  if (lista.length === 0) return null;
  if (lista.length === 1) return lista[0];
  const tipo: 'coleta' | 'producao' = lista.every((c) => c.tipo === 'coleta') ? 'coleta' : 'producao';
  const datas = lista.flatMap((c) => [c.periodoInicio, c.periodoFim]).filter((d): d is string => !!d).sort();
  const servicos = new Map<string, TotalServicoConferencia>();
  for (const conf of lista) {
    for (const t of conf.totaisServico) {
      const atual = servicos.get(t.nome) || { nome: t.nome, registros: 0, areaM2: 0, km: 0, equipes: 0 };
      atual.registros += t.registros;
      atual.areaM2 = round2(atual.areaM2 + t.areaM2);
      atual.km = round2(atual.km + t.km);
      atual.equipes = round2(atual.equipes + t.equipes);
      servicos.set(t.nome, atual);
    }
  }
  const placas = new Map<string, AlertaConferencia>();
  let hodometro = 0;
  const formula = new Set<number>();
  let consolidado = false;
  const valorFora: AlertaConferencia[] = [];
  for (const conf of lista) {
    for (const alerta of conf.alertas) {
      if (alerta.codigo === 'hodometro') hodometro += alerta.quantidade;
      if (alerta.codigo === 'formula_peso') alerta.linhas.forEach((n) => formula.add(n));
      if (alerta.codigo === 'consolidado') consolidado = true;
      if (alerta.codigo === 'valor_fora') valorFora.push(alerta);
      if (alerta.codigo === 'placa' && alerta.placa) {
        const prev = placas.get(alerta.placa);
        placas.set(alerta.placa, {
          codigo: 'placa',
          placa: alerta.placa,
          quantidade: (prev?.quantidade || 0) + alerta.quantidade,
          linhas: [],
          texto: '',
        });
      }
    }
  }
  const alertas: AlertaConferencia[] = [];
  if (hodometro > 0) {
    alertas.push({
      codigo: 'hodometro',
      quantidade: hodometro,
      linhas: [],
      texto: `hodômetro não preenchido em ${formatarNumeroPt(hodometro, 0)} viagens`,
    });
  }
  for (const alerta of [...placas.values()].sort((a, b) => b.quantidade - a.quantidade)) {
    alertas.push({
      ...alerta,
      texto: `placa suspeita ${alerta.placa} (${formatarNumeroPt(alerta.quantidade, 0)} ${alerta.quantidade === 1 ? 'linha' : 'linhas'})`,
    });
  }
  if (formula.size > 0) {
    const linhas = [...formula].sort((a, b) => a - b);
    alertas.push({
      codigo: 'formula_peso',
      quantidade: linhas.length,
      linhas,
      texto: `fórmula PESO TOTAL vazia em ${formatarNumeroPt(linhas.length, 0)} ${linhas.length === 1 ? 'linha' : 'linhas'}`,
    });
  }
  if (consolidado) {
    alertas.push({
      codigo: 'consolidado',
      quantidade: 1,
      linhas: [],
      texto: 'CONSOLIDADO possivelmente desatualizado',
    });
  }
  alertas.push(...valorFora);
  let totaisColeta: ConferenciaImportacao['totaisColeta'] = null;
  if (tipo === 'coleta') {
    const comTotais = lista.filter((c) => c.totaisColeta);
    const viagens = comTotais.reduce((s, c) => s + (c.totaisColeta?.viagens || 0), 0);
    const toneladas = round2(comTotais.reduce((s, c) => s + (c.totaisColeta?.toneladas || 0), 0));
    const viagensComKm = comTotais.reduce((s, c) => {
      const t = c.totaisColeta;
      if (!t || !t.viagens) return s;
      return s + Math.round((t.pctKmValido / 100) * t.viagens);
    }, 0);
    const km = comTotais.reduce((s, c) => {
      const t = c.totaisColeta;
      if (!t) return s;
      const comKm = t.viagens > 0 ? Math.round((t.pctKmValido / 100) * t.viagens) : 0;
      return s + t.kmPorViagem * comKm;
    }, 0);
    totaisColeta = {
      toneladas,
      viagens,
      kmPorViagem: viagensComKm > 0 ? Math.round((km / viagensComKm) * 100) / 100 : 0,
      pctKmValido: viagens > 0 ? Math.round((viagensComKm / viagens) * 100) : 0,
    };
  }
  const base = {
    tipo,
    nome,
    periodoInicio: datas[0] || null,
    periodoFim: datas[datas.length - 1] || null,
    lidas: lista.reduce((s, c) => s + c.lidas, 0),
    importadas: lista.reduce((s, c) => s + c.importadas, 0),
    ignoradas: lista.flatMap((c) => c.ignoradas),
    totaisColeta,
    totaisServico: [...servicos.values()],
    alertas,
  };
  return { ...base, mensagem: formatarMensagemConferencia(base) };
}

export function mensagemWhatsappDeConferencias(lista: ConferenciaImportacao[], nomeGrupo?: string): string {
  if (lista.length === 0) return '';
  if (lista.length === 1) return lista[0].mensagem;
  const juntada = juntarConferencias(lista, nomeGrupo || (lista[0].tipo === 'producao' ? 'Produção' : lista[0].nome));
  return juntada?.mensagem || lista.map((c) => c.mensagem).join('\n\n');
}

function dataMaximaAba(ws: XLSX.WorkSheet | undefined): string | null {
  if (!ws) return null;
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true }) as unknown[][];
  let idx = -1;
  let header = 0;
  const lim = Math.min(15, rows.length);
  for (let r = 0; r < lim; r++) {
    const row = rows[r] || [];
    const i = row.findIndex((c) => {
      const n = normCab(String(c ?? ''));
      return n === 'DATA' || n === 'DATA SAIDA' || n === 'DIA' || n.startsWith('DATA ');
    });
    if (i >= 0) {
      idx = i;
      header = r;
      break;
    }
  }
  if (idx < 0) return null;
  let max: string | null = null;
  for (let r = header + 1; r < rows.length; r++) {
    const parsed = parseDataPlanilha((rows[r] || [])[idx]);
    const iso = isoDia(parsed);
    if (iso && (!max || iso > max)) max = iso;
  }
  return max;
}

export function linhasFormulaPesoTotalVazia(buffer: Buffer): number[] {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: 'buffer', cellDates: false, cellFormula: true });
  } catch {
    return [];
  }
  let nome: string;
  try {
    nome = nomeAbaColeta(wb);
  } catch {
    return [];
  }
  const sheet = wb.Sheets[nome];
  if (!sheet) return [];
  const header = (XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null })[0] || []) as unknown[];
  const idx = header.findIndex((c) => normCab(String(c ?? '')) === 'PESO TOTAL');
  if (idx < 0) return [];
  const linhas: number[] = [];
  for (const excel of linhasExcelPreenchidas(sheet)) {
    const cell = sheet[XLSX.utils.encode_cell({ r: excel - 1, c: idx })] as XLSX.CellObject | undefined;
    if (!cell?.f) linhas.push(excel);
  }
  return linhas;
}

export function alertaConsolidadoArquivo(buffer: Buffer): {
  desatualizado: boolean;
  dataConsolidado: string | null;
  dataAbasServico: string | null;
} {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  } catch {
    return { desatualizado: false, dataConsolidado: null, dataAbasServico: null };
  }
  const nomeCons = wb.SheetNames.find((n) => sheetEhConsolidado(n));
  const abasServico = wb.SheetNames.filter((n) => catalogoAbaProducao(n));
  if (!nomeCons || abasServico.length === 0) {
    return { desatualizado: false, dataConsolidado: null, dataAbasServico: null };
  }
  const dataConsolidado = dataMaximaAba(wb.Sheets[nomeCons]);
  let dataAbasServico: string | null = null;
  for (const nome of abasServico) {
    const data = dataMaximaAba(wb.Sheets[nome]);
    if (data && (!dataAbasServico || data > dataAbasServico)) dataAbasServico = data;
  }
  const desatualizado = !!dataConsolidado && !!dataAbasServico && dataConsolidado < dataAbasServico;
  return { desatualizado, dataConsolidado, dataAbasServico };
}

export function lerAlertasArquivo(buffer: Buffer): AlertasArquivo {
  const consolidado = alertaConsolidadoArquivo(buffer);
  return {
    formulaPesoTotalVazia: linhasFormulaPesoTotalVazia(buffer),
    consolidadoDesatualizado: consolidado.desatualizado,
    dataConsolidado: consolidado.dataConsolidado,
    dataAbasServico: consolidado.dataAbasServico,
  };
}

export function idsDeUploads(resultado: unknown): number[] {
  const ids = new Set<number>();
  const obj = resultado && typeof resultado === 'object' ? resultado as Record<string, unknown> : {};
  const principal = Number(obj.planilhaUploadId);
  if (principal > 0) ids.add(principal);
  const listas = [obj.splitPorServico, obj.planilhaUploadIds, obj.alvos];
  for (const lista of listas) {
    if (!Array.isArray(lista)) continue;
    for (const item of lista) {
      const id = Number(typeof item === 'number' ? item : (item as { planilhaUploadId?: number })?.planilhaUploadId);
      if (id > 0) ids.add(id);
    }
  }
  return [...ids];
}

export async function gravarAlertasArquivo(planilhaUploadId: number, buffer: Buffer): Promise<void> {
  if (!planilhaUploadId) return;
  const alertas = lerAlertasArquivo(buffer);
  const repo = AppDataSource.getRepository(PlanilhaUpload);
  const upload = await repo.findOne({ where: { id: planilhaUploadId } });
  if (!upload) return;
  upload.resumo = {
    ...(upload.resumo || {
      novos: upload.linhasImportadas || 0,
      duplicadosIgnorados: upload.linhasIgnoradas || 0,
      conflitantes: 0,
      substituidos: upload.linhasSubstituidas || 0,
    }),
    alertasArquivo: {
      ...alertas,
      servicosCriados: servicosCriadosDoResumo(upload.resumo),
    },
  };
  await repo.save(upload);
}

function servicosCriadosDoResumo(resumo: PlanilhaUpload['resumo']): string[] {
  const lista = resumo?.servicosCriados;
  return Array.isArray(lista) ? lista.map((nome) => String(nome).trim()).filter(Boolean) : [];
}

export async function gravarAlertasArquivoEm(ids: number[], buffer: Buffer): Promise<void> {
  const unicos = [...new Set(ids.filter((id) => id > 0))];
  if (!unicos.length) return;
  const alertas = lerAlertasArquivo(buffer);
  const repo = AppDataSource.getRepository(PlanilhaUpload);
  for (const id of unicos) {
    const upload = await repo.findOne({ where: { id } });
    if (!upload) continue;
    upload.resumo = {
      ...(upload.resumo || {
        novos: upload.linhasImportadas || 0,
        duplicadosIgnorados: upload.linhasIgnoradas || 0,
        conflitantes: 0,
        substituidos: upload.linhasSubstituidas || 0,
      }),
      alertasArquivo: {
        ...alertas,
        servicosCriados: servicosCriadosDoResumo(upload.resumo),
      },
    };
    await repo.save(upload);
  }
}

function modeloDoUpload(upload: PlanilhaUpload): string | null {
  const modelo = upload.resumo?.modelo;
  if (modelo) return modelo;
  const alertas = upload.resumo?.alertasArquivo;
  if (alertas?.consolidadoDesatualizado) return 'consolidado_producao';
  return null;
}

export async function conferenciaDoUpload(planilhaUploadId: number): Promise<ConferenciaImportacao | null> {
  if (!planilhaUploadId) return null;
  const uploadRepo = AppDataSource.getRepository(PlanilhaUpload);
  const upload = await uploadRepo.findOne({ where: { id: planilhaUploadId } });
  if (!upload) return null;

  const servico = upload.servico_id
    ? await AppDataSource.getRepository(Servico).findOne({
      where: { id: upload.servico_id },
      relations: ['contract'],
    })
    : null;

  const registros = await AppDataSource.getRepository(ColetaData).find({
    where: { planilhaUploadId },
    select: [
      'dataSaida', 'placa', 'placaSuspeita', 'kmTotal', 'pesoTotal',
      'peso1', 'peso2', 'peso3', 'peso4', 'peso5',
      'viagensPorRota', 'numeroViagens', 'validoDashboard', 'dados',
    ],
  });
  const ignoradasRows = await AppDataSource.getRepository(ImportacaoLinhaIgnorada).find({
    where: { planilhaUploadId },
    select: ['linhaExcel', 'motivo'],
    order: { linhaExcel: 'ASC' },
  });
  const modelo = modeloDoUpload(upload);
  const producao = (!!modelo && modelo !== 'coleta') || registros.some(registroEhProducao);
  const importadas = registros.filter((r) => r.validoDashboard !== false).length;
  const lidas = producao
    ? importadas + ignoradasRows.length
    : (upload.totalLinhas || importadas + ignoradasRows.length);
  const alertas = upload.resumo?.alertasArquivo;
  let alertasQuantidade: AlertaConferencia[] = [];
  if (servico) {
    try {
      alertasQuantidade = await alertasValorForaDoUpload(servico, registros);
    } catch (err: any) {
      console.warn('[Conferencia] valor fora do normal:', err?.message || err);
    }
  }

  return montarConferencia({
    nome: servico?.nome || upload.nomeArquivo.replace(/\.[^.]+$/, ''),
    registros,
    ignoradas: ignoradasRows.map((l) => ({ linhaExcel: l.linhaExcel, motivo: l.motivo })),
    lidas,
    modelo,
    formulaPesoTotalVazia: alertas?.formulaPesoTotalVazia || [],
    consolidadoDesatualizado: !!alertas?.consolidadoDesatualizado,
    servicosCriados: alertas?.servicosCriados || servicosCriadosDoResumo(upload.resumo),
    alertasQuantidade,
  });
}

export function planilhaConferenciaBuffer(conf: ConferenciaImportacao): Buffer {
  const resumo = [
    ['Campo', 'Valor'],
    ['Serviço', conf.nome],
    ['Período', periodoTexto(conf.periodoInicio, conf.periodoFim)],
    ['Lidas', conf.lidas],
    ['Importadas', conf.importadas],
    ['Ignoradas', conf.ignoradas.length],
    ['Mensagem', conf.mensagem],
  ];
  if (conf.totaisColeta) {
    resumo.push(
      ['Toneladas', conf.totaisColeta.toneladas],
      ['Viagens', conf.totaisColeta.viagens],
      ['km/viagem', conf.totaisColeta.kmPorViagem],
      ['% KM válido', conf.totaisColeta.pctKmValido],
    );
  }
  for (const t of conf.totaisServico) {
    resumo.push([t.nome, textoTotaisServico([t]).replace(`${t.nome}: `, '')]);
  }
  const ignoradas = [
    ['Linha', 'Motivo'],
    ...conf.ignoradas.map((l) => [l.linhaExcel, l.motivo]),
  ];
  const alertas: Array<Array<string | number>> = [['Alerta', 'Linha']];
  for (const alerta of conf.alertas) {
    if (alerta.linhas.length === 0) alertas.push([alerta.texto, '']);
    else for (const linha of alerta.linhas) alertas.push([alerta.texto, linha]);
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumo), 'Resumo');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ignoradas), 'Ignoradas');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(alertas), 'Alertas');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
