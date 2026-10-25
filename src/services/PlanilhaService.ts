import * as XLSX from 'xlsx';
import { Repository } from 'typeorm';
import AppDataSource from '../database/data-source';
import { ColetaData } from '../entities/ColetaData';
import { PlanilhaUpload } from '../entities/PlanilhaUpload';
import { ColetaTotaisDia } from '../entities/ColetaTotaisDia';
import FileStorageService from './FileStorageService';
import { detectarPadraoPlanilha, isNomeColunaInvalido } from './PadraoPlanilhaDetector';
import { Servico } from '../entities/Servico';
import { Contract } from '../entities/Contract';
import { User } from '../entities/User';
import { gerarConfigGraficosPadrao, reResolverGraficos } from './graficosPadrao';
import {
  aplicarFiltroViagensValidasDashboard,
  prepararViagemParaImportacao,
  sanitizarViagem as sanitizarViagemCampos,
  enriquecerCamposColeta,
  validarViagemParaDashboard,
} from './validacaoViagemService';
import { sqlDataIsoDia, sqlExprPesoEfetivoKg, sqlSumPesoEfetivoKg, sqlSumViagens } from './viagensPorRotaService';
import { sqlAreaM2, sqlKmLinear, sqlMetroLinear, sqlQtdArvore, sqlQuantitativo } from './metricaServicoSql';
import { TipoServico } from '../enums/TipoServico';
import { sqlSomenteUploadVigenteDoDia } from './uploadVisivelRelatorio';
import { deduplicarKpisLista } from './kpiDeduplicacaoService';
import { invalidarCacheDadosServico } from './servicoDadosCache';
import { invalidarCacheDashboardServico } from './comparacaoCache';
import { recalcularTotaisDiaServicoSilencioso } from './coletaTotaisDiaService';
import { normalizarTextoTipoCaminhao } from '../config/pesoMaximoCaminhao';
import { numeroPlanilha } from './FormulaEngine';
import { diffHorasSaidaChegada } from './horasProdutivasService';
import { aplicarLimitesTextoColeta } from '../utils/textoColunaColeta';

interface LinhaPlanilha {
  [key: string]: any;
}

interface ResultadoImportacao {
  planilhaUploadId: number;
  totalLinhas: number;
  importadas: number;
  erros: number;
  viagensInconsistentes?: number;
  viagensValidasDashboard?: number;
  linhasDescartadasSemDados?: number;
}

/** Mesma expressão de peso do ciclo, para resumo, regional, dia, placa e motorista. */
function sqlMediaPesoEfetivoKg(alias = 'c'): string {
  return `AVG(${sqlExprPesoEfetivoKg(alias)})`;
}

/** kg da planilha → t (se o dia ainda parecer kg, divide de novo). */
function toneladasDoPesoKg(pesoTotalKg: number): number {
  const kg = Number(pesoTotalKg);
  if (!Number.isFinite(kg) || kg <= 0) return 0;
  let t = kg / 1000;
  while (t >= 10_000) t /= 1000;
  return t;
}

/**
 * Serviço para processamento de planilhas de coleta
 * 
 * Mapeamento de colunas esperado:
 *   DATA SAIDA, TURNO, REGIONAL, DISTRITO, PLACA, MOTORISTA,
 *   Nº DE COLETORES, KM SAIDA, HORA SÁIDA, KM CHEGADA, HORA CHEGADA,
 *   HORA ULTIMO TÉRMINO DO CARREGAMENTO,
 *   PESO 1, PESO 2, PESO 3, PESO 4, PESO 5, PESO TOTAL,
 *   TEMPO FORA DA UNIDADE, HORAS QUE FICA FORA DA UNIDADE,
 *   CAMINHÃO, KM TOTAL, Nº DE VIAGENS, DIA DA SEMANA...
 */
export class PlanilhaService {
  // Resolvidos a cada uso: com um banco por contrato, o banco ativo muda por requisição.
  private get coletaRepo(): Repository<ColetaData> {
    return AppDataSource.getRepository(ColetaData);
  }

  private get uploadRepo(): Repository<PlanilhaUpload> {
    return AppDataSource.getRepository(PlanilhaUpload);
  }

  private get servicoRepo(): Repository<Servico> {
    return AppDataSource.getRepository(Servico);
  }

  /**
   * Processa e importa dados de uma planilha XLSX
   * @param buffer - Conteúdo do arquivo em Buffer
   * @param nomeArquivo - Nome original do arquivo
   * @param usuarioId - ID do usuário que fez upload
   */
  async importarPlanilha(
    buffer: Buffer,
    nomeArquivo: string,
    usuarioId?: string,
    mimeType?: string,
    servicoId?: string
  ): Promise<ResultadoImportacao> {
    // Ler workbook
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });

    // Pegar primeira aba (ou a que tiver dados)
    const nomeAba = workbook.SheetNames[0];
    const sheet = workbook.Sheets[nomeAba];

    // Converter para JSON (raw para manter valores numéricos)
    const linhas: LinhaPlanilha[] = XLSX.utils.sheet_to_json(sheet, {
      defval: null,
      raw: true,
    });

    if (linhas.length === 0) {
      throw new Error('Planilha vazia ou sem dados na primeira aba.');
    }

    // Criar registro de upload
    const upload = this.uploadRepo.create({
      nomeArquivo,
      totalLinhas: linhas.length,
      linhasImportadas: 0,
      linhasComErro: 0,
      usuarioId: usuarioId || null,
      servico_id: servicoId || null,
    });
    const uploadSalvo = await this.uploadRepo.save(upload);

    let importadas = 0;
    let erros = 0;
    let linhasIgnoradas = 0;
    let registrosLimpos = 0;
    let viagensInconsistentes = 0;
    let linhasDescartadasSemDados = 0;
    let viagensCorrigidas = 0;

    // Processar em lotes para performance
    const batch: ColetaData[] = [];
    const BATCH_SIZE = 500;

    for (const linha of linhas) {
      try {
        const coleta = this.mapearLinha(linha, uploadSalvo.id);
        if (!coleta) {
          erros++;
          continue;
        }

        coleta.dados = this.filtrarChavesVazias(linha);
        this.mapearPorPalavrasChave(coleta, linha);
        aplicarLimitesTextoColeta(coleta);

        const validacao = prepararViagemParaImportacao(coleta);
        if (validacao.descartada) {
          linhasDescartadasSemDados++;
          continue;
        }
        if (validacao.correcoes?.length) viagensCorrigidas++;
        if (!validacao.validoDashboard) {
          viagensInconsistentes++;
          linhasIgnoradas++;
          if (validacao.motivos.some(m => m.includes('negativo'))) registrosLimpos++;
          continue;
        }

        batch.push(coleta);
        importadas++;

        if (batch.length >= BATCH_SIZE) {
          await this.coletaRepo.save(batch);
          batch.length = 0;
        }
      } catch (err) {
        erros++;
      }
    }

    // Salvar lote final
    if (batch.length > 0) {
      await this.coletaRepo.save(batch);
    }

    if (linhasDescartadasSemDados > 0) {
      console.log(`[PlanilhaService] 🗑️ ${linhasDescartadasSemDados} linha(s) ignorada(s) (sem placa, KM Total e Peso Total).`);
    }
    if (viagensInconsistentes > 0) {
      console.log(`[PlanilhaService] ⛔ ${viagensInconsistentes} linha(s) rejeitada(s) na importação (não salvas no sistema). ${importadas} viagem(ns) válida(s) importada(s).`);
    }
    if (registrosLimpos > 0) {
      console.log(`[PlanilhaService] 🧹 ${registrosLimpos} linha(s) com valores negativos foram rejeitadas.`);
    }

    // Atualizar metadados do upload
    uploadSalvo.linhasImportadas = importadas;
    uploadSalvo.linhasIgnoradas = linhasIgnoradas;
    uploadSalvo.linhasComErro = erros;
    uploadSalvo.resumo = {
      novos: importadas,
      duplicadosIgnorados: linhasIgnoradas,
      conflitantes: 0,
      substituidos: 0,
      viagensInconsistentes,
      viagensValidasDashboard: importadas,
      linhasDescartadasSemDados,
      viagensCorrigidas,
    };

    // Salvar planilha no MinIO para download futuro
    try {
      const mt = mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      const urlDownload = await FileStorageService.uploadArquivo(buffer, nomeArquivo, mt);
      uploadSalvo.urlDownload = urlDownload;
    } catch (err) {
      console.warn('[PlanilhaService] Erro ao salvar planilha no MinIO:', err);
      // Não falha o processo — apenas não terá link de download
    }

    await this.uploadRepo.save(uploadSalvo);

    if (servicoId) {
      invalidarCacheDadosServico(servicoId);
      invalidarCacheDashboardServico(servicoId);
      void recalcularTotaisDiaServicoSilencioso(servicoId);
    }

    // Detectar padrão e salvar no serviço (se vinculado)
    if (servicoId) {
      try {
        const servico = await this.servicoRepo.findOne({ where: { id: servicoId } });
        if (servico) {
          const colunas = detectarPadraoPlanilha(buffer);
          const colunasNomes = colunas.map((c: any) => c.nome);

          // Identificar colunas numéricas candidatas a KPIs
          const colunasNumericas = colunas.filter(c => c.tipo === 'numero').map(c => c.nome);

          // Salvar padrão + sugestão de indicadores
          servico.padraoPlanilha = {
            colunas,
            totalLinhas: linhas.length,
            ultimoUpload: uploadSalvo.id,
            ultimoUploadNome: nomeArquivo,
            detectadoEm: new Date().toISOString(),
          };

          // ═══════════════════════════════════════════════════════════════
          // ATUALIZAR configDashboard — PRESERVAR gráficos existentes
          // ═══════════════════════════════════════════════════════════════

          const configAtual = servico.configDashboard || {};
          const graficosAtuais = configAtual.graficos || [];
          const kpisAtuais = configAtual.kpis || [];

          // 1️⃣ RE-RESOLVER placeholders dos gráficos padrão com as colunas reais
          let graficosReResolvidos = graficosAtuais;
          if (graficosAtuais.length > 0) {
            graficosReResolvidos = reResolverGraficos(graficosAtuais, colunasNomes);
          }

          // 2️⃣ Se não tinha gráficos antes, gerar a partir do padrão
          if (graficosReResolvidos.length === 0) {
            const tipoServico = servico.tipo || 'coleta_caminhao';
            graficosReResolvidos = gerarConfigGraficosPadrao(tipoServico, colunasNomes);
          }

          // 3️⃣ KPIs: colunas numéricas (soma) + colunas de texto relevantes (contagem)
          const colunasTextoRelevantes = colunas.filter(c =>
            c.tipo === 'texto' &&
            (c.valoresUnicos > 0 && c.valoresUnicos <= 200)
          );

          const kpisGerados: any[] = [];

          // Adiciona KPIs de soma para colunas numéricas (máx 4)
          for (const nome of colunasNumericas.slice(0, 4)) {
            kpisGerados.push({ nome, label: nome, agregacao: 'sum', formato: 'numero', ativo: true });
          }

          // Adiciona KPIs de contagem para colunas de texto relevantes (máx 6)
          for (const col of colunasTextoRelevantes.slice(0, 6)) {
            kpisGerados.push({ nome: col.nome, label: col.nome, agregacao: 'count', formato: 'numero', ativo: true });
          }

          // 4️⃣ MERGE: manter KPIs existentes + adicionar novos (evitando duplicatas por nome)
          const nomesKpisExistentes = new Set(kpisAtuais.map((k: any) => k.nome));
          const kpisNovos = kpisGerados
            .filter((k: any) => !nomesKpisExistentes.has(k.nome))
            .map((k: any) => ({ ...k, automatico: true }));
          const { kpis: kpisMerge } = deduplicarKpisLista(
            [...kpisAtuais, ...kpisNovos],
            { manterInativos: true },
          );

          servico.configDashboard = {
            ...configAtual,
            kpis: kpisMerge,
            graficos: graficosReResolvidos,
            reResolvidoEm: new Date().toISOString(),
            reResolvido: true,
            graficosPadraoAplicados: true,
            graficosPadraoTotal: graficosReResolvidos.length,
          };

          await this.servicoRepo.save(servico);
        }
      } catch (err) {
        console.warn('[PlanilhaService] Erro ao detectar padrão:', err);
        // Não falha o processo principal
      }
    }

    return {
      planilhaUploadId: uploadSalvo.id,
      totalLinhas: linhas.length,
      importadas,
      erros,
      viagensInconsistentes,
      viagensValidasDashboard: importadas,
      linhasDescartadasSemDados,
    };
  }

  /**
   * Mapeia uma linha da planilha para a entidade ColetaData
   */
  private mapearLinha(linha: LinhaPlanilha, planilhaUploadId: number): ColetaData | null {
    // Pular linhas totalmente vazias
    const valores = Object.values(linha).filter(v => v !== null && v !== '');
    if (valores.length === 0) return null;

    const coleta = new ColetaData();
    coleta.planilhaUploadId = planilhaUploadId;

    // DATA SAIDA - número serial Excel
    const dataSerial = this.getNum(linha, 'DATA SAIDA');
    coleta.dataSaida = dataSerial ? ColetaData.fromExcelDate(dataSerial) : null;

    coleta.turno = this.getStr(linha, 'TURNO');
    coleta.regional = this.getStr(linha, 'REGIONAL');
    coleta.distrito = this.getStr(linha, 'DISTRITO');
    coleta.placa = this.getStr(linha, 'PLACA');
    coleta.motorista = this.getStr(linha, 'MOTORISTA');
    coleta.numeroColetores = this.getInt(linha, 'Nº DE COLETORES');

    coleta.kmSaida = this.getNum(linha, 'KM SAIDA');
    coleta.horaSaida = this.getNum(linha, 'HORA SÁIDA');
    coleta.kmChegada = this.getNum(linha, 'KM CHEGADA');
    coleta.horaChegada = this.getNum(linha, 'HORA CHEGADA');
    coleta.horaUltimoTerminoCarregamento = this.getNum(linha, 'HORA ULTIMO TÉRMINO DO CARREGAMENTO');

    coleta.peso1 = this.getNum(linha, 'PESO 1');
    coleta.peso2 = this.getNum(linha, 'PESO 2');
    coleta.peso3 = this.getNum(linha, 'PESO 3');
    coleta.peso4 = this.getNum(linha, 'PESO 4');
    coleta.peso5 = this.getNum(linha, 'PESO 5');
    coleta.pesoTotal = this.getNum(linha, 'PESO TOTAL');

    coleta.tempoForaUnidade = this.getNum(linha, 'TEMPO FORA DA UNIDADE');
    coleta.horasForaUnidade = this.getNum(linha, 'HORAS QUE FICA FORA DA UNIDADE');
    coleta.tipoCaminhao = normalizarTextoTipoCaminhao(
      this.getStr(linha, 'TIPO DE CAMINHÃO')
      || this.getStr(linha, 'TIPO CAMINHAO')
      || this.getStr(linha, 'TIPO VEICULO')
      || null,
    );
    coleta.kmTotal = this.getNum(linha, 'KM TOTAL');
    coleta.numeroViagens = this.getInt(linha, 'CONTADOR DE VIAGENS')
      ?? this.getInt(linha, 'CONTADOR VIAGENS')
      ?? this.getInt(linha, 'Nº DE VIAGENS')
      ?? this.getInt(linha, 'NUMERO DE VIAGENS')
      ?? this.getInt(linha, 'NÚMERO DE VIAGENS')
      ?? this.getInt(linha, 'NR VIAGENS');

    // Dia da semana (1=domingo a 7=sábado)
    const diaSemana = this.getNum(linha, 'DIA DA SEMANA');
    // Pode estar com \r\n no nome
    coleta.diaSemana = diaSemana ? Math.round(diaSemana) : null;

    return coleta;
  }

  /**
   * 🧹 Sanitiza uma viagem — garante que KM Total, Peso Total e demais
   * campos numéricos nunca sejam negativos, evitando que dados corrompidos
   * afetem os dashboards.
   * 
   * Valores negativos são convertidos para null, pois indicam:
   * - Erro de leitura do hodômetro (km negativo)
   * - Erro de digitação ou balança (peso negativo)
   * - Dados faltantes preenchidos como -1, -999, etc.
   * 
   * A tratativa é feita por viagem (cada registro individual),
   * preservando os demais campos mesmo quando um é invalidado.
   * 
   * @returns true se algum campo foi corrigido, false caso contrário
   */
  /** @deprecated use validacaoViagemService.sanitizarViagem */
  private sanitizarViagem(coleta: ColetaData): boolean {
    return sanitizarViagemCampos(coleta);
  }

  // ── Helpers ──

  /**
   * Normaliza uma chave para comparação: remove acentos, espaços, caracteres especiais,
   * quebras de linha e sufixos como "BASE", "ROTA 01", "ROTA 02", "\r\n..."
   */
  private normalizarChave(chave: string): string {
    return chave
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')            // remove acentos
      .replace(/[\r\n]+/g, ' ')                    // quebras de linha → espaço
      .replace(/[^A-Z0-9\s]/g, '')                 // remove caracteres especiais
      .replace(/\s+(BASE|ROTA\s*\d+)\s*/g, ' ')   // remove sufixos "BASE", "ROTA 01", etc.
      .replace(/\s+/g, '')                         // remove todos os espaços
      .trim();
  }

  /**
   * Tenta encontrar o valor de uma chave no objeto usando:
   * 1. Match exato
   * 2. Match com trim
   * 3. Match com espaços ao redor
   * 4. Match por normalização (nível 2)
   */
  private encontrarChave(obj: any, key: string): string | null {
    // Nível 1: match exato ou com variações de espaços
    if (obj[key] !== undefined && obj[key] !== null) return key;
    if (obj[key.trim()] !== undefined && obj[key.trim()] !== null) return key.trim();
    if (obj[' ' + key + ' '] !== undefined && obj[' ' + key + ' '] !== null) return ' ' + key + ' ';
    if (obj[' ' + key] !== undefined && obj[' ' + key] !== null) return ' ' + key;
    if (obj[key + ' '] !== undefined && obj[key + ' '] !== null) return key + ' ';

    // Nível 2: normalização (remove acentos, espaços, sufixos)
    const keyNorm = this.normalizarChave(key);
    const chaves = Object.keys(obj);
    for (const ch of chaves) {
      const chNorm = this.normalizarChave(ch);
      // Testa se a chave normalizada esperada está CONTIDA na chave real normalizada
      // Ex: "KMSAIDA" está contido em "KMSAIDABASE" → match!
      if (keyNorm.length > 0 && chNorm.includes(keyNorm)) {
        return ch;
      }
      // Inverso só com chave real específica — senão "PESO 2" casa com "id"/"O"
      if (chNorm.length >= 5 && keyNorm.includes(chNorm)) {
        return ch;
      }
    }

    return null;
  }

  private getStr(obj: any, key: string): string | null {
    const chaveEncontrada = this.encontrarChave(obj, key);
    if (!chaveEncontrada) return null;
    const valor = obj[chaveEncontrada];
    if (valor === null || valor === undefined) return null;
    const str = String(valor).trim();
    return str || null;
  }

  private getNum(obj: any, key: string): number | null {
    const chaveEncontrada = this.encontrarChave(obj, key);
    if (!chaveEncontrada) return null;
    const valor = obj[chaveEncontrada];
    if (valor === null || valor === undefined) return null;
    return numeroPlanilha(valor);
  }

  private getInt(obj: any, key: string): number | null {
    const num = this.getNum(obj, key);
    return num !== null ? Math.round(num) : null;
  }

  /**
   * Filtra chaves que são artefatos do Excel (ex: __EMPTY, __EMPTY_1)
   * ou que têm valor nulo/undefined em todas as linhas
   */
  private filtrarChavesVazias(linha: LinhaPlanilha): Record<string, any> {
    const resultado: Record<string, any> = {};
    for (const [chave, valor] of Object.entries(linha)) {
      // Pular colunas artefato do Excel (__EMPTY) ou sem nome
      if (isNomeColunaInvalido(chave)) continue;
      // Pular valores totalmente vazios
      if (valor === null || valor === undefined || valor === '') continue;
      resultado[chave] = valor;
    }
    return resultado;
  }

  /**
   * Mapeamento por palavras-chave (nível 3 - fallback inteligente)
   * 
   * Substitui o antigo mapearGenerico com regras mais específicas:
   * - Prioriza colunas específicas sobre genéricas (ex: "KM TOTAL" > "KM SAIDA BASE")
   * - Detecta "TIPO DE CAMINHÃO" (com Ã) corretamente
   * - Calcula horas produtivas a partir de HORA CHEGADA BASE - HORA SÁIDA BASE
   * - Detecta CONTADOR DE VIAGENS e DIA DA SEMANA com \r\n
   */
  private mapearPorPalavrasChave(coleta: ColetaData, linha: LinhaPlanilha): void {
    const chaves = Object.keys(linha);
    
    // ─── Fase 1: coletar informações sobre todas as colunas ───
    const colunas: { chave: string; normalizada: string; valor: any; numerico: number | null }[] = [];
    
    for (const chave of chaves) {
      const valor = linha[chave];
      const num = numeroPlanilha(valor);
      colunas.push({
        chave,
        normalizada: this.normalizarChave(chave),
        valor,
        numerico: num,
      });
    }

    // Helper para encontrar coluna por palavra-chave na normalizada
    const encontrarPorNorm = (palavra: string): typeof colunas[0] | undefined => {
      const norm = this.normalizarChave(palavra);
      return colunas.find(c => c.normalizada.includes(norm));
    };

    // ─── Fase 2: mapear cada campo ───

    // DATA SAIDA (já pode ter sido mapeado pelo nível 1)
    if (!coleta.dataSaida) {
      const colData = encontrarPorNorm('DATA');
      if (colData && colData.numerico && colData.numerico > 40000 && colData.numerico < 60000) {
        coleta.dataSaida = ColetaData.fromExcelDate(colData.numerico);
      }
    }

    // TURNO
    if (!coleta.turno) {
      const col = encontrarPorNorm('TURNO');
      if (col) coleta.turno = String(col.valor).trim();
    }

    // REGIONAL
    if (!coleta.regional) {
      const col = encontrarPorNorm('REGIONAL');
      if (col) coleta.regional = String(col.valor).trim();
    }

    // DISTRITO
    if (!coleta.distrito) {
      const col = encontrarPorNorm('DISTRITO');
      if (col) coleta.distrito = String(col.valor).trim();
    }

    // PLACA (evitar confundir com "PLACA BASE" ou similar)
    if (!coleta.placa) {
      const colPlaca = colunas.find(c =>
        c.normalizada === 'PLACA' || c.normalizada.match(/^PLACA$/)
      );
      if (colPlaca) {
        coleta.placa = String(colPlaca.valor).trim();
      } else {
        // Fallback: PROCURAR por PLACA no início ou exato
        const col = colunas.find(c =>
          c.normalizada.startsWith('PLACA') && !c.normalizada.includes('BASE')
        );
        if (col) coleta.placa = String(col.valor).trim();
      }
    }

    // MOTORISTA
    if (!coleta.motorista) {
      const col = encontrarPorNorm('MOTORISTA');
      if (col) coleta.motorista = String(col.valor).trim();
    }

    // Nº DE COLETORES
    if (!coleta.numeroColetores) {
      const col = encontrarPorNorm('COLETORES');
      if (col && col.numerico !== null) coleta.numeroColetores = Math.round(col.numerico);
    }

    // KM SAIDA (hodômetro de partida) - NÃO confundir com KM TOTAL
    if (!coleta.kmSaida) {
      const col = colunas.find(c =>
        c.normalizada.includes('KMSAIDA') || c.normalizada.includes('KMSAIDABASE')
      );
      if (col && col.numerico !== null) coleta.kmSaida = col.numerico;
    }

    // HORA SÁIDA da base — não usar HORA SAÍDA ROTA (fim do trecho)
    if (!coleta.horaSaida) {
      const col = colunas.find(c =>
        !c.normalizada.includes('ROTA')
        && (c.normalizada.includes('HORASAIDABASE') || c.normalizada.includes('HRSAIDABASE') || c.normalizada === 'HORASAIDA')
      );
      if (col && col.numerico !== null) coleta.horaSaida = col.numerico;
    }

    // KM CHEGADA
    if (!coleta.kmChegada) {
      const col = colunas.find(c =>
        c.normalizada.includes('KMCHEGADA') || c.normalizada.includes('KMCHEGADAROTA')
      );
      if (col && col.numerico !== null) coleta.kmChegada = col.numerico;
    }

    // HORA CHEGADA na base — não usar HORA CHEGADA ROTA (início do trecho)
    if (!coleta.horaChegada) {
      const col = colunas.find(c =>
        !c.normalizada.includes('ROTA')
        && (c.normalizada.includes('HORACHEGADABASE') || c.normalizada.includes('HRCHEGABASE') || c.normalizada === 'HORACHEGADA')
      );
      if (col && col.numerico !== null) coleta.horaChegada = col.numerico;
    }

    // PESO TOTAL (priorizar "PESO TOTAL" sobre "PESO 1", "PESO 2" etc.)
    if (!coleta.pesoTotal) {
      const col = colunas.find(c =>
        c.normalizada.includes('PESOTOTAL') || c.normalizada === 'PESO'
      );
      if (col && col.numerico !== null) {
        coleta.pesoTotal = col.numerico;
      } else {
        // Fallback: somar PESO 1 + PESO 2 + ... + PESO 5
        let somaPesos = 0;
        for (let i = 1; i <= 5; i++) {
          const p = colunas.find(c => c.normalizada === `PESO${i}`);
          if (p && p.numerico !== null) somaPesos += p.numerico;
        }
        if (somaPesos > 0) coleta.pesoTotal = somaPesos;
      }
    }

    // TIPO DE CAMINHÃO (com Ã - normalização resolve)
    // Pode vir como "TIPO DE CAMINHÃO", "TIPO CAMINHAO", "CAMINHÃO", "TIPO VEICULO"
    if (!coleta.tipoCaminhao) {
      const col = colunas.find(c =>
        c.normalizada.includes('TIPOCAMINHAO') || c.normalizada.includes('TIPODECAMINHAO') ||
        c.normalizada.includes('CAMINHAO') || c.normalizada.includes('TIPOVEICULO')
      );
      if (col) {
        const val = String(col.valor).trim();
        // Excluir se for placa (formato letras+números) ou número puro
        if (!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(val.toUpperCase()) && !/^\d+$/.test(val)) {
          coleta.tipoCaminhao = normalizarTextoTipoCaminhao(val);
        }
      }
    }

    // KM TOTAL (distância percorrida) - tem prioridade sobre KM SAIDA
    if (!coleta.kmTotal) {
      const col = colunas.find(c =>
        c.normalizada.includes('KMTOTAL') || c.normalizada === 'KM'
      );
      if (col && col.numerico !== null) coleta.kmTotal = col.numerico;
    }

    // CONTADOR DE VIAGENS (coluna padrão da planilha modelo coleta)
    if (!coleta.numeroViagens) {
      const colContador = colunas.find(c =>
        c.normalizada.includes('CONTADORDEVIAGENS') || c.normalizada.includes('CONTADORVIAGENS')
      );
      if (colContador && colContador.numerico !== null) {
        coleta.numeroViagens = Math.round(colContador.numerico);
      } else {
        const col = colunas.find(c =>
          c.normalizada.includes('NRVIAGENS') || c.normalizada.includes('NUMERODEVAGENS') ||
          (c.normalizada.includes('VIAGENS') && !c.normalizada.includes('CONTADOR'))
        );
        if (col && col.numerico !== null) coleta.numeroViagens = Math.round(col.numerico);
      }
    }

    // DIA DA SEMANA (pode ter \r\n no nome)
    if (!coleta.diaSemana) {
      const col = colunas.find(c =>
        c.normalizada.includes('DIASEMANA') || c.normalizada.includes('DIADASEMANA')
      );
      if (col && col.numerico !== null) coleta.diaSemana = Math.round(col.numerico);
    }

    // ─── VIAGENS/ROTAS (até 4) ───
    // Mapeia colunas como "KM ROTA 01", "HORA ROTA 01", "KM CHEGADA ROTA 02", etc.
    for (let i = 1; i <= 4; i++) {
      const kmField = `kmRota${i}` as keyof ColetaData;
      const horaField = `horaRota${i}` as keyof ColetaData;
      const rotStr = String(i).padStart(2, '0'); // "01", "02", etc.

      // KM da rota
      if (!coleta[kmField]) {
        const colKm = colunas.find(c =>
          c.normalizada.includes(`KMROTA${rotStr}`) ||
          c.normalizada.includes(`KMROTA${i}`) ||
          c.normalizada.includes(`KMCHEGADAROTA${rotStr}`) ||
          c.normalizada.includes(`KMCHEGADAROTA${i}`) ||
          (c.normalizada.includes('KM') && c.normalizada.includes(`ROTA${rotStr}`)) ||
          (c.normalizada.includes('KM') && c.normalizada.includes(`ROTA${i}`))
        );
        if (colKm && colKm.numerico !== null) (coleta as any)[kmField] = colKm.numerico;
      }

      // HORA da rota
      if (!coleta[horaField]) {
        const colHora = colunas.find(c =>
          c.normalizada.includes(`HORAROTA${rotStr}`) ||
          c.normalizada.includes(`HORAROTA${i}`) ||
          c.normalizada.includes(`HORACHEGADAROTA${rotStr}`) ||
          c.normalizada.includes(`HORACHEGADAROTA${i}`) ||
          c.normalizada.includes(`HORASAIDAROTA${rotStr}`) ||
          c.normalizada.includes(`HORASAIDAROTA${i}`) ||
          (c.normalizada.includes('HORA') && c.normalizada.includes(`ROTA${rotStr}`)) ||
          (c.normalizada.includes('HORA') && c.normalizada.includes(`ROTA${i}`))
        );
        if (colHora && colHora.numerico !== null) (coleta as any)[horaField] = colHora.numerico;
      }
    }

    // Jornada base→base, mesma regra de HORAS_PRODUTIVAS (inclui virada de dia).
    // Registros já gravados não são recalculados aqui.
    if (!coleta.horasForaUnidade && !coleta.tempoForaUnidade) {
      if (coleta.horaSaida !== null && coleta.horaChegada !== null) {
        const diff = diffHorasSaidaChegada(Number(coleta.horaSaida), Number(coleta.horaChegada));
        if (diff > 0 && diff <= 24) coleta.horasForaUnidade = diff;
      }
    }

  }

  /**
   * Retorna dados agregados para o dashboard
   */
  async getDashboardData(filtros?: {
    dataInicio?: string;
    dataFim?: string;
    regional?: string;
    distrito?: string;
    planilhaId?: number;
  }) {
    const queryBuilder = this.coletaRepo.createQueryBuilder('c');
    aplicarFiltroViagensValidasDashboard(queryBuilder, 'c');
    queryBuilder.select([
        'COUNT(*) as total_registros',
        `${sqlSumPesoEfetivoKg('c')} as total_peso`,
        `${sqlMediaPesoEfetivoKg('c')} as media_peso`,
        'SUM(c.kmTotal) as total_km',
        'AVG(c.kmTotal) as media_km',
        `${sqlSumViagens('c')} as total_viagens`,
        'COALESCE(AVG(c.viagensPorRota), 0) as media_viagens',
        'SUM(c.horasForaUnidade) as total_horas_fora',
        'AVG(c.horasForaUnidade) as media_horas_fora',
        'COUNT(DISTINCT c.placa) as total_caminhoes',
        'COUNT(DISTINCT c.motorista) as total_motoristas',
        'COUNT(DISTINCT c.regional) as total_regionais',
        'SUM(c.numeroColetores) as total_coletores',
        'SUM(CASE WHEN c.horasForaUnidade BETWEEN 0 AND 24 THEN c.horasForaUnidade ELSE 0 END) as total_horas_trabalhadas',
      ]);

    this.aplicarFiltroData(queryBuilder, filtros);

    const resultado = await queryBuilder.getRawOne();

    return {
      totalRegistros: Number(resultado?.total_registros || 0),
      totalPeso: Number(resultado?.total_peso || 0),
      mediaPeso: Number(resultado?.media_peso || 0),
      totalKm: Number(resultado?.total_km || 0),
      mediaKm: Number(resultado?.media_km || 0),
      totalViagens: Number(resultado?.total_viagens || 0),
      mediaViagens: Number(resultado?.media_viagens || 0),
      totalHorasFora: Number(resultado?.total_horas_fora || 0),
      mediaHorasFora: Number(resultado?.media_horas_fora || 0),
      totalCaminhoes: Number(resultado?.total_caminhoes || 0),
      totalMotoristas: Number(resultado?.total_motoristas || 0),
      totalRegionais: Number(resultado?.total_regionais || 0),
      totalColetores: Number(resultado?.total_coletores || 0),
      totalHorasTrabalhadas: Number(resultado?.total_horas_trabalhadas || 0),
    };
  }

  /**
   * Retorna dados de coleta vinculados a um serviço (através dos uploads)
   * ⚡ OTIMIZADO: usa subquery direta em vez de carregar uploads em memória
   */
  async listarDadosPorServico(servicoId: string, page: number = 1, limit: number = 50, uploadId?: number): Promise<{ dados: ColetaData[]; total: number; pagina: number; totalPaginas: number }> {
    const skip = (page - 1) * limit;

    // Subquery: filtra ColetaData cujo planilhaUploadId está nos uploads do serviço
    const qb = this.coletaRepo.createQueryBuilder('c')
      .innerJoin(PlanilhaUpload, 'u', 'u.id = c.planilhaUploadId AND u.servico_id = :servicoId', { servicoId });

    if (uploadId) {
      qb.andWhere('c.planilhaUploadId = :uploadId', { uploadId });
    }

    const [dados, total] = await qb
      .orderBy('c.dataSaida', 'DESC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    return {
      dados,
      total,
      pagina: page,
      totalPaginas: Math.ceil(total / limit),
    };
  }

  /**
   * Retorna todos os dados brutos de um serviço (para cálculos de dashboard)
   * Faz o mapeamento reverso: converte nomes das propriedades da entidade
   * para os nomes originais das colunas (ex: pesoTotal → "PESO TOTAL")
   * 
   * ⚡ OTIMIZADO: usa subquery direta em vez de carregar uploads em memória
   * 
   * Corrige nomes com espaços extras (ex: " KM SAIDA " → "KM SAIDA")
   * e adiciona aliases para todos os nomes possíveis de cada coluna.
   */
  async getDadosBrutosPorServico(
    servicoId: string,
    limite: number = 1000,
    opts?: { apenasValidos?: boolean }
  ): Promise<Record<string, any>[]> {
    const apenasValidos = opts?.apenasValidos !== false;
    const qb = this.coletaRepo.createQueryBuilder('c')
      .innerJoin(PlanilhaUpload, 'u', 'u.id = c.planilhaUploadId AND u.servico_id = :servicoId', { servicoId });
    if (apenasValidos) {
      aplicarFiltroViagensValidasDashboard(qb, 'c');
    }
    const dados = await qb
      .orderBy('c.dataSaida', 'DESC')
      .take(limite)
      .getMany();
    if (dados.length === 0) return [];

    return this.converterColetasParaBrutos(dados, apenasValidos);
  }

  /**
   * Retorna todos os registros upados em uma data específica (consulta direta no banco).
   */
  async getDadosBrutosPorDia(
    servicoId: string,
    dataIso: string,
    opts?: {
      apenasValidos?: boolean;
      pularValidacaoViagem?: boolean;
      page?: number;
      limit?: number;
    },
  ): Promise<{
    dados: Record<string, any>[];
    total: number;
    pagina: number;
    totalPaginas: number;
    limit: number;
  }> {
    const apenasValidos = opts?.apenasValidos !== false;
    const pularValidacaoViagem = opts?.pularValidacaoViagem === true;
    const page = Math.max(1, opts?.page || 1);
    // Sem page/limit explícitos: comportamento legado (tudo). Com limit: pagina.
    const paginar = opts?.limit != null && opts.limit > 0;
    const limit = paginar ? Math.min(Math.max(opts!.limit!, 1), 500) : 0;

    const qb = this.coletaRepo.createQueryBuilder('c')
      .leftJoinAndSelect('c.planilhaUpload', 'upload')
      .innerJoin(PlanilhaUpload, 'u', 'u.id = c.planilhaUploadId AND u.servico_id = :servicoId', { servicoId })
      // dataSaida é meio-dia UTC — igualdade com 'YYYY-MM-DD' (00:00) não encontra o registro
      .andWhere('c.dataSaida >= :inicioDia', { inicioDia: `${dataIso}T00:00:00.000Z` })
      .andWhere('c.dataSaida <= :fimDia', { fimDia: `${dataIso}T23:59:59.999Z` });
    if (apenasValidos) {
      aplicarFiltroViagensValidasDashboard(qb, 'c');
    }
    qb.orderBy('c.id', 'ASC');

    let dados: ColetaData[];
    let total: number;
    if (paginar) {
      const skip = (page - 1) * limit;
      [dados, total] = await qb.skip(skip).take(limit).getManyAndCount();
    } else {
      dados = await qb.getMany();
      total = dados.length;
    }

    if (dados.length === 0) {
      return { dados: [], total, pagina: page, totalPaginas: Math.ceil(total / (limit || 1)) || 0, limit: limit || total };
    }
    const convertidos = this.converterColetasParaBrutos(dados, apenasValidos, pularValidacaoViagem);
    return {
      dados: convertidos,
      total,
      pagina: page,
      totalPaginas: paginar ? Math.ceil(total / limit) : 1,
      limit: paginar ? limit : total,
    };
  }

  private converterColetasParaBrutos(
    dados: ColetaData[],
    apenasValidos: boolean,
    pularValidacaoViagem = false,
  ): Record<string, any>[] {
    const mapaEntidadeParaColuna: Record<string, string[]> = {
      dataSaida: ['DATA SAIDA', 'DATA SAÍDA', 'DATA DE SAIDA', 'DATA DE SAÍDA', 'DIA', 'Data'],
      turno: ['TURNO'],
      regional: ['REGIONAL', 'REGIAO', 'REGIÃO'],
      distrito: ['DISTRITO', 'BAIRRO'],
      placa: ['PLACA', 'VEICULO', 'VEÍCULO', 'CAMINHAO', 'CAMINHÃO', 'CARRO'],
      motorista: ['MOTORISTA', 'OPERADOR', 'NOME', 'Operador'],
      numeroColetores: ['Nº DE COLETORES', 'NUMERO DE COLETORES', 'NÚMERO DE COLETORES', 'COLETORES'],
      kmSaida: ['KM SAIDA', 'KM SAÍDA', 'KM SAIDA BASE', 'KM SAÍDA BASE', ' KM SAIDA BASE '],
      horaSaida: ['HORA SAIDA', 'HORA SÁIDA', 'HORA SAIDA BASE', 'HORA SÁIDA BASE', 'HORA DE SAIDA', 'HORA DE SAÍDA'],
      kmChegada: ['KM CHEGADA', 'KM DE CHEGADA', 'KM CHEGADA BASE'],
      horaChegada: ['HORA CHEGADA', 'HORA DE CHEGADA', 'HORA CHEGADA BASE'],
      horaUltimoTerminoCarregamento: ['HORA ULTIMO TÉRMINO DO CARREGAMENTO', 'HORA ÚLTIMO TÉRMINO DO CARREGAMENTO'],
      peso1: ['PESO 1'],
      peso2: ['PESO 2'],
      peso3: ['PESO 3'],
      peso4: ['PESO 4'],
      peso5: ['PESO 5'],
      pesoTotal: ['PESO TOTAL'],
      tempoForaUnidade: ['TEMPO FORA DA UNIDADE'],
      horasForaUnidade: ['HORAS QUE FICA FORA DA UNIDADE', 'HORAS FORA UNIDADE'],
      tipoCaminhao: ['TIPO DE CAMINHÃO', 'TIPO CAMINHAO', 'TIPO VEICULO', 'TIPO VEÍCULO'],
      kmTotal: ['KM TOTAL'],
      numeroViagens: ['CONTADOR DE VIAGENS', 'CONTADOR VIAGENS', 'Nº DE VIAGENS', 'NUMERO DE VIAGENS', 'NÚMERO DE VIAGENS', 'NR VIAGENS', 'NUMERO VIAGENS'],
      viagensPorRota: ['VIAGENS POR ROTA'],
      kmRota1: ['KM ROTA 01', 'KM CHEGADA ROTA 01', ' KM CHEGADA ROTA 01 '],
      horaRota1: ['HORA ROTA 01', 'HORA CHEGADA ROTA 01', 'HORA SAÍDA ROTA 01'],
      kmRota2: ['KM ROTA 02', 'KM CHEGADA ROTA 02', ' KM CHEGADA ROTA 02 '],
      horaRota2: ['HORA ROTA 02', 'HORA CHEGADA ROTA 02', 'HORA SAÍDA ROTA 02'],
      kmRota3: ['KM ROTA 03', 'KM CHEGADA ROTA 03', ' KM CHEGADA ROTA 03 '],
      horaRota3: ['HORA ROTA 03', 'HORA CHEGADA ROTA 03', 'HORA CHEGA ROTA 03'],
      kmRota4: ['KM ROTA 04', 'KM CHEGADA ROTA 04', ' KM CHEGADA ROTA 04 '],
      horaRota4: ['HORA ROTA 04', 'HORA CHEGADA ROTA 04', 'HORA SAÍDA ROTA 04'],
      diaSemana: ['DIA DA SEMANA', 'DIA DA SEMANA\r\n1(DOMINGO) A 7(SÁBADO)'],
      coletor01: ['COLETOR 01'],
      coletor02: ['COLETOR 02'],
      coletor03: ['COLETOR 03'],
      coletor04: ['COLETOR 04'],
    };

    // Enriquecer + converter para objetos planos; revalidar viagens (corrige validoDashboard=false legado)
    const objetos = dados.map(d => {
      const tipoLinhaPre = String(d.dados?._tipoServico || '');
      const modeloUnificadoPre = String(d.dados?._modeloPlanilha || '') === 'servicos_unificados';
      const ehServicoUnidadePre =
        pularValidacaoViagem
        || modeloUnificadoPre
        || tipoLinhaPre === 'rocadeira'
        || tipoLinhaPre === 'capina'
        || tipoLinhaPre === 'varricao'
        || tipoLinhaPre === 'poda'
        || tipoLinhaPre === 'pintura_meio_fio';

      // Capina/varrição/poda: NÃO enriquecer com regras de coleta
      // (encontrarValorColuna fuzzy casa "id" com "KM SAIDA" etc. e corrompe campos)
      if (!ehServicoUnidadePre) {
        enriquecerCamposColeta(d);
      }

      const obj: Record<string, any> = {};

      for (const [key, value] of Object.entries(d)) {
        // Evita embutir relação TypeORM; mantém JSONB `dados` (alertas, CONTADOR, etc.)
        if (key === 'planilhaUpload') continue;
        obj[key] = value;
      }

      if (d.dados && typeof d.dados === 'object') {
        for (const [key, value] of Object.entries(d.dados)) {
          const keyTrimmed = key.trim();
          if (!(key in obj) || obj[key] === null || obj[key] === '') {
            obj[key] = value;
          }
          if (keyTrimmed !== key && (!(keyTrimmed in obj) || obj[keyTrimmed] === null || obj[keyTrimmed] === '')) {
            obj[keyTrimmed] = value;
          }
        }
      }

      for (const [prop, nomesColuna] of Object.entries(mapaEntidadeParaColuna)) {
        const valor = (d as any)[prop];
        if (valor !== null && valor !== undefined && valor !== '') {
          let valorExport = valor;
          if (prop === 'dataSaida' && valor instanceof Date) {
            const ds = valor as Date;
            valorExport = `${ds.getUTCFullYear()}-${String(ds.getUTCMonth() + 1).padStart(2, '0')}-${String(ds.getUTCDate()).padStart(2, '0')}`;
            obj.dataSaida = valorExport;
          }
          for (const nomeCol of nomesColuna) {
            if (!(nomeCol in obj) || obj[nomeCol] === null || obj[nomeCol] === '') {
              obj[nomeCol] = valorExport;
            }
          }
        }
      }

      if (d.planilhaUpload?.nomeArquivo) {
        obj._nomePlanilha = d.planilhaUpload.nomeArquivo;
      }

      const tipoLinha = String(d.dados?._tipoServico || obj._tipoServico || '');
      const modeloUnificado = String(d.dados?._modeloPlanilha || obj._modeloPlanilha || '') === 'servicos_unificados';
      const ehServicoUnidade =
        pularValidacaoViagem
        || modeloUnificado
        || tipoLinha === 'rocadeira'
        || tipoLinha === 'capina'
        || tipoLinha === 'varricao'
        || tipoLinha === 'poda'
        || tipoLinha === 'pintura_meio_fio';

      if (ehServicoUnidade) {
        // Capina/varrição/poda/roçada não usam regras de placa/KM/peso da coleta
        const valido = d.validoDashboard !== false;
        obj.validoDashboard = valido;
        obj._validoDashboard = valido;
      } else {
        const validacao = validarViagemParaDashboard(d);
        obj.validoDashboard = validacao.validoDashboard;
        obj._validoDashboard = validacao.validoDashboard;
        if (validacao.motivos?.length) {
          obj._motivosInvalidos = validacao.motivos;
        }
      }

      return obj;
    });

    if (!apenasValidos) return objetos;

    // Usa o flag já calculado na entidade/objeto — NÃO revalidar o objeto plano
    // (ele perde `dados` aninhado e o alerta de hodômetro no topo; revalidar
    // derrubava viagens com KM=0 legítimas, ex.: 455 no SQL → 450 no PDF).
    return objetos.filter((obj) => obj.validoDashboard !== false && obj._validoDashboard !== false);
  }

  /**
   * Retorna dados de peso por regional
   */
  async getPesoPorRegional(filtros?: { dataInicio?: string; dataFim?: string; regional?: string; distrito?: string }) {
    const qb = this.coletaRepo.createQueryBuilder('c')
      .select(['c.regional as regional', `${sqlSumPesoEfetivoKg('c')} as total_peso`, 'COUNT(*) as quantidade'])
      .groupBy('c.regional')
      .orderBy('total_peso', 'DESC');
    aplicarFiltroViagensValidasDashboard(qb, 'c');

    this.aplicarFiltroData(qb, filtros);

    return qb.getRawMany();
  }

  /**
   * Aplica filtros de data a um query builder
   */
  private aplicarFiltroData(qb: any, filtros?: { dataInicio?: string; dataFim?: string; regional?: string; distrito?: string; planilhaId?: number }) {
    if (filtros?.dataInicio) {
      qb.andWhere('c.dataSaida >= :dataInicio', { dataInicio: filtros.dataInicio });
    }
    if (filtros?.dataFim) {
      qb.andWhere('c.dataSaida <= :dataFim', { dataFim: filtros.dataFim });
    }
    if (filtros?.regional) {
      qb.andWhere('c.regional = :regional', { regional: filtros.regional });
    }
    if (filtros?.distrito) {
      qb.andWhere('c.distrito = :distrito', { distrito: filtros.distrito });
    }
    if (filtros?.planilhaId) {
      qb.andWhere('c.planilhaUploadId = :planilhaId', { planilhaId: filtros.planilhaId });
    }
    return qb;
  }

  /**
   * Retorna top motoristas por peso total
   */
  async getTopMotoristas(limite: number = 10, filtros?: { dataInicio?: string; dataFim?: string; regional?: string; distrito?: string }) {
    const qb = this.coletaRepo.createQueryBuilder('c')
      .select([`c.motorista as motorista`, `${sqlSumPesoEfetivoKg('c')} as total_peso`, `COUNT(*) as quantidade`, `SUM(c.kmTotal) as total_km`, `${sqlSumViagens('c')} as total_viagens`])
      .where('c.motorista IS NOT NULL')
      .groupBy('c.motorista')
      .orderBy('total_peso', 'DESC')
      .limit(limite);
    aplicarFiltroViagensValidasDashboard(qb, 'c');

    this.aplicarFiltroData(qb, filtros);
    return qb.getRawMany();
  }

  /**
   * Retorna distribuição por dia da semana (1=domingo a 7=sábado)
   */
  async getDadosPorDiaSemana(filtros?: { dataInicio?: string; dataFim?: string; regional?: string; distrito?: string }) {
    // Usa EXTRACT(DOW) do PostgreSQL como fallback quando diaSemana é NULL
    const qb = this.coletaRepo.createQueryBuilder('c')
      .select([
        'COALESCE(c.diaSemana, EXTRACT(DOW FROM c.dataSaida)::int + 1) AS "diaSemana"',
        'COUNT(*) as quantidade',
        `${sqlSumPesoEfetivoKg('c')} as total_peso`,
        'SUM(c.kmTotal) as total_km',
        `${sqlSumViagens('c')} as total_viagens`,
      ])
      .where('c.dataSaida IS NOT NULL')
      .groupBy('COALESCE(c.diaSemana, EXTRACT(DOW FROM c.dataSaida)::int + 1)')
      .orderBy('"diaSemana"', 'ASC');
    aplicarFiltroViagensValidasDashboard(qb, 'c');

    this.aplicarFiltroData(qb, filtros);
    return qb.getRawMany();
  }

  /**
   * Retorna lista de regionais distintas (para filtro)
   */
  async getListaRegionais() {
    const qb = this.coletaRepo.createQueryBuilder('c')
      .select('DISTINCT c.regional', 'regional')
      .where('c.regional IS NOT NULL')
      .orderBy('c.regional', 'ASC');
    return qb.getRawMany();
  }

  /**
   * Retorna lista de distritos distintas (para filtro)
   */
  async getListaDistritos() {
    const qb = this.coletaRepo.createQueryBuilder('c')
      .select('DISTINCT c.distrito', 'distrito')
      .where('c.distrito IS NOT NULL')
      .orderBy('c.distrito', 'ASC');
    return qb.getRawMany();
  }

  /**
   * Retorna dados de peso por dia
   */
  async getPesoPorDia(filtros?: { dataInicio?: string; dataFim?: string; regional?: string; distrito?: string }) {
    const qb = this.coletaRepo.createQueryBuilder('c')
      .select(['c.dataSaida as data', `${sqlSumPesoEfetivoKg('c')} as total_peso`, 'COUNT(*) as quantidade', 'SUM(c.kmTotal) as total_km', `${sqlSumViagens('c')} as total_viagens`])
      .where('c.dataSaida IS NOT NULL')
      .groupBy('c.dataSaida')
      .orderBy('c.dataSaida', 'ASC');
    aplicarFiltroViagensValidasDashboard(qb, 'c');

    this.aplicarFiltroData(qb, filtros);

    return qb.getRawMany();
  }

  /**
   * Retorna top placas por peso total
   */
  async getTopPlacas(limite: number = 10, filtros?: { dataInicio?: string; dataFim?: string; regional?: string; distrito?: string }) {
    const qb = this.coletaRepo.createQueryBuilder('c')
      .select(['c.placa as placa', `${sqlSumPesoEfetivoKg('c')} as total_peso`, 'COUNT(*) as quantidade', 'SUM(c.kmTotal) as total_km', `${sqlSumViagens('c')} as total_viagens`])
      .where('c.placa IS NOT NULL')
      .groupBy('c.placa')
      .orderBy('total_peso', 'DESC')
      .limit(limite);
    aplicarFiltroViagensValidasDashboard(qb, 'c');

    this.aplicarFiltroData(qb, filtros);

    return qb.getRawMany();
  }

  /**
   * Retorna distribuição por tipo de caminhão
   */
  async getDistribuicaoTipoCaminhao(filtros?: { dataInicio?: string; dataFim?: string; regional?: string; distrito?: string }) {
    const qb = this.coletaRepo.createQueryBuilder('c')
      .select(['c.tipoCaminhao as tipo', 'COUNT(*) as quantidade', `${sqlSumPesoEfetivoKg('c')} as total_peso`, `${sqlMediaPesoEfetivoKg('c')} as media_peso`])
      .where('c.tipoCaminhao IS NOT NULL')
      .groupBy('c.tipoCaminhao')
      .orderBy('quantidade', 'DESC');
    aplicarFiltroViagensValidasDashboard(qb, 'c');

    this.aplicarFiltroData(qb, filtros);

    return qb.getRawMany();
  }

  /**
   * Retorna dados por turno
   */
  async getDadosPorTurno(filtros?: { dataInicio?: string; dataFim?: string; regional?: string; distrito?: string }) {
    const qb = this.coletaRepo.createQueryBuilder('c')
      .select(['c.turno as turno', 'COUNT(*) as quantidade', `${sqlSumPesoEfetivoKg('c')} as total_peso`, `${sqlMediaPesoEfetivoKg('c')} as media_peso`])
      .where('c.turno IS NOT NULL')
      .groupBy('c.turno')
      .orderBy('quantidade', 'DESC');
    aplicarFiltroViagensValidasDashboard(qb, 'c');

    this.aplicarFiltroData(qb, filtros);

    return qb.getRawMany();
  }

  /**
   * Lista uploads realizados
   */
  async listarUploads() {
    return this.uploadRepo.find({
      order: { criadoEm: 'DESC' },
      take: 20,
    });
  }

  /**
   * Lista uploads filtrados por serviço
   */
  async listarUploadsPorServico(servicoId: string) {
    return this.uploadRepo.find({
      where: { servico_id: servicoId },
      order: { criadoEm: 'DESC' },
    });
  }

  /**
   * Lista uploads realizados em um dia (timezone America/Sao_Paulo),
   * com contrato e serviço associados.
   */
  async listarUploadsPorDia(dataIso: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataIso)) {
      throw new Error('Data inválida. Use o formato YYYY-MM-DD.');
    }

    const inicio = new Date(`${dataIso}T00:00:00-03:00`);
    const fim = new Date(`${dataIso}T00:00:00-03:00`);
    fim.setUTCDate(fim.getUTCDate() + 1);

    const rows = await this.uploadRepo
      .createQueryBuilder('u')
      .innerJoin(Servico, 's', 's.id = u.servico_id')
      .innerJoin(Contract, 'c', 'c.id = s.contract_id')
      .leftJoin(User, 'usr', 'usr.id = u.usuarioId')
      .select('c.id', 'contratoId')
      .addSelect('c.numeroContrato', 'numeroContrato')
      .addSelect('c.status', 'contratoStatus')
      .addSelect('s.id', 'servicoId')
      .addSelect('s.nome', 'servicoNome')
      .addSelect('s.tipo', 'servicoTipo')
      .addSelect('u.id', 'uploadId')
      .addSelect('u.nomeArquivo', 'nomeArquivo')
      .addSelect('u.criadoEm', 'criadoEm')
      .addSelect('u.totalLinhas', 'totalLinhas')
      .addSelect('u.linhasImportadas', 'linhasImportadas')
      .addSelect('usr.nome', 'usuarioNome')
      .where('u.criadoEm >= :inicio AND u.criadoEm < :fim', { inicio, fim })
      .orderBy('c.numeroContrato', 'ASC')
      .addOrderBy('u.criadoEm', 'DESC')
      .getRawMany();

    const uploads = rows.map((r) => ({
      uploadId: Number(r.uploadId),
      nomeArquivo: r.nomeArquivo as string,
      criadoEm: r.criadoEm instanceof Date ? r.criadoEm.toISOString() : String(r.criadoEm),
      totalLinhas: Number(r.totalLinhas ?? 0),
      linhasImportadas: Number(r.linhasImportadas ?? 0),
      usuarioNome: (r.usuarioNome as string) || null,
      contratoId: r.contratoId as string,
      numeroContrato: (r.numeroContrato as string) || 'Sem número',
      contratoStatus: (r.contratoStatus as string) || 'ativo',
      servicoId: r.servicoId as string,
      servicoNome: r.servicoNome as string,
      servicoTipo: r.servicoTipo as string,
    }));

    const porContratoMap = new Map<string, {
      contratoId: string;
      numeroContrato: string;
      contratoStatus: string;
      totalUploads: number;
      totalLinhasImportadas: number;
      uploads: typeof uploads;
    }>();

    for (const u of uploads) {
      let grupo = porContratoMap.get(u.contratoId);
      if (!grupo) {
        grupo = {
          contratoId: u.contratoId,
          numeroContrato: u.numeroContrato,
          contratoStatus: u.contratoStatus,
          totalUploads: 0,
          totalLinhasImportadas: 0,
          uploads: [],
        };
        porContratoMap.set(u.contratoId, grupo);
      }
      grupo.totalUploads += 1;
      grupo.totalLinhasImportadas += u.linhasImportadas;
      grupo.uploads.push(u);
    }

    const contratos = Array.from(porContratoMap.values());

    return {
      data: dataIso,
      totalUploads: uploads.length,
      totalContratos: contratos.length,
      contratos,
      uploads,
    };
  }

  /**
   * Exclui um upload e todos os dados de coleta vinculados
   */
  async excluirUpload(id: number, opts?: { forcarCicloFechado?: boolean }) {
    const upload = await this.uploadRepo.findOne({ where: { id } });
    if (!upload) throw new Error('Upload não encontrado.');
    if (upload.cicloFechadoEm && !opts?.forcarCicloFechado) {
      throw new Error('Esta planilha pertence a um ciclo fechado e não pode ser excluída.');
    }

    const servicoId = upload.servico_id;
    const urlDownload = upload.urlDownload;

    const removidos = await AppDataSource.transaction(async (manager) => {
      const delColeta = await manager
        .createQueryBuilder()
        .delete()
        .from(ColetaData)
        .where('"planilhaUploadId" = :id', { id })
        .execute();

      await manager
        .createQueryBuilder()
        .delete()
        .from(PlanilhaUpload)
        .where('id = :id', { id })
        .execute();

      return Number(delColeta.affected || 0);
    });

    if (urlDownload) {
      try {
        await FileStorageService.removerImagem(urlDownload);
      } catch (err) {
        console.warn('[PlanilhaService] Erro ao remover arquivo do storage:', err);
      }
    }

    if (servicoId) {
      invalidarCacheDadosServico(servicoId);
      invalidarCacheDashboardServico(servicoId);
      void recalcularTotaisDiaServicoSilencioso(servicoId);
      const restantes = await this.uploadRepo.count({ where: { servico_id: servicoId } });
      if (restantes === 0) {
        const servico = await this.servicoRepo.findOne({ where: { id: servicoId } });
        if (servico) {
          servico.padraoPlanilha = null;
          await this.servicoRepo.save(servico);
        }
      }
    }

    const contagem = servicoId
      ? await this.getContagemRegistrosPorServico(servicoId)
      : { total: 0, validos: 0 };

    return {
      message: 'Upload excluído com sucesso.',
      servicoId,
      registrosRemovidos: removidos,
      registrosValidos: contagem.validos,
      registrosTotais: contagem.total,
    };
  }

  /**
   * Remove TODOS os uploads, coleta_dados e arquivos do storage de um serviço.
   * Usado na exclusão do serviço (ignora ciclo fechado).
   */
  async excluirTodosDadosDoServico(servicoId: string): Promise<{
    uploadsRemovidos: number;
    registrosRemovidos: number;
    urlsStorage: string[];
  }> {
    const uploads = await this.uploadRepo.find({
      where: { servico_id: servicoId },
      select: ['id', 'urlDownload'],
    });
    const uploadIds = uploads.map((u) => u.id);
    const urlsStorage = uploads.map((u) => u.urlDownload).filter((u): u is string => !!u);

    let registrosRemovidos = 0;

    await AppDataSource.transaction(async (manager) => {
      if (uploadIds.length > 0) {
        const delColeta = await manager
          .createQueryBuilder()
          .delete()
          .from(ColetaData)
          .where('"planilhaUploadId" IN (:...ids)', { ids: uploadIds })
          .execute();
        registrosRemovidos = Number(delColeta.affected || 0);

        await manager
          .createQueryBuilder()
          .delete()
          .from(PlanilhaUpload)
          .where('servico_id = :servicoId', { servicoId })
          .execute();
      }

      await manager
        .createQueryBuilder()
        .delete()
        .from(ColetaTotaisDia)
        .where('"servicoId" = :servicoId', { servicoId })
        .execute();
    });

    for (const url of urlsStorage) {
      try {
        await FileStorageService.removerImagem(url);
      } catch (err) {
        console.warn('[PlanilhaService] Erro ao remover arquivo do storage:', err);
      }
    }

    invalidarCacheDadosServico(servicoId);
    invalidarCacheDashboardServico(servicoId);

    return {
      uploadsRemovidos: uploadIds.length,
      registrosRemovidos,
      urlsStorage,
    };
  }

  /**
   * Renomeia o arquivo de um upload
   */
  async renomearUpload(id: number, novoNome: string) {
    const upload = await this.uploadRepo.findOne({ where: { id } });
    if (!upload) throw new Error('Upload não encontrado.');
    upload.nomeArquivo = novoNome;
    return this.uploadRepo.save(upload);
  }

  /**
   * Lista uploads resumidos para o filtro do dashboard (apenas id + nome)
   */
  async listarUploadsResumido() {
    const uploads = await this.uploadRepo.find({
      select: [
        'id', 'nomeArquivo', 'criadoEm', 'totalLinhas',
        'linhasImportadas', 'linhasIgnoradas', 'linhasSubstituidas',
        'linhasConflitantes', 'estrategia', 'resumo',
      ],
      order: { criadoEm: 'DESC' },
      take: 50,
    });
    return uploads.map(u => ({
      id: u.id,
      nome: u.nomeArquivo,
      criadoEm: u.criadoEm,
      totalLinhas: u.totalLinhas,
      importadas: u.linhasImportadas,
      ignoradas: u.linhasIgnoradas,
      substituidas: u.linhasSubstituidas,
      conflitantes: u.linhasConflitantes,
      estrategia: u.estrategia,
      resumo: u.resumo,
    }));
  }

  // ═══════════════════════════════════════════════════════
  // 🚀 NOVOS MÉTODOS AGREGADOS (executam no PostgreSQL)
  // ═══════════════════════════════════════════════════════

  /**
   * Retorna os IDs de upload vinculados a um serviço
   * Útil para filtros rápidos sem recarregar
   */
  async getUploadIdsPorServico(servicoId: string): Promise<number[]> {
    const uploads = await this.uploadRepo.find({
      where: { servico_id: servicoId },
      select: ['id'],
    });
    return uploads.map(u => u.id);
  }

  /**
   * Retorna métricas agregadas de ColetaData para um serviço,
   * EXECUTANDO TUDO NO BANCO (sem carregar registros em memória).
   * 
   * Equivalente ao que getExecMetrics faz em JS, mas usando SUM/COUNT/AVG do PostgreSQL.
   * Retorna: viagens, pesoTotalTon, kmTotal, horasProdutivas, coletores, etc.
   */
  async getMetricasAgregadasPorServico(
    servicoId: string,
    filtros?: { dataInicio?: string; dataFim?: string }
  ): Promise<{
    viagens: number;
    pesoTotalKg: number;
    pesoTotalTon: number;
    kmTotal: number;
    horasProdutivas: number;
    coletoresAtivos: number;
    faturamento: number;
  }> {
    const uploadIds = await this.getUploadIdsPorServico(servicoId);
    if (uploadIds.length === 0) {
      return { viagens: 0, pesoTotalKg: 0, pesoTotalTon: 0, kmTotal: 0, horasProdutivas: 0, coletoresAtivos: 0, faturamento: 0 };
    }

    const qb = this.coletaRepo.createQueryBuilder('c')
      .select([
        `${sqlSumViagens('c')} as viagens`,
        `${sqlSumPesoEfetivoKg('c')} as peso_total_kg`,
        'COALESCE(SUM(c.kmTotal), 0) as km_total',
        'COALESCE(SUM(CASE WHEN c.horasForaUnidade BETWEEN 0 AND 24 THEN c.horasForaUnidade ELSE 0 END), 0) as horas_produtivas',
        'COUNT(DISTINCT c.placa) as coletores_ativos',
      ])
      .where('c.planilhaUploadId IN (:...uploadIds)', { uploadIds });
    aplicarFiltroViagensValidasDashboard(qb, 'c');

    if (filtros?.dataInicio) {
      qb.andWhere(`${sqlDataIsoDia('c')} >= :dataInicio`, { dataInicio: filtros.dataInicio });
    }
    if (filtros?.dataFim) {
      qb.andWhere(`${sqlDataIsoDia('c')} <= :dataFim`, { dataFim: filtros.dataFim });
    }

    const result = await qb.getRawOne();

    const viagens = Number(result?.viagens || 0);
    const pesoTotalKg = Number(result?.peso_total_kg || 0);
    const kmTotal = Number(result?.km_total || 0);
    const horasProdutivas = Number(result?.horas_produtivas || 0);
    const coletoresAtivos = Number(result?.coletores_ativos || 0);

    return {
      viagens,
      pesoTotalKg,
      pesoTotalTon: Math.round(toneladasDoPesoKg(pesoTotalKg) * 100) / 100,
      kmTotal: Math.round(kmTotal * 100) / 100,
      horasProdutivas: Math.round(horasProdutivas * 100) / 100,
      coletoresAtivos,
      faturamento: 0, // faturamento depende de valores fixos, calculado separadamente
    };
  }

  /**
   * Retorna métricas diárias agregadas para um período (gráficos de tendência)
   * Executa no banco — sem carregar registros.
   */
  async getMetricasPorDia(
    servicoId: string,
    dataInicio: string,
    dataFim: string,
  ): Promise<{
    data: string;
    rotas: number;
    viagens: number;
    pesoTotalKg: number;
    pesoTotalTon: number;
    kmTotal: number;
    areaM2: number;
    metroLinear: number;
    kmLinear: number;
    qtdArvore: number;
    quantitativo: number;
  }[]> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataInicio) || !/^\d{4}-\d{2}-\d{2}$/.test(dataFim)) {
      return [];
    }

    const uploadIds = await this.getUploadIdsPorServico(servicoId);
    if (uploadIds.length === 0) return [];

    const servico = await this.servicoRepo.findOne({ where: { id: servicoId }, select: ['id', 'tipo'] });
    const producao = servico != null && [
      TipoServico.ROCADEIRA,
      TipoServico.CAPINA,
      TipoServico.VARRICAO,
      TipoServico.PODA,
      TipoServico.PINTURA_MEIO_FIO,
      TipoServico.REMOCAO,
      TipoServico.GERAL,
    ].includes(servico.tipo as TipoServico);

    const areaExpr = sqlAreaM2('c');
    const metroLinearExpr = sqlMetroLinear('c');
    const kmLinearExpr = sqlKmLinear('c');
    const qtdArvoreExpr = sqlQtdArvore('c');
    const quantitativoExpr = sqlQuantitativo('c');

    const dataIsoExpr = sqlDataIsoDia('c');
    const qb = this.coletaRepo.createQueryBuilder('c')
      .select([
        `${dataIsoExpr} as data`,
        'COUNT(*)::int as rotas',
        `${sqlSumViagens('c')} as viagens`,
        `${sqlSumPesoEfetivoKg('c')} as peso_total_kg`,
        'COALESCE(SUM(c.kmTotal), 0) as km_total',
        `COALESCE(SUM(${areaExpr}), 0) as area_m2`,
        `COALESCE(SUM(${metroLinearExpr}), 0) as metro_linear`,
        `COALESCE(SUM(${kmLinearExpr}), 0) as km_linear`,
        `COALESCE(SUM(${qtdArvoreExpr}), 0) as qtd_arvore`,
        `COALESCE(SUM(${quantitativoExpr}), 0) as quantitativo`,
      ])
      .where('c.planilhaUploadId IN (:...uploadIds)', { uploadIds });
    if (producao) {
      qb.andWhere(sqlSomenteUploadVigenteDoDia('c'));
    }
    aplicarFiltroViagensValidasDashboard(qb, 'c');
    qb.andWhere(`${dataIsoExpr} >= :inicio`, { inicio: dataInicio })
      .andWhere(`${dataIsoExpr} <= :fim`, { fim: dataFim })
      .groupBy(dataIsoExpr)
      .orderBy(dataIsoExpr, 'ASC');

    const results = await qb.getRawMany();
    const toIso = (v: Date | string) => {
      if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v.trim())) {
        return v.trim().slice(0, 10);
      }
      const d = v instanceof Date ? v : new Date(v);
      if (isNaN(d.getTime())) return '';
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };
    const num = (row: Record<string, unknown>, ...keys: string[]): number => {
      for (const k of keys) {
        if (row[k] != null && row[k] !== '') {
          const n = Number(row[k]);
          if (!Number.isNaN(n)) return n;
        }
      }
      const compacto = new Map(
        Object.entries(row).map(([k, v]) => [k.toLowerCase().replace(/[^a-z0-9]/g, ''), v]),
      );
      for (const k of keys) {
        const v = compacto.get(k.toLowerCase().replace(/[^a-z0-9]/g, ''));
        if (v != null && v !== '') {
          const n = Number(v);
          if (!Number.isNaN(n)) return n;
        }
      }
      return 0;
    };

    return results.map(r => {
      const pesoTotalKg = num(r, 'peso_total_kg', 'pesoTotalKg');
      return {
        data: r.data ? toIso(r.data) : '',
        rotas: num(r, 'rotas'),
        viagens: num(r, 'viagens'),
        pesoTotalKg,
        pesoTotalTon: toneladasDoPesoKg(pesoTotalKg),
        kmTotal: num(r, 'km_total', 'kmTotal'),
        areaM2: num(r, 'area_m2', 'areaM2'),
        metroLinear: num(r, 'metro_linear', 'metroLinear'),
        kmLinear: num(r, 'km_linear', 'kmLinear'),
        qtdArvore: num(r, 'qtd_arvore', 'qtdArvore'),
        quantitativo: num(r, 'quantitativo'),
      };
    });
  }

  /**
   * Retorna o total de registros de um serviço (rápido, COUNT no banco)
   */
  async getTotalRegistrosPorServico(servicoId: string): Promise<number> {
    const { total } = await this.getContagemRegistrosPorServico(servicoId);
    return total;
  }

  /** Total de linhas importadas e quantas entram no dashboard (validoDashboard) */
  async getContagemRegistrosPorServico(servicoId: string): Promise<{ total: number; validos: number }> {
    const mapa = await this.getContagemRegistrosPorServicos([servicoId]);
    return mapa.get(servicoId) || { total: 0, validos: 0 };
  }

  /** Intervalo de datas das viagens válidas no dashboard (min/max dataSaida) */
  async getPeriodoDadosPorServico(
    servicoId: string,
  ): Promise<{ dataInicio: string; dataFim: string } | null> {
    const row = await this.coletaRepo
      .createQueryBuilder('c')
      .innerJoin(PlanilhaUpload, 'u', 'u.id = c.planilhaUploadId')
      .select('MIN(c.dataSaida)', 'minData')
      .addSelect('MAX(c.dataSaida)', 'maxData')
      .where('u.servico_id = :servicoId', { servicoId })
      .andWhere('c.validoDashboard = true')
      .andWhere('c.dataSaida IS NOT NULL')
      .getRawOne();

    if (!row?.minData || !row?.maxData) return null;

    const toIso = (v: Date | string) => {
      const d = v instanceof Date ? v : new Date(v);
      if (isNaN(d.getTime())) return null;
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    const dataInicio = toIso(row.minData);
    const dataFim = toIso(row.maxData);
    if (!dataInicio || !dataFim) return null;

    return { dataInicio, dataFim };
  }

  /** Intervalo das viagens válidas pertencentes exclusivamente ao upload informado. */
  async getPeriodoDadosPorUpload(
    planilhaUploadId: number,
    servicoId?: string,
  ): Promise<{ dataInicio: string; dataFim: string } | null> {
    if (!(planilhaUploadId > 0)) return null;

    const qb = this.coletaRepo
      .createQueryBuilder('c')
      .innerJoin(PlanilhaUpload, 'u', 'u.id = c.planilhaUploadId')
      .select('MIN(c.dataSaida)', 'minData')
      .addSelect('MAX(c.dataSaida)', 'maxData')
      .where('c.planilhaUploadId = :planilhaUploadId', { planilhaUploadId })
      .andWhere('c.validoDashboard = true')
      .andWhere('c.dataSaida IS NOT NULL');

    if (servicoId) {
      qb.andWhere('u.servico_id = :servicoId', { servicoId });
    }

    const row = await qb.getRawOne();
    if (!row?.minData || !row?.maxData) return null;

    const toIso = (v: Date | string): string | null => {
      const d = v instanceof Date ? v : new Date(v);
      if (isNaN(d.getTime())) return null;
      return [
        d.getUTCFullYear(),
        String(d.getUTCMonth() + 1).padStart(2, '0'),
        String(d.getUTCDate()).padStart(2, '0'),
      ].join('-');
    };

    const dataInicio = toIso(row.minData);
    const dataFim = toIso(row.maxData);
    return dataInicio && dataFim ? { dataInicio, dataFim } : null;
  }

  /**
   * Contagem em lote por serviço (1 query em vez de N)
   */
  async getContagemRegistrosPorServicos(
    servicoIds: string[],
  ): Promise<Map<string, { total: number; validos: number }>> {
    const resultado = new Map<string, { total: number; validos: number }>();
    if (!servicoIds.length) return resultado;

    const rows = await this.coletaRepo
      .createQueryBuilder('c')
      .innerJoin(PlanilhaUpload, 'u', 'u.id = c.planilhaUploadId')
      .select('u.servico_id', 'servicoId')
      .addSelect('COUNT(*)', 'total')
      .addSelect('SUM(CASE WHEN c.validoDashboard = true THEN 1 ELSE 0 END)', 'validos')
      .where('u.servico_id IN (:...servicoIds)', { servicoIds })
      .groupBy('u.servico_id')
      .getRawMany();

    for (const row of rows) {
      resultado.set(row.servicoId, {
        total: Number(row.total || 0),
        validos: Number(row.validos || 0),
      });
    }
    return resultado;
  }

  /**
   * Último upload por serviço (1 query em vez de N)
   */
  async getUltimosUploadsPorServicos(servicoIds: string[]): Promise<Map<string, Date>> {
    const resultado = new Map<string, Date>();
    if (!servicoIds.length) return resultado;

    const rows = await this.uploadRepo
      .createQueryBuilder('u')
      .select('u.servico_id', 'servicoId')
      .addSelect('MAX(u.criadoEm)', 'ultimoUpload')
      .where('u.servico_id IN (:...servicoIds)', { servicoIds })
      .groupBy('u.servico_id')
      .getRawMany();

    for (const row of rows) {
      if (row.ultimoUpload) resultado.set(row.servicoId, new Date(row.ultimoUpload));
    }
    return resultado;
  }

  /**
   * Retorna o estudo detalhado das viagens de um registro de coleta
   * Calcula KM, hora, duração e velocidade média de cada rota (1 a 4)
   */
  async getEstudoViagens(coletaId: number): Promise<{
    viagens: {
      numero: number;
      km: number | null;
      hora: number | null;        // serial Excel (0.0 a 1.0)
      horaFormatada: string;      // HH:MM legível
      duracaoMinutos: number;     // duração em minutos (se houver kmSaida original como referência)
      duracaoFormatada: string;   // HH:MM
      velocidadeMedia: number | null; // km/h
    }[];
    totalKm: number;
    totalHoras: number;
  }> {
    const coleta = await this.coletaRepo.findOne({ where: { id: coletaId } });
    if (!coleta) throw new Error('Registro de coleta não encontrado.');

    const converterHora = (serial: number | null): string => {
      if (serial === null || serial === undefined) return '--:--';
      const totalMinutes = Math.round(serial * 24 * 60);
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    };

    const converterMinutos = (serial: number | null): number => {
      if (serial === null || serial === undefined) return 0;
      return Math.round(serial * 24 * 60);
    };

    const viagens: any[] = [];
    let totalKm = 0;
    let totalMinutos = 0;

    for (let i = 1; i <= 4; i++) {
      const kmField = `kmRota${i}` as keyof ColetaData;
      const horaField = `horaRota${i}` as keyof ColetaData;
      const km = (coleta as any)[kmField] as number | null;
      const hora = (coleta as any)[horaField] as number | null;

      if (km === null && hora === null) continue; // pular rotas vazias

      const minutos = converterMinutos(hora);
      let velocidadeMedia: number | null = null;
      let duracaoMinutos = 0;

      // Se temos hora e km, calcular velocidade média
      if (km && hora && hora > 0) {
        const horasDecimais = hora * 24;
        if (horasDecimais > 0) {
          velocidadeMedia = Math.round((km / horasDecimais) * 10) / 10;
        }
      }

      // Duração: se temos horaSaida como referência, a horaRotaN pode ser o tempo decorrido
      // Mas como horaRotaN é a hora da rota (absoluta), vamos usar apenas como referência
      // A duração como diferença entre rotas consecutivas será calculada no frontend
      
      // Para simplificar: horaRotaN representa o tempo gasto na rota (se < 1, é serial de hora)
      // Se hora < 1, pode ser fração de dia = horas gastas na rota
      if (hora !== null && hora > 0) {
        if (hora < 1) {
          // É fração de dia => já representa horas (ex: 0.3333 = 8h)
          duracaoMinutos = Math.round(hora * 24 * 60);
        } else if (hora >= 1 && hora <= 24) {
          // Pode ser horas decimais diretamente
          duracaoMinutos = Math.round(hora * 60);
        } else {
          duracaoMinutos = Math.round(hora);
        }
      }

      if (km) totalKm += km;
      totalMinutos += duracaoMinutos;

      viagens.push({
        numero: i,
        km,
        hora,
        horaFormatada: converterHora(hora),
        duracaoMinutos,
        duracaoFormatada: `${String(Math.floor(duracaoMinutos / 60)).padStart(2, '0')}:${String(duracaoMinutos % 60).padStart(2, '0')}`,
        velocidadeMedia,
      });
    }

    const totalHorasDecimal = Math.round((totalMinutos / 60) * 100) / 100;

    return {
      viagens,
      totalKm: Math.round(totalKm * 100) / 100,
      totalHoras: totalHorasDecimal,
    };
  }

  /**
   * Gera um buffer XLSX com os dados de um upload específico
   * @param uploadId - ID do upload (planilha_uploads)
   */
  async exportarPlanilha(uploadId: number): Promise<{ buffer: Buffer; nomeArquivo: string }> {
    const upload = await this.uploadRepo.findOne({ where: { id: uploadId } });
    if (!upload) throw new Error('Upload não encontrado.');

    const dados = await this.coletaRepo.find({
      where: { planilhaUploadId: uploadId },
      order: { dataSaida: 'ASC' },
    });

    // Mapear para o formato da planilha original
    const dateToExcel = (dt: Date): number => {
      const epoch = new Date(Date.UTC(1899, 11, 30));
      const diff = dt.getTime() - epoch.getTime();
      return diff / (24 * 60 * 60 * 1000);
    };
    const linhas = dados.map(d => ({
      'DATA SAIDA': d.dataSaida ? dateToExcel(new Date(d.dataSaida)) : null,
      'TURNO': d.turno,
      'REGIONAL': d.regional,
      'DISTRITO': d.distrito,
      'PLACA': d.placa,
      'MOTORISTA': d.motorista,
      'Nº DE COLETORES': d.numeroColetores,
      'KM SAIDA': d.kmSaida,
      'HORA SÁIDA': d.horaSaida,
      'KM CHEGADA': d.kmChegada,
      'HORA CHEGADA': d.horaChegada,
      'HORA ULTIMO TÉRMINO DO CARREGAMENTO': d.horaUltimoTerminoCarregamento,
      'PESO 1': d.peso1,
      'PESO 2': d.peso2,
      'PESO 3': d.peso3,
      'PESO 4': d.peso4,
      'PESO 5': d.peso5,
      'PESO TOTAL': d.pesoTotal,
      'TEMPO FORA DA UNIDADE': d.tempoForaUnidade,
      'HORAS QUE FICA FORA DA UNIDADE': d.horasForaUnidade,
      'CAMINHÃO': d.tipoCaminhao,
      'KM TOTAL': d.kmTotal,
      'Nº DE VIAGENS': d.numeroViagens,
      'DIA DA SEMANA': d.diaSemana,
    }));

    const ws = XLSX.utils.json_to_sheet(linhas);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Dados');

    // Largura das colunas
    ws['!cols'] = Object.keys(linhas[0] || {}).map(() => ({ wch: 18 }));

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    return { buffer, nomeArquivo: upload.nomeArquivo.replace(/\.[^.]+$/, '') + '_exportado.xlsx' };
  }
}

export default new PlanilhaService();
