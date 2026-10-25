/**
 * Pré-aquecimento do cache do Dashboard Executivo.
 * Roda após startup, diariamente e após upload de planilha.
 */

import AppDataSource, {
  getCurrentTenantDb,
  isMultiTenant,
  runWithTenant,
} from '../database/data-source';
import { contratosComBanco, escopoCacheTenant } from './tenantFanout';
import { Contract } from '../entities/Contract';
import { Servico } from '../entities/Servico';
import {
  calcularCicloMensalContrato,
  inferirMesReferenciaAtual,
  inferirMesReferenciaDeData,
  normalizarDiaInicioCiclo,
} from '../utils/periodoCicloContrato';
import { buildValoresFixosFaturamento } from './configFaturamentoValores';
import {
  agregacaoColetaComCache,
  mapeamentoOperacionalComCache,
  rankingsColetaComCache,
  fichaRotasCicloComCache,
} from './coletaEndpointsCache';
import { dashboardCache, type ExecutivoCacheParams } from './DashboardCacheManager';
import PlanilhaService from './PlanilhaService';
import type { DashboardExecutivoController } from '../controllers/DashboardExecutivoController';
import { calcularWarmupPedido } from './warmupPolicy';
import { trabalhoPesadoEmAndamento } from './trabalhoPesado';
export { calcularWarmupPedido } from './warmupPolicy';
export type { WarmupPedido } from './warmupPolicy';

let aquecendo = false;
let adiadoPorChatbot: ReturnType<typeof setTimeout> | null = null;
let controllerRef: DashboardExecutivoController | null = null;
let timerDiario: ReturnType<typeof setInterval> | null = null;
let warmupPosUploadTimer: ReturnType<typeof setTimeout> | null = null;
let warmupPosUploadPendente: { servicoId: string; contractId?: string } | null = null;

const INTERVALO_MS = parseInt(
  process.env.DASHBOARD_WARMUP_INTERVAL_MS || String(24 * 60 * 60 * 1000),
  10,
);
const DELAY_INICIAL_MS = parseInt(
  process.env.DASHBOARD_WARMUP_DELAY_MS || '45000',
  10,
);
const WARMUP_ENABLED = process.env.DASHBOARD_WARMUP_ENABLED !== 'false';
const WARMUP_FULL_SCAN = process.env.DASHBOARD_WARMUP_FULL_SCAN === 'true';
const WARMUP_MAX_CONTRATOS = parseInt(process.env.DASHBOARD_WARMUP_MAX_CONTRATOS || '2', 10);
const WARMUP_MAX_SERVICOS = parseInt(process.env.DASHBOARD_WARMUP_MAX_SERVICOS || '6', 10);
const WARMUP_PAUSE_MS = parseInt(process.env.DASHBOARD_WARMUP_PAUSE_MS || '400', 10);

let warmupPendente: { contractId?: string; servicoId?: string } | null = null;

function pausaWarmup(): Promise<void> {
  if (WARMUP_PAUSE_MS <= 0) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, WARMUP_PAUSE_MS));
}

export function registrarControllerExecutivo(ctrl: DashboardExecutivoController): void {
  controllerRef = ctrl;
}

function montarParamsCiclo(
  contractId: string,
  servicoId: string | undefined,
  diaInicioCiclo: number,
): ExecutivoCacheParams {
  const { mes, ano } = inferirMesReferenciaAtual(diaInicioCiclo);
  return {
    periodo: 'ciclo',
    contractId,
    ...(servicoId ? { servicoId } : {}),
    mesReferencia: mes,
    anoReferencia: ano,
    escopo: escopoCacheTenant(),
  };
}

export async function aquecerEntradaExecutivo(params: ExecutivoCacheParams): Promise<boolean> {
  if (!controllerRef) return false;
  if (dashboardCache.obter(params)) return true;
  return controllerRef.calcularECachear(params);
}

export async function aquecerCacheExecutivo(opts?: {
  contractId?: string;
  servicoId?: string;
}): Promise<void> {
  if (!WARMUP_ENABLED || !controllerRef) return;
  if (trabalhoPesadoEmAndamento()) {
    if (!adiadoPorChatbot) {
      console.log('[DashboardWarmup] Adiado: chatbot importando planilha ou gerando relatório');
      adiadoPorChatbot = setTimeout(() => {
        adiadoPorChatbot = null;
        void aquecerCacheExecutivo(opts);
      }, 60_000);
    }
    return;
  }
  if (aquecendo) {
    warmupPendente = { contractId: opts?.contractId, servicoId: opts?.servicoId };
    return;
  }
  if (!AppDataSource.isInitialized) return;

  // Com um banco por contrato o aquecimento roda dentro de cada banco.
  if (isMultiTenant() && !getCurrentTenantDb()) {
    const bancos = await contratosComBanco();
    for (const tenant of bancos) {
      if (opts?.contractId && tenant.contractId !== opts.contractId) continue;
      await runWithTenant(tenant.databaseName, () => aquecerCacheExecutivo(opts));
    }
    return;
  }

  aquecendo = true;
  const inicio = Date.now();
  let ok = 0;
  let skip = 0;
  let fail = 0;
  let vazio = 0;

  try {
    const contractRepo = AppDataSource.getRepository(Contract);
    const servicoRepo = AppDataSource.getRepository(Servico);

    let contratos: Contract[] = [];
    if (opts?.contractId) {
      const c = await contractRepo.findOne({ where: { id: opts.contractId } });
      if (c) contratos = [c];
    } else {
      contratos = await contractRepo.find({ order: { numeroContrato: 'ASC' } });
    }

    const todosServicos: Servico[] = [];
    for (const contrato of contratos) {
      if (opts?.servicoId) {
        const s = await servicoRepo.findOne({ where: { id: opts.servicoId, contract_id: contrato.id } });
        if (s) todosServicos.push(s);
      } else {
        const lista = await servicoRepo.find({ where: { contract_id: contrato.id }, order: { nome: 'ASC' } });
        todosServicos.push(...lista);
      }
    }

    const pedidoWarmup = calcularWarmupPedido({
      fullScan: WARMUP_FULL_SCAN || Boolean(opts?.contractId || opts?.servicoId),
      contratoTotal: contratos.length,
      servicoTotal: todosServicos.length,
      servicos: todosServicos.map(s => s.id),
      maxContratos: WARMUP_MAX_CONTRATOS,
      maxServicos: WARMUP_MAX_SERVICOS,
    });
    const contratosAProcessar = pedidoWarmup.fullScan ? contratos : contratos.slice(0, pedidoWarmup.maxContratos);

    const contagens = await PlanilhaService.getContagemRegistrosPorServicos(
      todosServicos.filter((s, index) => pedidoWarmup.fullScan || index < pedidoWarmup.maxServicos).map(s => s.id),
    );
    const servicoTemDados = (id: string) => (contagens.get(id)?.total || 0) > 0;

    for (const contrato of contratosAProcessar) {
      const dia = contrato.diaInicioCiclo ?? 1;

      if (opts?.servicoId) {
        if (!servicoTemDados(opts.servicoId)) { vazio++; continue; }
        const params = montarParamsCiclo(contrato.id, opts.servicoId, dia);
        if (dashboardCache.obter(params)) { skip++; continue; }
        const res = await controllerRef.calcularECachear(params);
        if (res) ok++; else fail++;
        await pausaWarmup();
        continue;
      }

      const servicos = (pedidoWarmup.fullScan ? todosServicos : todosServicos.slice(0, pedidoWarmup.maxServicos))
        .filter(s => s.contract_id === contrato.id);
      const servicosComDados = servicos.filter(s => servicoTemDados(s.id));

      if (servicosComDados.length === 0) {
        vazio += 1 + servicos.length;
        continue;
      }

      // Visão do contrato (todos serviços com dados)
      const paramsContrato = montarParamsCiclo(contrato.id, undefined, dia);
      if (dashboardCache.obter(paramsContrato)) skip++;
      else if (await controllerRef.calcularECachear(paramsContrato)) ok++;
      else fail++;
      await pausaWarmup();

      for (const servico of servicosComDados) {
        const params = montarParamsCiclo(contrato.id, servico.id, dia);
        if (dashboardCache.obter(params)) { skip++; continue; }
        if (await controllerRef.calcularECachear(params)) ok++;
        else fail++;
        await pausaWarmup();
      }
      vazio += servicos.length - servicosComDados.length;
    }

    const seg = ((Date.now() - inicio) / 1000).toFixed(1);
    const stats = dashboardCache.estatisticas();
    console.log(
      `[DashboardWarmup] Concluído em ${seg}s — ok:${ok} cache:${skip} vazio:${vazio} falha:${fail} | entradas mem:${stats.memoria} disco:${stats.disco}`,
    );
  } catch (err) {
    console.error('[DashboardWarmup] Erro:', (err as Error)?.message || err);
  } finally {
    aquecendo = false;
    const pendente = warmupPendente;
    warmupPendente = null;
    if (pendente) {
      setTimeout(() => {
        void aquecerCacheExecutivo(pendente);
      }, 10000);
    }
  }
}

/**
 * Aquece as consultas operacionais do ciclo corrente (agregação, rankings,
 * mapeamento e ficha de rotas). São as telas do dia a dia e as mais caras de
 * calcular; deixá-las prontas aqui evita que o usuário pague a primeira volta.
 */
async function aquecerOperacionalDoServico(servicoId: string, contractId: string): Promise<void> {
  try {
    const servico = await AppDataSource.getRepository(Servico).findOne({
      where: { id: servicoId },
      select: ['id', 'tipo'],
    });
    const ehColeta = servico?.tipo === 'coleta_caminhao';
    if (!ehColeta) return;

    const contrato = await AppDataSource.getRepository(Contract).findOne({ where: { id: contractId } });
    const dia = normalizarDiaInicioCiclo(contrato?.diaInicioCiclo);
    // O ciclo que interessa é o da planilha que acabou de entrar, não o de hoje:
    // quem importa dado de um mês fechado vai abrir justamente aquele ciclo.
    const periodoDados = await PlanilhaService.getPeriodoDadosPorServico(servicoId);
    const { mes, ano } = periodoDados
      ? inferirMesReferenciaDeData(periodoDados.dataFim, dia)
      : inferirMesReferenciaAtual(dia);
    const ciclo = calcularCicloMensalContrato(ano, mes, dia);

    const opts = { dataInicio: ciclo.dataInicio, dataFim: ciclo.dataFim };
    const valoresFixos = buildValoresFixosFaturamento(contrato, null);

    await agregacaoColetaComCache(servicoId, { ...opts, valoresFixos, tipoServico: servico?.tipo });
    await pausaWarmup();
    await rankingsColetaComCache(servicoId, opts);
    await pausaWarmup();
    await fichaRotasCicloComCache(servicoId, opts);
    await pausaWarmup();
    await mapeamentoOperacionalComCache(servicoId, { ...opts, tipoServico: servico?.tipo });
  } catch (err) {
    console.warn('[DashboardWarmup] Aquecimento operacional falhou:', (err as Error)?.message || err);
  }
}

/** Agenda warmup inicial + repetição diária */
export function iniciarAgendamentoWarmupExecutivo(): void {
  if (!WARMUP_ENABLED) {
    console.log('[DashboardWarmup] Desabilitado (DASHBOARD_WARMUP_ENABLED=false)');
    return;
  }

  setTimeout(() => {
    void aquecerCacheExecutivo();
  }, DELAY_INICIAL_MS);

  if (timerDiario) clearInterval(timerDiario);
  timerDiario = setInterval(() => {
    void aquecerCacheExecutivo();
  }, INTERVALO_MS);

  console.log(
    `[DashboardWarmup] Agendado — 1ª execução em ${DELAY_INICIAL_MS / 1000}s, depois a cada ${INTERVALO_MS / 3600000}h`,
  );
  const stats = dashboardCache.estatisticas();
  if (stats.memoria > 0 || stats.disco > 0) {
    console.log(`[DashboardWarmup] Cache em disco/memória: ${stats.disco} arquivo(s), ${stats.memoria} em RAM`);
  }
}

/**
 * Após upload — aquece só contrato/serviço afetado (em background).
 *
 * O banco do contrato precisa ser capturado agora: dentro do setTimeout o
 * contexto da requisição já não existe, e com um banco por contrato a busca do
 * serviço cairia no banco de controle, que não tem a tabela.
 */
export function agendarWarmupPosUpload(servicoId: string, contractId?: string): void {
  if (!WARMUP_ENABLED) return;
  const tenantDb = getCurrentTenantDb();

  warmupPosUploadPendente = { servicoId, contractId };
  if (warmupPosUploadTimer) clearTimeout(warmupPosUploadTimer);

  warmupPosUploadTimer = setTimeout(() => {
    const pending = warmupPosUploadPendente;
    warmupPosUploadPendente = null;
    warmupPosUploadTimer = null;
    if (!pending) return;

    const aquecer = async () => {
      let cid = pending.contractId;
      if (!cid) {
        const s = await AppDataSource.getRepository(Servico).findOne({ where: { id: pending.servicoId } });
        cid = s?.contract_id;
      }
      if (!cid) {
        console.warn(`[DashboardWarmup] Serviço ${pending.servicoId} sem contrato — aquecimento ignorado`);
        return;
      }
      await aquecerCacheExecutivo({ contractId: cid, servicoId: pending.servicoId });
      await aquecerOperacionalDoServico(pending.servicoId, cid);
    };

    void (async () => {
      try {
        if (tenantDb) await runWithTenant(tenantDb, aquecer);
        else await aquecer();
      } catch (err) {
        console.error('[DashboardWarmup] Falha no aquecimento pós-upload:', (err as Error)?.message || err);
      }
    })();
  }, 5000);
}
