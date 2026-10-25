/**
 * Importação do layout unificado (roçada/capina/varrição/poda numa aba).
 * Pipeline separado — não altera RocadaImportService nem rocadaPlanilhaParser.
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
import {
  garantirServicosPadraoContrato,
  TIPOS_SERVICO_PADRAO_UNIFICADO,
} from './servicosPadraoContratoService';
import {
  detectarPlanilhaServicosUnificados,
  parsearPlanilhaServicosUnificados,
  resumoParseServicosUnificados,
  TIPOS_ACEITA_UNIFICADO,
  type LinhaServicoUnificado,
  type ResultadoParseServicosUnificados,
  type TipoServicoUnificado,
} from './servicosUnificadosPlanilhaParser';
import { persistirArquivoOriginalUpload } from './planilhaOriginalStorage';
import { carregarChavesProducaoExistentes, filtrarColetasProducaoNovas } from './producaoDedupService';
import { executarImportacaoAtomica } from './substituicaoImportacaoProducao';

export interface ResultadoImportUnificadoServico {
  servicoId: string;
  servicoNome: string;
  tipoSistema: TipoServicoUnificado;
  planilhaUploadId: number;
  importados: number;
  quantitativoTotal: number;
  dias: number;
  bairros: number;
}

export interface ResultadoImportServicosUnificados {
  modo: 'servicos_unificados';
  modelo: 'servicos_unificados';
  planilhaUploadId: number;
  totalLinhas: number;
  importados: number;
  ignorados: number;
  abasUsadas: string[];
  avisos: string[];
  porTipo: ResultadoParseServicosUnificados['porTipo'];
  splitPorServico: ResultadoImportUnificadoServico[];
  tiposSemServico: Array<{ tipoSistema: string; registros: number }>;
  datasApagadas: { data: string; registrosRemovidos: number }[];
  datasIgnoradasCicloFechado?: string[];
  consolidacao?: { uploadsRemovidos: number; uploadsRemovidosIds: number[] };
  viagensValidasDashboard: number;
  viagensInconsistentes: number;
}

class ServicosUnificadosImportService {
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
    return detectarPlanilhaServicosUnificados(buffer);
  }

  preview(buffer: Buffer) {
    const parsed = parsearPlanilhaServicosUnificados(buffer);
    return { ...parsed, resumo: resumoParseServicosUnificados(parsed) };
  }

  private trunc(v: string | null | undefined, max: number): string | null {
    if (v == null) return null;
    const s = String(v).trim();
    if (!s) return null;
    return s.length > max ? s.slice(0, max) : s;
  }

  private montarColeta(linha: LinhaServicoUnificado, uploadId: number): ColetaData {
    const coleta = new ColetaData();
    coleta.planilhaUploadId = uploadId;
    coleta.dataSaida = linha.dataSaida;
    const local = linha.bairro || linha.logradouro || null;
    const distritoCheio = linha.logradouro || local;
    coleta.regional = this.trunc(local, 50);
    coleta.distrito = this.trunc(distritoCheio, 50);
    coleta.motorista = this.trunc(linha.operador, 100);
    coleta.tipoCaminhao = this.trunc(linha.equipamento, 30);
    coleta.turno = this.trunc(linha.equipe, 20);
    coleta.placa = null;
    coleta.pesoTotal = null;
    // Capina/varrição em km: espelha em kmTotal para dashboards genéricos
    const km = Number(linha.dados['KM Linear'] ?? linha.dados.KM_LINEAR ?? 0);
    coleta.kmTotal = km > 0 ? km : null;
    coleta.numeroViagens = 1;
    coleta.viagensPorRota = 1;
    coleta.validoDashboard = true;
    coleta.motivosInconsistencia = null;
    coleta.dados = {
      ...linha.dados,
      ...(distritoCheio && distritoCheio.length > 50 ? { DISTRITO_COMPLETO: distritoCheio } : {}),
      ...(local && local.length > 50 ? { LOCAL_COMPLETO: local } : {}),
    };
    if (linha.dataSaida) {
      coleta.diaSemana = linha.dataSaida.getUTCDay() + 1;
    }
    return coleta;
  }

  private colunasPadrao(tipo: TipoServicoUnificado): string[] {
    const base = ['DATA', 'Dia', 'BAIRRO', 'Setor', 'LOGRADOURO', 'Avenida / Rua', 'Equipe', 'Operador', 'Funcionario', 'QUANTITATIVO', 'UND', 'TIPO DE SERVIÇO'];
    switch (tipo) {
      case TipoServico.ROCADEIRA:
        return [...base, 'Area m²', 'AREA_M2', 'Equipamento', 'TIPO'];
      case TipoServico.CAPINA:
        return [...base, 'Metro Linear', 'METRO_LINEAR', 'KM Linear', 'KM_LINEAR', 'COMPRIMENTO'];
      case TipoServico.VARRICAO:
        return [...base, 'KM Linear', 'KM_LINEAR', 'QUILOMETROS_VARRIDOS'];
      case TipoServico.PODA:
        return [...base, 'Quantidade de Arvore', 'QTD_ARVORE', 'Tipo de serviço'];
      default:
        return base;
    }
  }

  private async persistirEmServico(opts: {
    servico: Servico;
    linhas: LinhaServicoUnificado[];
    nomeArquivo: string;
    usuarioId?: string;
    substituirPorData: boolean;
    totalLinhasBrutas: number;
    abasUsadas: string[];
    buffer: Buffer;
  }): Promise<ResultadoImportUnificadoServico & {
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
      const bairros = new Set(linhas.map((l) => l.bairro).filter(Boolean)).size;
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
      modelo: 'servicos_unificados',
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
      modeloPlanilha: 'servicos_unificados',
      abasUsadas,
    } as any;
    await servicoRepo.save(servico);

    try {
      const colunasNomes = colunas;
      const cfgAtual = servico.configDashboard || {};
      const graficosAtuais = cfgAtual.graficos || [];
      // Reaplica gráficos do tipo com as colunas reais da planilha unificada
      const graficosReResolvidos = graficosAtuais.length > 0
        ? reResolverGraficos(graficosAtuais, colunasNomes)
        : gerarConfigGraficosPadrao(tipoSistema, colunasNomes);

      // Garante KPIs do template do tipo (unidade correta: m² / km / m / árvores)
      const kpisAtuais = Array.isArray(cfgAtual.kpis) ? cfgAtual.kpis : [];
      const kpisTemplate = converterKpisParaConfig(tipoSistema);
      const precisaKpis = kpisAtuais.length === 0
        || kpisAtuais.every((k: any) => k.origemTemplate && k.templateTipo && k.templateTipo !== tipoSistema)
        || !kpisAtuais.some((k: any) =>
          /Area m²|Metro Linear|KM Linear|Quantidade de Arvore/i.test(String(k.expressao || '')),
        );

      servico.configDashboard = {
        ...cfgAtual,
        graficos: graficosReResolvidos.length > 0
          ? graficosReResolvidos
          : gerarConfigGraficosPadrao(tipoSistema, colunasNomes),
        kpis: precisaKpis ? kpisTemplate : kpisAtuais,
        reResolvidoEm: new Date().toISOString(),
        graficosPadraoAplicados: true,
        kpisTemplateAplicados: precisaKpis || !!cfgAtual.kpisTemplateAplicados,
        unidadeOperacional: tipoSistema,
      };
      await servicoRepo.save(servico);
    } catch (err) {
      console.warn('[ServicosUnificados] Erro ao aplicar dashboard do tipo:', err);
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

  /**
   * Resolve o serviço cadastrado no contrato para o TIPO DE SERVIÇO da linha.
   * Ex.: CAPINA → serviço tipo=capina; ROÇADA → tipo=rocadeira.
   * Se houver vários do mesmo tipo, prioriza o serviço de onde partiu o upload;
   * senão o primeiro do tipo (split Manual/Mecanizada continua só no fluxo legado de roçada).
   */
  private resolverAlvoPorTipo(
    servicoAtual: Servico,
    tipo: TipoServicoUnificado,
    irmaos: Servico[],
  ): Servico | null {
    const candidatos = irmaos.filter((s) => s.tipo === tipo || String(s.tipo) === tipo);
    if (candidatos.length === 0) return null;

    // Upload feito no próprio serviço do tipo → usa ele
    if (servicoAtual.tipo === tipo || String(servicoAtual.tipo) === tipo) {
      return candidatos.find((s) => s.id === servicoAtual.id) || candidatos[0];
    }

    // Preferir nome que mencione o tipo (ex.: "Capina Betim", "Roçada Manual")
    const chave = String(tipo)
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    const porNome = candidatos.find((s) => {
      const n = String(s.nome || '')
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      if (chave === 'ROCADEIRA') return n.includes('ROCAD') || n.includes('ROCADEIR');
      if (chave === 'VARRICAO') return n.includes('VARRIC') || n.includes('VARRED');
      return n.includes(chave);
    });
    return porNome || candidatos[0];
  }

  async importar(
    buffer: Buffer,
    nomeArquivo: string,
    servicoId: string,
    usuarioId?: string,
    substituirPorData = false,
  ): Promise<ResultadoImportServicosUnificados> {
    const servico = await this.servicoRepo.findOne({ where: { id: servicoId } });
    if (!servico) throw new Error('Serviço não encontrado.');

    if (!TIPOS_ACEITA_UNIFICADO.has(String(servico.tipo))) {
      throw new Error('Layout unificado só é aceito em serviços de roçada, capina, varrição, poda ou geral.');
    }

    const parsed = parsearPlanilhaServicosUnificados(buffer);
    if (parsed.linhas.length === 0) {
      throw new Error(parsed.avisos[0] || 'Nenhuma linha válida no layout unificado.');
    }

    const irmaos = await this.servicoRepo.find({
      where: { contract_id: servico.contract_id },
    });

    const porTipoMap = new Map<TipoServicoUnificado, LinhaServicoUnificado[]>();
    for (const l of parsed.linhas) {
      const arr = porTipoMap.get(l.tipoSistema) || [];
      arr.push(l);
      porTipoMap.set(l.tipoSistema, arr);
    }

    const splitPorServico: ResultadoImportUnificadoServico[] = [];
    const tiposSemServico: Array<{ tipoSistema: string; registros: number }> = [];
    const avisos = [...parsed.avisos];
    const allDatasApagadas: { data: string; registrosRemovidos: number }[] = [];
    const allUploadsRemovidos: number[] = [];
    const allDatasCicloFechado: string[] = [];
    let importados = 0;
    let ignoradasDuplicadasTotal = 0;
    let primeiroUploadId = 0;

    const tiposDisponiveisNoContrato = [...new Set(
      irmaos
        .filter((s) => TIPOS_ACEITA_UNIFICADO.has(String(s.tipo)))
        .map((s) => `${s.nome} (${s.tipo})`),
    )];

    for (const [tipo, linhasTipo] of porTipoMap) {
      const alvo = this.resolverAlvoPorTipo(servico, tipo, irmaos);
      if (!alvo) {
        tiposSemServico.push({ tipoSistema: tipo, registros: linhasTipo.length });
        avisos.push(
          `${linhasTipo.length} registro(s) de "${tipo}" na CONSOLIDADO sem serviço desse tipo no contrato — ignorados.`
          + (tiposDisponiveisNoContrato.length
            ? ` Serviços disponíveis: ${tiposDisponiveisNoContrato.join(', ')}.`
            : ' Cadastre no contrato um serviço com esse tipo.'),
        );
        continue;
      }

      if (tipo === TipoServico.ROCADEIRA) {
        const qtdRocada = irmaos.filter((s) => s.tipo === TipoServico.ROCADEIRA || s.tipo === 'rocadeira').length;
        if (qtdRocada > 1) {
          avisos.push(
            `ROÇADA → "${alvo.nome}". Há ${qtdRocada} serviços de roçada; `
            + 'para separar Manual/Mecanizada use o upload tradicional de roçada.',
          );
        }
      }

      avisos.push(
        `${linhasTipo.length} linha(s) de ${tipo} → serviço "${alvo.nome}".`,
      );

      const r = await this.persistirEmServico({
        servico: alvo,
        linhas: linhasTipo,
        nomeArquivo,
        usuarioId,
        substituirPorData,
        totalLinhasBrutas: parsed.totalLinhasBrutas,
        abasUsadas: parsed.abasUsadas,
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
          ? `Nenhum serviço do contrato corresponde aos tipos da aba CONSOLIDADO (${tiposSemServico.map((t) => t.tipoSistema).join(', ')}). `
            + 'Cadastre serviços de roçada/capina/varrição/poda no contrato e envie de novo.'
          : 'Nenhuma linha importada da aba CONSOLIDADO.',
      );
    }
    if (importados === 0 && ignoradasDuplicadasTotal > 0) {
      avisos.unshift(
        `Nenhum registro novo: ${ignoradasDuplicadasTotal} linha(s) já estavam no sistema e não foram importadas de novo.`,
      );
    }

    const ignorados = parsed.linhas.length - importados + parsed.linhasSemQuantitativo + parsed.linhasTipoDesconhecido;

    return {
      modo: 'servicos_unificados',
      modelo: 'servicos_unificados',
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

  /**
   * Upload no nível do contrato: garante os 4 serviços padrão e distribui a CONSOLIDADO.
   */
  async importarPorContrato(
    buffer: Buffer,
    nomeArquivo: string,
    contractId: string,
    usuarioId?: string,
    substituirPorData = false,
  ): Promise<ResultadoImportServicosUnificados & { servicosGarantidos?: number }> {
    if (!detectarPlanilhaServicosUnificados(buffer)) {
      throw new Error(
        'Planilha sem layout unificado (DATA, UND, QUANTITATIVO, TIPO DE SERVIÇO) em nenhuma aba.',
      );
    }

    const { servicos, criados } = await garantirServicosPadraoContrato(contractId);
    const entrada = servicos.find((s) =>
      TIPOS_SERVICO_PADRAO_UNIFICADO.includes(s.tipo as typeof TIPOS_SERVICO_PADRAO_UNIFICADO[number]),
    ) || servicos[0];

    if (!entrada) {
      throw new Error('Não foi possível criar/localizar serviços padrão no contrato.');
    }

    const resultado = await this.importar(
      buffer,
      nomeArquivo,
      entrada.id,
      usuarioId,
      substituirPorData,
    );

    if (criados.length > 0) {
      resultado.avisos = [
        `${criados.length} serviço(s) padrão criado(s) neste upload.`,
        ...resultado.avisos,
      ];
    }

    return { ...resultado, servicosGarantidos: criados.length };
  }
}

export default new ServicosUnificadosImportService();
