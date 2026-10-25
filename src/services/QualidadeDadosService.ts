import { Repository } from 'typeorm';
import AppDataSource from '../database/data-source';
import { ColetaData } from '../entities/ColetaData';
import { PlanilhaUpload } from '../entities/PlanilhaUpload';
import {
  filtrarRegistrosKmRotaExcessivo,
  MAX_KM_ROTA,
  resumoKmRotaExcesso,
} from './kmRotaValidacaoService';
import { formatarDataSaida } from '../utils/formatarDataPlanilha';
import { enriquecerCamposColeta } from './validacaoViagemService';

interface Problema {
  tipo: string;
  label: string;
  descricao: string;
  gravidade: 'crítico' | 'alto' | 'médio' | 'baixo';
  quantidade: number;
  percentual: number;
  amostra: {
    id: number;
    placa: string | null;
    motorista: string | null;
    data: string | null;
    valorAtual: any;
  }[];
}

interface RelatorioQualidade {
  uploadId: number;
  nomeArquivo: string;
  totalRegistros: number;
  totalProblemas: number;
  registroMaisAntigo: string | null;
  registroMaisRecente: string | null;
  pontuacaoQualidade: number; // 0 a 100
  problemas: Problema[];
  resumo: {
    registrosValidos: number;
    registrosInconsistentesDashboard: number;
    registrosComAlgumProblema: number;
    percentualValido: number;
    categorias: {
      kmNegativo: number;
      semPeso: number;
      semKmInicial: number;
      semKmFinal: number;
      semKmTotal: number;
      semPlaca: number;
      semMotorista: number;
      kmRotaAlto: number;
    };
  };
}

export class QualidadeDadosService {
  private get coletaRepo(): Repository<ColetaData> {
    return AppDataSource.getRepository(ColetaData);
  }

  private get uploadRepo(): Repository<PlanilhaUpload> {
    return AppDataSource.getRepository(PlanilhaUpload);
  }

  /**
   * Gera relatório de qualidade dos dados de um upload específico
   */
  async gerarRelatorio(uploadId: number): Promise<RelatorioQualidade> {
    const upload = await this.uploadRepo.findOne({ where: { id: uploadId } });
    if (!upload) throw new Error('Upload não encontrado.');

    const totalRegistros = await this.coletaRepo.count({
      where: { planilhaUploadId: uploadId },
    });

    if (totalRegistros === 0) {
      return {
        uploadId,
        nomeArquivo: upload.nomeArquivo,
        totalRegistros: 0,
        totalProblemas: 0,
        registroMaisAntigo: null,
        registroMaisRecente: null,
        pontuacaoQualidade: 100,
        problemas: [],
        resumo: {
          registrosValidos: 0,
          registrosInconsistentesDashboard: 0,
          registrosComAlgumProblema: 0,
          percentualValido: 100,
          categorias: {
            kmNegativo: 0,
            semPeso: 0,
            semKmInicial: 0,
            semKmFinal: 0,
            semKmTotal: 0,
            semPlaca: 0,
            semMotorista: 0,
            kmRotaAlto: 0,
          },
        },
      };
    }

    // ─── Data mais antiga e mais recente ───
    const rangeData = await this.coletaRepo
      .createQueryBuilder('c')
      .select('MIN(c.dataSaida)', 'minData')
      .addSelect('MAX(c.dataSaida)', 'maxData')
      .where('c.planilhaUploadId = :uploadId', { uploadId })
      .getRawOne();

    // ─── Carregar registros e analisar em memória (com enriquecimento de coleta.dados) ───
    const registros = await this.coletaRepo.find({ where: { planilhaUploadId: uploadId } });

    const kmNegativo: ColetaData[] = [];
    const semPeso: ColetaData[] = [];
    const semKmInicial: ColetaData[] = [];
    const semKmFinal: ColetaData[] = [];
    const semKmTotal: ColetaData[] = [];
    const semPlaca: ColetaData[] = [];
    const semMotorista: ColetaData[] = [];

    for (const reg of registros) {
      const camposKm = [reg.kmSaida, reg.kmChegada, reg.kmTotal, reg.kmRota1, reg.kmRota2, reg.kmRota3, reg.kmRota4];
      if (camposKm.some(v => v !== null && v !== undefined && v < 0)) {
        kmNegativo.push(reg);
      }

      const enriquecido = Object.assign(new ColetaData(), reg);
      enriquecerCamposColeta(enriquecido);

      if (enriquecido.pesoTotal === null || enriquecido.pesoTotal === undefined || enriquecido.pesoTotal <= 0) {
        semPeso.push(reg);
      }
      if (enriquecido.kmSaida === null || enriquecido.kmSaida === undefined || enriquecido.kmSaida <= 0) {
        semKmInicial.push(reg);
      }
      if (enriquecido.kmChegada === null || enriquecido.kmChegada === undefined || enriquecido.kmChegada <= 0) {
        semKmFinal.push(reg);
      }
      if (enriquecido.kmTotal === null || enriquecido.kmTotal === undefined || enriquecido.kmTotal <= 0) {
        semKmTotal.push(reg);
      }
      if (!enriquecido.placa?.trim()) {
        semPlaca.push(reg);
      }
      if (!enriquecido.motorista?.trim()) {
        semMotorista.push(reg);
      }
    }

    const kmRotaAlto = filtrarRegistrosKmRotaExcessivo(registros);

    // ─── Montar lista de problemas ───
    const problemas: Problema[] = [];

    const criarProblema = (
      tipo: string,
      label: string,
      descricao: string,
      gravidade: 'crítico' | 'alto' | 'médio' | 'baixo',
      registros: ColetaData[]
    ): Problema | null => {
      if (registros.length === 0) return null;
      return {
        tipo,
        label,
        descricao,
        gravidade,
        quantidade: registros.length,
        percentual: Math.round((registros.length / totalRegistros) * 100 * 10) / 10,
        amostra: registros.slice(0, 5).map(r => ({
          id: r.id,
          placa: r.placa,
          motorista: r.motorista,
          data: formatarDataSaida(r.dataSaida),
          valorAtual: this.extrairValorProblema(tipo, r),
        })),
      };
    };

    // KM Negativo — crítico
    const pKmNegativo = criarProblema(
      'km_negativo', 'KM Negativo',
      'Registros com valores de quilometragem negativa — indicam erro de leitura do hodômetro ou digitação.',
      'crítico', kmNegativo
    );
    if (pKmNegativo) problemas.push(pKmNegativo);

    // Sem Peso — crítico (viagem sem carga registrada)
    const pSemPeso = criarProblema(
      'sem_peso', 'Viagens sem Peso',
      'Registros onde o peso total está zerado ou não foi preenchido — a viagem pode ter ocorrido sem coleta de carga.',
      'crítico', semPeso
    );
    if (pSemPeso) problemas.push(pSemPeso);

    // Sem KM Inicial — alto
    const pSemKmInicial = criarProblema(
      'sem_km_inicial', 'Sem KM Inicial (hodômetro de saída)',
      'Registros sem a quilometragem de partida do veículo — impossibilita calcular a distância percorrida.',
      'alto', semKmInicial
    );
    if (pSemKmInicial) problemas.push(pSemKmInicial);

    // Sem KM Final — alto
    const pSemKmFinal = criarProblema(
      'sem_km_final', 'Sem KM Final (hodômetro de chegada)',
      'Registros sem a quilometragem de retorno do veículo — impossibilita validar a distância total.',
      'alto', semKmFinal
    );
    if (pSemKmFinal) problemas.push(pSemKmFinal);

    // Sem KM Total — médio
    const pSemKmTotal = criarProblema(
      'sem_km_total', 'Sem KM Total Percorrido',
      'Registros onde a quilometragem total da viagem não foi preenchida.',
      'médio', semKmTotal
    );
    if (pSemKmTotal) problemas.push(pSemKmTotal);

    // Sem Placa — crítico
    const pSemPlaca = criarProblema(
      'sem_placa', 'Sem Identificação do Veículo (Placa)',
      'Registros sem a placa do veículo — impossível vincular a viagem ao caminhão.',
      'crítico', semPlaca
    );
    if (pSemPlaca) problemas.push(pSemPlaca);

    // Sem Motorista — médio
    const pSemMotorista = criarProblema(
      'sem_motorista', 'Sem Identificação do Motorista',
      'Registros sem o nome do motorista responsável pela viagem.',
      'médio', semMotorista
    );
    if (pSemMotorista) problemas.push(pSemMotorista);

    const pKmRotaAlto = criarProblema(
      'km_rota_alto',
      `KM da Rota acima de ${MAX_KM_ROTA} km`,
      `Registros com quilometragem de rota superior a ${MAX_KM_ROTA} km — pode indicar erro de digitação, hodômetro no lugar da distância ou viagem atípica.`,
      'alto',
      kmRotaAlto,
    );
    if (pKmRotaAlto) problemas.push(pKmRotaAlto);

    // Ordenar por gravidade
    const ordemGravidade: Record<string, number> = { crítico: 0, alto: 1, médio: 2, baixo: 3 };
    problemas.sort((a, b) => ordemGravidade[a.gravidade] - ordemGravidade[b.gravidade]);

    // ─── Resumo ───
    // Registros com algum problema (usando Set para evitar duplicidade)
    const idsComProblema = new Set<number>();
    for (const r of kmNegativo) idsComProblema.add(r.id);
    for (const r of semPeso) idsComProblema.add(r.id);
    for (const r of semKmInicial) idsComProblema.add(r.id);
    for (const r of semKmFinal) idsComProblema.add(r.id);
    for (const r of semKmTotal) idsComProblema.add(r.id);
    for (const r of semPlaca) idsComProblema.add(r.id);
    for (const r of semMotorista) idsComProblema.add(r.id);
    for (const r of kmRotaAlto) idsComProblema.add(r.id);

    const totalComProblema = idsComProblema.size;

    const registrosValidosDashboard = registros.filter(r => r.validoDashboard === true).length;
    const registrosInconsistentesDashboard = totalRegistros - registrosValidosDashboard;
    const percentualValido = totalRegistros > 0
      ? Math.round((registrosValidosDashboard / totalRegistros) * 100 * 10) / 10
      : 100;

    // Score = % de registros válidos para o dashboard (data + KM Total + Peso Total)
    const pontuacao = percentualValido;

    return {
      uploadId,
      nomeArquivo: upload.nomeArquivo,
      totalRegistros,
      totalProblemas: problemas.length,
      registroMaisAntigo: formatarDataSaida(rangeData?.minData),
      registroMaisRecente: formatarDataSaida(rangeData?.maxData),
      pontuacaoQualidade: pontuacao,
      problemas,
      resumo: {
        registrosValidos: registrosValidosDashboard,
        registrosInconsistentesDashboard,
        registrosComAlgumProblema: totalComProblema,
        percentualValido,
        categorias: {
          kmNegativo: kmNegativo.length,
          semPeso: semPeso.length,
          semKmInicial: semKmInicial.length,
          semKmFinal: semKmFinal.length,
          semKmTotal: semKmTotal.length,
          semPlaca: semPlaca.length,
          semMotorista: semMotorista.length,
          kmRotaAlto: kmRotaAlto.length,
        },
      },
    };
  }

  /**
   * Extrai o valor problemático de um registro conforme o tipo de problema
   */
  private extrairValorProblema(tipo: string, registro: ColetaData): any {
    switch (tipo) {
      case 'km_negativo': {
        const negativos: Record<string, number | null> = {};
        if (registro.kmSaida !== null && registro.kmSaida < 0) negativos['kmSaida'] = registro.kmSaida;
        if (registro.kmChegada !== null && registro.kmChegada < 0) negativos['kmChegada'] = registro.kmChegada;
        if (registro.kmTotal !== null && registro.kmTotal < 0) negativos['kmTotal'] = registro.kmTotal;
        if (registro.kmRota1 !== null && registro.kmRota1 < 0) negativos['kmRota1'] = registro.kmRota1;
        if (registro.kmRota2 !== null && registro.kmRota2 < 0) negativos['kmRota2'] = registro.kmRota2;
        if (registro.kmRota3 !== null && registro.kmRota3 < 0) negativos['kmRota3'] = registro.kmRota3;
        if (registro.kmRota4 !== null && registro.kmRota4 < 0) negativos['kmRota4'] = registro.kmRota4;
        return Object.keys(negativos).length > 0 ? negativos : registro.kmTotal;
      }
      case 'sem_peso': return { pesoTotal: registro.pesoTotal, peso1: registro.peso1, peso2: registro.peso2 };
      case 'sem_km_inicial': return { kmSaida: registro.kmSaida };
      case 'sem_km_final': return { kmChegada: registro.kmChegada };
      case 'sem_km_total': return { kmTotal: registro.kmTotal };
      case 'sem_placa': return { placa: registro.placa };
      case 'sem_motorista': return { motorista: registro.motorista };
      case 'km_rota_alto': return resumoKmRotaExcesso(registro);
      default: return null;
    }
  }

  /**
   * Gera relatório para o último upload de um serviço
   */
  async gerarRelatorioUltimoUpload(servicoId: string): Promise<RelatorioQualidade | null> {
    const ultimoUpload = await this.uploadRepo.findOne({
      where: { servico_id: servicoId },
      order: { criadoEm: 'DESC' },
    });
    if (!ultimoUpload) return null;
    return this.gerarRelatorio(ultimoUpload.id);
  }
}

export default new QualidadeDadosService();
