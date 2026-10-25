import AppDataSource from '../database/data-source';
import { In } from 'typeorm';
import { Servico } from '../entities/Servico';
import { Contract } from '../entities/Contract';
import { PlanilhaUpload } from '../entities/PlanilhaUpload';
import PlanilhaService from './PlanilhaService';
import { LIMITE_DADOS_MAX, DADOS_CACHE_TTL_MS } from '../config/limitesRecursos';
import { calcularIndicadoresExecutivoUnificado } from './executivoIndicadoresService';

function periodoUltimos30Dias(): {
  inicio: Date;
  fim: Date;
  inicioAnterior: Date;
  fimAnterior: Date;
} {
  const fim = new Date();
  fim.setHours(23, 59, 59, 999);
  const inicio = new Date(fim);
  inicio.setDate(inicio.getDate() - 29);
  inicio.setHours(0, 0, 0, 0);
  const duracaoMs = fim.getTime() - inicio.getTime();
  const fimAnterior = new Date(inicio.getTime() - 1);
  const inicioAnterior = new Date(fimAnterior.getTime() - duracaoMs);
  return { inicio, fim, inicioAnterior, fimAnterior };
}

export interface DiagnosticoServico {
  servicoId: string;
  servicoNome: string;
  contratoId: string;
  contratoNome: string;
  tipo: string;
  uploads: number;
  registrosTotal: number;
  registrosValidos: number;
  registrosInvalidos: number;
  temPadraoPlanilha: boolean;
  colunasPadrao: number;
  kpisConfigurados: number;
  periodoDados: { dataInicio: string; dataFim: string } | null;
  amostraBrutos500: number;
  amostraBrutosLimiteMax: number;
  truncado500: boolean;
  truncadoLimiteMax: boolean;
  executivo30d: {
    registrosPeriodo: number;
    viagens: number;
    faturamento: number;
    pesoTon: number;
    km: number;
  };
  avisos: string[];
  ok: boolean;
}

export interface DiagnosticoDashboardResponse {
  geradoEm: string;
  ambiente: {
    limiteDadosMax: number;
    cacheDadosTtlMs: number;
    buildSha: string;
    imageTag: string;
  };
  resumo: {
    servicos: number;
    comDadosValidos: number;
    semDados: number;
    comAvisos: number;
  };
  servicos: DiagnosticoServico[];
}

function avisoSe(cond: boolean, msg: string, avisos: string[]): void {
  if (cond) avisos.push(msg);
}

export async function diagnosticarDashboards(opts?: {
  contractId?: string;
  servicoId?: string;
}): Promise<DiagnosticoDashboardResponse> {
  const servicoRepo = AppDataSource.getRepository(Servico);
  const contractRepo = AppDataSource.getRepository(Contract);
  const uploadRepo = AppDataSource.getRepository(PlanilhaUpload);

  let servicos: Servico[];
  if (opts?.servicoId) {
    const s = await servicoRepo.findOne({ where: { id: opts.servicoId } });
    servicos = s ? [s] : [];
  } else if (opts?.contractId) {
    servicos = await servicoRepo.find({
      where: { contract_id: opts.contractId },
      order: { nome: 'ASC' },
    });
  } else {
    servicos = await servicoRepo.find({ order: { nome: 'ASC' } });
  }

  const contractIds = [...new Set(servicos.map(s => s.contract_id))];
  const contracts = contractIds.length
    ? await contractRepo.find({ where: { id: In(contractIds) } })
    : [];
  const contractMap = new Map(contracts.map(c => [c.id, c]));

  const periodo30 = periodoUltimos30Dias();
  const resultados: DiagnosticoServico[] = [];

  for (const servico of servicos) {
    const avisos: string[] = [];
    const contract = contractMap.get(servico.contract_id);
    const contagem = await PlanilhaService.getContagemRegistrosPorServico(servico.id);
    const uploads = await uploadRepo.count({ where: { servico_id: servico.id } });
    const periodoDados = await PlanilhaService.getPeriodoDadosPorServico(servico.id);

    const cfg = servico.configDashboard || {};
    const colunas = servico.padraoPlanilha?.colunas?.length ?? 0;

    const [brutos500, brutosMax] = await Promise.all([
      PlanilhaService.getDadosBrutosPorServico(servico.id, 500, { apenasValidos: true }),
      PlanilhaService.getDadosBrutosPorServico(servico.id, LIMITE_DADOS_MAX, { apenasValidos: true }),
    ]);

    avisoSe(uploads === 0, 'Nenhum upload de planilha vinculado ao serviço.', avisos);
    avisoSe(contagem.total === 0 && uploads > 0, 'Há upload(s) mas zero registros em coleta_dados.', avisos);
    avisoSe(
      contagem.validos === 0 && contagem.total > 0,
      `${contagem.total} registro(s) no banco, mas nenhum com validoDashboard=true (KM/Peso/Data inválidos).`,
      avisos,
    );
    avisoSe(
      contagem.validos > 500 && brutos500.length < contagem.validos,
      `Dashboard operacional (ciclo) carrega só ${brutos500.length} de ${contagem.validos} viagens válidas — dias antigos podem aparecer zerados. Use limite maior ou agregação SQL.`,
      avisos,
    );
    avisoSe(
      contagem.validos > LIMITE_DADOS_MAX && brutosMax.length < contagem.validos,
      `Executivo/KPIs usam limite GRAFICOS_DADOS_LIMITE=${LIMITE_DADOS_MAX} — períodos antigos podem zerar.`,
      avisos,
    );
    avisoSe(colunas === 0 && uploads > 0, 'padraoPlanilha vazio — reimporte ou reconfigure o serviço.', avisos);
    avisoSe((cfg.kpis?.length ?? 0) === 0, 'Nenhum KPI em configDashboard.', avisos);

    let exec = { registrosPeriodo: 0, viagens: 0, faturamento: 0, pesoTon: 0, km: 0 };
    try {
      const ind = await calcularIndicadoresExecutivoUnificado({
        servicoId: servico.id,
        contractId: servico.contract_id,
        inicio: periodo30.inicio,
        fim: periodo30.fim,
        inicioAnterior: periodo30.inicioAnterior,
        fimAnterior: periodo30.fimAnterior,
      });
      exec = {
        registrosPeriodo: ind.totalRegistrosAtual,
        viagens: ind.metricasAtual.viagens,
        faturamento: ind.metricasAtual.faturamento,
        pesoTon: ind.metricasAtual.pesoTotalTon,
        km: ind.metricasAtual.kmTotal,
      };
      avisoSe(
        contagem.validos > 0 && exec.registrosPeriodo === 0,
        'Há dados válidos no banco, mas o filtro dos últimos 30 dias retornou zero — verifique datas das viagens.',
      avisos,
      );
    } catch (err: any) {
      avisos.push(`Erro ao calcular executivo 30d: ${err?.message || err}`);
    }

    resultados.push({
      servicoId: servico.id,
      servicoNome: servico.nome,
      contratoId: servico.contract_id,
      contratoNome: contract?.numeroContrato || '—',
      tipo: servico.tipo || '—',
      uploads,
      registrosTotal: contagem.total,
      registrosValidos: contagem.validos,
      registrosInvalidos: contagem.total - contagem.validos,
      temPadraoPlanilha: colunas > 0,
      colunasPadrao: colunas,
      kpisConfigurados: cfg.kpis?.length ?? 0,
      periodoDados,
      amostraBrutos500: brutos500.length,
      amostraBrutosLimiteMax: brutosMax.length,
      truncado500: contagem.validos > brutos500.length,
      truncadoLimiteMax: contagem.validos > brutosMax.length,
      executivo30d: exec,
      avisos,
      ok: avisos.length === 0 && contagem.validos > 0,
    });
  }

  return {
    geradoEm: new Date().toISOString(),
    ambiente: {
      limiteDadosMax: LIMITE_DADOS_MAX,
      cacheDadosTtlMs: DADOS_CACHE_TTL_MS,
      buildSha: process.env.BUILD_SHA || 'unknown',
      imageTag: process.env.IMAGE_TAG || process.env.TAG || 'unknown',
    },
    resumo: {
      servicos: resultados.length,
      comDadosValidos: resultados.filter(r => r.registrosValidos > 0).length,
      semDados: resultados.filter(r => r.registrosValidos === 0).length,
      comAvisos: resultados.filter(r => r.avisos.length > 0).length,
    },
    servicos: resultados,
  };
}
