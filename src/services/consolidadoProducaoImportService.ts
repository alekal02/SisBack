/**
 * Importação da planilha padrão de produção (CONSOLIDADO do Power Query).
 * Cada SERVIÇO da CONSOLIDADO vira um serviço no contrato.
 * Coleta não entra neste fluxo.
 */
import { Repository } from 'typeorm';
import AppDataSource from '../database/data-source';
import { ColetaData } from '../entities/ColetaData';
import { PlanilhaUpload } from '../entities/PlanilhaUpload';
import { Servico } from '../entities/Servico';
import { TipoServico } from '../enums/TipoServico';
import { obterUploadIdsModificaveis, aplicarReferenciaCicloNoUpload, apagarDatasDeUploadsAbertos, prepararDatasImportacaoCiclo } from './cicloPlanilhaService';
import { normalizarDiaInicioCiclo } from '../utils/periodoCicloContrato';
import { invalidarCacheDadosServico } from './servicoDadosCache';
import { invalidarCacheDashboardServico } from '../controllers/ServicoController';
import { recalcularTotaisDiaServicoSilencioso } from './coletaTotaisDiaService';
import { invalidarCacheSaudeContratos } from '../controllers/ContractController';
import { dashboardCache } from './DashboardCacheManager';
import { agendarWarmupPosUpload } from './executivoCacheWarmupService';
import { gerarConfigGraficosPadrao, reResolverGraficos } from './graficosPadrao';
import { converterKpisParaConfig } from './TipoServicoTemplateService';
import { garantirServicoNomeadoContrato } from './servicosPadraoContratoService';
import {
  detectarPlanilhaConsolidadoProducao,
  parsearPlanilhaConsolidadoProducao,
  resumoParseConsolidadoProducao,
  agruparLinhasPorServicoAba,
  TIPOS_ACEITA_CONSOLIDADO,
  type LinhaConsolidadoProducao,
  type ResultadoParseConsolidadoProducao,
  type TipoServicoConsolidado,
} from './consolidadoProducaoPlanilhaParser';
import { persistirArquivoOriginalUpload } from './planilhaOriginalStorage';
import { carregarChavesProducaoExistentes, filtrarColetasProducaoNovas } from './producaoDedupService';
import { executarImportacaoAtomica } from './substituicaoImportacaoProducao';

export interface ResultadoImportConsolidadoServico {
  servicoId: string;
  servicoNome: string;
  tipoSistema: TipoServicoConsolidado;
  planilhaUploadId: number;
  importados: number;
  quantitativoTotal: number;
  dias: number;
  bairros: number;
}

export interface ResultadoImportConsolidadoProducao {
  modo: 'consolidado_producao';
  modelo: 'consolidado_producao';
  planilhaUploadId: number;
  totalLinhas: number;
  importados: number;
  ignorados: number;
  abasUsadas: string[];
  avisos: string[];
  porTipo: ResultadoParseConsolidadoProducao['porTipo'];
  splitPorServico: ResultadoImportConsolidadoServico[];
  tiposSemServico: Array<{ tipoSistema: string; registros: number }>;
  datasApagadas: { data: string; registrosRemovidos: number }[];
  datasIgnoradasCicloFechado?: string[];
  consolidacao?: { uploadsRemovidos: number; uploadsRemovidosIds: number[] };
  viagensValidasDashboard: number;
  viagensInconsistentes: number;
}

class ConsolidadoProducaoImportService {
  private get coletaRepo(): Repository<ColetaData> {
    return AppDataSource.getRepository(ColetaData);
  }
  private get uploadRepo(): Repository<PlanilhaUpload> {
    return AppDataSource.getRepository(PlanilhaUpload);
  }
  private get servicoRepo(): Repository<Servico> {
    return AppDataSource.getRepository(Servico);
  }

  detectar(buffer: Buffer): boolean {
    return detectarPlanilhaConsolidadoProducao(buffer);
  }

  preview(buffer: Buffer) {
    const parsed = parsearPlanilhaConsolidadoProducao(buffer);
    return { ...parsed, resumo: resumoParseConsolidadoProducao(parsed) };
  }

  private trunc(v: string | null | undefined, max: number): string | null {
    if (v == null) return null;
    const s = String(v).trim();
    if (!s) return null;
    return s.length > max ? s.slice(0, max) : s;
  }

  private montarColeta(linha: LinhaConsolidadoProducao, uploadId: number): ColetaData {
    const coleta = new ColetaData();
    coleta.planilhaUploadId = uploadId;
    coleta.dataSaida = linha.dataSaida;
    const localCheio = linha.local;
    coleta.regional = this.trunc(localCheio, 50);
    coleta.distrito = this.trunc(localCheio, 50);
    coleta.motorista = null;
    coleta.tipoCaminhao = this.trunc(linha.equipamento, 30);
    coleta.turno = this.trunc(linha.tipoExecucao !== 'desconhecido' ? linha.tipoExecucao : null, 20);
    coleta.placa = null;
    coleta.pesoTotal = null;
    const km = Number(linha.dados['KM Linear'] ?? linha.dados.KM_LINEAR ?? 0);
    coleta.kmTotal = km > 0 ? km : null;
    coleta.numeroViagens = 1;
    coleta.viagensPorRota = 1;
    coleta.validoDashboard = true;
    coleta.motivosInconsistencia = null;
    coleta.dados = {
      ...linha.dados,
      ...(localCheio && localCheio.length > 50
        ? { DISTRITO_COMPLETO: localCheio, LOCAL_COMPLETO: localCheio }
        : {}),
    };
    if (linha.dataSaida) {
      coleta.diaSemana = linha.dataSaida.getUTCDay() + 1;
    }
    return coleta;
  }

  private colunasPadrao(tipo: TipoServicoConsolidado): string[] {
    const base = ['DATA', 'Dia', 'LOCAL', 'BAIRRO', 'Setor', 'QUANTITATIVO', 'UND', 'SERVIÇO', 'TIPO DE EQUIPAMENTO'];
    switch (tipo) {
      case TipoServico.ROCADEIRA:
        return [...base, 'Area m²', 'AREA_M2', 'Equipamento', 'TIPO'];
      case TipoServico.CAPINA:
        return [...base, 'Metro Linear', 'METRO_LINEAR', 'KM Linear', 'KM_LINEAR'];
      case TipoServico.VARRICAO:
        return [...base, 'KM Linear', 'KM_LINEAR', 'QUILOMETROS_VARRIDOS', 'TIPO_EXECUCAO'];
      case TipoServico.PODA:
        return [...base, 'Quantidade de Arvore', 'QTD_ARVORE'];
      case TipoServico.REMOCAO:
        return [...base, 'OBSERVAÇÃO'];
      case TipoServico.COLETA_SELETIVA:
        return [...base, 'Toneladas', 'TONELADAS', 'Peso'];
      case TipoServico.ATERRO:
        return [...base, 'OBSERVAÇÃO', 'Descrição do serviço', 'Peso', 'Viagens'];
      default:
        return base;
    }
  }

  private async persistirEmServico(opts: {
    servico: Servico;
    linhas: LinhaConsolidadoProducao[];
    nomeArquivo: string;
    usuarioId?: string;
    substituirPorData: boolean;
    totalLinhasBrutas: number;
    abasUsadas: string[];
    buffer: Buffer;
  }): Promise<ResultadoImportConsolidadoServico & {
    datasApagadas: { data: string; registrosRemovidos: number }[];
    uploadsRemovidosIds: number[];
    avisosCiclo: string[];
    datasIgnoradasCicloFechado: string[];
    ignoradasDuplicadas: number;
  }> {
    const { servico, linhas: linhasBrutas, nomeArquivo, usuarioId, substituirPorData, totalLinhasBrutas, abasUsadas, buffer } = opts;
    const datasTodas = [...new Set(
      linhasBrutas
        .map((l) => (l.dataSaida ? l.dataSaida.toISOString().slice(0, 10) : null))
        .filter((d): d is string => !!d),
    )];
    const prep = await prepararDatasImportacaoCiclo(servico.id, datasTodas);
    const permitidasSet = new Set(prep.datas);
    const linhas = linhasBrutas.filter((l) => {
      const d = l.dataSaida ? l.dataSaida.toISOString().slice(0, 10) : null;
      return Boolean(d && permitidasSet.has(d));
    });
    if (linhas.length === 0) {
      return {
        servicoId: servico.id,
        servicoNome: servico.nome,
        tipoSistema: linhasBrutas[0].tipoSistema,
        planilhaUploadId: 0,
        importados: 0,
        quantitativoTotal: 0,
        dias: 0,
        bairros: 0,
        datasApagadas: [],
        uploadsRemovidosIds: [],
        avisosCiclo: prep.avisos.length > 0
          ? prep.avisos
          : ['Nenhuma data do ciclo atual nesta planilha — o ciclo anterior não foi alterado.'],
        datasIgnoradasCicloFechado: prep.bloqueadasFechado,
        ignoradasDuplicadas: 0,
      };
    }

    const resultado = await executarImportacaoAtomica(servico.id, async (manager) => {
    const coletaRepo = manager.getRepository(ColetaData);
    const uploadRepo = manager.getRepository(PlanilhaUpload);
    const servicoRepo = manager.getRepository(Servico);
    const tipoSistema = linhas[0].tipoSistema;
    const datasApagadas: { data: string; registrosRemovidos: number }[] = [];
    if (substituirPorData) {
      const datas = [...new Set(
        linhas
          .map((l) => (l.dataSaida ? l.dataSaida.toISOString().slice(0, 10) : null))
          .filter((d): d is string => !!d),
      )];
      datasApagadas.push(...await apagarDatasDeUploadsAbertos(servico.id, datas, manager));
    }

    const existentes = await carregarChavesProducaoExistentes(servico.id, manager);
    const { novas, ignoradas: ignoradasDuplicadas } = filtrarColetasProducaoNovas(
      linhas,
      (l) => this.montarColeta(l, 0),
      existentes,
    );
    const avisosCiclo = [
      ...prep.avisos,
      ...(ignoradasDuplicadas > 0
        ? [`${ignoradasDuplicadas} linha(s) de "${servico.nome}" já estavam no sistema e não foram importadas de novo.`]
        : []),
    ];
    if (novas.length === 0) {
      const quantitativoTotal = Math.round(linhas.reduce((s, l) => s + l.quantitativo, 0) * 1000) / 1000;
      const dias = new Set(linhas.map((l) => (l.dataSaida ? l.dataSaida.toISOString().slice(0, 10) : null)).filter(Boolean)).size;
      const bairros = new Set(linhas.map((l) => l.local).filter(Boolean)).size;
      return {
        servicoId: servico.id,
        servicoNome: servico.nome,
        tipoSistema,
        planilhaUploadId: 0,
        importados: 0,
        quantitativoTotal,
        dias,
        bairros,
        datasApagadas,
        uploadsRemovidosIds: [],
        avisosCiclo,
        datasIgnoradasCicloFechado: prep.bloqueadasFechado,
        ignoradasDuplicadas,
      };
    }

    const quantitativoTotal = Math.round(novas.reduce((s, c) => {
      const q = Number((c.dados as Record<string, unknown> | null)?.QUANTITATIVO || 0);
      return s + (Number.isFinite(q) ? q : 0);
    }, 0) * 1000) / 1000;
    const dias = new Set(novas.map((c) => (c.dataSaida ? c.dataSaida.toISOString().slice(0, 10) : null)).filter(Boolean)).size;
    const bairros = new Set(novas.map((c) => c.distrito || c.regional).filter(Boolean)).size;

    const upload = uploadRepo.create({
      nomeArquivo,
      totalLinhas: totalLinhasBrutas,
      linhasImportadas: 0,
      linhasComErro: 0,
      linhasIgnoradas: ignoradasDuplicadas,
      linhasSubstituidas: 0,
      linhasConflitantes: 0,
      estrategia: substituirPorData ? 'atualizar_data' : 'ignorar',
      usuarioId: usuarioId || null,
      servico_id: servico.id,
      resumo: null,
    });
    const uploadSalvo = await uploadRepo.save(upload);
    const dataOp = [...new Set(
      novas.map((c) => (c.dataSaida ? c.dataSaida.toISOString().slice(0, 10) : null)).filter((d): d is string => !!d),
    )].sort().pop();
    const urlOriginal = await persistirArquivoOriginalUpload(uploadSalvo.id, buffer, nomeArquivo, dataOp, manager);
    if (urlOriginal) uploadSalvo.urlDownload = urlOriginal;

    const uploadIds = await obterUploadIdsModificaveis(servico.id, manager);

    const batch: ColetaData[] = [];
    let importados = 0;
    const BATCH = 500;
    for (const coleta of novas) {
      coleta.planilhaUploadId = uploadSalvo.id;
      batch.push(coleta);
      importados++;
      if (batch.length >= BATCH) {
        await coletaRepo.save(batch);
        batch.length = 0;
      }
    }
    if (batch.length) await coletaRepo.save(batch);

    const uploadsRemovidosIds: number[] = [];
    for (const oldId of uploadIds) {
      if (oldId === uploadSalvo.id) continue;
      const restantes = await coletaRepo.count({ where: { planilhaUploadId: oldId } });
      if (restantes > 0) continue;
      const old = await uploadRepo.findOne({ where: { id: oldId } });
      if (!old || old.cicloFechadoEm) continue;
      await uploadRepo.remove(old);
      uploadsRemovidosIds.push(oldId);
    }

    uploadSalvo.linhasImportadas = importados;
    uploadSalvo.linhasIgnoradas = ignoradasDuplicadas;
    uploadSalvo.linhasSubstituidas = datasApagadas.reduce((s, d) => s + d.registrosRemovidos, 0);
    uploadSalvo.resumo = {
      novos: importados,
      duplicadosIgnorados: ignoradasDuplicadas,
      conflitantes: 0,
      substituidos: uploadSalvo.linhasSubstituidas,
      viagensValidasDashboard: importados,
      modelo: 'consolidado_producao',
      consolidacao: {
        registrosRemovidosAusentes: 0,
        uploadsRemovidos: uploadsRemovidosIds.length,
        diasRemovidosAusentes: [],
      },
    };
    await uploadRepo.save(uploadSalvo);

    const datasImportadas = [...new Set(
      linhas
        .map((l) => (l.dataSaida ? l.dataSaida.toISOString().slice(0, 10) : null))
        .filter((d): d is string => !!d),
    )];
    const servicoContrato = await servicoRepo.findOne({
      where: { id: servico.id },
      relations: ['contract'],
    });
    await aplicarReferenciaCicloNoUpload(
      uploadSalvo.id,
      datasImportadas,
      normalizarDiaInicioCiclo(servicoContrato?.contract?.diaInicioCiclo),
      manager,
    );

    const colunas = this.colunasPadrao(tipoSistema);
    servico.padraoPlanilha = {
      colunas: colunas.map((nome) => ({
        nome,
        tipo: nome === 'DATA' ? 'data' : /área|area|m²|linear|quantidad|quantitat/i.test(nome) ? 'numero' : 'texto',
        obrigatorio: false,
      })),
      totalLinhas: importados,
      ultimoUpload: uploadSalvo.id,
      ultimoUploadNome: nomeArquivo,
      detectadoEm: new Date().toISOString(),
      modeloPlanilha: 'consolidado_producao',
      abasUsadas,
    } as any;
    await servicoRepo.save(servico);

    try {
      const cfgAtual = servico.configDashboard || {};
      const graficosAtuais = cfgAtual.graficos || [];
      const graficosReResolvidos = graficosAtuais.length > 0
        ? reResolverGraficos(graficosAtuais, colunas)
        : gerarConfigGraficosPadrao(tipoSistema, colunas);
      const kpisAtuais = Array.isArray(cfgAtual.kpis) ? cfgAtual.kpis : [];
      const kpisTemplate = converterKpisParaConfig(tipoSistema);
      const precisaKpis = kpisAtuais.length === 0
        || kpisAtuais.every((k: any) => k.origemTemplate && k.templateTipo && k.templateTipo !== tipoSistema);

      servico.configDashboard = {
        ...cfgAtual,
        graficos: graficosReResolvidos.length > 0
          ? graficosReResolvidos
          : gerarConfigGraficosPadrao(tipoSistema, colunas),
        kpis: precisaKpis ? kpisTemplate : kpisAtuais,
        reResolvidoEm: new Date().toISOString(),
        graficosPadraoAplicados: true,
        kpisTemplateAplicados: precisaKpis || !!cfgAtual.kpisTemplateAplicados,
        unidadeOperacional: tipoSistema,
      };
      await servicoRepo.save(servico);
    } catch (err) {
      console.warn('[ConsolidadoProducao] Erro ao aplicar dashboard do tipo:', err);
    }

    return {
      servicoId: servico.id,
      servicoNome: servico.nome,
      tipoSistema,
      planilhaUploadId: uploadSalvo.id,
      importados,
      quantitativoTotal,
      dias,
      bairros,
      datasApagadas,
      uploadsRemovidosIds,
      avisosCiclo,
      datasIgnoradasCicloFechado: prep.bloqueadasFechado,
      ignoradasDuplicadas,
    };
    });

    invalidarCacheDadosServico(servico.id);
    invalidarCacheDashboardServico(servico.id);
    dashboardCache.invalidar(servico.id);
    agendarWarmupPosUpload(servico.id);
    invalidarCacheSaudeContratos(servico.contract_id);
    void recalcularTotaisDiaServicoSilencioso(servico.id);
    return resultado;
  }

  async importar(
    buffer: Buffer,
    nomeArquivo: string,
    servicoId: string,
    usuarioId?: string,
    substituirPorData = false,
  ): Promise<ResultadoImportConsolidadoProducao> {
    const servico = await this.servicoRepo.findOne({ where: { id: servicoId } });
    if (!servico) throw new Error('Serviço não encontrado.');

    if (!TIPOS_ACEITA_CONSOLIDADO.has(String(servico.tipo))) {
      throw new Error('Layout CONSOLIDADO só é aceito em serviços de via/área (varrição, roçada, poda, remoção, capina ou feiras).');
    }

    const parsed = parsearPlanilhaConsolidadoProducao(buffer);
    if (parsed.linhas.length === 0) {
      throw new Error(parsed.avisos[0] || 'Nenhuma linha válida nas abas de serviço.');
    }

    const irmaos = await this.servicoRepo.find({
      where: { contract_id: servico.contract_id },
    });

    const porAba = agruparLinhasPorServicoAba(parsed.linhas);

    const splitPorServico: ResultadoImportConsolidadoServico[] = [];
    const tiposSemServico: Array<{ tipoSistema: string; registros: number }> = [];
    const avisos = [...parsed.avisos];
    const allDatasApagadas: { data: string; registrosRemovidos: number }[] = [];
    const allUploadsRemovidos: number[] = [];
    const allDatasCicloFechado: string[] = [];
    let importados = 0;
    let ignoradasDuplicadasTotal = 0;
    let primeiroUploadId = 0;

    for (const [, linhasTipo] of porAba) {
      const meta = linhasTipo[0];
      const { servico: alvo, criado } = await garantirServicoNomeadoContrato(
        servico.contract_id,
        meta.nomeServico,
        meta.tipoSistema,
      );
      if (criado && !irmaos.some((s) => s.id === alvo.id)) irmaos.push(alvo);

      avisos.push(`${linhasTipo.length} linha(s) de "${meta.nomeServico}" (aba ${meta.aba}) → serviço "${alvo.nome}".`);

      const r = await this.persistirEmServico({
        servico: alvo,
        linhas: linhasTipo,
        nomeArquivo,
        usuarioId,
        substituirPorData,
        totalLinhasBrutas: parsed.totalLinhasBrutas,
        abasUsadas: [meta.aba],
        buffer,
      });

      splitPorServico.push({
        servicoId: r.servicoId,
        servicoNome: r.servicoNome,
        tipoSistema: r.tipoSistema,
        planilhaUploadId: r.planilhaUploadId,
        importados: r.importados,
        quantitativoTotal: r.quantitativoTotal,
        dias: r.dias,
        bairros: r.bairros,
      });
      importados += r.importados;
      ignoradasDuplicadasTotal += r.ignoradasDuplicadas;
      allDatasApagadas.push(...r.datasApagadas);
      allUploadsRemovidos.push(...r.uploadsRemovidosIds);
      avisos.push(...r.avisosCiclo);
      allDatasCicloFechado.push(...r.datasIgnoradasCicloFechado);
      if (!primeiroUploadId && r.planilhaUploadId) primeiroUploadId = r.planilhaUploadId;
    }

    if (importados === 0 && ignoradasDuplicadasTotal === 0) {
      throw new Error(
        tiposSemServico.length
          ? `Nenhum serviço do contrato corresponde às abas da planilha (${tiposSemServico.map((t) => t.tipoSistema).join(', ')}).`
          : 'Nenhuma linha importada das abas de serviço.',
      );
    }
    if (importados === 0 && ignoradasDuplicadasTotal > 0) {
      avisos.unshift(
        `Nenhum registro novo: ${ignoradasDuplicadasTotal} linha(s) já estavam no sistema e não foram importadas de novo.`,
      );
    }

    const ignorados = parsed.linhas.length - importados + parsed.linhasSemTipo + parsed.linhasSemData;

    return {
      modo: 'consolidado_producao',
      modelo: 'consolidado_producao',
      planilhaUploadId: primeiroUploadId,
      totalLinhas: parsed.totalLinhasBrutas,
      importados,
      ignorados,
      abasUsadas: parsed.abasUsadas,
      avisos,
      porTipo: parsed.porTipo,
      splitPorServico,
      tiposSemServico,
      datasApagadas: allDatasApagadas,
      datasIgnoradasCicloFechado: [...new Set(allDatasCicloFechado)],
      consolidacao: {
        uploadsRemovidos: allUploadsRemovidos.length,
        uploadsRemovidosIds: allUploadsRemovidos,
      },
      viagensValidasDashboard: importados,
      viagensInconsistentes: 0,
    };
  }

  async importarPorContrato(
    buffer: Buffer,
    nomeArquivo: string,
    contractId: string,
    usuarioId?: string,
    substituirPorData = false,
  ): Promise<ResultadoImportConsolidadoProducao & { servicosGarantidos?: number }> {
    if (!detectarPlanilhaConsolidadoProducao(buffer)) {
      throw new Error(
        'Planilha sem CONSOLIDADO/abas de serviço (Tabela* / Roçada / Poda / Remoção / Feiras).',
      );
    }

    const parsed = parsearPlanilhaConsolidadoProducao(buffer);
    if (parsed.linhas.length === 0) {
      throw new Error(parsed.avisos[0] || 'Nenhuma linha válida nas abas de serviço.');
    }
    const primeiro = agruparLinhasPorServicoAba(parsed.linhas).values().next().value?.[0];
    if (!primeiro) {
      throw new Error('Nenhuma linha válida nas abas de serviço.');
    }

    const { servico: entrada } = await garantirServicoNomeadoContrato(
      contractId,
      primeiro.nomeServico,
      primeiro.tipoSistema,
    );

    const resultado = await this.importar(
      buffer,
      nomeArquivo,
      entrada.id,
      usuarioId,
      substituirPorData,
    );

    const criadosNaPlanilha = resultado.splitPorServico.length;
    resultado.avisos = [
      `${criadosNaPlanilha} serviço(s) saíram desta planilha, com KPI do próprio tipo.`,
      ...resultado.avisos,
    ];

    return { ...resultado, servicosGarantidos: criadosNaPlanilha };
  }
}

export default new ConsolidadoProducaoImportService();
