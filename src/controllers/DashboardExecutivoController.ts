/* ============================================
   Dashboard Executivo Controller
   Endpoint único que calcula todos os indicadores financeiros,
   operacionais, comparativos e tendências para o dashboard executivo.

   GET /api/dashboard/executivo
   Query params:
     - periodo: 'ciclo' | 'hoje' | 'semana' | 'mes' | '30d' | '90d' | 'personalizado'
     - mesReferencia: number (1-12) — ciclo do contrato
     - anoReferencia: number — ciclo do contrato
     - dataInicio: string (ISO) — usado quando periodo = 'personalizado'
     - dataFim: string (ISO)
     - contractId: string (opcional — filtra por contrato)
     - servicoId: string (opcional — filtra por serviço específico)
   ============================================ */

import { Request, Response } from 'express';
import { Repository } from 'typeorm';
import {
  startOfDay, endOfDay, subDays, startOfWeek, endOfWeek,
  startOfMonth, endOfMonth, subMonths, format,
  differenceInDays,
} from 'date-fns';
import AppDataSource from '../database/data-source';
import { ehHubDeContratos, escopoCacheTenant } from '../services/tenantFanout';
import { ColetaData } from '../entities/ColetaData';
import { Abastecimento } from '../entities/Abastecimento';
import { Servico } from '../entities/Servico';
import { Contract } from '../entities/Contract';
import { Caminhao } from '../entities/Caminhao';
import {
  encontrarValorColuna,
} from '../services/FormulaEngine';
import { aplicarFiltroViagensValidasDashboard } from '../services/validacaoViagemService';
import { gerarHtmlRelatorioExecutivo, PdfExecutivoParams } from '../services/PdfRelatorioExecutivoService';
import { invalidarPdfCache, getPdfCache, getPdfCacheDuracao } from '../services/PdfCacheManager';
import { dashboardCache } from '../services/DashboardCacheManager';
import { calcularIndicadoresExecutivoUnificado } from '../services/executivoIndicadoresService';
import {
  contarRotasValidadas,
  contarViagensPorRotaRegistro,
  sumarizarViagensPorRota,
} from '../services/viagensPorRotaService';
import { resolverValorUnitarioPorTipo, normalizarTipoCaminhaoPeso } from '../config/pesoMaximoCaminhao';
import {
  calcularCicloMensalContrato,
  inferirMesReferenciaAtual,
  deslocarMesReferencia,
  normalizarDiaInicioCiclo,
  recortarPeriodoAteReferencia,
  primeirosNDiasPeriodo,
} from '../utils/periodoCicloContrato';
import { diagnosticarDashboards } from '../services/diagnosticoDashboardService';
import { TIPOS_SERVICO_META } from '../enums/TipoServico';
import crypto from 'crypto';

function sanitizarNomePdf(parte: string, maxLen = 50): string {
  return (parte || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, maxLen);
}

function labelTipoServicoPdf(tipo: string): string {
  const meta = TIPOS_SERVICO_META[tipo];
  if (!meta?.label) return tipo.replace(/_/g, ' ');
  return meta.label.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').trim();
}

const PDF_CACHE_DURACAO = getPdfCacheDuracao();
const pdfCache = getPdfCache();

/* ─── Helpers ─── */

function detectarColuna(dados: Record<string, any>[], candidatos: string[]): string {
  if (!dados || dados.length === 0) return candidatos[0] || '';
  const chaves = Object.keys(dados[0]);
  for (const candidato of candidatos) {
    const norm = candidato.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
    for (const chave of chaves) {
      const chaveNorm = chave.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
      // ⭐ CORRIGIDO: usar includes em vez de === para capturar variações como
      // "TIPODECAMINHAO" (real) vs "TIPOCAMINHAO" (candidato)
      if (chaveNorm.includes(norm) || norm.includes(chaveNorm)) return chave;
    }
  }
  return candidatos[0] || '';
}

/**
 * Extrai horas produtivas de um registro usando múltiplos níveis de fallback:
 * 1. Propriedades mapeadas da entidade (horasForaUnidade, tempoForaUnidade)
 * 2. Coluna genérica detectada nos dados brutos ("HORAS", "TEMPO FORA", etc.)
 * 3. Colunas de hora específicas nos dados brutos ("HORA SÁIDA BASE", "HORA CHEGADA BASE")
 * 4. Propriedade horaSaida/horaChegada da entidade (se mapeadas corretamente)
 */
function extrairHorasProdutivas(obj: Record<string, any>): number {
  let horas = 0;

  // Nível 1: propriedades mapeadas da entidade
  const horasEntidade = Number(obj.horasForaUnidade) || Number(obj.tempoForaUnidade) || 0;
  if (horasEntidade > 0 && horasEntidade <= 24) {
    return Math.round(horasEntidade * 100) / 100;
  } else if (horasEntidade > 24 && horasEntidade < 1000) {
    return Math.round((horasEntidade / 60) * 100) / 100; // minutos → horas
  }

  // Nível 2: coluna genérica "HORAS" nos dados brutos
  const colHoras = ['HORAS FORA UNIDADE', 'HORAS_FORA_UNIDADE', 'horasForaUnidade',
    'TEMPO FORA', 'HORAS', 'HORAS PRODUTIVAS', 'tempoForaUnidade'];
  for (const col of colHoras) {
    const chaves = Object.keys(obj);
    const norm = col.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
    for (const chave of chaves) {
      const chaveNorm = chave.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
      if (chaveNorm.includes(norm) || norm.includes(chaveNorm)) {
        const valor = Number(obj[chave]) || 0;
        if (valor > 0 && valor <= 24) {
          return Math.round(valor * 100) / 100;
        }
      }
    }
  }

  // Nível 3: colunas de hora específicas dos dados brutos
  // Ex: "HORA SÁIDA BASE", "HORA CHEGADA BASE", "HORA SAÍDA ROTA 01" etc.
  const colHoraSaidaCands = ['HORA SÁIDA BASE', 'HORA SAIDA BASE', 'HORA SÁIDA', 'HORA SAIDA',
    'HORA SÁIDA ROTA', 'HORA SAIDA ROTA'];
  const colHoraChegadaCands = ['HORA CHEGADA BASE', 'HORA DE CHEGADA', 'HORA CHEGADA',
    'HORA CHEGADA ROTA', 'HORA DE CHEGADA ROTA'];

  let horaSaidaValor = 0;
  let horaChegadaValor = 0;

  // Tentar encontrar hora de saída nos dados brutos
  for (const cand of colHoraSaidaCands) {
    const normCand = cand.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
    for (const chave of Object.keys(obj)) {
      const chaveNorm = chave.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
      if (chaveNorm.includes(normCand) || normCand.includes(chaveNorm)) {
        const v = Number(obj[chave]) || 0;
        if (v > 0) {
          horaSaidaValor = v;
          break;
        }
      }
    }
    if (horaSaidaValor > 0) break;
  }

  // Tentar encontrar hora de chegada nos dados brutos
  for (const cand of colHoraChegadaCands) {
    const normCand = cand.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
    for (const chave of Object.keys(obj)) {
      const chaveNorm = chave.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
      if (chaveNorm.includes(normCand) || normCand.includes(chaveNorm)) {
        const v = Number(obj[chave]) || 0;
        if (v > 0) {
          horaChegadaValor = v;
          break;
        }
      }
    }
    if (horaChegadaValor > 0) break;
  }

  // Se encontrou ambas, calcular diferença
  if (horaSaidaValor > 0 && horaChegadaValor > 0) {
    let diff = Math.abs(horaChegadaValor - horaSaidaValor);
    // Se ambos são seriais Excel (< 1)
    if (horaSaidaValor < 1 && horaChegadaValor < 1) {
      diff = diff * 24; // converter para horas
    }
    if (diff > 100) {
      diff = diff / 60; // pode estar em minutos
    }
    if (diff > 0 && diff <= 24) {
      return Math.round(diff * 100) / 100;
    }
  }

  // Nível 4: propriedade horaSaida/horaChegada da entidade
  const horaSaidaEnt = Number(obj.horaSaida) || 0;
  const horaChegadaEnt = Number(obj.horaChegada) || 0;
  if (horaSaidaEnt > 0 && horaChegadaEnt > 0) {
    let diff = Math.abs(horaChegadaEnt - horaSaidaEnt);
    if (horaSaidaEnt < 1 && horaChegadaEnt < 1) diff = diff * 24;
    if (diff > 100) diff = diff / 60;
    if (diff > 0 && diff <= 24) {
      return Math.round(diff * 100) / 100;
    }
  }

  return 0;
}

function formatarValor(valor: number, formato: string): string {
  if (formato === 'moeda') {
    return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
  if (formato === 'porcentagem') {
    return valor.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + '%';
  }
  return valor.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

type TipoVariacaoExecutivo = 'aumento' | 'reducao' | 'estavel' | 'sem_base';

function calcVariacao(
  atual: number,
  anterior: number,
  opts?: { temBase?: boolean },
): { valor: number; tipo: TipoVariacaoExecutivo } {
  if (opts?.temBase === false) {
    return { valor: 0, tipo: 'sem_base' };
  }
  if (anterior === 0) {
    if (Math.abs(atual) < 1e-9) return { valor: 0, tipo: 'estavel' };
    return { valor: 0, tipo: 'sem_base' };
  }
  const pct = ((atual - anterior) / Math.abs(anterior)) * 100;
  if (Math.abs(pct) < 0.5) return { valor: 0, tipo: 'estavel' };
  return { valor: Math.round(pct * 100) / 100, tipo: pct > 0 ? 'aumento' : 'reducao' };
}

function formatarIntervaloCiclo(inicio: Date, fim: Date): string {
  const fmt = (d: Date) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
  return `${fmt(inicio)} – ${fmt(fim)}`;
}

function gerarMiniTendenciaHtml(valores: number[]): string {
  if (!valores || valores.length === 0) return '';
  const max = Math.max(...valores, 1);
  const min = Math.min(...valores, 0);
  const range = max - min || 1;
  const dots = valores.map((v, i) => {
    const x = (i / Math.max(valores.length - 1, 1)) * 100;
    const y = 100 - ((v - min) / range) * 70 - 15;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const color = valores[valores.length - 1] >= valores[0] ? '#22c55e' : '#ef4444';
  return `<svg width="100%" height="36" viewBox="0 0 100 36" preserveAspectRatio="none">
    <polyline fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" points="${dots}" opacity="0.7"/>
    <polyline fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="${dots}" opacity="0.3"/>
  </svg>`;
}

/* ─── Helpers de Data Segura ─── */
function parseDateSafe(valor: any): Date | null {
  if (!valor && valor !== 0) return null;
  if (valor instanceof Date && !isNaN(valor.getTime())) return valor;

  // ═══ SERIAL EXCEL: números entre 40000 e 60000 são datas seriais ═══
  // Excel armazena datas como dias desde 30/12/1899 (Windows)
  // Fórmula: new Date((serial - 25569) * 86400000)
  if (typeof valor === 'number' && valor > 40000 && valor < 60000) {
    const utcDays = Math.floor(valor - 25569);
    const utcValue = utcDays * 86400;
    const d = new Date(utcValue * 1000);
    if (!isNaN(d.getTime())) return d;
  }

  // ═══ HORAS DECIMAIS EXCEL: números entre 0 e 1 são horas, NÃO datas ═══
  if (typeof valor === 'number' && valor > 0 && valor < 1) {
    return null; // não é data, é hora decimal
  }

  // ═══ STRINGS: tentar múltiplos formatos ═══
  if (typeof valor === 'string') {
    // Formato ISO (aaaa-mm-dd) — suportado nativamente
    const iso = new Date(valor);
    if (!isNaN(iso.getTime())) return iso;

    // Formato brasileiro dd/mm/aaaa ou dd/mm/aa
    const brRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/;
    const brMatch = valor.trim().match(brRegex);
    if (brMatch) {
      let [_, dia, mes, ano] = brMatch.map(Number);
      if (ano < 100) ano += 2000;
      if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12) {
        const d = new Date(ano, mes - 1, dia);
        if (!isNaN(d.getTime())) return d;
      }
    }

    // Formato dd/mm/yyyy HH:MM
    const brDateTimeRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})/;
    const dtMatch = valor.trim().match(brDateTimeRegex);
    if (dtMatch) {
      let [_, dia, mes, ano, hora, min] = dtMatch.map(Number);
      if (ano < 100) ano += 2000;
      if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12) {
        const d = new Date(ano, mes - 1, dia, hora, min);
        if (!isNaN(d.getTime())) return d;
      }
    }
  }

  // ═══ NÚMERO (outros casos): interpretar como timestamp JS ═══
  if (typeof valor === 'number') {
    const d = new Date(valor);
    if (!isNaN(d.getTime()) && d.getTime() > 946684800000) return d; // > ano 2000
  }

  return null;
}

function formatDateSafe(valor: any, formato: string, fallback: string = ''): string {
  const d = parseDateSafe(valor);
  if (!d) return fallback;
  try {
    return format(d, formato);
  } catch {
    return fallback;
  }
}

/* ─── Interface do período calculado ─── */
interface PeriodoCalculado {
  inicio: Date;
  fim: Date;
  inicioAnterior: Date;
  fimAnterior: Date;
  label: string;
}

function parseIsoDate(iso: string): Date {
  return new Date(`${iso}T12:00:00`);
}

function calcularPeriodoCiclo(
  diaInicioCiclo: number,
  mesReferencia?: number,
  anoReferencia?: number,
): PeriodoCalculado {
  const dia = normalizarDiaInicioCiclo(diaInicioCiclo);
  let mes: number;
  let ano: number;
  if (
    mesReferencia != null &&
    anoReferencia != null &&
    mesReferencia >= 1 &&
    mesReferencia <= 12 &&
    anoReferencia >= 2000
  ) {
    mes = mesReferencia;
    ano = anoReferencia;
  } else {
    ({ mes, ano } = inferirMesReferenciaAtual(dia));
  }

  const cicloAtual = calcularCicloMensalContrato(ano, mes, dia);
  const { mes: mesAnt, ano: anoAnt } = deslocarMesReferencia(mes, ano, -1);
  const cicloAnterior = calcularCicloMensalContrato(anoAnt, mesAnt, dia);
  const recorte = recortarPeriodoAteReferencia(cicloAtual.dataInicio, cicloAtual.dataFim);
  const janelaAnt = primeirosNDiasPeriodo(
    cicloAnterior.dataInicio,
    cicloAnterior.dataFim,
    recorte.diasDecorridos,
  );

  return {
    inicio: startOfDay(parseIsoDate(recorte.dataInicio)),
    fim: endOfDay(parseIsoDate(recorte.dataFim)),
    inicioAnterior: startOfDay(parseIsoDate(janelaAnt.dataInicio)),
    fimAnterior: endOfDay(parseIsoDate(janelaAnt.dataFim)),
    label: recorte.emAndamento
      ? `Ciclo: ${cicloAtual.label} (${recorte.diasDecorridos} dias decorridos)`
      : `Ciclo: ${cicloAtual.label}`,
  };
}

async function calcularPeriodoExecutivo(
  contractRepo: Repository<Contract>,
  periodo: string,
  dataInicio?: string,
  dataFim?: string,
  contractId?: string,
  mesReferencia?: number,
  anoReferencia?: number,
): Promise<PeriodoCalculado> {
  if (periodo === 'ciclo') {
    let diaInicio = 1;
    if (contractId) {
      const contract = await contractRepo.findOne({ where: { id: contractId } });
      diaInicio = contract?.diaInicioCiclo ?? 1;
    }
    return calcularPeriodoCiclo(diaInicio, mesReferencia, anoReferencia);
  }
  return calcularPeriodo(periodo, dataInicio, dataFim);
}

function calcularPeriodo(
  periodo: string,
  dataInicio?: string,
  dataFim?: string
): PeriodoCalculado {
  const hoje = new Date();

  switch (periodo) {
    case 'hoje': {
      const inicio = startOfDay(hoje);
      const fim = endOfDay(hoje);
      const ontem = subDays(hoje, 1);
      return {
        inicio, fim,
        inicioAnterior: startOfDay(ontem),
        fimAnterior: endOfDay(ontem),
        label: 'Hoje',
      };
    }
    case 'semana': {
      const inicio = startOfWeek(hoje, { weekStartsOn: 0 });
      const fim = endOfWeek(hoje, { weekStartsOn: 0 });
      const semanaPassada = subDays(inicio, 7);
      return {
        inicio, fim,
        inicioAnterior: semanaPassada,
        fimAnterior: subDays(semanaPassada, differenceInDays(fim, inicio)),
        label: 'Esta Semana',
      };
    }
    case 'mes': {
      const inicio = startOfMonth(hoje);
      const fim = endOfMonth(hoje);
      const mesPassado = subMonths(hoje, 1);
      return {
        inicio, fim,
        inicioAnterior: startOfMonth(mesPassado),
        fimAnterior: endOfMonth(mesPassado),
        label: 'Este Mês',
      };
    }
    case '30d': {
      const inicio = subDays(hoje, 29);
      const fim = endOfDay(hoje);
      const anteriorFim = subDays(inicio, 1);
      return {
        inicio, fim,
        inicioAnterior: subDays(anteriorFim, 29),
        fimAnterior: endOfDay(anteriorFim),
        label: 'Últimos 30 Dias',
      };
    }
    case '90d': {
      const inicio = subDays(hoje, 89);
      const fim = endOfDay(hoje);
      const anteriorFim = subDays(inicio, 1);
      return {
        inicio, fim,
        inicioAnterior: subDays(anteriorFim, 89),
        fimAnterior: endOfDay(anteriorFim),
        label: 'Últimos 90 Dias',
      };
    }
    case 'personalizado':
    default: {
      const inicio = dataInicio ? startOfDay(new Date(dataInicio)) : subDays(hoje, 29);
      const fim = dataFim ? endOfDay(new Date(dataFim)) : endOfDay(hoje);

      const dias = differenceInDays(fim, inicio) + 1;
      const anteriorFim = subDays(inicio, 1);
      const inicioAnterior = subDays(anteriorFim, dias - 1);

      return {
        inicio, fim,
        inicioAnterior,
        fimAnterior: endOfDay(anteriorFim),
        label: 'Personalizado',
      };
    }
  }
}

/* ─── Função Helper: Obtém o valor unitário (R$/ton) com fallback para R$ 80/ton ─── */
const VALOR_ESTIMADO_TON = 80; // R$ 80/ton — fallback quando não há valores configurados

function obterValorUnitario(
  tipoRaw: string,
  valoresFixos: Record<string, number>,
  temValorFaturamento: boolean
): number {
  if (!temValorFaturamento) return VALOR_ESTIMADO_TON;

  const valor = resolverValorUnitarioPorTipo(tipoRaw, valoresFixos, 0);
  if (valor > 0) return valor;

  return VALOR_ESTIMADO_TON;
}

/* ═══════════════════════════════════════════
   Controller
   ═══════════════════════════════════════════ */
export class DashboardExecutivoController {
  private get coletaRepo(): Repository<ColetaData> {
    return AppDataSource.getRepository(ColetaData);
  }

  private get abastecimentoRepo(): Repository<Abastecimento> {
    return AppDataSource.getRepository(Abastecimento);
  }

  private get servicoRepo(): Repository<Servico> {
    return AppDataSource.getRepository(Servico);
  }

  private get contractRepo(): Repository<Contract> {
    return AppDataSource.getRepository(Contract);
  }

  private get caminhaoRepo(): Repository<Caminhao> {
    return AppDataSource.getRepository(Caminhao);
  }

  /**
   * GET /api/dashboard/executivo
   * Endpoint único: calcula todos os indicadores de uma só vez.
   */
  async executivo(req: Request, res: Response): Promise<void> {
    try {
      const {
        periodo = 'ciclo',
        dataInicio,
        dataFim,
        contractId,
        servicoId,
        mesReferencia: mesReferenciaRaw,
        anoReferencia: anoReferenciaRaw,
      } = req.query as Record<string, string | undefined>;

      const mesReferencia = mesReferenciaRaw != null ? parseInt(String(mesReferenciaRaw), 10) : undefined;
      const anoReferencia = anoReferenciaRaw != null ? parseInt(String(anoReferenciaRaw), 10) : undefined;
      const modoCiclo = periodo === 'ciclo';

      // ═══ VERIFICAR CACHE ═══
      if (ehHubDeContratos(req.usuario) && !contractId) {
        res.status(409).json({
          error: 'Cada contrato está no seu próprio banco: escolha um contrato para abrir o executivo.',
          precisaEscolherContrato: true,
        });
        return;
      }

      const paramsCache = {
        periodo: periodo!,
        dataInicio,
        dataFim,
        contractId,
        servicoId,
        mesReferencia,
        anoReferencia,
        escopo: escopoCacheTenant(),
      };
      const ignorarCache = req.query.refresh === '1' || req.query.nocache === '1';
      const cacheHit = ignorarCache ? null : dashboardCache.obter(paramsCache);
      if (cacheHit) {
        const cacheInfo = dashboardCache.info(paramsCache);
        const payload = cacheHit as Record<string, unknown>;
        const meta = (payload.metadados || {}) as Record<string, unknown>;
        res.json({
          ...payload,
          metadados: {
            ...meta,
            cacheHit: true,
            cacheIdadeSegundos: cacheInfo.idadeSegundos,
            cacheValidoAte: cacheInfo.validoAte,
          },
        });
        return;
      }

      // 1. Calcular períodos
      const periodoAtual = await calcularPeriodoExecutivo(
        this.contractRepo,
        periodo!,
        dataInicio,
        dataFim,
        contractId,
        mesReferencia,
        anoReferencia,
      );

      // 2. Indicadores unificados — mesma fonte do dashboard operacional (planilhas + KPIs universais)
      const indicadores = await calcularIndicadoresExecutivoUnificado({
        contractId,
        servicoId,
        inicio: periodoAtual.inicio,
        fim: periodoAtual.fim,
        inicioAnterior: periodoAtual.inicioAnterior,
        fimAnterior: periodoAtual.fimAnterior,
        modoCiclo,
        mesReferenciaCiclo: mesReferencia,
        anoReferenciaCiclo: anoReferencia,
      });

      const dadosAtuais = indicadores.dadosAtuais;
      const dadosAnteriores = indicadores.dadosAnteriores;
      const valoresFixos = indicadores.valoresFixos;
      const temValorFaturamento = indicadores.temValor;
      const temValor = temValorFaturamento;
      const kpisCalculados = indicadores.kpisCalculados;

      // 3. Carregar contratos para listagens
      const contracts = contractId
        ? [await this.contractRepo.findOne({ where: { id: contractId } })]
        : await this.contractRepo.find();
      const contractsValidos = contracts.filter(Boolean) as Contract[];

      // 4. Abastecimentos do período (filtrados por contrato quando aplicável)
      const qbAbastAtual = this.abastecimentoRepo.createQueryBuilder('a')
        .select(['a.id', 'a.placa', 'a.litragem', 'a.valor', 'a.dataAbastecimento'])
        .where('a.dataAbastecimento BETWEEN :inicio AND :fim', {
          inicio: periodoAtual.inicio,
          fim: periodoAtual.fim,
        });
      if (contractId) qbAbastAtual.andWhere('a.contract_id = :contractId', { contractId });
      const abastecimentosAtuais = await qbAbastAtual.getMany();

      const qbAbastAnterior = this.abastecimentoRepo.createQueryBuilder('a')
        .select(['a.id', 'a.placa', 'a.litragem', 'a.valor', 'a.dataAbastecimento'])
        .where('a.dataAbastecimento BETWEEN :inicio AND :fim', {
          inicio: periodoAtual.inicioAnterior,
          fim: periodoAtual.fimAnterior,
        });
      if (contractId) qbAbastAnterior.andWhere('a.contract_id = :contractId', { contractId });
      const abastecimentosAnteriores = await qbAbastAnterior.getMany();

      // 5. Caminhões cadastrados
      const todosCaminhoes = await this.caminhaoRepo.find();
      const totalCaminhoesCadastrados = todosCaminhoes.length;

      // 6. Painéis financeiro/operacional a partir das métricas unificadas
      const custoAtual = abastecimentosAtuais.reduce((s, a) => s + Number(a.valor), 0);
      const custoAnterior = abastecimentosAnteriores.reduce((s, a) => s + Number(a.valor), 0);
      const mAtual = indicadores.metricasAtual;
      const mAnterior = indicadores.metricasAnterior;

      const finAtual = {
        faturamento: mAtual.faturamento,
        custo: Math.round(custoAtual * 100) / 100,
        margem: mAtual.faturamento > 0
          ? Math.round(((mAtual.faturamento - custoAtual) / mAtual.faturamento) * 10000) / 100
          : 0,
        ticketMedio: mAtual.viagens > 0
          ? Math.round((mAtual.faturamento / mAtual.viagens) * 100) / 100
          : 0,
      };
      const finAnterior = {
        faturamento: mAnterior.faturamento,
        custo: Math.round(custoAnterior * 100) / 100,
        margem: mAnterior.faturamento > 0
          ? Math.round(((mAnterior.faturamento - custoAnterior) / mAnterior.faturamento) * 10000) / 100
          : 0,
        ticketMedio: mAnterior.viagens > 0
          ? Math.round((mAnterior.faturamento / mAnterior.viagens) * 100) / 100
          : 0,
      };

      const opAtual = {
        viagens: mAtual.viagens,
        tonelagem: mAtual.pesoTotalTon,
        kmTotal: mAtual.kmTotal,
        coletoresAtivos: mAtual.qtdColetores,
        horasProdutivas: mAtual.horasProdutivas,
        eficiencia: mAtual.tonKm,
      };
      const opAnterior = {
        viagens: mAnterior.viagens,
        tonelagem: mAnterior.pesoTotalTon,
        kmTotal: mAnterior.kmTotal,
        coletoresAtivos: mAnterior.qtdColetores,
        horasProdutivas: mAnterior.horasProdutivas,
        eficiencia: mAnterior.tonKm,
      };

      // ─── KPI: Receita por Hora Produtiva (Faturamento ÷ Horas Produtivas) ───
      const receitaHoraAtual = opAtual.horasProdutivas > 0
        ? Math.round((finAtual.faturamento / opAtual.horasProdutivas) * 100) / 100
        : 0;
      const receitaHoraAnterior = opAnterior.horasProdutivas > 0
        ? Math.round((finAnterior.faturamento / opAnterior.horasProdutivas) * 100) / 100
        : 0;

      const temBasePlanilha = indicadores.totalRegistrosAnterior > 0;
      const temBaseAbastecimento = abastecimentosAnteriores.length > 0;
      const basePlanilha = { temBase: temBasePlanilha };
      const baseAbastecimento = { temBase: temBaseAbastecimento };

      // ─── Tendências Financeiras (últimos 7 dias) a partir dos dados carregados ───
      const tendenciaFinanceira = this.calcularTendenciaFinanceira(dadosAtuais, valoresFixos, temValor, abastecimentosAtuais);

      // ─── Tendência de Faturamento (até 30 dias do período selecionado) ───
      const inicioTendencia = subDays(periodoAtual.fim, Math.min(differenceInDays(periodoAtual.fim, periodoAtual.inicio) + 1, 30) - 1);
      const dadosTendenciaPeriodo = dadosAtuais.filter(d => {
        if (!d.dataSaida) return false;
        const data = d.dataSaida instanceof Date ? d.dataSaida : new Date(d.dataSaida);
        return !isNaN(data.getTime()) && data >= inicioTendencia && data <= periodoAtual.fim;
      });
      
      const tendenciaFaturamento30d = this.calcularTendencia30d(dadosTendenciaPeriodo, valoresFixos, temValor);

      // ─── Faturamento por Tipo de Caminhão ───
      const fatPorTipo = this.calcularFaturamentoPorTipo(dadosAtuais, valoresFixos, temValor);

      // ─── Produtividade por Coletor ───
      const prodPorColetor = this.calcularProdutividadePorColetor(dadosAtuais);

      // ─── Produtividade por Motorista ───
      const prodPorMotorista = this.calcularProdutividadePorMotorista(dadosAtuais);
      const totalMotoristas = new Set(prodPorMotorista.map(m => m.motorista)).size;

      // ─── KM Médio por Viagem ───
      const kmMedioViagem = this.calcularKmMedioViagem(dadosAtuais, dadosAnteriores, temBasePlanilha);

      // ─── Horas Produtivas Médias ───
      const horasMedias = this.calcularHorasMedias(dadosAtuais, dadosAnteriores, temBasePlanilha);

      // ─── Utilização da Frota ───
      const utilizacaoFrota = this.calcularUtilizacaoFrota(dadosAtuais, totalCaminhoesCadastrados);

      // ─── Margem por Tipo de Caminhão ───
      const margemPorTipo = this.calcularMargemPorTipo(dadosAtuais, abastecimentosAtuais, valoresFixos, temValor);

      // ─── Faturamento por Coletor (ordenado) ───
      const fatPorColetor = this.calcularFaturamentoPorColetor(dadosAtuais, valoresFixos, temValor);

      // ─── Projeção Mensal ───
      const projecaoMensal = this.calcularProjecaoMensal(dadosAtuais, finAtual.faturamento, periodoAtual);

      // ─── Lista de contratos disponíveis ───
      const contratosDisponiveis = contractsValidos.map(c => ({
        id: c.id,
        nome: c.numeroContrato,
      }));

      // ─── Lista de serviços disponíveis ───
      let servicosDisponiveis: { id: string; nome: string; contractId: string }[] = [];
      if (contractId) {
        const servicos = await this.servicoRepo.find({
          where: { contract_id: contractId },
          order: { nome: 'ASC' },
        });
        servicosDisponiveis = servicos.map(s => ({ id: s.id, nome: s.nome, contractId: s.contract_id }));
      }

      // 7. Montar resposta final e armazenar em cache
      const custoTotalPeriodo = tendenciaFinanceira.custoDiario.reduce((s, v) => s + v, 0);
      const rotasAtual = contarRotasValidadas(dadosAtuais);
      const rotasAnterior = contarRotasValidadas(dadosAnteriores);
      const resumoCiclo = {
        rotas: rotasAtual,
        viagens: opAtual.viagens,
        toneladas: opAtual.tonelagem,
        km: opAtual.kmTotal,
        horasProdutivas: opAtual.horasProdutivas,
        coletoresAtivos: opAtual.coletoresAtivos,
        faturamento: finAtual.faturamento,
        receitaTon: opAtual.tonelagem > 0
          ? Math.round((finAtual.faturamento / opAtual.tonelagem) * 100) / 100
          : 0,
        receitaKm: opAtual.kmTotal > 0
          ? Math.round((finAtual.faturamento / opAtual.kmTotal) * 100) / 100
          : 0,
        ticketMedio: finAtual.ticketMedio,
        tonPorViagem: opAtual.viagens > 0
          ? Math.round((opAtual.tonelagem / opAtual.viagens) * 1000) / 1000
          : 0,
      };
      const resposta = {
        periodo: {
          label: periodoAtual.label,
          inicio: periodoAtual.inicio.toISOString(),
          fim: periodoAtual.fim.toISOString(),
          inicioAnterior: periodoAtual.inicioAnterior.toISOString(),
          fimAnterior: periodoAtual.fimAnterior.toISOString(),
          comparacaoAnterior: {
            label: formatarIntervaloCiclo(periodoAtual.inicioAnterior, periodoAtual.fimAnterior),
            registrosPlanilha: indicadores.totalRegistrosAnterior,
            abastecimentos: abastecimentosAnteriores.length,
            temBasePlanilha,
            temBaseAbastecimento,
          },
        },
        filtros: {
          periodo,
          contractId: contractId || null,
          servicoId: servicoId || null,
          mesReferencia: mesReferencia ?? null,
          anoReferencia: anoReferencia ?? null,
          contratosDisponiveis,
          servicosDisponiveis,
        },

        // ─── Painel Financeiro ───
        financeiro: {
          faturamento: {
            valor: finAtual.faturamento,
            formatado: formatarValor(finAtual.faturamento, 'moeda'),
            variacao: calcVariacao(finAtual.faturamento, finAnterior.faturamento, basePlanilha),
            minitendenciaSvg: gerarMiniTendenciaHtml(tendenciaFinanceira.faturamentoDiario),
          },
          custoOperacional: {
            valor: finAtual.custo,
            formatado: formatarValor(finAtual.custo, 'moeda'),
            variacao: calcVariacao(finAtual.custo, finAnterior.custo, baseAbastecimento),
            minitendenciaSvg: gerarMiniTendenciaHtml(tendenciaFinanceira.custoDiario),
          },
          margemBruta: {
            valor: finAtual.margem,
            formatado: formatarValor(finAtual.margem, 'porcentagem'),
            variacao: calcVariacao(finAtual.margem, finAnterior.margem, basePlanilha),
            minitendenciaSvg: '',
          },
          ticketMedio: {
            valor: finAtual.ticketMedio,
            formatado: formatarValor(finAtual.ticketMedio, 'moeda'),
            variacao: calcVariacao(finAtual.ticketMedio, finAnterior.ticketMedio, basePlanilha),
            minitendenciaSvg: '',
          },
          // ═══ KPI: Receita por Hora Produtiva (Faturamento ÷ Horas Produtivas) ═══
          receitaHora: {
            valor: receitaHoraAtual,
            formatado: receitaHoraAtual > 0
              ? 'R$ ' + receitaHoraAtual.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '/h'
              : 'R$ 0,00/h',
            variacao: calcVariacao(receitaHoraAtual, receitaHoraAnterior, basePlanilha),
            minitendenciaSvg: (() => {
              const vals = tendenciaFinanceira.horasDiario.map((h, i) => {
                const fat = tendenciaFinanceira.faturamentoDiario[i] || 0;
                return h > 0 ? Math.round((fat / h) * 100) / 100 : 0;
              });
              return gerarMiniTendenciaHtml(vals);
            })(),
          },
          temValor: temValorFaturamento,
          usandoEstimativa: !temValorFaturamento,
        },

        // ─── Painel Operacional ───
        operacional: {
          tonelagem: {
            valor: opAtual.tonelagem,
            formatado: opAtual.tonelagem.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' t',
            variacao: calcVariacao(opAtual.tonelagem, opAnterior.tonelagem, basePlanilha),
          },
          kmRodados: {
            valor: opAtual.kmTotal,
            formatado: opAtual.kmTotal.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + ' km',
            variacao: calcVariacao(opAtual.kmTotal, opAnterior.kmTotal, basePlanilha),
          },
          viagens: {
            valor: opAtual.viagens,
            formatado: opAtual.viagens.toLocaleString('pt-BR'),
            variacao: calcVariacao(opAtual.viagens, opAnterior.viagens, basePlanilha),
          },
          coletoresAtivos: {
            valor: opAtual.coletoresAtivos,
            formatado: String(opAtual.coletoresAtivos),
            variacao: calcVariacao(opAtual.coletoresAtivos, opAnterior.coletoresAtivos, basePlanilha),
          },
          horasProdutivas: {
            valor: opAtual.horasProdutivas,
            formatado: opAtual.horasProdutivas.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'h',
            variacao: calcVariacao(opAtual.horasProdutivas, opAnterior.horasProdutivas, basePlanilha),
          },
          eficiencia: {
            valor: opAtual.eficiencia,
            formatado: opAtual.eficiencia.toLocaleString('pt-BR', { maximumFractionDigits: 3 }),
            variacao: calcVariacao(opAtual.eficiencia, opAnterior.eficiencia, basePlanilha),
          },
        },

        // ─── Gráficos de Receita (financeiros + novos) ───
        graficos: {
          usandoEstimativa: !temValorFaturamento,

          // 📊 Gráfico 1: Receita por KM diário (existente)
          receitaKmDiario: tendenciaFinanceira.faturamentoDiario.map((v, i) => {
            const dataStr = tendenciaFinanceira.dias[i] || '';
            const km = tendenciaFinanceira.kmDiario[i] || 0;
            return {
              label: dataStr ? formatDateSafe(dataStr, 'dd/MM') : '',
              valor: km > 0 ? Math.round((v / km) * 100) / 100 : 0,
              km,
              faturamento: v,
            };
          }),

          // 📊 Gráfico 2: Receita por Hora diário (existente)
          receitaHoraDiario: tendenciaFinanceira.faturamentoDiario.map((v, i) => {
            const dataStr = tendenciaFinanceira.dias[i] || '';
            const horas = tendenciaFinanceira.horasDiario[i] || 0;
            return {
              label: dataStr ? formatDateSafe(dataStr, 'dd/MM') : '',
              valor: horas > 0 ? Math.round((v / horas) * 100) / 100 : 0,
              horas,
              faturamento: v,
            };
          }),

          // 📊 Gráfico 3: Média receita/km e receita/hora (existentes)
          receitaKmMedio: (() => {
            const totalKm = tendenciaFinanceira.kmDiario.reduce((s, v) => s + v, 0);
            const totalFat = tendenciaFinanceira.faturamentoDiario.reduce((s, v) => s + v, 0);
            return totalKm > 0 ? Math.round((totalFat / totalKm) * 100) / 100 : 0;
          })(),
          receitaHoraMedia: (() => {
            const totalHoras = tendenciaFinanceira.horasDiario.reduce((s, v) => s + v, 0);
            const totalFat = tendenciaFinanceira.faturamentoDiario.reduce((s, v) => s + v, 0);
            return totalHoras > 0 ? Math.round((totalFat / totalHoras) * 100) / 100 : 0;
          })(),

          // ═══════════════════════════════════════════
          // 🆕 NOVOS GRÁFICOS DE RECEITA
          // ═══════════════════════════════════════════

          // 📊 Gráfico 4: Evolução Diária de Receita (até 30 dias do período)
          receitaDiaria: (() => {
            const serie = tendenciaFaturamento30d.length > 0
              ? tendenciaFaturamento30d
              : tendenciaFinanceira.faturamentoDiario.map((v, i) => {
                  const dataStr = tendenciaFinanceira.dias[i] || '';
                  return {
                    data: dataStr,
                    label: dataStr ? formatDateSafe(dataStr, 'dd/MM') : '',
                    valor: v,
                  };
                });
            const kmPorData = new Map<string, number>();
            const horasPorData = new Map<string, number>();
            tendenciaFinanceira.dias.forEach((dataStr, i) => {
              if (!dataStr) return;
              kmPorData.set(dataStr, tendenciaFinanceira.kmDiario[i] || 0);
              horasPorData.set(dataStr, tendenciaFinanceira.horasDiario[i] || 0);
            });
            return serie.map(t => ({
              label: t.label,
              valor: t.valor,
              data: t.data || '',
              km: kmPorData.get(t.data || '') ?? 0,
              horas: horasPorData.get(t.data || '') ?? 0,
            }));
          })(),

          // 📊 Gráfico 5: Ranking de Receita por Motorista Top 10
          rankingMotoristas: (() => {
            const fatPorMotorista = this.calcularFaturamentoPorMotorista(dadosAtuais, valoresFixos, temValorFaturamento);
            return fatPorMotorista.slice(0, 10).map(f => ({
              motorista: f.motorista,
              placa: f.placa,
              faturamento: f.faturamento,
              viagens: f.viagens,
            }));
          })(),

          // 📊 Gráfico 6: Receita por Regional (barras)
          receitaPorRegional: (() => {
            const fatRegional = this.calcularFaturamentoPorRegional(dadosAtuais, valoresFixos, temValorFaturamento);
            return fatRegional.map(r => ({
              regional: r.regional,
              faturamento: r.faturamento,
              viagens: r.viagens,
            }));
          })(),

          // 📊 Gráfico 7: Receita por Dia da Semana
          receitaPorDiaSemana: (() => {
            const fatDiaSemana = this.calcularFaturamentoPorDiaSemana(dadosAtuais, valoresFixos, temValorFaturamento);
            return fatDiaSemana.map(d => ({
              diaSemana: d.diaSemana,
              diaNome: d.diaNome,
              faturamento: d.faturamento,
              viagens: d.viagens,
            }));
          })(),

          // 📊 Gráfico 8: Receita por Turno
          receitaPorTurno: (() => {
            const fatTurno = this.calcularFaturamentoPorTurno(dadosAtuais, valoresFixos, temValorFaturamento);
            return fatTurno.map(t => ({
              turno: t.turno,
              faturamento: t.faturamento,
              viagens: t.viagens,
              mediaPorViagem: t.mediaPorViagem,
            }));
          })(),
        },

        // ─── Análise Financeira Expansível (foco em receita) ───
        analiseFinanceira: {
          margemPorTipo,
          faturamentoPorColetor: fatPorColetor.slice(0, 15),
          faturamentoPorRegional: this.calcularFaturamentoPorRegional(dadosAtuais, valoresFixos, temValorFaturamento),
          faturamentoPorMotorista: this.calcularFaturamentoPorMotorista(dadosAtuais, valoresFixos, temValorFaturamento).slice(0, 15),
          faturamentoPorTurno: this.calcularFaturamentoPorTurno(dadosAtuais, valoresFixos, temValorFaturamento),
          faturamentoPorDiaSemana: this.calcularFaturamentoPorDiaSemana(dadosAtuais, valoresFixos, temValorFaturamento),
          ticketMedioPorMotorista: this.calcularTicketMedioPorMotorista(dadosAtuais, valoresFixos, temValorFaturamento).slice(0, 15),
          projecaoMensal,
          projecaoCenarios: this.calcularProjecaoCenarios(dadosAtuais, valoresFixos, temValorFaturamento, periodoAtual),
        },

        // ─── Análise Operacional Expansível ───
        analiseOperacional: {
          produtividadePorColetor: prodPorColetor.slice(0, 15).map(c => ({
            coletor: c.coletor,
            tonelagem: c.tonelagem,
            viagens: c.viagens,
            km: c.km,
            tonPorDia: c.tonPorDia,
          })),
          kmMedioViagem,
          horasMedias,
          utilizacaoFrota,
          // ═══ NOVO: Análise por Motorista ═══
          motoristas: prodPorMotorista.slice(0, 15),
          totalMotoristas,
        },

        // ─── KPIs universais calculados (mesmo pipeline do dashboard operacional) ───
        kpisCalculados,

        resumoCiclo,

        // ─── Metadados ───
        metadados: {
          totalRegistrosAtual: indicadores.totalRegistrosAtual,
          totalRegistrosAnterior: indicadores.totalRegistrosAnterior,
          totalRotasAtual: rotasAtual,
          totalRotasAnterior: rotasAnterior,
          totalViagensAtual: opAtual.viagens,
          totalViagensAnterior: opAnterior.viagens,
          totalAbastecimentosAtual: abastecimentosAtuais.length,
          totalAbastecimentosAnterior: abastecimentosAnteriores.length,
          dataGeracao: new Date().toISOString(),
          fonteDados: 'planilha',
        },
      };

      // ═══ ARMAZENAR EM CACHE E ENVIAR RESPOSTA ═══
      dashboardCache.armazenar(paramsCache, resposta);
      res.json(resposta);
    } catch (error: any) {
      console.error('[DashboardExecutivo] Erro:', error?.message || error);
      res.status(500).json({
        error: 'Erro ao carregar dashboard executivo',
        detalhe: error?.message || '',
      });
    }
  }

  /**
   * Calcula e grava no cache (warmup / pós-upload) sem passar pelo HTTP.
   */
  async calcularECachear(params: {
    periodo: string;
    dataInicio?: string;
    dataFim?: string;
    contractId?: string;
    servicoId?: string;
    mesReferencia?: number;
    anoReferencia?: number;
  }): Promise<boolean> {
    if (dashboardCache.obter(params)) return true;

    return new Promise((resolve) => {
      let statusCode = 200;
      const fakeRes = {
        status(code: number) {
          statusCode = code;
          return this;
        },
        json(data: unknown) {
          if (statusCode === 200 && data) {
            resolve(true);
          } else {
            resolve(false);
          }
        },
      };

      const fakeReq = {
        query: {
          periodo: params.periodo,
          ...(params.dataInicio ? { dataInicio: params.dataInicio } : {}),
          ...(params.dataFim ? { dataFim: params.dataFim } : {}),
          ...(params.contractId ? { contractId: params.contractId } : {}),
          ...(params.servicoId ? { servicoId: params.servicoId } : {}),
          ...(params.mesReferencia != null ? { mesReferencia: String(params.mesReferencia) } : {}),
          ...(params.anoReferencia != null ? { anoReferencia: String(params.anoReferencia) } : {}),
          refresh: '0',
        },
      };

      void this.executivo(fakeReq as any, fakeRes as any).catch(() => resolve(false));
    });
  }

  /* ═══════════════════════════════════════════
     Métodos Privados de Cálculo
     ═══════════════════════════════════════════ */

  /**
   * ⚡ OTIMIZADO: Carrega métricas AGREGADAS de ColetaData diretamente no banco
   * em vez de carregar todos os registros em memória.
   * 
   * Retorna dados agregados e também os dados por tipo de caminhão (para faturamento)
   * e dados por dia (para tendências).
   */
  private async carregarDadosColeta(
    inicio: Date,
    fim: Date,
    contractId?: string,
    servicoId?: string
  ): Promise<ColetaData[]> {
    // Se tem filtro de serviço, usa subquery com uploads
    // Se tem filtro de contrato mas não de serviço, busca todos serviços do contrato
    const qb = this.coletaRepo.createQueryBuilder('c');

    if (servicoId) {
      qb.where('c.planilhaUploadId IN (SELECT p.id FROM planilha_uploads p WHERE p.servico_id = :servicoId)', { servicoId });
    } else if (contractId) {
      qb.where('c.planilhaUploadId IN (SELECT p.id FROM planilha_uploads p WHERE p.servico_id IN (SELECT s.id FROM servicos s WHERE s.contract_id = :contractId))', { contractId });
    }

    // Filtro de data — sempre aplicado
    qb.andWhere('c.dataSaida BETWEEN :inicio AND :fim', { inicio, fim });
    aplicarFiltroViagensValidasDashboard(qb, 'c');

    // ⚡ SELECT apenas as colunas necessárias (evita carregar dados pesados)
    const dados = await qb
      .select([
        'c.id', 'c.dataSaida', 'c.pesoTotal', 'c.kmTotal', 'c.placa',
        'c.tipoCaminhao', 'c.horasForaUnidade', 'c.horaSaida', 'c.horaChegada',
        'c.tempoForaUnidade', 'c.numeroViagens', 'c.dados',
      ])
      .orderBy('c.dataSaida', 'ASC')
      .getMany();

    return dados;
  }

  /**
   * Calcula indicadores financeiros a partir dos dados de coleta e abastecimentos
   */
  private calcularFinanceiros(
    dados: ColetaData[],
    valoresFixos: Record<string, number>,
    temValorFaturamento: boolean,
    abastecimentos: Abastecimento[]
  ) {
    if (dados.length === 0) {
      return { faturamento: 0, custo: 0, margem: 0, ticketMedio: 0 };
    }

    // Converter para Record para usar encontrarValorColuna
    const dadosNorm = dados.map(d => {
      const obj: Record<string, any> = {};
      for (const [key, value] of Object.entries(d)) {
        obj[key] = value;
      }
      if (d.dados) {
        for (const [key, value] of Object.entries(d.dados)) {
          obj[key] = value;
        }
      }
      return obj;
    });

    const colPeso = detectarColuna(dadosNorm, ['PESO TOTAL', 'PESO', 'PESOTOTAL', 'PESO_TOTAL', 'pesoTotal']);
    const colTipo = detectarColuna(dadosNorm, ['TIPO CAMINHAO', 'TIPO_CAMINHAO', 'tipoCaminhao', 'CAMINHAO', 'CAMINHÃO']);

    // Faturamento — usa valor real ou estimado (R$ 80/ton)
    let faturamento = 0;
    const valorTonUsado = temValorFaturamento ? (valoresFixos['VALOR_TONELADA'] || 0) : VALOR_ESTIMADO_TON;

    for (const d of dadosNorm) {
      const tipoRaw = String(encontrarValorColuna(d, colTipo) || '').toUpperCase().trim();
      if (/^\d+$/.test(tipoRaw)) continue;
      const peso = Number(encontrarValorColuna(d, colPeso)) || 0;
      if (peso <= 0) continue;
      const toneladas = peso / 1000;
      const valorUnitario = obterValorUnitario(tipoRaw, valoresFixos, temValorFaturamento);
      faturamento += toneladas * valorUnitario;
    }
    if (faturamento === 0) {
      const totalKg = dadosNorm.reduce((s, d) => s + (Number(encontrarValorColuna(d, colPeso)) || 0), 0);
      faturamento = totalKg / 1000 * valorTonUsado;
      // Se valorTonUsado for 0 (configurado como 0), usar estimativa
      if (valorTonUsado <= 0) {
        faturamento = totalKg / 1000 * VALOR_ESTIMADO_TON;
      }
    }

    // Custo operacional (baseado nos abastecimentos do período)
    let custo = abastecimentos.reduce((s, a) => s + Number(a.valor), 0);

    // Margem bruta
    const margem = faturamento > 0 ? ((faturamento - custo) / faturamento) * 100 : 0;

    // Ticket médio por viagem
    const totalViagens = sumarizarViagensPorRota(dadosNorm);
    const ticketMedio = totalViagens > 0 ? faturamento / totalViagens : 0;

    return {
      faturamento: Math.round(faturamento * 100) / 100,
      custo: Math.round(custo * 100) / 100,
      margem: Math.round(margem * 100) / 100,
      ticketMedio: Math.round(ticketMedio * 100) / 100,
    };
  }

  /**
   * Calcula indicadores operacionais
   */
  private calcularOperacionais(
    dados: ColetaData[],
    totalCaminhoesCadastrados: number
  ) {
    if (dados.length === 0) {
      return {
        viagens: 0,
        tonelagem: 0,
        kmTotal: 0,
        coletoresAtivos: 0,
        horasProdutivas: 0,
        eficiencia: 0,
      };
    }

    const viagens = sumarizarViagensPorRota(dados);

    // Tonelagem total
    let pesoTotalKg = 0;
    let kmTotal = 0;
    let horasProdutivas = 0;
    const coletoresSet = new Set<string>();

    for (const d of dados) {
      // Peso
      if (d.pesoTotal) pesoTotalKg += Number(d.pesoTotal);
      if (!d.pesoTotal) {
        for (const p of [d.peso1, d.peso2, d.peso3, d.peso4, d.peso5]) {
          if (p) pesoTotalKg += Number(p);
        }
      }

      // KM
      if (d.kmTotal) kmTotal += Number(d.kmTotal);

      // Coletores (placa)
      if (d.placa) {
        coletoresSet.add(d.placa);
      }

      // ═══ HORAS PRODUTIVAS — usando helper centralizado extrairHorasProdutivas ═══
      // Construir objeto combinado (entidade + dados brutos)
      const objCombinado: Record<string, any> = {};
      for (const [key, value] of Object.entries(d)) {
        objCombinado[key] = value;
      }
      if (d.dados) {
        for (const [key, value] of Object.entries(d.dados)) {
          objCombinado[key] = value;
        }
      }
      const horaValida = extrairHorasProdutivas(objCombinado);
      if (horaValida > 0 && horaValida <= 24) {
        horasProdutivas += horaValida;
      }
    }

    const tonelagem = Math.round((pesoTotalKg / 1000) * 100) / 100;
    const eficiencia = kmTotal > 0 ? Math.round((tonelagem / kmTotal) * 10000) / 10000 : 0;

    return {
      viagens,
      tonelagem,
      kmTotal: Math.round(kmTotal * 100) / 100,
      coletoresAtivos: coletoresSet.size,
      horasProdutivas: Math.round(horasProdutivas * 100) / 100,
      eficiencia,
    };
  }

  /**
   * Calcula tendência financeira dos últimos 7 DIAS COM DADOS do período selecionado.
   * ⭐ CORRIGIDO: agora extrai as datas reais dos registros carregados em vez de usar
   *   os últimos 7 dias corridos (que podem estar vazios se os dados são de períodos anteriores).
   *   Retorna também o array de datas para os labels dos gráficos.
   */
  private calcularTendenciaFinanceira(
    dados: ColetaData[],
    valoresFixos: Record<string, number>,
    temValorFaturamento: boolean,
    abastecimentos: Abastecimento[]
  ): { dias: string[]; faturamentoDiario: number[]; custoDiario: number[]; kmDiario: number[]; horasDiario: number[] } {
    // Normalizar dados para detectar colunas
    const dadosNorm = dados.map(d => {
      const obj: Record<string, any> = {};
      for (const [key, value] of Object.entries(d)) {
        obj[key] = value;
      }
      if (d.dados) {
        for (const [key, value] of Object.entries(d.dados)) {
          obj[key] = value;
        }
      }
      return obj;
    });

    // ═══ EXTRAIR AS ÚLTIMAS 7 DATAS COM DADOS ═══
    const datasComDados = new Set<string>();
    for (const obj of dadosNorm) {
      const dataValida = parseDateSafe(obj.dataSaida);
      if (dataValida) {
        datasComDados.add(format(dataValida, 'yyyy-MM-dd'));
      }
    }

    // Se não há datas com dados, retorna 7 zeros
    if (datasComDados.size === 0) {
      return {
        dias: [],
        faturamentoDiario: [0, 0, 0, 0, 0, 0, 0],
        custoDiario: [0, 0, 0, 0, 0, 0, 0],
        kmDiario: [0, 0, 0, 0, 0, 0, 0],
        horasDiario: [0, 0, 0, 0, 0, 0, 0],
      };
    }

    // Ordenar ASC e pegar as últimas 7
    const diasOrdenados = Array.from(datasComDados).sort();
    const dias7 = diasOrdenados.slice(-7);

    const colPeso = detectarColuna(dadosNorm, ['PESO TOTAL', 'PESO', 'PESOTOTAL', 'PESO_TOTAL', 'pesoTotal']);
    const colTipo = detectarColuna(dadosNorm, ['TIPO CAMINHAO', 'TIPO_CAMINHAO', 'tipoCaminhao', 'CAMINHAO', 'CAMINHÃO']);
    const colKm = detectarColuna(dadosNorm, ['KM TOTAL', 'KM', 'KMTOTAL', 'KM_TOTAL', 'kmTotal', 'QUILOMETRO', 'DISTANCIA']);
    const colHoras = detectarColuna(dadosNorm, ['HORAS FORA UNIDADE', 'HORAS_FORA_UNIDADE', 'horasForaUnidade', 'TEMPO FORA', 'HORAS', 'HORAS PRODUTIVAS', 'tempoForaUnidade']);

    // Agrupar dadosNorm por dia
    const dadosPorDiaNorm: Record<string, Record<string, any>[]> = {};
    for (const chave of dias7) {
      dadosPorDiaNorm[chave] = [];
    }
    for (const obj of dadosNorm) {
      const dataValida = parseDateSafe(obj.dataSaida);
      if (dataValida) {
        const chave = format(dataValida, 'yyyy-MM-dd');
        if (dadosPorDiaNorm[chave]) dadosPorDiaNorm[chave].push(obj);
      }
    }

    // Agrupar abastecimentos por dia
    const abastPorDia: Record<string, Abastecimento[]> = {};
    for (const chave of dias7) {
      abastPorDia[chave] = [];
    }
    for (const a of abastecimentos) {
      const dataValida = parseDateSafe(a.dataAbastecimento);
      if (dataValida) {
        const chave = format(dataValida, 'yyyy-MM-dd');
        if (abastPorDia[chave]) abastPorDia[chave].push(a);
      }
    }

    const faturamentoDiario: number[] = [];
    const custoDiario: number[] = [];
    const kmDiario: number[] = [];
    const horasDiario: number[] = [];

    for (const chave of dias7) {
      const dadosDia = dadosPorDiaNorm[chave] || [];
      const abastDia = abastPorDia[chave] || [];

      // Faturamento do dia — usa obterValorUnitario com fallback R$ 80/ton
      let fatDia = 0;
      let kmDia = 0;
      let horasDia = 0;

      for (const obj of dadosDia) {
        const peso = Number(encontrarValorColuna(obj, colPeso)) || 0;
        if (peso <= 0) continue;

        const toneladas = peso / 1000;
        const km = Number(encontrarValorColuna(obj, colKm)) || 0;
        kmDia += km;

        // ═══ HORAS PRODUTIVAS — usando helper centralizado extrairHorasProdutivas ═══
        const horas = extrairHorasProdutivas(obj);

        // Só acumular se for valor de hora válido (máx 24h por viagem)
        if (horas > 0 && horas <= 24) {
          horasDia += Math.round(horas * 100) / 100;
        }

        // Detectar tipo de caminhão
        const tipoRaw = String(encontrarValorColuna(obj, colTipo) || '').toUpperCase().trim();
        if (/^\d+$/.test(tipoRaw)) {
          fatDia += toneladas * (temValorFaturamento ? (valoresFixos['VALOR_TONELADA'] || VALOR_ESTIMADO_TON) : VALOR_ESTIMADO_TON);
          continue;
        }

        const valorUnitario = obterValorUnitario(tipoRaw, valoresFixos, temValorFaturamento);
        fatDia += toneladas * valorUnitario;
      }

      // Custo do dia — usa abastecimentos reais
      let custoDia = abastDia.reduce((s, a) => s + Number(a.valor), 0);

      faturamentoDiario.push(Math.round(fatDia * 100) / 100);
      custoDiario.push(Math.round(custoDia * 100) / 100);
      kmDiario.push(Math.round(kmDia * 100) / 100);
      horasDiario.push(Math.round(horasDia * 100) / 100);
    }

    return { dias: dias7, faturamentoDiario, custoDiario, kmDiario, horasDiario };
  }

  /**
   * Calcula tendência de faturamento nos últimos 30 DIAS COM DADOS do período.
   * ⭐ CORRIGIDO: extrai datas reais dos registros em vez de usar dias corridos.
   */
  private calcularTendencia30d(
    dados: ColetaData[],
    valoresFixos: Record<string, number>,
    temValorFaturamento: boolean
  ): { data: string; label: string; valor: number }[] {
    // Normalizar para detectar colunas
    const dadosNorm = dados.map(d => {
      const obj: Record<string, any> = {};
      for (const [key, value] of Object.entries(d)) {
        obj[key] = value;
      }
      if (d.dados) {
        for (const [key, value] of Object.entries(d.dados)) {
          obj[key] = value;
        }
      }
      return obj;
    });

    // ═══ EXTRAIR DATAS REAIS DOS DADOS ═══
    const datasComDados = new Set<string>();
    for (const obj of dadosNorm) {
      const dataValida = parseDateSafe(obj.dataSaida);
      if (dataValida) {
        datasComDados.add(format(dataValida, 'yyyy-MM-dd'));
      }
    }

    const porDia: Record<string, number> = {};

    // Se não há dados, retorna array vazio
    if (datasComDados.size === 0) {
      return [];
    }

    // Inicializar com as datas existentes (até 30)
    const diasOrdenados = Array.from(datasComDados).sort().slice(-30);
    for (const data of diasOrdenados) {
      porDia[data] = 0;
    }

    const colPeso = detectarColuna(dadosNorm, ['PESO TOTAL', 'PESO', 'PESOTOTAL', 'PESO_TOTAL', 'pesoTotal']);
    const colTipo = detectarColuna(dadosNorm, ['TIPO CAMINHAO', 'TIPO_CAMINHAO', 'tipoCaminhao', 'CAMINHAO', 'CAMINHÃO']);

    for (const obj of dadosNorm) {
      const dataValida = parseDateSafe(obj.dataSaida);
      if (dataValida) {
        const chave = format(dataValida, 'yyyy-MM-dd');
        if (porDia[chave] !== undefined) {
          const peso = Number(encontrarValorColuna(obj, colPeso)) || 0;
          if (peso <= 0) continue;

          const toneladas = peso / 1000;

          // Detectar tipo de caminhão
          const tipoRaw = String(encontrarValorColuna(obj, colTipo) || '').toUpperCase().trim();
          if (/^\d+$/.test(tipoRaw)) {
            porDia[chave] += toneladas * (temValorFaturamento ? (valoresFixos['VALOR_TONELADA'] || VALOR_ESTIMADO_TON) : VALOR_ESTIMADO_TON);
            continue;
          }

          const valorUnitario = obterValorUnitario(tipoRaw, valoresFixos, temValorFaturamento);
          porDia[chave] += toneladas * valorUnitario;
        }
      }
    }

    return Object.entries(porDia).map(([data, valor]) => ({
      data,
      label: formatDateSafe(data, 'dd/MM', data?.slice(5) || ''),
      valor: Math.round(valor * 100) / 100,
    }));
  }

  /**
   * Calcula faturamento por tipo de caminhão
   */
  private calcularFaturamentoPorTipo(
    dados: ColetaData[],
    valoresFixos: Record<string, number>,
    temValorFaturamento: boolean
  ): { tipo: string; valor: number; percentual: number }[] {
    if (dados.length === 0) return [];

    const dadosNorm = dados.map(d => {
      const obj: Record<string, any> = {};
      for (const [key, value] of Object.entries(d)) {
        obj[key] = value;
      }
      if (d.dados) {
        for (const [key, value] of Object.entries(d.dados)) {
          obj[key] = value;
        }
      }
      return obj;
    });

    const colPeso = detectarColuna(dadosNorm, ['PESO TOTAL', 'PESO', 'PESOTOTAL', 'PESO_TOTAL', 'pesoTotal']);
    const colTipo = detectarColuna(dadosNorm, ['TIPO CAMINHAO', 'TIPO_CAMINHAO', 'tipoCaminhao', 'CAMINHAO', 'CAMINHÃO']);

    const porTipo: Record<string, number> = {};
    let total = 0;

    for (const d of dadosNorm) {
      const tipoRaw = String(encontrarValorColuna(d, colTipo) || 'OUTROS').toUpperCase().trim();
      if (/^\d+$/.test(tipoRaw)) continue;
      const peso = Number(encontrarValorColuna(d, colPeso)) || 0;
      if (peso <= 0) continue;

      const toneladas = peso / 1000;
      const valorUnitario = obterValorUnitario(tipoRaw, valoresFixos, temValorFaturamento);

      const receita = toneladas * valorUnitario;
      porTipo[tipoRaw] = (porTipo[tipoRaw] || 0) + receita;
      total += receita;
    }

    if (total === 0) return [];

    return Object.entries(porTipo)
      .map(([tipo, valor]) => ({
        tipo,
        valor: Math.round(valor * 100) / 100,
        percentual: Math.round((valor / total) * 10000) / 100,
      }))
      .sort((a, b) => b.valor - a.valor);
  }

  /**
   * Calcula produtividade por coletor
   * ⚠️ CORRIGIDO: usa dadosNorm + detectarColuna em vez de d.placa/d.kmTotal/d.pesoTotal
   */
  private calcularProdutividadePorColetor(
    dados: ColetaData[]
  ): { coletor: string; tonelagem: number; viagens: number; km: number; tonPorDia: number }[] {
    // Normalizar dados para detectar colunas
    const dadosNorm = dados.map(d => {
      const obj: Record<string, any> = {};
      for (const [key, value] of Object.entries(d)) {
        obj[key] = value;
      }
      if (d.dados) {
        for (const [key, value] of Object.entries(d.dados)) {
          obj[key] = value;
        }
      }
      return obj;
    });

    const colPlaca = detectarColuna(dadosNorm, ['PLACA', 'CAMINHAO', 'VEICULO', 'COLETOR', 'COLETORA', 'EQUIPAMENTO', 'placa']);
    const colPeso = detectarColuna(dadosNorm, ['PESO TOTAL', 'PESO', 'PESOTOTAL', 'PESO_TOTAL', 'pesoTotal']);
    const colKm = detectarColuna(dadosNorm, ['KM TOTAL', 'KM', 'KMTOTAL', 'KM_TOTAL', 'kmTotal', 'QUILOMETRO', 'DISTANCIA']);

    const mapa = new Map<string, { tonelagem: number; viagens: number; km: number; dias: Set<string> }>();

    for (const obj of dadosNorm) {
      const placa = String(encontrarValorColuna(obj, colPlaca) || '').trim();
      if (!placa) continue;
      if (!mapa.has(placa)) {
        mapa.set(placa, { tonelagem: 0, viagens: 0, km: 0, dias: new Set() });
      }
      const entry = mapa.get(placa)!;

      const pesoKg = Number(encontrarValorColuna(obj, colPeso)) || 0;
      entry.tonelagem += pesoKg / 1000;
      entry.viagens += contarViagensPorRotaRegistro(obj);
      entry.km += Number(encontrarValorColuna(obj, colKm)) || 0;

      const dataValidaProd = parseDateSafe(obj.dataSaida);
      if (dataValidaProd) {
        entry.dias.add(format(dataValidaProd, 'yyyy-MM-dd'));
      }
    }

    return Array.from(mapa.entries())
      .map(([coletor, data]) => ({
        coletor,
        tonelagem: Math.round(data.tonelagem * 100) / 100,
        viagens: data.viagens,
        km: Math.round(data.km * 100) / 100,
        tonPorDia: data.dias.size > 0
          ? Math.round((data.tonelagem / data.dias.size) * 100) / 100
          : 0,
      }))
      .sort((a, b) => b.tonelagem - a.tonelagem);
  }

  /**
   * Calcula produtividade por motorista (agrupando por coluna MOTORISTA)
   * Fallback para PLACA se não encontrar coluna MOTORISTA
   */
  private calcularProdutividadePorMotorista(
    dados: ColetaData[]
  ): { motorista: string; placa: string; viagens: number; tonelagem: number; kmTotal: number; horasProdutivas: number; tonPorViagem: number; kmPorViagem: number; tonPorKm: number; tonPorHora: number }[] {
    // Normalizar dados para detectar colunas
    const dadosNorm = dados.map(d => {
      const obj: Record<string, any> = {};
      for (const [key, value] of Object.entries(d)) {
        obj[key] = value;
      }
      if (d.dados) {
        for (const [key, value] of Object.entries(d.dados)) {
          obj[key] = value;
        }
      }
      return obj;
    });

    const colMotorista = detectarColuna(dadosNorm, ['MOTORISTA', 'OPERADOR', 'NOME', 'NOME MOTORISTA', 'NOME_MOTORISTA', 'motorista', 'MOT']);
    const colPlaca = detectarColuna(dadosNorm, ['PLACA', 'CAMINHAO', 'VEICULO', 'COLETOR', 'COLETORA', 'EQUIPAMENTO', 'placa']);
    const colPeso = detectarColuna(dadosNorm, ['PESO TOTAL', 'PESO', 'PESOTOTAL', 'PESO_TOTAL', 'pesoTotal']);
    const colKm = detectarColuna(dadosNorm, ['KM TOTAL', 'KM', 'KMTOTAL', 'KM_TOTAL', 'kmTotal', 'QUILOMETRO', 'DISTANCIA']);
    const colHoras = detectarColuna(dadosNorm, ['HORAS FORA UNIDADE', 'HORAS_FORA_UNIDADE', 'horasForaUnidade', 'TEMPO FORA', 'HORAS', 'HORAS PRODUTIVAS', 'tempoForaUnidade']);

    const mapa = new Map<string, { viagens: number; tonelagem: number; kmTotal: number; horasProdutivas: number; placa: string }>();

    for (const obj of dadosNorm) {
      let motorista = String(encontrarValorColuna(obj, colMotorista) || '').trim();
      const placa = String(encontrarValorColuna(obj, colPlaca) || '').trim();
      // Fallback para PLACA se não encontrou MOTORISTA
      if (!motorista) {
        motorista = placa;
      }
      if (!motorista) continue;

      if (!mapa.has(motorista)) {
        mapa.set(motorista, { viagens: 0, tonelagem: 0, kmTotal: 0, horasProdutivas: 0, placa: '' });
      }
      const entry = mapa.get(motorista)!;

      // Preencher placa (primeira encontrada)
      if (placa && !entry.placa) entry.placa = placa;

      const pesoKg = Number(encontrarValorColuna(obj, colPeso)) || 0;
      entry.tonelagem += pesoKg / 1000;
      entry.viagens += contarViagensPorRotaRegistro(obj);
      entry.kmTotal += Number(encontrarValorColuna(obj, colKm)) || 0;

      // ═══ HORAS PRODUTIVAS — usando helper centralizado extrairHorasProdutivas ═══
      const horasMotorista = extrairHorasProdutivas(obj);
      if (horasMotorista > 0 && horasMotorista <= 24) {
        entry.horasProdutivas += Math.round(horasMotorista * 100) / 100;
      }
    }

    return Array.from(mapa.entries())
      .map(([motorista, data]) => ({
        motorista,
        placa: data.placa,
        viagens: data.viagens,
        tonelagem: Math.round(data.tonelagem * 100) / 100,
        kmTotal: Math.round(data.kmTotal * 100) / 100,
        horasProdutivas: Math.round(data.horasProdutivas * 100) / 100,
        tonPorViagem: data.viagens > 0 ? Math.round((data.tonelagem / data.viagens) * 100) / 100 : 0,
        kmPorViagem: data.viagens > 0 ? Math.round((data.kmTotal / data.viagens) * 100) / 100 : 0,
        tonPorKm: data.kmTotal > 0 ? Math.round((data.tonelagem / data.kmTotal) * 10000) / 10000 : 0,
        tonPorHora: data.horasProdutivas > 0 ? Math.round((data.tonelagem / data.horasProdutivas) * 100) / 100 : 0,
      }))
      .sort((a, b) => b.tonelagem - a.tonelagem);
  }

  /**
   * Calcula KM médio por viagem
   */
  private calcularKmMedioViagem(
    dadosAtuais: ColetaData[],
    dadosAnteriores: ColetaData[],
    temBasePlanilha: boolean,
  ): { atual: number; anterior: number; variacao: { valor: number; tipo: string } } {
    const calc = (dados: ColetaData[]) => {
      const totalViagens = sumarizarViagensPorRota(dados);
      if (totalViagens <= 0) return 0;
      const totalKm = dados.reduce((s, d) => s + (Number(d.kmTotal) || 0), 0);
      return totalKm / totalViagens;
    };

    const atual = Math.round(calc(dadosAtuais) * 100) / 100;
    const anterior = Math.round(calc(dadosAnteriores) * 100) / 100;

    return { atual, anterior, variacao: calcVariacao(atual, anterior, { temBase: temBasePlanilha }) };
  }

  /**
   * Calcula horas produtivas médias por viagem
   */
  private calcularHorasMedias(
    dadosAtuais: ColetaData[],
    dadosAnteriores: ColetaData[],
    temBasePlanilha: boolean,
  ): { atual: number; anterior: number; variacao: { valor: number; tipo: string } } {
    const calc = (dados: ColetaData[]) => {
      const totalViagens = sumarizarViagensPorRota(dados);
      if (totalViagens <= 0) return 0;
      let totalHoras = 0;
      for (const d of dados) {
        // Construir objeto combinado para usar o helper
        const objCombinado: Record<string, any> = {};
        for (const [key, value] of Object.entries(d)) {
          objCombinado[key] = value;
        }
        if (d.dados) {
          for (const [key, value] of Object.entries(d.dados)) {
            objCombinado[key] = value;
          }
        }
        totalHoras += extrairHorasProdutivas(objCombinado);
      }
      return totalHoras / totalViagens;
    };

    const atual = Math.round(calc(dadosAtuais) * 100) / 100;
    const anterior = Math.round(calc(dadosAnteriores) * 100) / 100;

    return { atual, anterior, variacao: calcVariacao(atual, anterior, { temBase: temBasePlanilha }) };
  }

  /**
   * Calcula utilização da frota
   */
  private calcularUtilizacaoFrota(
    dadosAtuais: ColetaData[],
    totalCaminhoesCadastrados: number
  ): { ativos: number; total: number; percentual: number } {
    const coletoresAtivos = new Set<string>();
    for (const d of dadosAtuais) {
      if (d.placa) coletoresAtivos.add(d.placa);
    }

    const ativos = coletoresAtivos.size;
    const percentual = totalCaminhoesCadastrados > 0
      ? Math.round((ativos / totalCaminhoesCadastrados) * 10000) / 100
      : 0;

    return { ativos, total: totalCaminhoesCadastrados, percentual };
  }

  /**
   * Calcula margem por tipo de caminhão
   */
  private calcularMargemPorTipo(
    dados: ColetaData[],
    abastecimentos: Abastecimento[],
    valoresFixos: Record<string, number>,
    temValorFaturamento: boolean
  ): { tipo: string; receita: number; custo: number; margem: number }[] {
    if (dados.length === 0) return [];

    const dadosNorm = dados.map(d => {
      const obj: Record<string, any> = {};
      for (const [key, value] of Object.entries(d)) {
        obj[key] = value;
      }
      if (d.dados) {
        for (const [key, value] of Object.entries(d.dados)) {
          obj[key] = value;
        }
      }
      return obj;
    });

    const colPeso = detectarColuna(dadosNorm, ['PESO TOTAL', 'PESO', 'PESOTOTAL', 'PESO_TOTAL', 'pesoTotal']);
    const colTipo = detectarColuna(dadosNorm, ['TIPO CAMINHAO', 'TIPO_CAMINHAO', 'tipoCaminhao', 'CAMINHAO', 'CAMINHÃO']);
    const colKm = detectarColuna(dadosNorm, ['KM TOTAL', 'KM', 'KMTOTAL', 'KM_TOTAL', 'kmTotal', 'QUILOMETRO', 'DISTANCIA']);

    const receitaPorTipo: Record<string, number> = {};
    const pesoPorTipo: Record<string, number> = {};
    const kmPorTipo: Record<string, number> = {};

    for (const d of dadosNorm) {
      const tipoRaw = String(encontrarValorColuna(d, colTipo) || 'OUTROS').toUpperCase().trim();
      if (/^\d+$/.test(tipoRaw)) continue;
      const peso = Number(encontrarValorColuna(d, colPeso)) || 0;
      if (peso <= 0) continue;

      const toneladas = peso / 1000;
      const km = Number(encontrarValorColuna(d, colKm)) || 0;
      const valorUnitario = obterValorUnitario(tipoRaw, valoresFixos, temValorFaturamento);

      receitaPorTipo[tipoRaw] = (receitaPorTipo[tipoRaw] || 0) + toneladas * valorUnitario;
      pesoPorTipo[tipoRaw] = (pesoPorTipo[tipoRaw] || 0) + toneladas;
      kmPorTipo[tipoRaw] = (kmPorTipo[tipoRaw] || 0) + km;
    }

    // ═══ CUSTO TOTAL — baseado nos abastecimentos reais ═══
    const kmTotal = Object.values(kmPorTipo).reduce((s, v) => s + v, 0);

    const custoTotal = abastecimentos.reduce((s, a) => s + Number(a.valor), 0);

    const pesoTotal = Object.values(pesoPorTipo).reduce((s, v) => s + v, 0);

    return Object.entries(receitaPorTipo)
      .map(([tipo, receita]) => {
        const peso = pesoPorTipo[tipo] || 0;
        const km = kmPorTipo[tipo] || 0;

        // Distribuir custo proporcional ao peso (caminhões mais pesados consomem mais combustível)
        let custoProporcional = 0;
        if (custoTotal > 0 && pesoTotal > 0) {
          custoProporcional = (peso / pesoTotal) * custoTotal;
        }

        const margem = receita > 0 ? ((receita - custoProporcional) / receita) * 100 : 0;
        return {
          tipo,
          receita: Math.round(receita * 100) / 100,
          custo: Math.round(custoProporcional * 100) / 100,
          margem: Math.round(margem * 100) / 100,
        };
      })
      .sort((a, b) => b.receita - a.receita);
  }

  /**
   * Calcula faturamento por coletor (ordenado)
   */
  private calcularFaturamentoPorColetor(
    dados: ColetaData[],
    valoresFixos: Record<string, number>,
    temValorFaturamento: boolean
  ): { coletor: string; faturamento: number }[] {
    if (dados.length === 0) return [];

    const dadosNorm = dados.map(d => {
      const obj: Record<string, any> = {};
      for (const [key, value] of Object.entries(d)) {
        obj[key] = value;
      }
      if (d.dados) {
        for (const [key, value] of Object.entries(d.dados)) {
          obj[key] = value;
        }
      }
      return obj;
    });

    const colPeso = detectarColuna(dadosNorm, ['PESO TOTAL', 'PESO', 'PESOTOTAL', 'PESO_TOTAL', 'pesoTotal']);
    const colTipo = detectarColuna(dadosNorm, ['TIPO CAMINHAO', 'TIPO_CAMINHAO', 'tipoCaminhao', 'CAMINHAO', 'CAMINHÃO']);

    const porColetor: Record<string, number> = {};
    const colColetor = detectarColuna(dadosNorm, ['PLACA', 'CAMINHAO', 'VEICULO', 'COLETOR', 'COLETORA', 'EQUIPAMENTO', 'placa']);

    for (const d of dadosNorm) {
      const placa = String(encontrarValorColuna(d, colColetor) || '').trim();
      if (!placa) continue;

      const tipoRaw = String(encontrarValorColuna(d, colTipo) || 'OUTROS').toUpperCase().trim();
      if (/^\d+$/.test(tipoRaw)) continue;
      const peso = Number(encontrarValorColuna(d, colPeso)) || 0;
      if (peso <= 0) continue;

      const toneladas = peso / 1000;
      const valorUnitario = obterValorUnitario(tipoRaw, valoresFixos, temValorFaturamento);

      porColetor[placa] = (porColetor[placa] || 0) + toneladas * valorUnitario;
    }

    return Object.entries(porColetor)
      .map(([coletor, faturamento]) => ({
        coletor,
        faturamento: Math.round(faturamento * 100) / 100,
      }))
      .sort((a, b) => b.faturamento - a.faturamento);
  }

  /* ═══════════════════════════════════════════
     NOVOS KPIs DE RECEITA
     ═══════════════════════════════════════════ */

  /**
   * Calcula faturamento por regional
   */
  private calcularFaturamentoPorRegional(
    dados: ColetaData[],
    valoresFixos: Record<string, number>,
    temValorFaturamento: boolean
  ): { regional: string; faturamento: number; viagens: number }[] {
    if (dados.length === 0) return [];

    const dadosNorm = dados.map(d => {
      const obj: Record<string, any> = {};
      for (const [key, value] of Object.entries(d)) { obj[key] = value; }
      if (d.dados) { for (const [key, value] of Object.entries(d.dados)) { obj[key] = value; } }
      return obj;
    });

    const colRegional = detectarColuna(dadosNorm, ['REGIONAL', 'REGIAO', 'REGIÃO', 'regional']);
    const colPeso = detectarColuna(dadosNorm, ['PESO TOTAL', 'PESO', 'PESOTOTAL', 'PESO_TOTAL', 'pesoTotal']);
    const colTipo = detectarColuna(dadosNorm, ['TIPO CAMINHAO', 'TIPO_CAMINHAO', 'tipoCaminhao', 'CAMINHAO', 'CAMINHÃO']);

    const porRegional = new Map<string, { faturamento: number; viagens: number }>();

    // ⭐ CORRIGIDO: verificar se a coluna REGIONAL existe de verdade nos dados
    const temRegionalValida = colRegional !== 'REGIONAL' || dadosNorm.some(d => {
      const val = String(encontrarValorColuna(d, colRegional) || '').trim().toUpperCase();
      return val && val !== 'REGIONAL' && val !== 'OUTROS' && val.length > 1;
    });

    for (const d of dadosNorm) {
      const regional = String(encontrarValorColuna(d, colRegional) || 'Geral').trim();
      
      // Se não tem regional válida nos dados, tratar todos como "Geral"
      const chaveRegional = temRegionalValida ? regional : 'Geral';
      
      if (!porRegional.has(chaveRegional)) porRegional.set(chaveRegional, { faturamento: 0, viagens: 0 });

      const peso = Number(encontrarValorColuna(d, colPeso)) || 0;
      if (peso <= 0) continue;

      const entry = porRegional.get(chaveRegional)!;
      entry.viagens += contarViagensPorRotaRegistro(d);
      const toneladas = peso / 1000;
      const tipoRaw = String(encontrarValorColuna(d, colTipo) || '').toUpperCase().trim();
      const valorUnitario = obterValorUnitario(tipoRaw, valoresFixos, temValorFaturamento);
      entry.faturamento += toneladas * valorUnitario;
    }

    return Array.from(porRegional.entries())
      .map(([regional, v]) => ({
        regional,
        faturamento: Math.round(v.faturamento * 100) / 100,
        viagens: v.viagens,
      }))
      .sort((a, b) => b.faturamento - a.faturamento);
  }

  /**
   * Calcula faturamento por motorista
   */
  private calcularFaturamentoPorMotorista(
    dados: ColetaData[],
    valoresFixos: Record<string, number>,
    temValorFaturamento: boolean
  ): { motorista: string; placa: string; faturamento: number; viagens: number }[] {
    if (dados.length === 0) return [];

    const dadosNorm = dados.map(d => {
      const obj: Record<string, any> = {};
      for (const [key, value] of Object.entries(d)) { obj[key] = value; }
      if (d.dados) { for (const [key, value] of Object.entries(d.dados)) { obj[key] = value; } }
      return obj;
    });

    const colMotorista = detectarColuna(dadosNorm, ['MOTORISTA', 'OPERADOR', 'NOME', 'NOME MOTORISTA', 'NOME_MOTORISTA', 'motorista', 'MOT']);
    const colPlaca = detectarColuna(dadosNorm, ['PLACA', 'CAMINHAO', 'VEICULO', 'COLETOR', 'placa']);
    const colPeso = detectarColuna(dadosNorm, ['PESO TOTAL', 'PESO', 'PESOTOTAL', 'PESO_TOTAL', 'pesoTotal']);
    const colTipo = detectarColuna(dadosNorm, ['TIPO CAMINHAO', 'TIPO_CAMINHAO', 'tipoCaminhao', 'CAMINHAO', 'CAMINHÃO']);

    const porMotorista = new Map<string, { faturamento: number; viagens: number; placa: string }>();

    for (const d of dadosNorm) {
      const motorista = String(encontrarValorColuna(d, colMotorista) || d.placa || '').trim();
      const placa = String(encontrarValorColuna(d, colPlaca) || d.placa || '').trim();
      if (!motorista) continue;

      if (!porMotorista.has(motorista)) {
        porMotorista.set(motorista, { faturamento: 0, viagens: 0, placa: '' });
      }

      const entry = porMotorista.get(motorista)!;
      if (placa && !entry.placa) entry.placa = placa;

      const peso = Number(encontrarValorColuna(d, colPeso)) || 0;
      if (peso <= 0) continue;

      entry.viagens += contarViagensPorRotaRegistro(d);
      const toneladas = peso / 1000;
      const tipoRaw = String(encontrarValorColuna(d, colTipo) || '').toUpperCase().trim();
      const valorUnitario = obterValorUnitario(tipoRaw, valoresFixos, temValorFaturamento);
      entry.faturamento += toneladas * valorUnitario;
    }

    return Array.from(porMotorista.entries())
      .map(([motorista, v]) => ({
        motorista,
        placa: v.placa,
        faturamento: Math.round(v.faturamento * 100) / 100,
        viagens: v.viagens,
      }))
      .sort((a, b) => b.faturamento - a.faturamento);
  }

  /**
   * Calcula faturamento por turno (DIURNO / NOTURNO)
   */
  private calcularFaturamentoPorTurno(
    dados: ColetaData[],
    valoresFixos: Record<string, number>,
    temValorFaturamento: boolean
  ): { turno: string; faturamento: number; tonelagem: number; viagens: number; mediaPorViagem: number }[] {
    if (dados.length === 0) return [];

    const dadosNorm = dados.map(d => {
      const obj: Record<string, any> = {};
      for (const [key, value] of Object.entries(d)) { obj[key] = value; }
      if (d.dados) { for (const [key, value] of Object.entries(d.dados)) { obj[key] = value; } }
      return obj;
    });

    const colTurno = detectarColuna(dadosNorm, ['TURNO', 'turno']);
    const colPeso = detectarColuna(dadosNorm, ['PESO TOTAL', 'PESO', 'PESOTOTAL', 'PESO_TOTAL', 'pesoTotal']);
    const colTipo = detectarColuna(dadosNorm, ['TIPO CAMINHAO', 'TIPO_CAMINHAO', 'tipoCaminhao', 'CAMINHAO', 'CAMINHÃO']);

    const porTurno = new Map<string, { faturamento: number; tonelagem: number; viagens: number }>();

    for (const d of dadosNorm) {
      const turno = String(encontrarValorColuna(d, colTurno) || 'INDEFINIDO').trim().toUpperCase();
      if (!porTurno.has(turno)) porTurno.set(turno, { faturamento: 0, tonelagem: 0, viagens: 0 });

      const peso = Number(encontrarValorColuna(d, colPeso)) || 0;
      if (peso <= 0) continue;

      const entry = porTurno.get(turno)!;
      entry.viagens += contarViagensPorRotaRegistro(d);
      const toneladas = peso / 1000;
      entry.tonelagem += toneladas;
      const tipoRaw = String(encontrarValorColuna(d, colTipo) || '').toUpperCase().trim();
      const valorUnitario = obterValorUnitario(tipoRaw, valoresFixos, temValorFaturamento);
      entry.faturamento += toneladas * valorUnitario;
    }

    return Array.from(porTurno.entries())
      .map(([turno, v]) => ({
        turno,
        faturamento: Math.round(v.faturamento * 100) / 100,
        tonelagem: Math.round(v.tonelagem * 100) / 100,
        viagens: v.viagens,
        mediaPorViagem: v.viagens > 0 ? Math.round((v.faturamento / v.viagens) * 100) / 100 : 0,
      }))
      .sort((a, b) => b.faturamento - a.faturamento);
  }

  /**
   * Calcula faturamento por dia da semana
   */
  private calcularFaturamentoPorDiaSemana(
    dados: ColetaData[],
    valoresFixos: Record<string, number>,
    temValorFaturamento: boolean
  ): { diaSemana: number; diaNome: string; faturamento: number; tonelagem: number; viagens: number }[] {
    if (dados.length === 0) return [];

    const NOMES_DIAS = ['', 'Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

    const dadosNorm = dados.map(d => {
      const obj: Record<string, any> = {};
      for (const [key, value] of Object.entries(d)) { obj[key] = value; }
      if (d.dados) { for (const [key, value] of Object.entries(d.dados)) { obj[key] = value; } }
      return obj;
    });

    const colPeso = detectarColuna(dadosNorm, ['PESO TOTAL', 'PESO', 'PESOTOTAL', 'PESO_TOTAL', 'pesoTotal']);
    const colTipo = detectarColuna(dadosNorm, ['TIPO CAMINHAO', 'TIPO_CAMINHAO', 'tipoCaminhao', 'CAMINHAO', 'CAMINHÃO']);
    const colDiaSemana = detectarColuna(dadosNorm, ['DIA DA SEMANA', 'DIA_SEMANA', 'diadasemana', 'DOW', 'diaSemana']);

    const porDia = new Map<number, { faturamento: number; tonelagem: number; viagens: number }>();

    // Inicializar todos os dias
    for (let d = 1; d <= 7; d++) {
      porDia.set(d, { faturamento: 0, tonelagem: 0, viagens: 0 });
    }

    for (const obj of dadosNorm) {
      // Tenta extrair dia da semana da coluna específica
      let diaSemana = Number(encontrarValorColuna(obj, colDiaSemana)) || 0;

      // Fallback: calcular a partir da data
      if (!diaSemana || diaSemana < 1 || diaSemana > 7) {
        const dataValida = parseDateSafe(obj.dataSaida);
        if (dataValida) {
          // getDay(): 0=domingo, 6=sábado. Planilha: 1=domingo, 7=sábado
          diaSemana = dataValida.getDay() + 1;
        }
      }

      if (diaSemana < 1 || diaSemana > 7) continue;

      const peso = Number(encontrarValorColuna(obj, colPeso)) || 0;
      if (peso <= 0) continue;

      const entry = porDia.get(diaSemana)!;
      entry.viagens += contarViagensPorRotaRegistro(obj);
      const toneladas = peso / 1000;
      entry.tonelagem += toneladas;
      const tipoRaw = String(encontrarValorColuna(obj, colTipo) || '').toUpperCase().trim();
      const valorUnitario = obterValorUnitario(tipoRaw, valoresFixos, temValorFaturamento);
      entry.faturamento += toneladas * valorUnitario;
    }

    return Array.from(porDia.entries())
      .filter(([_, v]) => v.viagens > 0)
      .map(([diaSemana, v]) => ({
        diaSemana,
        diaNome: NOMES_DIAS[diaSemana] || `Dia ${diaSemana}`,
        faturamento: Math.round(v.faturamento * 100) / 100,
        tonelagem: Math.round(v.tonelagem * 100) / 100,
        viagens: v.viagens,
      }))
      .sort((a, b) => a.diaSemana - b.diaSemana);
  }

  /**
   * Calcula ticket médio por motorista (faturamento / viagens)
   */
  private calcularTicketMedioPorMotorista(
    dados: ColetaData[],
    valoresFixos: Record<string, number>,
    temValorFaturamento: boolean
  ): { motorista: string; placa: string; ticketMedio: number; viagens: number; faturamento: number }[] {
    const fatPorMotorista = this.calcularFaturamentoPorMotorista(dados, valoresFixos, temValorFaturamento);

    return fatPorMotorista
      .map(f => ({
        motorista: f.motorista,
        placa: f.placa,
        ticketMedio: f.viagens > 0 ? Math.round((f.faturamento / f.viagens) * 100) / 100 : 0,
        viagens: f.viagens,
        faturamento: f.faturamento,
      }))
      .sort((a, b) => b.ticketMedio - a.ticketMedio)
      .filter(f => f.ticketMedio > 0);
  }

  /**
   * Calcula projeção de faturamento com 3 cenários
   */
  private calcularProjecaoCenarios(
    dados: ColetaData[],
    valoresFixos: Record<string, number>,
    temValorFaturamento: boolean,
    periodo: PeriodoCalculado
  ): { cenarios: { nome: string; valor: number; diferenca: number }[]; diasRestantes: number; diasPassados: number } {
    const hoje = new Date();
    const fimMes = endOfMonth(hoje);

    // ⭐ CORRIGIDO: dias passados = dias reais desde o início do período até hoje
    const diasPassados = differenceInDays(hoje, periodo.inicio) + 1;
    const diasRestantes = differenceInDays(fimMes, hoje) + 1;

    // Calcular faturamento diário para análise de cenários
    const dadosNorm = dados.map(d => {
      const obj: Record<string, any> = {};
      for (const [key, value] of Object.entries(d)) { obj[key] = value; }
      if (d.dados) { for (const [key, value] of Object.entries(d.dados)) { obj[key] = value; } }
      return obj;
    });

    const colPeso = detectarColuna(dadosNorm, ['PESO TOTAL', 'PESO', 'PESOTOTAL', 'PESO_TOTAL', 'pesoTotal']);
    const colTipo = detectarColuna(dadosNorm, ['TIPO CAMINHAO', 'TIPO_CAMINHAO', 'tipoCaminhao', 'CAMINHAO', 'CAMINHÃO']);

    const fatPorDia: number[] = [];

    // Agrupar faturamento por dia
    const porDia = new Map<string, number>();
    for (const obj of dadosNorm) {
      const dataValida = parseDateSafe(obj.dataSaida);
      if (!dataValida) continue;
      const chave = format(dataValida, 'yyyy-MM-dd');
      const peso = Number(encontrarValorColuna(obj, colPeso)) || 0;
      if (peso <= 0) continue;
      const toneladas = peso / 1000;
      const tipoRaw = String(encontrarValorColuna(obj, colTipo) || '').toUpperCase().trim();
      const valorUnitario = obterValorUnitario(tipoRaw, valoresFixos, temValorFaturamento);
      const receita = toneladas * valorUnitario;
      porDia.set(chave, (porDia.get(chave) || 0) + receita);
    }

    const valoresDiarios = Array.from(porDia.values()).sort((a, b) => a - b);

    if (valoresDiarios.length === 0) {
      return {
        cenarios: [
          { nome: 'Otimista', valor: 0, diferenca: 0 },
          { nome: 'Realista', valor: 0, diferenca: 0 },
          { nome: 'Pessimista', valor: 0, diferenca: 0 },
        ],
        diasRestantes,
        diasPassados,
      };
    }

    const faturamentoAtual = valoresDiarios.reduce((s, v) => s + v, 0);
    const mediaGeral = valoresDiarios.length > 0 ? faturamentoAtual / valoresDiarios.length : 0;

    // Melhores 5 dias
    const melhores5 = valoresDiarios.slice(-5);
    const mediaMelhores = melhores5.length > 0 ? melhores5.reduce((s, v) => s + v, 0) / melhores5.length : mediaGeral;

    // Piores 5 dias
    const piores5 = valoresDiarios.slice(0, Math.min(5, valoresDiarios.length));
    const mediaPiores = piores5.length > 0 ? piores5.reduce((s, v) => s + v, 0) / piores5.length : mediaGeral;

    const projOtimista = faturamentoAtual + (diasRestantes * mediaMelhores);
    const projRealista = faturamentoAtual + (diasRestantes * mediaGeral);
    const projPessimista = faturamentoAtual + (diasRestantes * mediaPiores);

    return {
      cenarios: [
        { nome: 'Otimista', valor: Math.round(projOtimista * 100) / 100, diferenca: Math.round(((projOtimista - faturamentoAtual) / faturamentoAtual) * 10000) / 100 },
        { nome: 'Realista', valor: Math.round(projRealista * 100) / 100, diferenca: Math.round(((projRealista - faturamentoAtual) / faturamentoAtual) * 10000) / 100 },
        { nome: 'Pessimista', valor: Math.round(projPessimista * 100) / 100, diferenca: Math.round(((projPessimista - faturamentoAtual) / faturamentoAtual) * 10000) / 100 },
      ],
      diasRestantes,
      diasPassados,
    };
  }

  /* ═══════════════════════════════════════════
     DIAGNÓSTICO DE DADOS (executivo + operação + receita)
     GET /api/dashboard/diagnostico
     ═══════════════════════════════════════════ */
  async diagnostico(req: Request, res: Response): Promise<void> {
    try {
      const { contractId, servicoId } = req.query as Record<string, string | undefined>;
      if (ehHubDeContratos(req.usuario) && !contractId) {
        res.status(409).json({
          error: 'Cada contrato está no seu próprio banco: escolha um contrato para o diagnóstico.',
          precisaEscolherContrato: true,
        });
        return;
      }
      const resultado = await diagnosticarDashboards({ contractId, servicoId });
      res.json(resultado);
    } catch (error: any) {
      console.error('Erro no diagnóstico de dashboard:', error);
      res.status(500).json({ error: error?.message || 'Erro ao diagnosticar dashboards' });
    }
  }

  /* ═══════════════════════════════════════════
     GERAÇÃO DE PDF EXECUTIVO
     POST /api/dashboard/executivo/pdf
     ═══════════════════════════════════════════ */
  async gerarPdf(req: Request, res: Response): Promise<void> {
    try {
      const {
        periodo = 'ciclo',
        dataInicio,
        dataFim,
        contractId,
        servicoId,
        servicoNome: servicoNomeParam,
        mesReferencia: mesReferenciaBody,
        anoReferencia: anoReferenciaBody,
        secoes = ['financeira', 'operacional', 'graficos', 'customizados'],
      } = req.body as Record<string, any>;

      const mesReferencia = mesReferenciaBody != null ? parseInt(String(mesReferenciaBody), 10) : undefined;
      const anoReferencia = anoReferenciaBody != null ? parseInt(String(anoReferenciaBody), 10) : undefined;

      if (ehHubDeContratos(req.usuario) && !contractId) {
        res.status(409).json({
          error: 'Cada contrato está no seu próprio banco: escolha um contrato para gerar o PDF executivo.',
          precisaEscolherContrato: true,
        });
        return;
      }

      // Gerar chave de cache
      const cacheKey = crypto.createHash('md5').update(
        JSON.stringify({
          escopo: escopoCacheTenant(),
          periodo, dataInicio, dataFim, contractId, servicoId, mesReferencia, anoReferencia, secoes,
        })
      ).digest('hex');

      // Verificar cache
      const cached = pdfCache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < PDF_CACHE_DURACAO) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${cached.filename}.pdf"`);
        res.send(cached.buffer);
        return;
      }

      // 1. Calcular períodos
      const periodoAtual = await calcularPeriodoExecutivo(
        this.contractRepo,
        periodo,
        dataInicio,
        dataFim,
        contractId,
        mesReferencia,
        anoReferencia,
      );

      // 2. Carregar dados
      const [dadosAtuais, dadosAnteriores] = await Promise.all([
        this.carregarDadosColeta(periodoAtual.inicio, periodoAtual.fim, contractId, servicoId),
        this.carregarDadosColeta(periodoAtual.inicioAnterior, periodoAtual.fimAnterior, contractId, servicoId),
      ]);

      // 3. Carregar contratos e serviços
      let contratoNome = 'Contrato';
      let servicoNome = servicoNomeParam || 'Serviço';
      let servicoTipo = 'geral';
      let corPrimaria = '#22c55e';

      if (contractId) {
        const contrato = await this.contractRepo.findOne({ where: { id: contractId } });
        if (contrato) {
          contratoNome = contrato.numeroContrato || 'Contrato';
        }

        if (servicoId) {
          const servico = await this.servicoRepo.findOne({ where: { id: servicoId } });
          if (servico) {
            servicoNome = servico.nome || servicoNome;
            servicoTipo = servico.tipo || 'geral';
          }
        }
      }

      // 4. Carregar valores fixos do contrato
      const contracts = contractId
        ? [await this.contractRepo.findOne({ where: { id: contractId } })]
        : await this.contractRepo.find();
      const contractsValidos = contracts.filter(Boolean) as Contract[];
      const valoresFixos: Record<string, number> = {};
      for (const c of contractsValidos) {
        if (c.valorTonelada) valoresFixos['VALOR_TONELADA'] = Number(c.valorTonelada);
        if (c.valorMini) valoresFixos['VALOR_MINI'] = Number(c.valorMini);
        if (c.valorTruck) valoresFixos['VALOR_TRUCK'] = Number(c.valorTruck);
        if (c.valorToco) valoresFixos['VALOR_TOCO'] = Number(c.valorToco);
        if (c.valorBasculante) valoresFixos['VALOR_BASCULANTE'] = Number(c.valorBasculante);
      }
      const CHAVES_FATURAMENTO = ['VALOR_TONELADA', 'VALOR_MINI', 'VALOR_TRUCK', 'VALOR_TOCO', 'VALOR_BASCULANTE'];
      const temValorFaturamentoPdf = CHAVES_FATURAMENTO.some(k => (valoresFixos[k] || 0) > 0);
      const temValor = temValorFaturamentoPdf; // mantido para compatibilidade

      // 5. Abastecimentos
      const abastecimentosAtuais = await this.abastecimentoRepo.createQueryBuilder('a')
        .select(['a.id', 'a.placa', 'a.litragem', 'a.valor', 'a.dataAbastecimento'])
        .where('a.dataAbastecimento BETWEEN :inicio AND :fim', {
          inicio: periodoAtual.inicio, fim: periodoAtual.fim,
        })
        .getMany();

      const todosCaminhoes = await this.caminhaoRepo.find();
      const totalCaminhoesCadastrados = todosCaminhoes.length;

      // 6. Calcular indicadores
      const finAtual = this.calcularFinanceiros(dadosAtuais, valoresFixos, temValor, abastecimentosAtuais);
      const finAnterior = this.calcularFinanceiros(dadosAnteriores, valoresFixos, temValor, []);
      const opAtual = this.calcularOperacionais(dadosAtuais, totalCaminhoesCadastrados);
      const opAnterior = this.calcularOperacionais(dadosAnteriores, totalCaminhoesCadastrados);
      const fatPorTipo = this.calcularFaturamentoPorTipo(dadosAtuais, valoresFixos, temValor);
      const tendencia30d = this.calcularTendencia30d(dadosAtuais, valoresFixos, temValor);
      const prodPorColetor = this.calcularProdutividadePorColetor(dadosAtuais);
      const tendenciaFinanceira = this.calcularTendenciaFinanceira(dadosAtuais, valoresFixos, temValor, abastecimentosAtuais);

      // Faturamento por coletor (para gráfico 3)
      const fatPorColetor = this.calcularFaturamentoPorColetor(dadosAtuais, valoresFixos, temValor);

      // Variações
      const varFat = calcVariacao(finAtual.faturamento, finAnterior.faturamento);
      const varMargem = calcVariacao(finAtual.margem, finAnterior.margem);
      const varTicket = calcVariacao(finAtual.ticketMedio, finAnterior.ticketMedio);

      // 7. Calcular dados por período (agrupar por dia)
      const dadosNorm = dadosAtuais.map(d => {
        const obj: Record<string, any> = {};
        for (const [key, value] of Object.entries(d)) { obj[key] = value; }
        if (d.dados) { for (const [key, value] of Object.entries(d.dados)) { obj[key] = value; } }
        return obj;
      });
      const colPeso = detectarColuna(dadosNorm, ['PESO TOTAL', 'PESO', 'PESOTOTAL', 'PESO_TOTAL', 'pesoTotal']);

      // ═══ DETECTAR COLUNA DE DATA NOS DADOS BRUTOS DA PLANILHA ═══
      const colDataPlanilha = detectarColuna(dadosNorm,
        ['DATA SAIDA', 'DATA', 'DT SAIDA', 'DT', 'DATA COLETA', 'DATA_COLETA', 'DIA',
         'DATA SAÍDA', 'DATA_SAIDA', 'DT_SAIDA', 'DATA_SEDA', 'DATA_COLETA']
      );

      /**
       * Extrai a data real de cada registro:
       * 1. Tenta a coluna detectada nos dados brutos da planilha (d.dados)
       * 2. Fallback para dataSaida do banco
       * 3. Retorna null se nada for válido
       */
      function extrairDataRegistro(obj: Record<string, any>, colPlanilha: string): Date | null {
        // 1. Tentar coluna da planilha (dados brutos)
        if (colPlanilha) {
          const valorPlanilha = encontrarValorColuna(obj, colPlanilha);
          if (valorPlanilha) {
            const parsed = parseDateSafe(valorPlanilha);
            if (parsed) return parsed;
          }
        }
        // 2. Tentar todas as chaves que parecem data
        for (const chave of Object.keys(obj)) {
          const chaveNorm = chave.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          if (chaveNorm.includes('DATA') || chaveNorm.includes('DT') || chaveNorm.includes('DIA')) {
            const parsed = parseDateSafe(obj[chave]);
            if (parsed) return parsed;
          }
        }
        // 3. Fallback: dataSaida do banco
        if (obj.dataSaida) return parseDateSafe(obj.dataSaida);
        return null;
      }

      // Faturamento por período (agrupado por dia — COM ANO)
      const fatPorDia: Record<string, { viagens: number; peso: number; faturamento: number; dataReal: string }> = {};

      for (const d of dadosNorm) {
        const dataRegistro = extrairDataRegistro(d, colDataPlanilha);
        if (!dataRegistro) continue;
        const chave = format(dataRegistro, 'yyyy-MM-dd'); // chave única com ano
        const label = format(dataRegistro, 'dd/MM/yy');   // label com ano abreviado
        if (!fatPorDia[chave]) fatPorDia[chave] = { viagens: 0, peso: 0, faturamento: 0, dataReal: label };
        fatPorDia[chave].viagens += contarViagensPorRotaRegistro(d);
        const peso = Number(encontrarValorColuna(d, colPeso)) || 0;
        fatPorDia[chave].peso += peso / 1000;
        // Usa obterValorUnitario para faturamento (com fallback R$ 80/ton)
        const colTipoPdf = detectarColuna([d], ['TIPO CAMINHAO', 'TIPO_CAMINHAO', 'tipoCaminhao', 'CAMINHAO', 'CAMINHÃO']);
        const tipoRaw = String(encontrarValorColuna(d, colTipoPdf) || 'OUTROS').toUpperCase().trim();
        const valorUnitarioPdf = obterValorUnitario(tipoRaw, valoresFixos, temValorFaturamentoPdf);
        fatPorDia[chave].faturamento += (peso / 1000) * valorUnitarioPdf;
      }

      const fatPorPeriodoArray = Object.entries(fatPorDia)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([_, v]) => ({
          data: v.dataReal,
          viagens: v.viagens,
          peso: Math.round(v.peso * 100) / 100,
          faturamento: Math.round(v.faturamento * 100) / 100,
        }));

      // Volume de coleta por período (COM ANO)
      const volPorPeriodo: Record<string, { valor: number; label: string }> = {};
      for (const d of dadosNorm) {
        const dataRegistroVol = extrairDataRegistro(d, colDataPlanilha);
        if (!dataRegistroVol) continue;
        const chave = format(dataRegistroVol, 'yyyy-MM-dd');
        if (!volPorPeriodo[chave]) volPorPeriodo[chave] = { valor: 0, label: format(dataRegistroVol, 'dd/MM/yy') };
        const peso = Number(encontrarValorColuna(d, colPeso)) || 0;
        volPorPeriodo[chave].valor += peso / 1000;
      }
      const volumeSerie = Object.entries(volPorPeriodo)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([_, v]) => ({ label: v.label, valor: Math.round(v.valor * 100) / 100 }));

      // Faturamento por tipo com detalhes
      const colTipo = detectarColuna(dadosNorm, ['TIPO CAMINHAO', 'TIPO_CAMINHAO', 'tipoCaminhao', 'CAMINHAO', 'CAMINHÃO']);
      const fatTipoDetalhado: Record<string, { viagens: number; pesoTotal: number; valorUnitario: number; faturamento: number }> = {};
      for (const d of dadosNorm) {
        const tipoRaw = String(encontrarValorColuna(d, colTipo) || 'OUTROS').toUpperCase().trim();
        if (/^\d+$/.test(tipoRaw)) continue;
        const peso = Number(encontrarValorColuna(d, colPeso)) || 0;
        if (peso <= 0) continue;
        if (!fatTipoDetalhado[tipoRaw]) {
          const valorUnitario = obterValorUnitario(tipoRaw, valoresFixos, temValorFaturamentoPdf);
          fatTipoDetalhado[tipoRaw] = {
            viagens: 0, pesoTotal: 0,
            valorUnitario,
            faturamento: 0,
          };
        }
        fatTipoDetalhado[tipoRaw].viagens += contarViagensPorRotaRegistro(d);
        fatTipoDetalhado[tipoRaw].pesoTotal += peso / 1000;
        fatTipoDetalhado[tipoRaw].faturamento += (peso / 1000) * fatTipoDetalhado[tipoRaw].valorUnitario;
      }
      const fatTipoArray = Object.entries(fatTipoDetalhado).map(([tipo, v]) => ({
        tipo,
        viagens: v.viagens,
        pesoTotal: Math.round(v.pesoTotal * 100) / 100,
        valorUnitario: v.valorUnitario,
        faturamento: Math.round(v.faturamento * 100) / 100,
      })).sort((a, b) => b.faturamento - a.faturamento);

      // Produtividade por coletor
      const prodMedColetor = prodPorColetor.length > 0
        ? prodPorColetor.reduce((s, c) => s + c.tonelagem, 0) / prodPorColetor.length
        : 0;

      // Peso médio por coleta
      const pesoMedioColeta = opAtual.viagens > 0 ? opAtual.tonelagem / opAtual.viagens : 0;

      // KM médio por viagem
      const kmMedioPorViagem = opAtual.viagens > 0 ? opAtual.kmTotal / opAtual.viagens : 0;

      // ═══ NOVOS CÁLCULOS — 7 GRÁFICOS DO PDF ═══

      // (A) Faturamento diário com custo (Gráfico 1)
      const hoje = new Date();
      const faturamentoDiarioComCusto = tendenciaFinanceira.faturamentoDiario.map((v, i) => {
        const dataStr = tendenciaFinanceira.dias[i] || '';
        return {
          label: dataStr ? formatDateSafe(dataStr, 'dd/MM') : '',
          faturamento: v,
          custo: tendenciaFinanceira.custoDiario[i] || 0,
        };
      });

      // Meta de faturamento (baseada no contrato)
      const metaFaturamento = finAtual.faturamento > 0 ? Math.round(finAtual.faturamento * 1.15) : undefined;

      // (B) Faturamento por coletor Top 10 (Gráfico 3)
      const fatPorColetorTop10 = fatPorColetor.slice(0, 10);

      // (C) Projeção mensal detalhada (Gráfico 4)
      // Recalcular dados acumulados dia a dia para o mês atual
      const inicioMes = startOfMonth(hoje);
      const fimMes = endOfMonth(hoje);
      const diasNoMes = differenceInDays(fimMes, inicioMes) + 1;
      const diasArr: number[] = [];
      const reaisArr: number[] = [];
      const projetadosArr: number[] = [];

      // Acumular faturamento real por dia
      let acumulado = 0;
      const mediaDiaria = opAtual.viagens > 0 && diasNoMes > 0
        ? Math.round((finAtual.faturamento / Math.min(diasNoMes, periodoAtual.fim.getDate())) * 100) / 100
        : 0;

      for (let d = 1; d <= diasNoMes; d++) {
        diasArr.push(d);
        // Dados do dia específico
        const diaStr = format(new Date(hoje.getFullYear(), hoje.getMonth(), d), 'yyyy-MM-dd');
        let valorDia = 0;
        for (const obj of dadosNorm) {
          const dataValidaProj = parseDateSafe(obj.dataSaida);
          if (dataValidaProj) {
            const dataReg = format(dataValidaProj, 'yyyy-MM-dd');
            if (dataReg === diaStr) {
              const peso = Number(encontrarValorColuna(obj, colPeso)) || 0;
              if (peso > 0) {
                const tipoRaw = String(encontrarValorColuna(obj, colTipo) || 'OUTROS').toUpperCase().trim();
                const valorUnitario = obterValorUnitario(tipoRaw, valoresFixos, temValorFaturamentoPdf);
                valorDia += (peso / 1000) * valorUnitario;
              }
            }
          }
        }
        acumulado += valorDia;
        reaisArr.push(Math.round(acumulado * 100) / 100);

        // Projeção (a partir de hoje + 1)
        if (d > hoje.getDate()) {
          const projVal = reaisArr[hoje.getDate() - 1] + (d - hoje.getDate()) * mediaDiaria;
          projetadosArr.push(Math.round(projVal * 100) / 100);
        } else {
          projetadosArr.push(0); // placeholder, não usado
        }
      }

      const projecaoMensalGrafico = {
        dias: diasArr,
        reais: reaisArr,
        projetados: projetadosArr,
        meta: metaFaturamento,
        labelMes: format(inicioMes, 'MMMM \'de\' yyyy'),
      };

      // (D) Volume de coleta com média móvel 7 dias (Gráfico 5)
      const volumeColetaComMedia = volumeSerie.map((item, i) => {
        // Média móvel de 7 dias (incluindo os 3 anteriores e 3 posteriores se disponíveis)
        let soma = 0;
        let count = 0;
        for (let j = Math.max(0, i - 3); j <= Math.min(volumeSerie.length - 1, i + 3); j++) {
          soma += volumeSerie[j].valor;
          count++;
        }
        return {
          label: item.label,
          valor: item.valor,
          mediaMovel: count > 0 ? Math.round((soma / count) * 100) / 100 : 0,
        };
      });

      // (E) Produtividade por coletor Top 10 (Gráfico 6)
      const produtividadeColetorTop10 = prodPorColetor.slice(0, 10).map(c => ({
        coletor: c.coletor,
        tonelagem: c.tonelagem,
        tonPorDia: c.tonPorDia,
      }));

      // (F) Eficiência operacional (bolha - Gráfico 7)
      // Precisamos do tipo de caminhão predominante por coletor
      const colTipoEfi = detectarColuna(dadosNorm, ['TIPO CAMINHAO', 'TIPO_CAMINHAO', 'tipoCaminhao', 'CAMINHAO', 'CAMINHÃO']);
      const tipoPorColetor = new Map<string, Map<string, number>>();
      const coletaViagens = new Map<string, number>();

      for (const obj of dadosNorm) {
        const placa = String(encontrarValorColuna(obj, 'placa') || '') || '';
        if (!placa) continue;
        if (!tipoPorColetor.has(placa)) tipoPorColetor.set(placa, new Map());
        const tipoRaw = String(encontrarValorColuna(obj, colTipoEfi) || 'OUTROS').toUpperCase().trim();
        const tipoMap = tipoPorColetor.get(placa)!;
        tipoMap.set(tipoRaw, (tipoMap.get(tipoRaw) || 0) + 1);
        coletaViagens.set(placa, (coletaViagens.get(placa) || 0) + 1);
      }

      const coresTipoCaminhao: Record<string, string> = {
        'MINI': '#3b82f6',
        'TRUCK': '#22c55e',
        'TOCO': '#f59e0b',
        'BASCULANTE': '#ef4444',
        'OUTROS': '#94a3b8',
      };

      const eficienciaOperacional = prodPorColetor
        .filter(c => c.km > 0 && c.tonelagem > 0)
        .slice(0, 15)
        .map(c => {
          // Tipo predominante
          const tipoCounts = tipoPorColetor.get(c.coletor);
          let tipoPredominante = 'OUTROS';
          let maxCount = 0;
          if (tipoCounts) {
            for (const [tipo, count] of tipoCounts) {
              const tipoCanonico = normalizarTipoCaminhaoPeso(tipo) || 'OUTROS';

              if (count > maxCount) {
                maxCount = count;
                tipoPredominante = tipoCanonico;
              }
            }
          }
          return {
            coletor: c.coletor,
            km: c.km,
            tonelagem: c.tonelagem,
            viagens: c.viagens,
            tipoCor: coresTipoCaminhao[tipoPredominante] || '#94a3b8',
          };
        });

      // ═══ NOVOS CÁLCULOS — EXPANSÃO FINANCEIRA ═══

      // Custo Operacional (card na capa)
      const varCusto = calcVariacao(finAtual.custo, finAnterior.custo);

      // Margem por Tipo (já existe via método)
      const margemTipoData = this.calcularMargemPorTipo(dadosAtuais, abastecimentosAtuais, valoresFixos, temValor);

      // Receita por KM e por Hora (médias do período)
      const kmTotalPeriodo = tendenciaFinanceira.kmDiario.reduce((s, v) => s + v, 0);
      const horasTotalPeriodo = tendenciaFinanceira.horasDiario.reduce((s, v) => s + v, 0);
      const fatTotalPeriodo = tendenciaFinanceira.faturamentoDiario.reduce((s, v) => s + v, 0);

      const receitaKmValor = kmTotalPeriodo > 0 ? Math.round((fatTotalPeriodo / kmTotalPeriodo) * 100) / 100 : 0;
      const receitaHoraValor = horasTotalPeriodo > 0 ? Math.round((fatTotalPeriodo / horasTotalPeriodo) * 100) / 100 : 0;
      const lucroLiquidoEst = Math.round((fatTotalPeriodo - tendenciaFinanceira.custoDiario.reduce((s, v) => s + v, 0)) * 100) / 100;

      // ═══ NOVOS GRÁFICOS DE RECEITA PARA O PDF ═══
      // Receita por KM diário
      const receitaKmDiarioData = tendenciaFinanceira.faturamentoDiario.map((v, i) => {
        const dataStr = tendenciaFinanceira.dias[i] || '';
        const km = tendenciaFinanceira.kmDiario[i] || 0;
        return {
          label: dataStr ? formatDateSafe(dataStr, 'dd/MM') : '',
          valor: km > 0 ? Math.round((v / km) * 100) / 100 : 0,
        };
      });

      // Receita por Hora diário
      const receitaHoraDiarioData = tendenciaFinanceira.faturamentoDiario.map((v, i) => {
        const dataStr = tendenciaFinanceira.dias[i] || '';
        const horas = tendenciaFinanceira.horasDiario[i] || 0;
        return {
          label: dataStr ? formatDateSafe(dataStr, 'dd/MM') : '',
          valor: horas > 0 ? Math.round((v / horas) * 100) / 100 : 0,
        };
      });

      // Ranking de Motoristas
      const rankingMotoristasData = this.calcularFaturamentoPorMotorista(dadosAtuais, valoresFixos, temValorFaturamentoPdf)
        .slice(0, 10)
        .map(m => ({
          motorista: m.motorista,
          placa: m.placa,
          faturamento: m.faturamento,
          viagens: m.viagens,
        }));

      // Receita por Regional
      const receitaPorRegionalData = this.calcularFaturamentoPorRegional(dadosAtuais, valoresFixos, temValorFaturamentoPdf);

      // Receita por Dia da Semana
      const receitaPorDiaSemanaData = this.calcularFaturamentoPorDiaSemana(dadosAtuais, valoresFixos, temValorFaturamentoPdf)
        .map(d => ({
          diaNome: d.diaNome,
          faturamento: d.faturamento,
          viagens: d.viagens,
        }));

      // Receita por Turno
      const receitaPorTurnoData = this.calcularFaturamentoPorTurno(dadosAtuais, valoresFixos, temValorFaturamentoPdf);

      // Lucro por período (combinar faturamentoDiario com custoDiario)
      const lucroPeriodoData = tendenciaFinanceira.faturamentoDiario.map((v, i) => {
        const dataStr = tendenciaFinanceira.dias[i] || '';
        const custo = tendenciaFinanceira.custoDiario[i] || 0;
        const lucro = v - custo;
        const margemPct = v > 0 ? (lucro / v) * 100 : 0;
        return {
          data: dataStr ? formatDateSafe(dataStr, 'dd/MM') : '',
          faturamento: Math.round(v * 100) / 100,
          custo: Math.round(custo * 100) / 100,
          lucro: Math.round(lucro * 100) / 100,
          margem: Math.round(margemPct * 100) / 100,
        };
      });

      // 8. Montar parâmetros do PDF
      const pdfParams: PdfExecutivoParams = {
        contratoNome,
        contratoId: contractId || '',
        servicoNome,
        servicoId: servicoId || '',
        periodoLabel: periodoAtual.label,
        dataInicio: periodoAtual.inicio.toISOString(),
        dataFim: periodoAtual.fim.toISOString(),
        dataGeracao: new Date(),
        corPrimaria,
        secoes: secoes as string[],
        dadosSuficientes: dadosAtuais.length >= 5,

        faturamentoTotal: {
          valor: finAtual.faturamento,
          formatado: formatarValor(finAtual.faturamento, 'moeda'),
          variacao: varFat.valor,
          tipoVariacao: varFat.tipo,
          meta: finAtual.faturamento * 1.1,
        },
        margemBruta: {
          valor: finAtual.margem,
          formatado: formatarValor(finAtual.margem, 'porcentagem'),
          variacao: varMargem.valor,
          tipoVariacao: varMargem.tipo,
          meta: 20,
        },
        ticketMedio: {
          valor: finAtual.ticketMedio,
          formatado: formatarValor(finAtual.ticketMedio, 'moeda'),
          variacao: varTicket.valor,
          tipoVariacao: varTicket.tipo,
          meta: finAtual.ticketMedio * 1.15,
        },

        faturamentoPorTipo: fatTipoArray,
        temValorCaminhao: temValor,
        faturamentoPorPeriodo: fatPorPeriodoArray,

        tendenciaFaturamento: tendencia30d.map(t => ({ label: t.label, valor: t.valor })),

        indicadoresOperacionais: {
          viagens: opAtual.viagens,
          coletores: opAtual.coletoresAtivos,
          tonelagem: opAtual.tonelagem,
          kmRodados: opAtual.kmTotal,
          horasProdutivas: opAtual.horasProdutivas,
          produtividadeColetor: Math.round(prodMedColetor * 100) / 100,
          kmMedioViagem: Math.round(kmMedioPorViagem * 100) / 100,
          pesoMedioColeta: Math.round(pesoMedioColeta * 100) / 100,
        },

        volumeColetaSerie: volumeSerie,
        indicadoresCustomizados: [],
        totalRegistros: dadosAtuais.length,

        // ═══ NOVOS CAMPOS — 7 GRÁFICOS ═══
        faturamentoDiarioComCusto,
        metaFaturamento,
        faturamentoPorColetorTop10: fatPorColetorTop10,
        projecaoMensalGrafico,
        volumeColetaComMedia,
        produtividadeColetorTop10,
        eficienciaOperacional,
        coresTipoCaminhao,

        // ═══ NOVOS CAMPOS — EXPANSÃO FINANCEIRA ═══
        custoOperacional: {
          valor: finAtual.custo,
          formatado: formatarValor(finAtual.custo, 'moeda'),
          variacao: varCusto.valor,
          tipoVariacao: varCusto.tipo,
          meta: undefined,
        },
        receitaKm: receitaKmValor,
        receitaHora: receitaHoraValor,
        lucroLiquidoEstimado: lucroLiquidoEst,
        margemPorTipo: margemTipoData,
        lucroPorPeriodo: lucroPeriodoData,

        // ═══ NOVOS GRÁFICOS DE RECEITA ═══
        receitaKmDiario: receitaKmDiarioData,
        receitaHoraDiario: receitaHoraDiarioData,
        rankingMotoristas: rankingMotoristasData,
        receitaPorRegional: receitaPorRegionalData,
        receitaPorDiaSemana: receitaPorDiaSemanaData,
        receitaPorTurno: receitaPorTurnoData,

        // ═══ NOVOS CAMPOS — PDF 5 PÁGINAS ═══

        // Resumo da Frota (capa)
        resumoFrota: {
          totalVeiculos: opAtual.coletoresAtivos,
          totalLitros: Math.round(abastecimentosAtuais.reduce((s, a) => s + Number(a.litragem), 0) * 100) / 100,
          custoMedioKm: 0,
          receitaMediaKm: receitaKmValor || 0,
        },

        // Análise de Combustível
        analiseCombustivel: (() => {
          const totalLitros = abastecimentosAtuais.reduce((s, a) => s + Number(a.litragem), 0);
          const totalValor = abastecimentosAtuais.reduce((s, a) => s + Number(a.valor), 0);
          const precoMedio = totalLitros > 0 ? totalValor / totalLitros : 0;
          const kmTotalPeriodo = tendenciaFinanceira.kmDiario.reduce((s, v) => s + v, 0);
          const litrosPorKm = kmTotalPeriodo > 0 ? totalLitros / kmTotalPeriodo : 0;
          const percentualCusto = finAtual.custo > 0 ? (totalValor / finAtual.custo) * 100 : 0;
          return {
            totalLitros: Math.round(totalLitros * 100) / 100,
            totalValor: Math.round(totalValor * 100) / 100,
            precoMedio: Math.round(precoMedio * 100) / 100,
            litrosPorKm: Math.round(litrosPorKm * 1000) / 1000,
            percentualCusto: Math.round(percentualCusto * 100) / 100,
          };
        })(),

        // Evolução diária de combustível (gráfico)
        evolucaoCombustivel: (() => {
          const abastPorDiaEvol = new Map<string, { litros: number; valor: number }>();
          for (const a of abastecimentosAtuais) {
            const dataValida = parseDateSafe(a.dataAbastecimento);
            if (dataValida) {
              const chave = format(dataValida, 'yyyy-MM-dd');
              if (!abastPorDiaEvol.has(chave)) abastPorDiaEvol.set(chave, { litros: 0, valor: 0 });
              const entry = abastPorDiaEvol.get(chave)!;
              entry.litros += Number(a.litragem);
              entry.valor += Number(a.valor);
            }
          }
          return Array.from(abastPorDiaEvol.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([chave, v]) => ({
              label: formatDateSafe(chave, 'dd/MM', chave?.slice(5) || ''),
              litros: Math.round(v.litros * 100) / 100,
              valor: Math.round(v.valor * 100) / 100,
            }));
        })(),

        // Desempenho por veículo
        desempenhoVeiculos: (() => {
          // Agrupar abastecimentos por placa
          const abastPorPlaca = new Map<string, { litros: number; valor: number }>();
          for (const a of abastecimentosAtuais) {
            const placa = a.placa?.trim().toUpperCase();
            if (!placa) continue;
            if (!abastPorPlaca.has(placa)) abastPorPlaca.set(placa, { litros: 0, valor: 0 });
            const entry = abastPorPlaca.get(placa)!;
            entry.litros += Number(a.litragem);
            entry.valor += Number(a.valor);
          }

          // Combinar com faturamento por coletor e produtividade
          const fatPorPlaca = new Map(fatPorColetor.map(f => [f.coletor.trim().toUpperCase(), f.faturamento]));
          const prodPorPlaca = new Map(prodPorColetor.map(p => [p.coletor.trim().toUpperCase(), p]));

          const todasPlacas = new Set([
            ...Array.from(abastPorPlaca.keys()),
            ...Array.from(fatPorPlaca.keys()),
          ]);

          return Array.from(todasPlacas)
            .map(placa => {
              const fat = fatPorPlaca.get(placa) || 0;
              const custo = abastPorPlaca.get(placa)?.valor || 0;
              const litros = abastPorPlaca.get(placa)?.litros || 0;
              const prod = prodPorPlaca.get(placa);
              const tonelagem = prod?.tonelagem || 0;
              const km = prod?.km || 0;
              const lucro = fat - custo;
              const margem = fat > 0 ? (lucro / fat) * 100 : 0;
              const kmPorLitro = litros > 0 ? km / litros : 0;
              return {
                placa,
                faturamento: Math.round(fat * 100) / 100,
                custo: Math.round(custo * 100) / 100,
                lucro: Math.round(lucro * 100) / 100,
                tonelagem: Math.round(tonelagem * 100) / 100,
                km: Math.round(km * 100) / 100,
                litros: Math.round(litros * 100) / 100,
                kmPorLitro: Math.round(kmPorLitro * 100) / 100,
                margem: Math.round(margem * 100) / 100,
              };
            })
            .sort((a, b) => b.lucro - a.lucro);
        })(),

        // Projeção Financeira
        projecaoFinanceira: (() => {
          const projMensal = this.calcularProjecaoMensal(dadosAtuais, finAtual.faturamento, periodoAtual);
          const custoRealizado = finAtual.custo;
          const mediaCustoDiaria = periodoAtual.fim.getDate() > 0
            ? custoRealizado / Math.min(periodoAtual.fim.getDate(), 31)
            : 0;
          const custoProjetado = custoRealizado + mediaCustoDiaria * Math.max(0, differenceInDays(endOfMonth(new Date()), periodoAtual.fim));
          const fatProjetado = projMensal.projecao;
          const margemProjetada = fatProjetado > 0 ? ((fatProjetado - custoProjetado) / fatProjetado) * 100 : 0;
          return {
            faturamentoRealizado: Math.round(finAtual.faturamento * 100) / 100,
            custoRealizado: Math.round(custoRealizado * 100) / 100,
            margemAtual: Math.round(finAtual.margem * 100) / 100,
            faturamentoProjetado: Math.round(fatProjetado * 100) / 100,
            custoProjetado: Math.round(custoProjetado * 100) / 100,
            margemProjetada: Math.round(margemProjetada * 100) / 100,
          };
        })(),
      };

      // 9. Gerar HTML
      const html = gerarHtmlRelatorioExecutivo(pdfParams);

      // 10. Converter para PDF (browser reutilizado + espera Chart.js)
      const { htmlToPdf } = await import('../services/PdfGeneratorService');
      const pdf = await htmlToPdf(html, {
        margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
        waitMs: 6000,
        useCache: true,
      });

      // 11. Nome do arquivo: Contrato_TipoServico_Executivo_Data
      const dataStr = format(new Date(), 'dd-MM-yyyy');
      const tipoLabel = labelTipoServicoPdf(servicoTipo);
      const nomeArquivo = [
        sanitizarNomePdf(contratoNome),
        sanitizarNomePdf(tipoLabel),
        'Executivo',
        dataStr,
      ].join('_');

      // 12. Armazenar em cache
      pdfCache.set(cacheKey, { buffer: pdf, timestamp: Date.now(), filename: nomeArquivo });

      // 13. Retornar PDF
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}.pdf"`);
      res.send(pdf);
    } catch (error: any) {
      console.error('[DashboardExecutivo] Erro ao gerar PDF:', error?.message || error);
      res.status(500).json({
        error: 'Erro ao gerar PDF executivo',
        detalhe: error?.message || '',
      });
    }
  }

  /**
   * Calcula projeção mensal baseada na média diária
   */
  private calcularProjecaoMensal(
    dados: ColetaData[],
    faturamentoAtual: number,
    periodo: PeriodoCalculado
  ): { projecao: number; mediaDiaria: number; diasRestantes: number; diasPassados: number } {
    const hoje = new Date();
    const fimMes = endOfMonth(hoje);

    // ⭐ CORRIGIDO: dias passados = dias reais desde o início do período até hoje
    // (não o tamanho total do período, que pode ser maior que os dias já vividos)
    const diasPassados = differenceInDays(hoje, periodo.inicio) + 1;
    const diasRestantes = differenceInDays(fimMes, hoje) + 1;

    const mediaDiaria = diasPassados > 0 ? faturamentoAtual / diasPassados : 0;
    const projecao = mediaDiaria * (diasPassados + diasRestantes);

    return {
      projecao: Math.round(projecao * 100) / 100,
      mediaDiaria: Math.round(mediaDiaria * 100) / 100,
      diasRestantes,
      diasPassados,
    };
  }
}
