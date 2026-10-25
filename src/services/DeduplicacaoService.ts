import * as XLSX from 'xlsx';
import { Repository, In } from 'typeorm';
import AppDataSource from '../database/data-source';
import { ColetaData } from '../entities/ColetaData';
import { PlanilhaUpload } from '../entities/PlanilhaUpload';
import { Servico } from '../entities/Servico';
import PlanilhaService from './PlanilhaService';
import { prepararViagemParaImportacao, aplicarFiltroViagensValidasDashboard } from './validacaoViagemService';
import { contarViagensPorRotaRegistro, sqlSumViagens } from './viagensPorRotaService';
import {
  compararMetricasDia,
  formatarDataBr,
  montarRecomendacaoConferencia,
  type ConferenciaDiariaPlanilha,
  type MetricasDiaOperacao,
} from './conferenciaDiariaPlanilhaService';
import { parseDataPlanilha } from '../utils/formatarDataPlanilha';
import { normalizarPlaca } from '../utils/normalizarPlaca';
import {
  aplicarReferenciaCicloNoUpload,
  apagarDatasDeUploadsAbertos,
  obterUploadIdsModificaveis,
  prepararDatasImportacaoCiclo,
  verificarDatasEmCicloFechado,
} from './cicloPlanilhaService';
import {
  marcarOrigemPlanilhaUpload,
  persistirArquivoOriginalUpload,
  type OrigemPlanilhaUpload,
} from './planilhaOriginalStorage';
import { limitarDiasAusentesAoPeriodoDaPlanilha, normalizarDiaInicioCiclo } from '../utils/periodoCicloContrato';
import { invalidarCacheDadosServico } from './servicoDadosCache';
import { invalidarCacheDashboardServico } from '../controllers/ServicoController';
import { recalcularTotaisDiaServicoSilencioso } from './coletaTotaisDiaService';
import { invalidarCacheSaudeContratos } from '../controllers/ContractController';
import { dashboardCache } from './DashboardCacheManager';
import { agendarWarmupPosUpload } from './executivoCacheWarmupService';
import { normalizarTextoTipoCaminhao } from '../config/pesoMaximoCaminhao';
import { numeroPlanilha } from './FormulaEngine';
import { aplicarLimitesTextoColeta, textoMaisLongo, lerCampoDados } from '../utils/textoColunaColeta';

/**
 * Interface que representa uma linha da planilha já parseada
 */
interface LinhaParseada {
  raw: Record<string, any>;
  dataSaida: Date | null;
  placa: string | null;
  turno: string | null;
  regional: string | null;
  distrito: string | null;
  motorista: string | null;
  [key: string]: any;
}

/**
 * Classificação de cada linha após comparação com o banco
 */
export type ClassificacaoLinha = 'novo' | 'duplicado' | 'conflitante';

/**
 * Resultado da análise de uma linha
 */
export interface LinhaAnalisada {
  indice: number;
  classificacao: ClassificacaoLinha;
  chave: string;
  dadosPlanilha: LinhaParseada;
  dadosBanco?: Partial<ColetaData>;
  diferencas?: string[];
}

/**
 * Resultado completo da análise de conflitos
 */
export interface ResultadoAnalise {
  totalLinhas: number;
  novos: LinhaAnalisada[];
  duplicados: LinhaAnalisada[];
  conflitantes: LinhaAnalisada[];
  chaveUsada: string;
}

/**
 * Resultado da importação com dedup
 */
export interface ResultadoImportacaoDedup {
  planilhaUploadId: number;
  totalLinhas: number;
  importados: number;
  ignorados: number;
  substituidos: number;
  erros: number;
  viagensInconsistentes?: number;
  viagensValidasDashboard?: number;
  viagensCorrigidas?: number;
  duplicatasRemovidasSql?: number;
  resumo: {
    novos: number;
    duplicadosIgnorados: number;
    conflitantes: number;
    substituidos: number;
    viagensInconsistentes?: number;
    viagensValidasDashboard?: number;
    viagensCorrigidas?: number;
    duplicatasRemovidasSql?: number;
  };
}

/**
 * Campos da ColetaData que formam a "impressão digital" do registro
 * para comparação de igualdade entre planilha e banco.
 * Inclui apenas campos de dados (não metadados como id, planilhaUploadId, criadoEm)
 */
const CAMPOS_COMPARACAO: (keyof ColetaData)[] = [
  'turno', 'regional', 'distrito', 'motorista',
  'numeroColetores', 'kmSaida', 'horaSaida', 'kmChegada', 'horaChegada',
  'horaUltimoTerminoCarregamento',
  'peso1', 'peso2', 'peso3', 'peso4', 'peso5', 'pesoTotal',
  'tempoForaUnidade', 'horasForaUnidade', 'tipoCaminhao',
  'kmTotal', 'numeroViagens', 'diaSemana',
];

/**
 * Serviço de deduplicação — analisa e resolve conflitos entre
 * dados da planilha e dados já existentes no banco.
 *
 * Chave única usada: (dataSaida + placa + turno + distrito + regional) no mesmo serviço.
 * Cada linha da planilha BH = uma rota (distrito); o mesmo caminhão pode ter várias rotas no dia.
 *
 * Lógica:
 * 1. Extrai chave única de cada linha da planilha
 * 2. Busca no banco todos os registros que correspondem às chaves
 * 3. Classifica cada linha em: novo, duplicado (idêntico), conflitante (diferente)
 * 4. Na importação, aplica a estratégia escolhida pelo usuário
 */
export class DeduplicacaoService {
  private get coletaRepo(): Repository<ColetaData> {
    return AppDataSource.getRepository(ColetaData);
  }

  private get uploadRepo(): Repository<PlanilhaUpload> {
    return AppDataSource.getRepository(PlanilhaUpload);
  }

  private get servicoRepo(): Repository<Servico> {
    return AppDataSource.getRepository(Servico);
  }

  private async obterDiaInicioCicloServico(servicoId?: string): Promise<number> {
    if (!servicoId) return 1;
    const servico = await this.servicoRepo.findOne({
      where: { id: servicoId },
      relations: ['contract'],
    });
    return normalizarDiaInicioCiclo(servico?.contract?.diaInicioCiclo);
  }

  private extrairDatasIsoDasLinhas(linhas: LinhaParseada[]): string[] {
    const set = new Set<string>();
    for (const linha of linhas) {
      if (!linha.dataSaida) continue;
      set.add(linha.dataSaida.toISOString().slice(0, 10));
    }
    return [...set];
  }

  private async validarImportacaoNaoInvadeCicloFechado(
    servicoId: string | undefined,
    linhas: LinhaParseada[],
  ): Promise<void> {
    if (!servicoId) return;
    const datas = this.extrairDatasIsoDasLinhas(linhas);
    const { bloqueadas, ciclos } = await verificarDatasEmCicloFechado(servicoId, datas);
    if (bloqueadas.length === 0) return;
    const labels = ciclos.map(c => c.label).join(', ');
    throw new Error(
      `A planilha contém ${bloqueadas.length} data(s) em ciclo(s) já fechado(s) (${labels}). `
      + `Datas bloqueadas: ${bloqueadas.slice(0, 5).join(', ')}${bloqueadas.length > 5 ? '…' : ''}. `
      + 'Feche o ciclo atual e importe apenas dados do novo período.',
    );
  }

  /**
   * ⭐ Remove duplicatas EXATAS no banco via SQL.
   * Chave ampla demais (só data+placa+turno+regional) apagava rotas distintas
   * do mesmo caminhão no mesmo dia — ex.: CONTADOR 456 na planilha → 455 no dash.
   * Mantém o registro mais antigo (menor id) só quando métricas operacionais coincidem.
   */
  private async limparDuplicatas(servicoId?: string): Promise<number> {
    if (!servicoId) return 0;

    const uploadIds = await obterUploadIdsModificaveis(servicoId);
    if (uploadIds.length === 0) return 0;

    const result = await AppDataSource.query(`
      DELETE FROM coleta_dados
      WHERE id IN (
        SELECT id FROM (
          SELECT c.id,
                 ROW_NUMBER() OVER (
                   PARTITION BY
                     c."dataSaida"::date,
                     COALESCE(NULLIF(TRIM(UPPER(c."placa")), ''), 'SEM_PLACA'),
                     COALESCE(NULLIF(TRIM(UPPER(c."turno")), ''), 'SEM_TURNO'),
                     COALESCE(NULLIF(TRIM(UPPER(c."distrito")), ''), 'SEM_DISTRITO'),
                     COALESCE(NULLIF(TRIM(UPPER(c."regional")), ''), 'SEM_REGIONAL'),
                     COALESCE(NULLIF(TRIM(UPPER(c."motorista")), ''), 'SEM_MOTORISTA'),
                     COALESCE(ROUND(c."kmSaida"::numeric, 1), -1),
                     COALESCE(ROUND(c."kmTotal"::numeric, 1), -1),
                     COALESCE(ROUND(c."pesoTotal"::numeric, 1), -1),
                     COALESCE(c."numeroViagens", c."viagensPorRota", -1)
                   ORDER BY c.id ASC
                 ) as rn
          FROM coleta_dados c
          WHERE c."planilhaUploadId" = ANY($1::int[])
        ) sub
        WHERE sub.rn > 1
      )
    `, [uploadIds]);

    const removidos = result?.[1] || 0;
    if (removidos > 0) {
      console.log(`[Dedup SQL] ${removidos} duplicata(s) exata(s) removida(s) do servico ${servicoId}`);
    }
    return removidos;
  }

  /** Normaliza texto para chave de deduplicação (distrito, regional, turno). */
  private normalizarCampoChave(valor: string | null | undefined, fallback: string): string {
    if (valor === null || valor === undefined) return fallback;
    const t = String(valor).trim();
    if (!t) return fallback;
    return t.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  /**
   * Gera a chave única para um registro (rota operacional).
   * Inclui KM/peso/contador e motorista para não colapsar rotas distintas
   * nem apagar retrabalho da sala técnica (mesmo KM/peso, nome diferente).
   */
  gerarChave(
    dataSaida: Date | string | null,
    placa: string | null,
    turno: string | null,
    distrito?: string | null,
    regional?: string | null,
    kmSaida?: number | null,
    kmTotal?: number | null,
    pesoTotal?: number | null,
    numeroViagens?: number | null,
    motorista?: string | null,
  ): string {
    let data: string;
    if (dataSaida instanceof Date) {
      data = dataSaida.toISOString().slice(0, 10);
    } else if (typeof dataSaida === 'string') {
      data = dataSaida.slice(0, 10);
    } else {
      data = 'SEM_DATA';
    }
    const placaNorm = normalizarPlaca(placa) || 'SEM_PLACA';
    const turnoNorm = this.normalizarCampoChave(turno, 'SEM_TURNO');
    const distritoNorm = this.normalizarCampoChave(distrito, 'SEM_DISTRITO');
    const regionalNorm = this.normalizarCampoChave(regional, 'SEM_REGIONAL');
    const motoristaNorm = this.normalizarCampoChave(motorista, 'SEM_MOTORISTA');
    const round1 = (n: number | null | undefined) =>
      n != null && !Number.isNaN(Number(n)) ? String(Math.round(Number(n) * 10) / 10) : 'NA';
    return [
      data,
      placaNorm,
      turnoNorm,
      distritoNorm,
      regionalNorm,
      motoristaNorm,
      round1(kmSaida),
      round1(kmTotal),
      round1(pesoTotal),
      numeroViagens != null && !Number.isNaN(Number(numeroViagens)) ? String(Math.round(Number(numeroViagens))) : 'NA',
    ].join('|');
  }

  /**
   * Gera a chave a partir de uma linha já parseada (ColetaData)
   */
  private textoChave(
    coluna: string | null | undefined,
    dados: Record<string, unknown> | null | undefined,
    nomes: string[],
  ): string | null {
    const cheio = textoMaisLongo(lerCampoDados(dados, nomes), coluna);
    return cheio || null;
  }

  gerarChaveDeColeta(coleta: ColetaData): string {
    const dados = (coleta.dados || null) as Record<string, unknown> | null;
    return this.gerarChave(
      coleta.dataSaida,
      coleta.placa,
      coleta.turno,
      this.textoChave(coleta.distrito, dados, ['DISTRITO_COMPLETO', 'DISTRITO']),
      this.textoChave(coleta.regional, dados, ['LOCAL_COMPLETO', 'REGIONAL']),
      coleta.kmSaida,
      coleta.kmTotal,
      coleta.pesoTotal,
      coleta.numeroViagens ?? coleta.viagensPorRota,
      coleta.motorista,
    );
  }

  private gerarChaveDeLinha(l: LinhaParseada): string {
    const dados = (l.raw || null) as Record<string, unknown> | null;
    return this.gerarChave(
      l.dataSaida,
      l.placa,
      l.turno,
      this.textoChave(l.distrito, dados, ['DISTRITO_COMPLETO', 'DISTRITO']),
      this.textoChave(l.regional, dados, ['LOCAL_COMPLETO', 'REGIONAL']),
      l.kmSaida,
      l.kmTotal,
      l.pesoTotal,
      l.numeroViagens,
      l.motorista,
    );
  }

  private static readonly CHAVE_USADA =
    'dataSaida + placa + turno + distrito + regional + motorista + kmSaida + kmTotal + pesoTotal + contador';

  /** Recalcula metadados do upload após deduplicação SQL. */
  private async sincronizarContagemUploadAposDedup(uploadId: number): Promise<number> {
    const count = await this.coletaRepo.count({
      where: { planilhaUploadId: uploadId, validoDashboard: true },
    });
    const upload = await this.uploadRepo.findOne({ where: { id: uploadId } });
    if (upload) {
      upload.linhasImportadas = count;
      if (upload.resumo) {
        upload.resumo = {
          ...upload.resumo,
          viagensValidasDashboard: count,
        };
      }
      await this.uploadRepo.save(upload);
    }
    return count;
  }

  /**
   * Após substituir por data: remove uploads antigos vazios do ciclo aberto.
   * Dias ausentes na planilha nova já foram apagados em importarPorData.
   */
  private async consolidarUploadsAposSubstituicao(
    servicoId: string,
    novoUploadId: number,
  ): Promise<{
    uploadsRemovidos: number;
    uploadsRemovidosIds: number[];
  }> {
    const uploadIdsAntigos = (await obterUploadIdsModificaveis(servicoId))
      .filter((id) => id !== novoUploadId);

    if (uploadIdsAntigos.length === 0) {
      return {
        uploadsRemovidos: 0,
        uploadsRemovidosIds: [],
      };
    }

    // Remover shells vazios (uploads antigos sem linhas restantes)
    const uploadsRemovidosIds: number[] = [];
    for (const oldId of uploadIdsAntigos) {
      const restantes = await this.coletaRepo.count({ where: { planilhaUploadId: oldId } });
      if (restantes > 0) continue;

      const upload = await this.uploadRepo.findOne({ where: { id: oldId } });
      if (!upload || upload.cicloFechadoEm) continue;

      const urlDownload = upload.urlDownload;
      await this.uploadRepo.remove(upload);
      uploadsRemovidosIds.push(oldId);

      if (urlDownload) {
        try {
          const { default: FileStorageService } = await import('./FileStorageService');
          await FileStorageService.removerImagem(urlDownload);
        } catch (err) {
          console.warn('[Deduplicacao] Erro ao remover arquivo antigo do storage:', err);
        }
      }
    }

    if (uploadsRemovidosIds.length > 0) {
      await this.sincronizarContagemUploadAposDedup(novoUploadId);
    }

    return {
      uploadsRemovidos: uploadsRemovidosIds.length,
      uploadsRemovidosIds,
    };
  }

  /**
   * Extrai os campos de uma linha para comparação
   */
  private extrairCamposComparacao(linha: LinhaParseada): Record<string, any> {
    return {
      turno: linha.turno,
      regional: linha.regional,
      distrito: linha.distrito,
      motorista: linha.motorista,
      numeroColetores: linha.numeroColetores,
      kmSaida: linha.kmSaida,
      horaSaida: linha.horaSaida,
      kmChegada: linha.kmChegada,
      horaChegada: linha.horaChegada,
      horaUltimoTerminoCarregamento: linha.horaUltimoTerminoCarregamento,
      peso1: linha.peso1,
      peso2: linha.peso2,
      peso3: linha.peso3,
      peso4: linha.peso4,
      peso5: linha.peso5,
      pesoTotal: linha.pesoTotal,
      tempoForaUnidade: linha.tempoForaUnidade,
      horasForaUnidade: linha.horasForaUnidade,
      tipoCaminhao: linha.tipoCaminhao,
      kmTotal: linha.kmTotal,
      numeroViagens: linha.numeroViagens,
      diaSemana: linha.diaSemana,
    };
  }

  /**
   * Compara campos da planilha com os do banco e retorna as diferenças
   */
  private compararCampos(planilha: Record<string, any>, banco: Record<string, any>): string[] {
    const diferencas: string[] = [];
    for (const campo of CAMPOS_COMPARACAO) {
      const valPlanilha = planilha[campo];
      const valBanco = banco[campo];
      // Normalizar undefined/null como null
      const a = valPlanilha === undefined ? null : valPlanilha;
      const b = valBanco === undefined ? null : valBanco;
      // Comparação flexível: string vs number
      if (String(a ?? '') !== String(b ?? '')) {
        diferencas.push(String(campo));
      }
    }
    return diferencas;
  }

  /**
   * Lê e parseia as linhas de uma planilha, extraindo dados estruturados
   */
  private montarColetaDeLinha(linha: LinhaParseada, planilhaUploadId: number): ColetaData {
    const coleta = new ColetaData();
    coleta.planilhaUploadId = planilhaUploadId;
    coleta.dataSaida = linha.dataSaida;
    coleta.turno = linha.turno;
    coleta.regional = linha.regional;
    coleta.distrito = linha.distrito;
    coleta.placa = linha.placa;
    coleta.motorista = linha.motorista;
    coleta.numeroColetores = linha.numeroColetores;
    coleta.kmSaida = linha.kmSaida;
    coleta.horaSaida = linha.horaSaida;
    coleta.kmChegada = linha.kmChegada;
    coleta.horaChegada = linha.horaChegada;
    coleta.horaUltimoTerminoCarregamento = linha.horaUltimoTerminoCarregamento;
    coleta.peso1 = linha.peso1;
    coleta.peso2 = linha.peso2;
    coleta.peso3 = linha.peso3;
    coleta.peso4 = linha.peso4;
    coleta.peso5 = linha.peso5;
    coleta.pesoTotal = linha.pesoTotal;
    coleta.tempoForaUnidade = linha.tempoForaUnidade;
    coleta.horasForaUnidade = linha.horasForaUnidade;
    coleta.tipoCaminhao = linha.tipoCaminhao;
    coleta.kmTotal = linha.kmTotal;
    coleta.kmRota1 = linha.kmRota1;
    coleta.kmRota2 = linha.kmRota2;
    coleta.kmRota3 = linha.kmRota3;
    coleta.kmRota4 = linha.kmRota4;
    coleta.numeroViagens = linha.numeroViagens;
    coleta.diaSemana = linha.diaSemana;
    coleta.dados = this.filtrarChavesVazias(linha.raw);
    aplicarLimitesTextoColeta(coleta);
    return coleta;
  }

  private parsearLinhas(buffer: Buffer): LinhaParseada[] {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
    const nomeAba = workbook.SheetNames[0];
    const sheet = workbook.Sheets[nomeAba];
    const linhas: Record<string, any>[] = XLSX.utils.sheet_to_json(sheet, {
      defval: null,
      raw: true,
    });

    return linhas.map((raw) => {
      const dataSaida = this.parseDataSaida(raw);

      const linha: LinhaParseada = {
        raw,
        dataSaida,
        placa: this.getStr(raw, 'PLACA'),
        turno: this.getStr(raw, 'TURNO'),
        regional: this.getStr(raw, 'REGIONAL'),
        distrito: this.getStr(raw, 'DISTRITO'),
        motorista: this.getStr(raw, 'MOTORISTA'),
        numeroColetores: this.getInt(raw, 'Nº DE COLETORES'),
        kmSaida: this.getNum(raw, 'KM SAIDA'),
        horaSaida: this.getNum(raw, 'HORA SÁIDA'),
        kmChegada: this.getNum(raw, 'KM CHEGADA'),
        horaChegada: this.getNum(raw, 'HORA CHEGADA'),
        horaUltimoTerminoCarregamento: this.getNum(raw, 'HORA ULTIMO TÉRMINO DO CARREGAMENTO'),
        peso1: this.getNum(raw, 'PESO 1'),
        peso2: this.getNum(raw, 'PESO 2'),
        peso3: this.getNum(raw, 'PESO 3'),
        peso4: this.getNum(raw, 'PESO 4'),
        peso5: this.getNum(raw, 'PESO 5'),
        pesoTotal: this.getNum(raw, 'PESO TOTAL'),
        tempoForaUnidade: this.getNum(raw, 'TEMPO FORA DA UNIDADE'),
        horasForaUnidade: this.getNum(raw, 'HORAS QUE FICA FORA DA UNIDADE'),
        tipoCaminhao: normalizarTextoTipoCaminhao(
          this.getStr(raw, 'TIPO DE CAMINHÃO')
          || this.getStr(raw, 'TIPO CAMINHAO')
          || this.getStr(raw, 'TIPO VEICULO')
          || this.getStr(raw, 'CAMINHÃO'),
        ),
        kmTotal: this.getNum(raw, 'KM TOTAL'),
        kmRota1: this.getNum(raw, 'KM ROTA 01'),
        kmRota2: this.getNum(raw, 'KM ROTA 02'),
        kmRota3: this.getNum(raw, 'KM ROTA 03'),
        kmRota4: this.getNum(raw, 'KM ROTA 04'),
        numeroViagens: this.getInt(raw, 'CONTADOR DE VIAGENS')
          ?? this.getInt(raw, 'CONTADOR VIAGENS')
          ?? this.getInt(raw, 'Nº DE VIAGENS')
          ?? this.getInt(raw, 'NUMERO DE VIAGENS')
          ?? this.getInt(raw, 'NÚMERO DE VIAGENS')
          ?? this.getInt(raw, 'NR VIAGENS'),
        diaSemana: this.getInt(raw, 'DIA DA SEMANA'),
      };

      return linha;
    }).filter((linha) => {
      const temId = Boolean(linha.dataSaida) || Boolean(linha.placa);
      const temMetrica = (linha.kmTotal != null && linha.kmTotal > 0)
        || (linha.pesoTotal != null && linha.pesoTotal > 0);
      return temId || temMetrica;
    });
  }

  private parseDataSaida(raw: Record<string, unknown>): Date | null {
    for (const key of ['DATA SAIDA', 'DATA SAÍDA', 'DATA DE SAIDA', 'DATA DE SAÍDA', 'DIA', 'DATA']) {
      const chave = this.encontrarChave(raw, key);
      if (!chave) continue;
      const parsed = parseDataPlanilha(raw[chave]);
      if (parsed) return parsed;
    }
    return null;
  }

  // ── Helpers de extração (replicados do PlanilhaService) ──

  private normalizarChave(chave: string): string {
    return chave
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[\r\n]+/g, ' ')
      .replace(/[^A-Z0-9\s]/g, '')
      .replace(/\s+(BASE|ROTA\s*\d+)\s*/g, ' ')
      .replace(/\s+/g, '')
      .trim();
  }

  private encontrarChave(obj: any, key: string): string | null {
    if (obj[key] !== undefined && obj[key] !== null) return key;
    if (obj[key.trim()] !== undefined && obj[key.trim()] !== null) return key.trim();
    if (obj[' ' + key + ' '] !== undefined && obj[' ' + key + ' '] !== null) return ' ' + key + ' ';
    if (obj[' ' + key] !== undefined && obj[' ' + key] !== null) return ' ' + key;
    if (obj[key + ' '] !== undefined && obj[key + ' '] !== null) return key + ' ';

    const keyNorm = this.normalizarChave(key);
    const chaves = Object.keys(obj);
    for (const ch of chaves) {
      const chNorm = this.normalizarChave(ch);
      if (keyNorm.length > 0 && chNorm.includes(keyNorm)) return ch;
      if (chNorm.length >= 5 && keyNorm.includes(chNorm)) return ch;
    }
    return null;
  }

  private getStr(obj: any, key: string): string | null {
    const chave = this.encontrarChave(obj, key);
    if (!chave) return null;
    const valor = obj[chave];
    if (valor === null || valor === undefined) return null;
    const str = String(valor).trim();
    return str || null;
  }

  private getNum(obj: any, key: string): number | null {
    const chave = this.encontrarChave(obj, key);
    if (!chave) return null;
    const valor = obj[chave];
    if (valor === null || valor === undefined) return null;
    return numeroPlanilha(valor);
  }

  private getInt(obj: any, key: string): number | null {
    const num = this.getNum(obj, key);
    return num !== null ? Math.round(num) : null;
  }

  /**
   * ════════════════════════════════════════════════════════════
   * API PÚBLICA — Análise de Conflitos
   * ════════════════════════════════════════════════════════════
   */

  /**
   * Analisa uma planilha comparando com os dados já existentes no banco
   * para um determinado serviço. NÃO importa nada — apenas classifica.
   * 
   * @param buffer - Conteúdo da planilha
   * @param servicoId - ID do serviço (para filtrar registros existentes)
   * @returns Resultado da análise com as 3 categorias
   */
  async analisarPlanilha(buffer: Buffer, servicoId?: string): Promise<ResultadoAnalise> {
    const linhas = this.parsearLinhas(buffer);

    // Se não há serviço, todos são "novos" (não temos referência)
    if (!servicoId) {
      return {
        totalLinhas: linhas.length,
        novos: linhas.map((l, i) => ({
          indice: i,
          classificacao: 'novo' as ClassificacaoLinha,
          chave: this.gerarChaveDeLinha(l),
          dadosPlanilha: l,
        })),
        duplicados: [],
        conflitantes: [],
        chaveUsada: DeduplicacaoService.CHAVE_USADA,
      };
    }

    // Buscar uploads modificáveis do serviço (ciclos fechados ficam protegidos)
    const uploadIds = servicoId ? await obterUploadIdsModificaveis(servicoId) : [];

    if (uploadIds.length === 0) {
      // Serviço sem uploads anteriores — todos são novos
      return {
        totalLinhas: linhas.length,
        novos: linhas.map((l, i) => ({
          indice: i,
          classificacao: 'novo' as ClassificacaoLinha,
          chave: this.gerarChaveDeLinha(l),
          dadosPlanilha: l,
        })),
        duplicados: [],
        conflitantes: [],
        chaveUsada: DeduplicacaoService.CHAVE_USADA,
      };
    }

    // Gerar chaves de todas as linhas da planilha
    const chavesPlanilha = linhas.map(l => this.gerarChaveDeLinha(l));
    
    // ⭐ DEBUG: mostrar as chaves geradas
    console.log('[DEBUG analisarPlanilha] servicoId:', servicoId);
    console.log('[DEBUG analisarPlanilha] uploadIds:', uploadIds);
    console.log('[DEBUG analisarPlanilha] total linhas parseadas:', linhas.length);
    for (let di = 0; di < linhas.length; di++) {
      const l = linhas[di];
      console.log(`[DEBUG] Linha ${di}: dataSaida=${l.dataSaida} (${typeof l.dataSaida}), placa=${l.placa}, turno=${l.turno}, chave=${chavesPlanilha[di]}`);
    }

    // Buscar TODOS os registros existentes que correspondam a essas chaves
    // Precisamos buscar por dataSaida, placa e turno individualmente
    // Como a chave é composta, vamos buscar por lote

    const linhasComData: Date[] = [];
    const placas: string[] = [];
    const turnos: string[] = [];

    for (const linha of linhas) {
      if (linha.dataSaida) {
        const d = new Date(linha.dataSaida);
        // Normalizar para YYYY-MM-DD
        d.setHours(0, 0, 0, 0);
        linhasComData.push(d);
      }
      if (linha.placa) placas.push(normalizarPlaca(linha.placa) || linha.placa.toUpperCase().trim());
      if (linha.turno) turnos.push(linha.turno.toUpperCase().trim());
    }

    // Buscar registros existentes no banco que podem coincidir
    const registrosExistentes = await this.coletaRepo.createQueryBuilder('c')
      .where('c.planilhaUploadId IN (:...uploadIds)', { uploadIds })
      .andWhere('c.dataSaida IS NOT NULL')
      .andWhere('c.placa IS NOT NULL')
      .getMany();

    // Indexar registros existentes por chave
    const mapaBanco = new Map<string, ColetaData>();
    console.log('[DEBUG analisarPlanilha] registrosExistentes.length:', registrosExistentes.length);
    for (const reg of registrosExistentes) {
      const chave = this.gerarChaveDeColeta(reg);
      console.log(`[DEBUG] Banco reg id=${reg.id}: dataSaida=${reg.dataSaida} (${typeof reg.dataSaida}), placa=${reg.placa}, turno=${reg.turno}, chave=${chave}`);
      if (!mapaBanco.has(chave)) {
        mapaBanco.set(chave, reg);
      }
    }
    console.log('[DEBUG] mapaBanco chaves:', Array.from(mapaBanco.keys()));

    // Classificar cada linha
    const novos: LinhaAnalisada[] = [];
    const duplicados: LinhaAnalisada[] = [];
    const conflitantes: LinhaAnalisada[] = [];

    for (let i = 0; i < linhas.length; i++) {
      const linha = linhas[i];
      const chave = chavesPlanilha[i];
      const registroBanco = mapaBanco.get(chave);

      if (!registroBanco) {
        console.log(`[DEBUG] Linha ${i}: chave=${chave} -> NOVO (nao encontrado no banco)`);
        // Chave não existe no banco → NOVO
        novos.push({
          indice: i,
          classificacao: 'novo',
          chave,
          dadosPlanilha: linha,
        });
      } else {
        // Chave já existe → comparar campos
        const camposPlanilha = this.extrairCamposComparacao(linha);
        const camposBanco = this.extrairCamposComparacao({
          ...linha,
          ...registroBanco,
          raw: registroBanco.dados || {},
        });
        const diferencas = this.compararCampos(camposPlanilha, registroBanco);

        if (diferencas.length === 0) {
          // Mesmos valores → DUPLICADO
          duplicados.push({
            indice: i,
            classificacao: 'duplicado',
            chave,
            dadosPlanilha: linha,
            dadosBanco: registroBanco,
          });
        } else {
          // Valores diferentes → CONFLITANTE
          conflitantes.push({
            indice: i,
            classificacao: 'conflitante',
            chave,
            dadosPlanilha: linha,
            dadosBanco: registroBanco,
            diferencas,
          });
        }
      }
    }

    return {
      totalLinhas: linhas.length,
      novos,
      duplicados,
      conflitantes,
      chaveUsada: DeduplicacaoService.CHAVE_USADA,
    };
  }

  /**
   * ════════════════════════════════════════════════════════════
   * API PÚBLICA — Importação com Deduplicação
   * ════════════════════════════════════════════════════════════
   */

  /**
   * Importa uma planilha aplicando a estratégia de conflito escolhida.
   * 
   * @param buffer - Conteúdo da planilha
   * @param nomeArquivo - Nome original do arquivo
   * @param estrategia - Estratégia para conflitos: 'ignorar' | 'substituir'
   * @param usuarioId - ID do usuário (opcional)
   * @param servicoId - ID do serviço (opcional)
   * @returns Resultado detalhado da importação
   */
  async importarComDedup(
    buffer: Buffer,
    nomeArquivo: string,
    estrategia: 'ignorar' | 'substituir',
    usuarioId?: string,
    servicoId?: string,
    origem?: OrigemPlanilhaUpload,
  ): Promise<ResultadoImportacaoDedup> {
    const linhas = this.parsearLinhas(buffer);
    await this.validarImportacaoNaoInvadeCicloFechado(servicoId, linhas);

    // 1. Analisar conflitos
    const analise = await this.analisarPlanilha(buffer, servicoId);

    // 2. Criar registro de upload
    const upload = this.uploadRepo.create({
      nomeArquivo,
      totalLinhas: analise.totalLinhas,
      linhasImportadas: 0,
      linhasComErro: 0,
      linhasIgnoradas: 0,
      linhasSubstituidas: 0,
      linhasConflitantes: analise.conflitantes.length,
      estrategia,
      usuarioId: usuarioId || null,
      servico_id: servicoId || null,
      resumo: {
        novos: analise.novos.length,
        duplicadosIgnorados: analise.duplicados.length,
        conflitantes: analise.conflitantes.length,
        substituidos: 0,
      },
    });
    const uploadSalvo = await this.uploadRepo.save(upload);
    const urlOriginal = await persistirArquivoOriginalUpload(uploadSalvo.id, buffer, nomeArquivo);
    if (urlOriginal) uploadSalvo.urlDownload = urlOriginal;
    if (origem) await marcarOrigemPlanilhaUpload(uploadSalvo.id, origem);
    let importados = 0;
    let ignorados = 0;
    let substituidos = 0;
    let erros = 0;
    let viagensInconsistentes = 0;
    let viagensCorrigidas = 0;

    // 3. Identificar registros a excluir (se estratégia = substituir)
    if (estrategia === 'substituir' && analise.conflitantes.length > 0) {
      const idsExcluir = analise.conflitantes
        .map(c => (c.dadosBanco as ColetaData)?.id)
        .filter(Boolean);
      if (idsExcluir.length > 0) {
        await this.coletaRepo.delete({ id: In(idsExcluir) });
      }
    }

    // 4. Processar registros
    // - Novos: sempre inserir
    // - Duplicados: ignorar (a menos que estratégia seja substituir)
    // - Conflitantes: se estratégia = substituir, já excluímos acima e vamos reinserir
    //                 se estratégia = ignorar, não inserimos

    const batch: ColetaData[] = [];
    const BATCH_SIZE = 500;

    // Função auxiliar para criar entidade ColetaData a partir de LinhaParseada
    const criarColetaSeValida = (linha: LinhaParseada): ColetaData | null => {
      const coleta = this.montarColetaDeLinha(linha, uploadSalvo.id);
      const validacao = prepararViagemParaImportacao(coleta);
      if (validacao.correcoes?.length) viagensCorrigidas++;
      if (validacao.descartada) return null;
      if (!validacao.validoDashboard) {
        viagensInconsistentes++;
        return null;
      }
      return coleta;
    };

    // Processar NOVOS
    for (const item of analise.novos) {
      try {
        const coleta = criarColetaSeValida(item.dadosPlanilha);
        if (!coleta) {
          ignorados++;
          continue;
        }
        batch.push(coleta);
        importados++;
        if (batch.length >= BATCH_SIZE) {
          await this.coletaRepo.save(batch);
          batch.length = 0;
        }
      } catch (err) {
        erros++;
      }
    }

    // Processar CONFLITANTES (apenas se estratégia = substituir)
    if (estrategia === 'substituir') {
      for (const item of analise.conflitantes) {
        try {
          const coleta = criarColetaSeValida(item.dadosPlanilha);
          if (!coleta) {
            ignorados++;
            continue;
          }
          batch.push(coleta);
          substituidos++;
          importados++;
          if (batch.length >= BATCH_SIZE) {
            await this.coletaRepo.save(batch);
            batch.length = 0;
          }
        } catch (err) {
          erros++;
        }
      }
    } else {
      ignorados += analise.conflitantes.length;
    }

    // Processar DUPLICADOS
    ignorados += analise.duplicados.length;

    // Salvar lote final
    if (batch.length > 0) {
      await this.coletaRepo.save(batch);
    }

    // 5. Atualizar metadados do upload
    uploadSalvo.linhasImportadas = importados;
    uploadSalvo.linhasIgnoradas = ignorados;
    uploadSalvo.linhasSubstituidas = substituidos;
    uploadSalvo.linhasComErro = erros;
    const detalhes: { data: string; placa: string; motivo: string }[] = [];
    if (analise.conflitantes.length > 0) {
      for (const c of analise.conflitantes.slice(0, 50)) {
        detalhes.push({
          data: c.dadosPlanilha.dataSaida
            ? c.dadosPlanilha.dataSaida.toISOString().slice(0, 10)
            : 'N/A',
          placa: c.dadosPlanilha.placa || 'N/A',
          motivo: `Campos diferentes: ${(c.diferencas || []).join(', ')}`,
        });
      }
    }
    uploadSalvo.resumo = {
      novos: analise.novos.length,
      duplicadosIgnorados: analise.duplicados.length,
      conflitantes: analise.conflitantes.length,
      substituidos,
      detalhes,
      viagensInconsistentes,
      viagensValidasDashboard: importados,
      viagensCorrigidas,
    };

    await this.uploadRepo.save(uploadSalvo);

    if (servicoId) {
      const diaInicio = await this.obterDiaInicioCicloServico(servicoId);
      await aplicarReferenciaCicloNoUpload(
        uploadSalvo.id,
        this.extrairDatasIsoDasLinhas(linhas),
        diaInicio,
      );
    }

    // ⭐ Pós-importação: limpeza de duplicatas via SQL (rede de segurança)
    const duplicatasRemovidas = await this.limparDuplicatas(servicoId);
    importados = await this.sincronizarContagemUploadAposDedup(uploadSalvo.id);

    if (servicoId) {
      invalidarCacheDadosServico(servicoId);
      invalidarCacheDashboardServico(servicoId);
      dashboardCache.invalidar(servicoId);
      agendarWarmupPosUpload(servicoId);
      invalidarCacheSaudeContratos();
      void recalcularTotaisDiaServicoSilencioso(servicoId);
    }

    return {
      planilhaUploadId: uploadSalvo.id,
      totalLinhas: analise.totalLinhas,
      importados,
      ignorados,
      substituidos,
      erros,
      viagensInconsistentes,
      viagensValidasDashboard: importados,
      viagensCorrigidas,
      duplicatasRemovidasSql: duplicatasRemovidas,
      resumo: {
        novos: analise.novos.length,
        duplicadosIgnorados: analise.duplicados.length,
        conflitantes: analise.conflitantes.length,
        substituidos,
        viagensInconsistentes,
        viagensValidasDashboard: importados,
        viagensCorrigidas,
        duplicatasRemovidasSql: duplicatasRemovidas,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // 🆕 API — Análise e Importação por Data (dedup por data)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Analisa uma planilha agrupando por DATA e verificando
   * quais datas já existem no banco para um serviço.
   * 
   * Diferente da analisarPlanilha() que compara registro a registro
   * (dataSaida + placa + turno), esta analisa apenas por data.
   * 
   * @param buffer - Conteúdo da planilha
   * @param servicoId - ID do serviço
   */
  async analisarPlanilhaPorData(buffer: Buffer, servicoId?: string): Promise<{
    totalLinhas: number;
    totalDatas: number;
    datasExistentes: { data: string; registrosBanco: number; registrosPlanilha: number }[];
    datasNovas: { data: string; registrosPlanilha: number }[];
    linhasIgnoradas: number;
    linhasImportaveis: number;
  }> {
    const linhas = this.parsearLinhas(buffer);

    // Agrupar linhas por data
    const mapaDatas = new Map<string, LinhaParseada[]>();
    for (const linha of linhas) {
      if (!linha.dataSaida) continue;
      const chaveData = linha.dataSaida.toISOString().slice(0, 10);
      if (!mapaDatas.has(chaveData)) {
        mapaDatas.set(chaveData, []);
      }
      mapaDatas.get(chaveData)!.push(linha);
    }

    const datasUnicas = Array.from(mapaDatas.keys()).sort();

    // Se não tem serviço, todas são novas
    if (!servicoId) {
      return {
        totalLinhas: linhas.length,
        totalDatas: datasUnicas.length,
        datasExistentes: [],
        datasNovas: datasUnicas.map(d => ({
          data: d,
          registrosPlanilha: mapaDatas.get(d)!.length,
        })),
        linhasIgnoradas: 0,
        linhasImportaveis: linhas.length,
      };
    }

    // Buscar IDs de upload modificáveis
    const uploadIds = servicoId ? await obterUploadIdsModificaveis(servicoId) : [];

    if (uploadIds.length === 0) {
      return {
        totalLinhas: linhas.length,
        totalDatas: datasUnicas.length,
        datasExistentes: [],
        datasNovas: datasUnicas.map(d => ({
          data: d,
          registrosPlanilha: mapaDatas.get(d)!.length,
        })),
        linhasIgnoradas: 0,
        linhasImportaveis: linhas.length,
      };
    }

    // Para cada data única, contar registros existentes no banco
    const datasExistentes: { data: string; registrosBanco: number; registrosPlanilha: number }[] = [];
    const datasNovas: { data: string; registrosPlanilha: number }[] = [];

    for (const dataStr of datasUnicas) {
      const dataInicio = new Date(dataStr + 'T00:00:00');
      const dataFim = new Date(dataStr + 'T23:59:59');

      const count = await this.coletaRepo.createQueryBuilder('c')
        .where('c.planilhaUploadId IN (:...uploadIds)', { uploadIds })
        .andWhere('c.dataSaida BETWEEN :inicio AND :fim', { inicio: dataInicio, fim: dataFim })
        .getCount();

      const qtdPlanilha = mapaDatas.get(dataStr)!.length;

      if (count > 0) {
        datasExistentes.push({ data: dataStr, registrosBanco: count, registrosPlanilha: qtdPlanilha });
      } else {
        datasNovas.push({ data: dataStr, registrosPlanilha: qtdPlanilha });
      }
    }

    const totalIgnorados = datasExistentes.reduce((acc, d) => acc + d.registrosPlanilha, 0);
    const totalImportaveis = datasNovas.reduce((acc, d) => acc + d.registrosPlanilha, 0);

    return {
      totalLinhas: linhas.length,
      totalDatas: datasUnicas.length,
      datasExistentes,
      datasNovas,
      linhasIgnoradas: totalIgnorados,
      linhasImportaveis: totalImportaveis,
    };
  }

  /**
   * Compara métricas por dia — planilha vs sistema (rotas, viagens, peso, km).
   * Uso diário: detectar divergências antes de atualizar o banco.
   */
  async conferirPlanilhaDiaria(buffer: Buffer, servicoId: string): Promise<ConferenciaDiariaPlanilha> {
    const linhas = this.parsearLinhas(buffer);
    const mapaPlanilha = new Map<string, MetricasDiaOperacao>();

    for (const linha of linhas) {
      if (!linha.dataSaida) continue;
      const dataIso = linha.dataSaida.toISOString().slice(0, 10);
      try {
        const coleta = this.montarColetaDeLinha(linha, 0);
        const validacao = prepararViagemParaImportacao(coleta);
        if (validacao.descartada || !validacao.validoDashboard) continue;

        const viagens = contarViagensPorRotaRegistro(coleta);
        const entry = mapaPlanilha.get(dataIso) || { rotas: 0, viagens: 0, pesoKg: 0, km: 0 };
        entry.rotas += 1;
        entry.viagens += viagens;
        entry.pesoKg += coleta.pesoTotal ?? 0;
        entry.km += coleta.kmTotal ?? 0;
        mapaPlanilha.set(dataIso, entry);
      } catch {
        // linha ignorada
      }
    }

    const datasPlanilha = [...mapaPlanilha.keys()].sort();
    const ultimaDataPlanilha = datasPlanilha.length > 0 ? datasPlanilha[datasPlanilha.length - 1] : null;

    const { bloqueadas } = await verificarDatasEmCicloFechado(servicoId, datasPlanilha);
    const bloqueadasSet = new Set(bloqueadas);

    const uploadIds = await obterUploadIdsModificaveis(servicoId);
    const mapaSistema = new Map<string, MetricasDiaOperacao>();

    if (uploadIds.length > 0) {
      const qb = this.coletaRepo.createQueryBuilder('c')
        .select("to_char(c.dataSaida, 'YYYY-MM-DD')", 'data')
        .addSelect('COUNT(*)::int', 'rotas')
        .addSelect(
          sqlSumViagens('c'),
          'viagens',
        )
        .addSelect('COALESCE(SUM(c.pesoTotal), 0)', 'peso_kg')
        .addSelect('COALESCE(SUM(c.kmTotal), 0)', 'km')
        .where('c.planilhaUploadId IN (:...uploadIds)', { uploadIds });
      aplicarFiltroViagensValidasDashboard(qb, 'c');
      qb.groupBy("to_char(c.dataSaida, 'YYYY-MM-DD')");

      const rows = await qb.getRawMany<{
        data: string;
        rotas: string;
        viagens: string;
        peso_kg: string;
        km: string;
      }>();

      for (const row of rows) {
        mapaSistema.set(row.data, {
          rotas: Number(row.rotas) || 0,
          viagens: Math.round(Number(row.viagens) || 0),
          pesoKg: Number(row.peso_kg) || 0,
          km: Number(row.km) || 0,
        });
      }
    }

    let ultimaDataSistema: string | null = null;
    if (uploadIds.length > 0) {
      const maxRow = await this.coletaRepo.createQueryBuilder('c')
        .select('MAX(c.dataSaida)', 'maxData')
        .where('c.planilhaUploadId IN (:...uploadIds)', { uploadIds });
      aplicarFiltroViagensValidasDashboard(maxRow, 'c');
      const raw = await maxRow.getRawOne<{ maxData: Date | string | null }>();
      if (raw?.maxData) {
        const d = raw.maxData instanceof Date ? raw.maxData : new Date(raw.maxData);
        ultimaDataSistema = d.toISOString().slice(0, 10);
      }
    }

    const dias: ConferenciaDiariaPlanilha['dias'] = [];
    let diasNovos = 0;
    let diasIguais = 0;
    let diasDivergentes = 0;
    let diasBloqueados = 0;
    let diasSomenteSistema = 0;
    const datasPlanilhaSet = new Set(datasPlanilha);

    for (const data of datasPlanilha) {
      const planilha = mapaPlanilha.get(data)!;
      const sistema = mapaSistema.get(data) ?? null;

      if (bloqueadasSet.has(data)) {
        diasBloqueados++;
        dias.push({
          data,
          dataBr: formatarDataBr(data),
          status: 'bloqueado',
          planilha,
          sistema,
          diferencas: ['Data em ciclo fechado — não pode ser alterada'],
        });
        continue;
      }

      if (!sistema || (sistema.rotas === 0 && sistema.viagens === 0)) {
        diasNovos++;
        dias.push({
          data,
          dataBr: formatarDataBr(data),
          status: 'novo',
          planilha,
          sistema,
          diferencas: [],
        });
        continue;
      }

      const diferencas = compararMetricasDia(planilha, sistema);
      if (diferencas.length === 0) {
        diasIguais++;
        dias.push({
          data,
          dataBr: formatarDataBr(data),
          status: 'igual',
          planilha,
          sistema,
          diferencas: [],
        });
      } else {
        diasDivergentes++;
        dias.push({
          data,
          dataBr: formatarDataBr(data),
          status: 'divergente',
          planilha,
          sistema,
          diferencas,
        });
      }
    }

    // Dias no sistema, no intervalo da planilha nova, que o arquivo não traz.
    // Datas fora desse intervalo (ciclo anterior) NÃO entram — não serão removidas.
    const minPlanilha = datasPlanilha[0];
    const maxPlanilha = datasPlanilha[datasPlanilha.length - 1];
    for (const [data, sistema] of mapaSistema) {
      if (datasPlanilhaSet.has(data)) continue;
      if (!minPlanilha || data < minPlanilha || data > maxPlanilha) continue;
      if (sistema.rotas === 0 && sistema.viagens === 0) continue;
      diasSomenteSistema++;
      dias.push({
        data,
        dataBr: formatarDataBr(data),
        status: 'somente_sistema',
        planilha: null,
        sistema,
        diferencas: ['Só no sistema — será removido ao substituir a planilha'],
      });
    }

    dias.sort((a, b) => b.data.localeCompare(a.data));

    const temPlanilhaAnterior = uploadIds.length > 0;
    const temDivergencia = diasDivergentes > 0 || diasBloqueados > 0;

    return {
      totalDatasPlanilha: datasPlanilha.length,
      diasNovos,
      diasIguais,
      diasDivergentes,
      diasBloqueados,
      diasSomenteSistema,
      temDivergencia,
      ultimaDataPlanilha,
      ultimaDataSistema,
      recomendacao: montarRecomendacaoConferencia({
        diasNovos,
        diasDivergentes,
        diasBloqueados,
        diasSomenteSistema,
        temPlanilhaAnterior,
      }),
      dias,
    };
  }

  /**
   * Importa uma planilha usando estratégia baseada em DATA.
   * 
   * 'atualizar_data' → a planilha é a verdade do PERÍODO que ela cobre:
   *   apaga os dias presentes no arquivo (ciclo aberto) e reinsere; também
   *   remove buracos entre a 1ª e a última data do arquivo. Datas de ciclo
   *   já fechado, ou anteriores ao intervalo da planilha, nunca são apagadas.
   * 
   * 'inserir_data' → insere apenas registros de datas que AINDA NÃO
   *   existem no banco. Datas já existentes são ignoradas.
   *   Ideal para adicionar novos dias sem sobrescrever existentes.
   * 
   * @param buffer - Conteúdo da planilha
   * @param nomeArquivo - Nome original do arquivo
   * @param estrategia - 'atualizar_data' | 'inserir_data'
   * @param usuarioId - ID do usuário (opcional)
   * @param servicoId - ID do serviço (opcional)
   */
  async importarPorData(
    buffer: Buffer,
    nomeArquivo: string,
    estrategia: 'atualizar_data' | 'inserir_data',
    usuarioId?: string,
    servicoId?: string,
    origem?: OrigemPlanilhaUpload,
  ): Promise<{
    planilhaUploadId: number;
    totalLinhas: number;
    importados: number;
    ignorados: number;
    datasExistentes: number;
    datasNovas: number;
    datasApagadas: { data: string; registrosRemovidos: number }[];
    diasRemovidosAusentes: { data: string; registrosRemovidos: number }[];
    datasIgnoradasCicloFechado?: string[];
    avisos?: string[];
    modo: 'atualizar_data' | 'inserir_data';
    viagensInconsistentes?: number;
    viagensValidasDashboard?: number;
    viagensCorrigidas?: number;
    duplicatasRemovidasSql?: number;
    consolidacao?: {
      registrosRemovidosAusentes: number;
      diasRemovidosAusentes: string[];
      uploadsRemovidos: number;
      uploadsRemovidosIds: number[];
    };
  }> {
    const linhas = this.parsearLinhas(buffer);

    // Agrupar por data
    const mapaDatas = new Map<string, LinhaParseada[]>();
    for (const linha of linhas) {
      if (!linha.dataSaida) continue;
      const chaveData = linha.dataSaida.toISOString().slice(0, 10);
      if (!mapaDatas.has(chaveData)) {
        mapaDatas.set(chaveData, []);
      }
      mapaDatas.get(chaveData)!.push(linha);
    }

    let datasUnicas = Array.from(mapaDatas.keys()).sort();
    const avisos: string[] = [];
    let datasIgnoradasCicloFechado: string[] = [];
    let cicloAlvo: { dataInicio: string; dataFim: string } | null = null;

    if (servicoId && datasUnicas.length > 0) {
      const prep = await prepararDatasImportacaoCiclo(servicoId, datasUnicas);
      cicloAlvo = prep.cicloAlvo;
      datasIgnoradasCicloFechado = prep.bloqueadasFechado;
      avisos.push(...prep.avisos);
      if (prep.datas.length === 0 && prep.bloqueadasFechado.length > 0) {
        await this.validarImportacaoNaoInvadeCicloFechado(servicoId, linhas);
      }
      datasUnicas = prep.datas;
    }

    // Criar registro de upload
    const upload = this.uploadRepo.create({
      nomeArquivo,
      totalLinhas: linhas.length,
      linhasImportadas: 0,
      linhasComErro: 0,
      linhasIgnoradas: 0,
      linhasSubstituidas: 0,
      linhasConflitantes: 0,
      estrategia,
      usuarioId: usuarioId || null,
      servico_id: servicoId || null,
      resumo: null,
    });
    const uploadSalvo = await this.uploadRepo.save(upload);
    const urlOriginal = await persistirArquivoOriginalUpload(
      uploadSalvo.id,
      buffer,
      nomeArquivo,
      datasUnicas.length ? datasUnicas[datasUnicas.length - 1] : undefined,
    );
    if (urlOriginal) uploadSalvo.urlDownload = urlOriginal;
    if (origem) await marcarOrigemPlanilhaUpload(uploadSalvo.id, origem);

    const datasApagadas: { data: string; registrosRemovidos: number }[] = [];
    const diasRemovidosAusentes: { data: string; registrosRemovidos: number }[] = [];
    let importados = 0;
    let ignorados = 0;
    let viagensInconsistentes = 0;
    let viagensCorrigidas = 0;

    // Se tem serviço, buscar upload IDs modificáveis (ciclos fechados protegidos)
    let uploadIds: number[] = [];
    if (servicoId) {
      uploadIds = await obterUploadIdsModificaveis(servicoId);
    }

    // ─── Decidir quais datas importar ───
    const datasParaImportar: string[] = [];

    if (estrategia === 'atualizar_data') {
      if (servicoId && datasUnicas.length > 0) {
        datasApagadas.push(...await apagarDatasDeUploadsAbertos(servicoId, datasUnicas));

        if (uploadIds.length > 0) {
          const diasSistemaRows = await this.coletaRepo.createQueryBuilder('c')
            .select("DISTINCT to_char(c.dataSaida, 'YYYY-MM-DD')", 'data')
            .where('c.planilhaUploadId IN (:...uploadIds)', { uploadIds })
            .andWhere('c.dataSaida IS NOT NULL')
            .orderBy('data', 'ASC')
            .getRawMany<{ data: string }>();

          const diasSistema = diasSistemaRows
            .map((r) => r.data)
            .filter((d): d is string => Boolean(d))
            .filter((d) => (
              !cicloAlvo || (d >= cicloAlvo.dataInicio && d <= cicloAlvo.dataFim)
            ));

          const buracos = limitarDiasAusentesAoPeriodoDaPlanilha(
            diasSistema,
            datasUnicas,
          );
          diasRemovidosAusentes.push(...await apagarDatasDeUploadsAbertos(servicoId, buracos));
        }
      }
      datasParaImportar.push(...datasUnicas);
    } else {
      // 'inserir_data': só importa datas que NÃO existem
      if (uploadIds.length > 0) {
        for (const dataStr of datasUnicas) {
          const count = await this.coletaRepo.createQueryBuilder('c')
            .where('c.planilhaUploadId IN (:...uploadIds)', { uploadIds })
            .andWhere('c.dataSaida = :data', { data: dataStr })
            .getCount();

          if (count === 0) {
            datasParaImportar.push(dataStr);
          }
        }
      } else {
        datasParaImportar.push(...datasUnicas);
      }
    }

    const datasSet = new Set(datasParaImportar);

    // ─── Inserir registros ───
    const batch: ColetaData[] = [];
    const BATCH_SIZE = 500;

    for (const linha of linhas) {
      if (!linha.dataSaida) {
        ignorados++;
        continue;
      }
      const chaveData = linha.dataSaida.toISOString().slice(0, 10);

      if (!datasSet.has(chaveData)) {
        ignorados++;
        continue;
      }

      try {
        const coleta = this.montarColetaDeLinha(linha, uploadSalvo.id);
        const validacao = prepararViagemParaImportacao(coleta);
        if (validacao.correcoes?.length) viagensCorrigidas++;
        if (validacao.descartada) continue;
        if (!validacao.validoDashboard) {
          viagensInconsistentes++;
          ignorados++;
          continue;
        }
        batch.push(coleta);
        importados++;

        if (batch.length >= BATCH_SIZE) {
          await this.coletaRepo.save(batch);
          batch.length = 0;
        }
      } catch (err) {
        // Linha com erro é ignorada
      }
    }

    if (batch.length > 0) {
      await this.coletaRepo.save(batch);
    }

    // ─── Atualizar metadados do upload ───
    uploadSalvo.linhasImportadas = importados;
    uploadSalvo.linhasIgnoradas = ignorados;
    uploadSalvo.linhasSubstituidas = estrategia === 'atualizar_data' ? importados : 0;
    uploadSalvo.resumo = {
      novos: importados,
      duplicadosIgnorados: ignorados,
      conflitantes: 0,
      substituidos: estrategia === 'atualizar_data' ? importados : 0,
      viagensInconsistentes,
      viagensValidasDashboard: importados,
      viagensCorrigidas,
    };
    await this.uploadRepo.save(uploadSalvo);

    if (servicoId) {
      const diaInicio = await this.obterDiaInicioCicloServico(servicoId);
      await aplicarReferenciaCicloNoUpload(uploadSalvo.id, datasUnicas, diaInicio);
    }

    // ⭐ Pós-importação: limpeza de duplicatas via SQL (rede de segurança)
    const duplicatasRemovidas = await this.limparDuplicatas(servicoId);
    importados = await this.sincronizarContagemUploadAposDedup(uploadSalvo.id);

    let consolidacao: {
      registrosRemovidosAusentes: number;
      diasRemovidosAusentes: string[];
      uploadsRemovidos: number;
      uploadsRemovidosIds: number[];
    } | undefined;

    // Substituição por data: remove planilhas antigas vazias (dias ausentes já foram apagados)
    if (estrategia === 'atualizar_data' && servicoId) {
      const limpeza = await this.consolidarUploadsAposSubstituicao(servicoId, uploadSalvo.id);
      consolidacao = {
        registrosRemovidosAusentes: diasRemovidosAusentes.reduce((s, d) => s + d.registrosRemovidos, 0),
        diasRemovidosAusentes: diasRemovidosAusentes.map((d) => d.data),
        uploadsRemovidos: limpeza.uploadsRemovidos,
        uploadsRemovidosIds: limpeza.uploadsRemovidosIds,
      };
      importados = await this.sincronizarContagemUploadAposDedup(uploadSalvo.id);

      const uploadAtual = await this.uploadRepo.findOne({ where: { id: uploadSalvo.id } });
      if (uploadAtual) {
        uploadAtual.resumo = {
          ...(uploadAtual.resumo || {
            novos: importados,
            duplicadosIgnorados: ignorados,
            conflitantes: 0,
            substituidos: importados,
          }),
          viagensValidasDashboard: importados,
          consolidacao: {
            registrosRemovidosAusentes: consolidacao.registrosRemovidosAusentes,
            uploadsRemovidos: consolidacao.uploadsRemovidos,
            diasRemovidosAusentes: consolidacao.diasRemovidosAusentes,
          },
        };
        await this.uploadRepo.save(uploadAtual);
      }
    }

    if (servicoId) {
      invalidarCacheDadosServico(servicoId);
      invalidarCacheDashboardServico(servicoId);
      dashboardCache.invalidar(servicoId);
      agendarWarmupPosUpload(servicoId);
      invalidarCacheSaudeContratos();
      void recalcularTotaisDiaServicoSilencioso(servicoId);
    }

    return {
      planilhaUploadId: uploadSalvo.id,
      totalLinhas: linhas.length,
      importados,
      ignorados,
      datasExistentes: datasApagadas.length,
      datasNovas: datasParaImportar.length,
      datasApagadas,
      diasRemovidosAusentes,
      datasIgnoradasCicloFechado,
      avisos,
      modo: estrategia,
      viagensInconsistentes,
      viagensValidasDashboard: importados,
      viagensCorrigidas,
      duplicatasRemovidasSql: duplicatasRemovidas,
      consolidacao,
    };
  }

  /**
   * Filtra chaves artefato do Excel
   */
  private filtrarChavesVazias(linha: Record<string, any>): Record<string, any> {
    const resultado: Record<string, any> = {};
    for (const [chave, valor] of Object.entries(linha)) {
      const nome = (chave || '').trim();
      if (!nome || nome.startsWith('__EMPTY')) continue;
      if (valor === null || valor === undefined || valor === '') continue;
      resultado[chave] = valor;
    }
    return resultado;
  }
}

export default new DeduplicacaoService();
