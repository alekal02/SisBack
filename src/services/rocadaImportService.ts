/**
 * Importação de planilhas de roçada (multi-modelo) → coleta_dados.
 * Não usa validação de viagem (placa/km/peso).
 *
 * Planilha Manual+Mecanizada:
 * - 1 serviço único → importa os dois tipos no mesmo dashboard
 * - 2 serviços (Manual + Mecanizada) no contrato → 1 upload distribui para ambos
 */
import { Repository } from 'typeorm';
import AppDataSource from '../database/data-source';
import { ColetaData } from '../entities/ColetaData';
import { PlanilhaUpload } from '../entities/PlanilhaUpload';
import { Servico } from '../entities/Servico';
import { TipoServico } from '../enums/TipoServico';
import {
  parsearPlanilhaRocada,
  resumoParseRocada,
  type LinhaRocadaCanonico,
  type ResultadoParseRocada,
} from './rocadaPlanilhaParser';
import { inferirFiltroExecucaoServico } from '../utils/rocadaTipoExecucao';
import {
  obterUploadIdsModificaveis,
  aplicarReferenciaCicloNoUpload,
  apagarDatasDeUploadsAbertos,
  prepararDatasImportacaoCiclo,
} from './cicloPlanilhaService';
import { normalizarDiaInicioCiclo } from '../utils/periodoCicloContrato';
import { invalidarCacheDadosServico } from './servicoDadosCache';
import { invalidarCacheDashboardServico } from '../controllers/ServicoController';
import { recalcularTotaisDiaServicoSilencioso } from './coletaTotaisDiaService';
import { invalidarCacheSaudeContratos } from '../controllers/ContractController';
import { dashboardCache } from './DashboardCacheManager';
import { agendarWarmupPosUpload } from './executivoCacheWarmupService';
import { persistirArquivoOriginalUpload } from './planilhaOriginalStorage';
import { carregarChavesProducaoExistentes, filtrarColetasProducaoNovas } from './producaoDedupService';
import { executarImportacaoAtomica } from './substituicaoImportacaoProducao';

export interface ResultadoImportRocadaServico {
  servicoId: string;
  servicoNome: string;
  filtroTipo: 'manual' | 'mecanizada' | null;
  planilhaUploadId: number;
  importados: number;
  areaTotalM2: number;
  dias: number;
  bairros: number;
}

export interface ResultadoImportRocada {
  planilhaUploadId: number;
  totalLinhas: number;
  importados: number;
  ignorados: number;
  modelo: string;
  abasUsadas: string[];
  areaTotalM2: number;
  dias: number;
  bairros: number;
  avisos: string[];
  datasApagadas: { data: string; registrosRemovidos: number }[];
  consolidacao?: {
    uploadsRemovidos: number;
    uploadsRemovidosIds: number[];
  };
  modo: 'rocada';
  viagensValidasDashboard: number;
  viagensInconsistentes: number;
  filtroTipoExecucao?: 'manual' | 'mecanizada' | null;
  porTipoExecucao?: ResultadoParseRocada['porTipoExecucao'];
  /** Quando o upload preencheu Manual e Mecanizada em serviços distintos */
  splitPorServico?: ResultadoImportRocadaServico[];
}

type ConfigFat = {
  valorM2Manual?: number | null;
  valorM2Mecanizada?: number | null;
  valorM2?: number | null;
} | null;

class RocadaImportService {
  private get coletaRepo(): Repository<ColetaData> {
    return AppDataSource.getRepository(ColetaData);
  }
  private get uploadRepo(): Repository<PlanilhaUpload> {
    return AppDataSource.getRepository(PlanilhaUpload);
  }
  private get servicoRepo(): Repository<Servico> {
    return AppDataSource.getRepository(Servico);
  }

  preview(
    buffer: Buffer,
    opts?: { filtroTipo?: 'manual' | 'mecanizada' | null },
  ): ResultadoParseRocada & { resumo: ReturnType<typeof resumoParseRocada> } {
    const parsed = parsearPlanilhaRocada(buffer, opts);
    return { ...parsed, resumo: resumoParseRocada(parsed) };
  }

  /** Limites das colunas varchar em coleta_dados (QGIS traz textos longos). */
  private trunc(v: string | null | undefined, max: number): string | null {
    if (v == null) return null;
    const s = String(v).trim();
    if (!s) return null;
    return s.length > max ? s.slice(0, max) : s;
  }

  private montarColeta(linha: LinhaRocadaCanonico, uploadId: number): ColetaData {
    const coleta = new ColetaData();
    coleta.planilhaUploadId = uploadId;
    coleta.dataSaida = linha.dataSaida;
    // Local principal: bairro → trecho → logradouro (cada modelo usa um)
    const local = linha.bairro || (linha.dados?.TRECHO as string) || linha.logradouro || null;
    const distritoCheio = linha.distrito || linha.logradouro || local;
    coleta.regional = this.trunc(local, 50);
    coleta.distrito = this.trunc(distritoCheio, 50);
    coleta.motorista = this.trunc(linha.operador, 100);
    coleta.tipoCaminhao = this.trunc(linha.equipamento || (linha.tipo !== 'ROÇADA' ? linha.tipo : null), 30);
    coleta.turno = this.trunc(linha.equipe || (linha.dados?.PERIODICIDADE as string) || null, 20);
    coleta.placa = null;
    coleta.pesoTotal = null;
    coleta.kmTotal = null;
    coleta.numeroViagens = 1;
    coleta.viagensPorRota = 1;
    coleta.validoDashboard = true;
    coleta.motivosInconsistencia = null;
    coleta.dados = {
      ...linha.dados,
      BAIRRO: linha.bairro || local,
      LOGRADOURO: linha.logradouro,
      LOCAL: local,
      Equipamento: linha.equipamento,
      EQUIPAMENTO: linha.equipamento,
      Operador: linha.operador,
      OPERADOR: linha.operador,
      Equipe: linha.equipe,
      EQUIPE: linha.equipe,
      TIPO: linha.tipo,
      TIPO_EXECUCAO: linha.tipoExecucao,
      _tipoServico: 'rocadeira',
      _modeloPlanilha: linha.modelo,
      _aba: linha.aba,
      _tipoExecucao: linha.tipoExecucao,
      ...(distritoCheio && distritoCheio.length > 50 ? { DISTRITO_COMPLETO: distritoCheio } : {}),
      ...(local && local.length > 50 ? { LOCAL_COMPLETO: local } : {}),
    };
    if (linha.dataSaida) {
      coleta.diaSemana = linha.dataSaida.getUTCDay() + 1;
    }
    return coleta;
  }

  private filtroDoServico(servico: Servico): 'manual' | 'mecanizada' | null {
    return inferirFiltroExecucaoServico(servico.nome, servico.configFaturamento as ConfigFat);
  }

  private resumoLinhas(linhas: LinhaRocadaCanonico[]) {
    const areaTotalM2 = Math.round(linhas.reduce((s, l) => s + l.areaM2, 0) * 100) / 100;
    const dias = new Set(
      linhas.map((l) => (l.dataSaida ? l.dataSaida.toISOString().slice(0, 10) : null)).filter(Boolean),
    ).size;
    const bairros = new Set(linhas.map((l) => l.bairro).filter(Boolean)).size;
    return { areaTotalM2, dias, bairros };
  }

  private async persistirLinhasEmServico(opts: {
    servico: Servico;
    linhas: LinhaRocadaCanonico[];
    nomeArquivo: string;
    usuarioId?: string;
    substituirPorData: boolean;
    parsedMeta: Pick<ResultadoParseRocada, 'modelo' | 'abasUsadas' | 'totalLinhasBrutas'>;
    filtroTipo: 'manual' | 'mecanizada' | null;
    buffer: Buffer;
  }): Promise<ResultadoImportRocadaServico & {
    datasApagadas: { data: string; registrosRemovidos: number }[];
    uploadsRemovidosIds: number[];
    avisosCiclo: string[];
    ignoradasDuplicadas: number;
  }> {
    const { servico, linhas: linhasBrutas, nomeArquivo, usuarioId, substituirPorData, parsedMeta, filtroTipo, buffer } = opts;
    const servicoId = servico.id;
    const datasTodas = [...new Set(
      linhasBrutas
        .map((l) => (l.dataSaida ? l.dataSaida.toISOString().slice(0, 10) : null))
        .filter((d): d is string => !!d),
    )];
    const prep = await prepararDatasImportacaoCiclo(servicoId, datasTodas);
    const permitidasSet = new Set(prep.datas);
    const linhas = linhasBrutas.filter((l) => {
      const d = l.dataSaida ? l.dataSaida.toISOString().slice(0, 10) : null;
      return Boolean(d && permitidasSet.has(d));
    });
    if (linhas.length === 0) {
      throw new Error(
        prep.avisos.join(' ')
          || 'Nenhuma data do ciclo atual nesta planilha — o ciclo anterior não foi alterado.',
      );
    }
    const resultado = await executarImportacaoAtomica(servicoId, async (manager) => {
    const coletaRepo = manager.getRepository(ColetaData);
    const uploadRepo = manager.getRepository(PlanilhaUpload);
    const servicoRepo = manager.getRepository(Servico);
    const datasApagadas: { data: string; registrosRemovidos: number }[] = [];
    if (substituirPorData) {
      const datas = [...new Set(
        linhas
          .map((l) => (l.dataSaida ? l.dataSaida.toISOString().slice(0, 10) : null))
          .filter((d): d is string => !!d),
      )];
      datasApagadas.push(...await apagarDatasDeUploadsAbertos(servicoId, datas, manager));
    }

    const existentes = await carregarChavesProducaoExistentes(servicoId, manager);
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
      const resumoL = this.resumoLinhas(linhas);
      return {
        servicoId,
        servicoNome: servico.nome,
        filtroTipo,
        planilhaUploadId: 0,
        importados: 0,
        areaTotalM2: resumoL.areaTotalM2,
        dias: resumoL.dias,
        bairros: resumoL.bairros,
        datasApagadas,
        uploadsRemovidosIds: [],
        avisosCiclo,
        ignoradasDuplicadas,
      };
    }

    const resumoL = {
      areaTotalM2: Math.round(novas.reduce((s, c) => {
        const d = (c.dados || {}) as Record<string, unknown>;
        const n = Number(d.AREA_M2 ?? d.QUANTITATIVO ?? 0);
        return s + (Number.isFinite(n) ? n : 0);
      }, 0) * 100) / 100,
      dias: new Set(novas.map((c) => (c.dataSaida ? c.dataSaida.toISOString().slice(0, 10) : null)).filter(Boolean)).size,
      bairros: new Set(novas.map((c) => c.regional || c.distrito).filter(Boolean)).size,
    };

    const upload = uploadRepo.create({
      nomeArquivo,
      totalLinhas: parsedMeta.totalLinhasBrutas,
      linhasImportadas: 0,
      linhasComErro: 0,
      linhasIgnoradas: ignoradasDuplicadas,
      linhasSubstituidas: 0,
      linhasConflitantes: 0,
      estrategia: substituirPorData ? 'atualizar_data' : 'ignorar',
      usuarioId: usuarioId || null,
      servico_id: servicoId,
      resumo: null,
    });
    const uploadSalvo = await uploadRepo.save(upload);
    const dataOp = [...new Set(
      novas.map((c) => (c.dataSaida ? c.dataSaida.toISOString().slice(0, 10) : null)).filter((d): d is string => !!d),
    )].sort().pop();
    const urlOriginal = await persistirArquivoOriginalUpload(uploadSalvo.id, buffer, nomeArquivo, dataOp, manager);
    if (urlOriginal) uploadSalvo.urlDownload = urlOriginal;

    const uploadIds = await obterUploadIdsModificaveis(servicoId, manager);

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
      where: { id: servicoId },
      relations: ['contract'],
    });
    await aplicarReferenciaCicloNoUpload(
      uploadSalvo.id,
      datasImportadas,
      normalizarDiaInicioCiclo(servicoContrato?.contract?.diaInicioCiclo),
      manager,
    );

    const colunasCanonicas = [
      'DATA', 'BAIRRO', 'Area m²', 'Equipamento', 'Operador', 'Equipe', 'LOGRADOURO', 'TIPO',
    ];
    servico.padraoPlanilha = {
      colunas: colunasCanonicas.map((nome) => ({
        nome,
        tipo: nome === 'DATA' ? 'data' : nome === 'Area m²' ? 'numero' : 'texto',
        obrigatorio: ['BAIRRO', 'Area m²'].includes(nome),
      })),
      totalLinhas: importados,
      ultimoUpload: uploadSalvo.id,
      ultimoUploadNome: nomeArquivo,
      detectadoEm: new Date().toISOString(),
      modeloRocada: parsedMeta.modelo,
      abasUsadas: parsedMeta.abasUsadas,
      filtroTipoExecucao: filtroTipo,
    } as any;
    await servicoRepo.save(servico);

    return {
      servicoId,
      servicoNome: servico.nome,
      filtroTipo,
      planilhaUploadId: uploadSalvo.id,
      importados,
      areaTotalM2: resumoL.areaTotalM2,
      dias: resumoL.dias,
      bairros: resumoL.bairros,
      datasApagadas,
      uploadsRemovidosIds,
      avisosCiclo,
      ignoradasDuplicadas,
    };
    });

    invalidarCacheDadosServico(servicoId);
    invalidarCacheDashboardServico(servicoId);
    dashboardCache.invalidar(servicoId);
    agendarWarmupPosUpload(servicoId);
    invalidarCacheSaudeContratos(servico.contract_id);
    void recalcularTotaisDiaServicoSilencioso(servicoId);
    return resultado;
  }

  /**
   * No mesmo contrato, localiza o par Manual + Mecanizada (por nome/tarifas).
   * Retorna null se não houver o par — aí importa tudo no serviço atual.
   */
  private async resolverAlvosSplit(
    servicoAtual: Servico,
  ): Promise<{ manual: Servico; mecanizada: Servico } | null> {
    const irmaos = await this.servicoRepo.find({
      where: { contract_id: servicoAtual.contract_id },
    });
    const lista = irmaos.filter(
      (s) => s.tipo === TipoServico.ROCADEIRA || s.tipo === 'rocadeira',
    );

    let manual: Servico | undefined;
    let mecanizada: Servico | undefined;
    for (const s of lista) {
      const f = this.filtroDoServico(s);
      if (f === 'manual' && !manual) manual = s;
      if (f === 'mecanizada' && !mecanizada) mecanizada = s;
    }
    if (manual && mecanizada && manual.id !== mecanizada.id) {
      return { manual, mecanizada };
    }
    return null;
  }

  async importar(
    buffer: Buffer,
    nomeArquivo: string,
    servicoId: string,
    usuarioId?: string,
    substituirPorData = false,
  ): Promise<ResultadoImportRocada> {
    const servico = await this.servicoRepo.findOne({ where: { id: servicoId } });
    if (!servico) {
      throw new Error('Serviço não encontrado.');
    }

    // Sempre parseia a planilha inteira (Manual + Mecanizada)
    const parsed = parsearPlanilhaRocada(buffer);
    const resumoCompleto = resumoParseRocada(parsed);
    const porTipo = parsed.porTipoExecucao;

    if (!resumoCompleto.podeImportar || parsed.linhas.length === 0 || resumoCompleto.areaTotalM2 <= 0) {
      if (parsed.semColunaArea) {
        throw new Error(
          'Planilha de roçada sem coluna de metragem/área (m²). '
          + 'Inclua METRAGEM, TOTAL (M²), Área ou EXECUTADO e envie novamente.',
        );
      }
      if (parsed.linhasSemArea > 0) {
        throw new Error(
          `Nenhuma linha com m²/área válida. ${parsed.linhasSemArea} linha(s) sem metragem foram encontradas. `
          + 'Preencha a área (m²) nas linhas e envie novamente.',
        );
      }
      throw new Error(
        parsed.avisos[0]
        || 'Nenhuma linha de roçada válida encontrada na planilha.',
      );
    }

    const meta = {
      modelo: parsed.modelo,
      abasUsadas: parsed.abasUsadas,
      totalLinhasBrutas: parsed.totalLinhasBrutas,
    };

    const alvos = await this.resolverAlvosSplit(servico);
    const temAmbosTiposNaPlanilha =
      (porTipo?.manual?.registros || 0) > 0 && (porTipo?.mecanizada?.registros || 0) > 0;

    // Par Manual + Mecanizada no contrato e planilha com os dois tipos → 1 upload preenche os 2 dashboards
    if (alvos && temAmbosTiposNaPlanilha) {
      const linhasMan = parsed.linhas.filter((l) => l.tipoExecucao === 'manual');
      const linhasMec = parsed.linhas.filter((l) => l.tipoExecucao === 'mecanizada');
      if (linhasMan.length === 0 || linhasMec.length === 0) {
        // fallback: importa tudo no serviço atual
      } else {
        const rMan = await this.persistirLinhasEmServico({
          servico: alvos.manual,
          linhas: linhasMan,
          nomeArquivo,
          usuarioId,
          substituirPorData,
          parsedMeta: meta,
          filtroTipo: 'manual',
          buffer,
        });
        const rMec = await this.persistirLinhasEmServico({
          servico: alvos.mecanizada,
          linhas: linhasMec,
          nomeArquivo,
          usuarioId,
          substituirPorData,
          parsedMeta: meta,
          filtroTipo: 'mecanizada',
          buffer,
        });

        const splitPorServico: ResultadoImportRocadaServico[] = [
          {
            servicoId: rMan.servicoId,
            servicoNome: rMan.servicoNome,
            filtroTipo: 'manual',
            planilhaUploadId: rMan.planilhaUploadId,
            importados: rMan.importados,
            areaTotalM2: rMan.areaTotalM2,
            dias: rMan.dias,
            bairros: rMan.bairros,
          },
          {
            servicoId: rMec.servicoId,
            servicoNome: rMec.servicoNome,
            filtroTipo: 'mecanizada',
            planilhaUploadId: rMec.planilhaUploadId,
            importados: rMec.importados,
            areaTotalM2: rMec.areaTotalM2,
            dias: rMec.dias,
            bairros: rMec.bairros,
          },
        ];

        const importados = rMan.importados + rMec.importados;
        const principal = servicoId === alvos.manual.id ? rMan : rMec;
        const avisos = [
          ...parsed.avisos,
          ...rMan.avisosCiclo,
          ...rMec.avisosCiclo,
          `Upload distribuído: Manual → "${alvos.manual.nome}" (${rMan.importados} reg., `
            + `${rMan.areaTotalM2.toLocaleString('pt-BR')} m²); `
            + `Mecanizada → "${alvos.mecanizada.nome}" (${rMec.importados} reg., `
            + `${rMec.areaTotalM2.toLocaleString('pt-BR')} m²).`,
        ];

        return {
          planilhaUploadId: principal.planilhaUploadId,
          totalLinhas: parsed.totalLinhasBrutas,
          importados,
          ignorados: Math.max(0, parsed.totalLinhasBrutas - importados),
          modelo: parsed.modelo,
          abasUsadas: parsed.abasUsadas,
          areaTotalM2: resumoCompleto.areaTotalM2,
          dias: resumoCompleto.dias,
          bairros: resumoCompleto.bairros,
          avisos,
          datasApagadas: [...rMan.datasApagadas, ...rMec.datasApagadas],
          consolidacao: {
            uploadsRemovidos: rMan.uploadsRemovidosIds.length + rMec.uploadsRemovidosIds.length,
            uploadsRemovidosIds: [...rMan.uploadsRemovidosIds, ...rMec.uploadsRemovidosIds],
          },
          modo: 'rocada',
          viagensValidasDashboard: importados,
          viagensInconsistentes: 0,
          filtroTipoExecucao: null,
          porTipoExecucao: porTipo,
          splitPorServico,
        };
      }
    }

    // Serviço único (ou sem par): importa Manual + Mecanizada no dashboard deste serviço
    const filtroTipo = null;
    const r = await this.persistirLinhasEmServico({
      servico,
      linhas: parsed.linhas,
      nomeArquivo,
      usuarioId,
      substituirPorData,
      parsedMeta: meta,
      filtroTipo,
      buffer,
    });

    const avisos = [...parsed.avisos, ...r.avisosCiclo];
    if (temAmbosTiposNaPlanilha) {
      avisos.push(
        `Dashboard atualizado com Manual (${porTipo.manual.registros} reg., `
          + `${porTipo.manual.areaM2.toLocaleString('pt-BR')} m²) e Mecanizada `
          + `(${porTipo.mecanizada.registros} reg., `
          + `${porTipo.mecanizada.areaM2.toLocaleString('pt-BR')} m²).`,
      );
    }

    return {
      planilhaUploadId: r.planilhaUploadId,
      totalLinhas: parsed.totalLinhasBrutas,
      importados: r.importados,
      ignorados: Math.max(0, parsed.totalLinhasBrutas - r.importados),
      modelo: parsed.modelo,
      abasUsadas: parsed.abasUsadas,
      areaTotalM2: r.areaTotalM2,
      dias: r.dias,
      bairros: r.bairros,
      avisos,
      datasApagadas: r.datasApagadas,
      consolidacao: {
        uploadsRemovidos: r.uploadsRemovidosIds.length,
        uploadsRemovidosIds: r.uploadsRemovidosIds,
      },
      modo: 'rocada',
      viagensValidasDashboard: r.importados,
      viagensInconsistentes: 0,
      filtroTipoExecucao: null,
      porTipoExecucao: porTipo,
    };
  }
}

export default new RocadaImportService();
