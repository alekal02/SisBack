import { Request, Response } from 'express';
import PlanilhaService from '../services/PlanilhaService';
import DeduplicacaoService from '../services/DeduplicacaoService';
import RocadaImportService from '../services/rocadaImportService';
import ServicosUnificadosImportService from '../services/servicosUnificadosImportService';
import ConsolidadoProducaoImportService from '../services/consolidadoProducaoImportService';
import {
  detectarPlanilhaServicosUnificados,
  TIPOS_ACEITA_UNIFICADO,
} from '../services/servicosUnificadosPlanilhaParser';
import {
  detectarPlanilhaConsolidadoProducao,
  TIPOS_ACEITA_CONSOLIDADO,
} from '../services/consolidadoProducaoPlanilhaParser';
import QualidadeDadosService from '../services/QualidadeDadosService';
import { analisarQualidadePlanilha } from '../services/QualidadePlanilhaPreviewService';
import AppDataSource from '../database/data-source';
import { User } from '../entities/User';
import { TipoServico } from '../enums/TipoServico';
import { buildConfigDashboardPadraoColeta } from '../config/dashboardPadraoColeta';
import { Servico } from '../entities/Servico';
import { PlanilhaUpload } from '../entities/PlanilhaUpload';
import { alteracaoNegada } from '../middlewares/tenantGuard';
import { inferirFiltroExecucaoServico } from '../utils/rocadaTipoExecucao';
import { labelModeloRocada } from '../services/rocadaPlanilhaParser';
import { invalidarCacheDashboardServico } from './ServicoController';
import { invalidarCacheDadosServico } from '../services/servicoDadosCache';
import { dashboardCache } from '../services/DashboardCacheManager';
import { agendarWarmupPosUpload } from '../services/executivoCacheWarmupService';
import { gerarConfigGraficosPadrao, reResolverGraficos } from '../services/graficosPadrao';
import { invalidarCacheSaudeContratos } from './ContractController';
import { mergePlacasAtivasPorUpload } from '../services/mergePlacasAtivasContratoService';
import {
  analisarConferenciaPlanilhaVsSistema,
  type RelatorioAgenteUpload,
} from '../services/agenteConferenciaUploadService';

// Extensão para request com file do multer
interface RequestWithFile extends Request {
  file?: Express.Multer.File;
}

async function conferirAgenteUpload(
  buffer: Buffer,
  nomeArquivo: string,
  servicoId?: string,
): Promise<RelatorioAgenteUpload | null> {
  try {
    return await analisarConferenciaPlanilhaVsSistema(buffer, nomeArquivo, servicoId);
  } catch (err: any) {
    console.warn('[ColetaController] Agente de conferência:', err?.message || err);
    return null;
  }
}

async function tentarMergePlacasContrato(
  servicoId: string | undefined,
  planilhaUploadId?: number | null,
): Promise<void> {
  if (!servicoId) return;
  try {
    const r = await mergePlacasAtivasPorUpload(servicoId, planilhaUploadId);
    if (r.adicionadas > 0) {
      console.log(
        `[ColetaController] Frota do contrato: +${r.adicionadas} placa(s) (total ${r.total})`,
      );
    }
  } catch (err: any) {
    console.warn('[ColetaController] Merge placas ativas:', err?.message || err);
  }
}

/**
 * Controller para upload de planilhas e consulta de dados de coleta
 */
export class ColetaController {
  private negarContractId(req: Request, res: Response, contractId: string | null | undefined): boolean {
    if (!alteracaoNegada(req.usuario, contractId)) return false;
    res.status(403).json({ error: 'Sem permissão para alterar este contrato' });
    return true;
  }

  private async contractIdDoUpload(uploadId: number | null | undefined): Promise<string | null> {
    if (!uploadId) return null;
    const upload = await AppDataSource.getRepository(PlanilhaUpload).findOne({
      where: { id: uploadId },
      select: ['id', 'servico_id'],
    });
    if (!upload?.servico_id) return null;
    const servico = await AppDataSource.getRepository(Servico).findOne({
      where: { id: upload.servico_id },
      select: ['id', 'contract_id'],
    });
    return servico?.contract_id ?? null;
  }

  private async negarPorUploadId(
    req: Request,
    res: Response,
    uploadId: number | null | undefined,
  ): Promise<boolean> {
    if (!req.usuario?.contractId || req.usuario.role === 'superadmin') return false;
    const contractId = await this.contractIdDoUpload(uploadId);
    return this.negarContractId(req, res, contractId);
  }

  /**
   * Valida se o usuarioId realmente existe no banco.
   * Se o banco foi resetado, tokens antigos podem ter IDs inválidos.
   */
  private async validarUsuarioId(usuarioId?: string): Promise<string | null> {
    if (!usuarioId) return null;
    try {
      const userRepo = AppDataSource.getRepository(User);
      const existe = await userRepo.findOne({ where: { id: usuarioId }, select: ['id'] });
      return existe ? usuarioId : null;
    } catch {
      return null;
    }
  }

  /**
   * POST /api/coleta/upload/contrato
   * Upload no nível do contrato: detecta o tipo da planilha e envia ao serviço certo.
   * - CONSOLIDADO → distribui Roçada/Capina/Varrição/Poda
   * - Coleta (PLACA/PESO) → serviço coleta_caminhao
   * - Roçada legado → serviço rocadeira
   *
   * Body (multipart):
   *   - planilha: arquivo .xlsx/.xls/.xlsm
   *   - contract_id: string
   *   - estrategia: opcional ('atualizar_data' default quando já há dados)
   */
  async uploadContrato(req: RequestWithFile, res: Response): Promise<void> {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'Nenhum arquivo enviado.' });
        return;
      }
      const ext = file.originalname.split('.').pop()?.toLowerCase();
      if (ext !== 'xlsx' && ext !== 'xls' && ext !== 'xlsm') {
        res.status(400).json({ error: 'Formato inválido. Envie um arquivo .xlsx, .xls ou .xlsm.' });
        return;
      }

      const contractId = String(req.body?.contract_id || '').trim();
      if (!contractId) {
        res.status(400).json({ error: 'contract_id é obrigatório.' });
        return;
      }
      if (this.negarContractId(req, res, contractId)) return;

      const usuarioIdValido = await this.validarUsuarioId(req.usuario?.id);
      const estrategiaRaw = req.body?.estrategia;
      const { estrategiaSubstituiDatasProducao } = await import('../services/substituicaoImportacaoProducao');
      const substituir = estrategiaSubstituiDatasProducao(estrategiaRaw);

      const { classificarPlanilhaContrato } = await import('../services/planilhaContratoClassifier');
      const { obterServicoPorTipoContrato } = await import('../services/servicosPadraoContratoService');
      const classificacao = classificarPlanilhaContrato(file.buffer);

      if (classificacao.tipo === 'consolidado_producao') {
        const resultado = await ConsolidadoProducaoImportService.importarPorContrato(
          file.buffer,
          file.originalname,
          contractId,
          usuarioIdValido ?? undefined,
          substituir,
        );

        const partes = resultado.splitPorServico.map((s) => {
          const und = resultado.porTipo.find((p) => p.tipoSistema === s.tipoSistema)?.undPrincipal || '';
          return `${s.servicoNome}: ${s.importados} reg. (${s.quantitativoTotal.toLocaleString('pt-BR')}${und ? ' ' + und : ''})`;
        });
        let mensagem = `Produção importada: ${resultado.importados} registro(s). ${partes.join(' · ')}`;
        if (resultado.tiposSemServico.length) {
          mensagem += ` (${resultado.tiposSemServico.map((t) => `${t.registros} ${t.tipoSistema} sem serviço`).join(', ')})`;
        }
        const avisoCiclo = (resultado.avisos || []).find((a) => a.includes('ciclo já fechado') || a.includes('ciclo anterior'));
        if (avisoCiclo) mensagem += ` ${avisoCiclo}`;
        const avisoDup = (resultado.avisos || []).find((a) => a.includes('já estavam no sistema'));
        if (avisoDup) mensagem += ` ${avisoDup}`;

        for (const s of resultado.splitPorServico || []) {
          if (s.importados > 0) {
            await tentarMergePlacasContrato(s.servicoId, s.planilhaUploadId);
          }
        }

        invalidarCacheSaudeContratos(contractId);
        res.json({
          sucesso: true,
          tipoDetectado: classificacao.tipo,
          tipoDetectadoLabel: classificacao.label,
          ...resultado,
          importadas: resultado.importados,
          mensagem,
        });
        return;
      }

      if (classificacao.tipo === 'unificado') {
        const resultado = await ServicosUnificadosImportService.importarPorContrato(
          file.buffer,
          file.originalname,
          contractId,
          usuarioIdValido ?? undefined,
          substituir,
        );

        const partes = resultado.splitPorServico.map((s) => {
          const und = resultado.porTipo.find((p) => p.tipoSistema === s.tipoSistema)?.undPrincipal || '';
          return `${s.servicoNome}: ${s.importados} reg. (${s.quantitativoTotal.toLocaleString('pt-BR')}${und ? ' ' + und : ''})`;
        });
        let mensagem = `Planilha unificada importada: ${resultado.importados} registro(s). ${partes.join(' · ')}`;
        if (resultado.tiposSemServico.length) {
          mensagem += ` (${resultado.tiposSemServico.map((t) => `${t.registros} ${t.tipoSistema} sem serviço`).join(', ')})`;
        }
        const avisoCiclo = (resultado.avisos || []).find((a) => a.includes('ciclo já fechado') || a.includes('ciclo anterior'));
        if (avisoCiclo) mensagem += ` ${avisoCiclo}`;
        const avisoDup = (resultado.avisos || []).find((a) => a.includes('já estavam no sistema'));
        if (avisoDup) mensagem += ` ${avisoDup}`;

        for (const s of resultado.splitPorServico || []) {
          if (s.importados > 0) {
            await tentarMergePlacasContrato(s.servicoId, s.planilhaUploadId);
          }
        }

        invalidarCacheSaudeContratos(contractId);
        res.json({
          sucesso: true,
          tipoDetectado: classificacao.tipo,
          tipoDetectadoLabel: classificacao.label,
          ...resultado,
          importadas: resultado.importados,
          mensagem,
        });
        return;
      }

      if (classificacao.tipo === 'coleta') {
        const alvo = await obterServicoPorTipoContrato(contractId, TipoServico.COLETA_CAMINHAO);
        let estrategia: 'ignorar' | 'substituir' | 'atualizar_data' | 'inserir_data' = 'atualizar_data';
        if (estrategiaRaw === 'ignorar') estrategia = 'ignorar';
        else if (estrategiaRaw === 'substituir') estrategia = 'substituir';
        else if (estrategiaRaw === 'inserir_data') estrategia = 'inserir_data';

        const agente = await conferirAgenteUpload(file.buffer, file.originalname, alvo.id);
        const resultado = (estrategia === 'atualizar_data' || estrategia === 'inserir_data')
          ? await DeduplicacaoService.importarPorData(
            file.buffer,
            file.originalname,
            estrategia,
            usuarioIdValido ?? undefined,
            alvo.id,
          )
          : await DeduplicacaoService.importarComDedup(
            file.buffer,
            file.originalname,
            estrategia === 'substituir' ? 'substituir' : 'ignorar',
            usuarioIdValido ?? undefined,
            alvo.id,
          );

        const qtd = Number((resultado as any).importados ?? (resultado as any).importadas ?? 0);
        await tentarMergePlacasContrato(alvo.id, (resultado as any).planilhaUploadId);
        invalidarCacheSaudeContratos(contractId);
        const avisos = Array.isArray((resultado as { avisos?: string[] }).avisos)
          ? (resultado as { avisos: string[] }).avisos
          : [];
        const avisoCiclo = avisos.find((a) => a.includes('ciclo'));
        res.json({
          sucesso: true,
          tipoDetectado: classificacao.tipo,
          tipoDetectadoLabel: classificacao.label,
          servicoId: alvo.id,
          servicoNome: alvo.nome,
          ...resultado,
          importadas: qtd,
          agente,
          mensagem: [
            avisoCiclo
              ? `Coleta importada em “${alvo.nome}”: ${qtd} registro(s). ${avisoCiclo}`
              : `Coleta importada em “${alvo.nome}”: ${qtd} registro(s).`,
            agente?.mensagem,
          ].filter(Boolean).join(' '),
        });
        return;
      }

      if (classificacao.tipo === 'rocada') {
        const alvo = await obterServicoPorTipoContrato(contractId, TipoServico.ROCADEIRA);
        const resultadoRocada = await RocadaImportService.importar(
          file.buffer,
          file.originalname,
          alvo.id,
          usuarioIdValido ?? undefined,
          substituir,
        );

        invalidarCacheSaudeContratos(contractId);
        res.json({
          sucesso: true,
          tipoDetectado: classificacao.tipo,
          tipoDetectadoLabel: classificacao.label,
          servicoId: alvo.id,
          servicoNome: alvo.nome,
          ...resultadoRocada,
          importadas: resultadoRocada.importados,
          mensagem: `Roçada importada em “${alvo.nome}” (${labelModeloRocada(resultadoRocada.modelo)}): ${resultadoRocada.importados} registro(s).${
            (resultadoRocada.avisos || []).some((a) => a.includes('já estavam no sistema'))
              ? ` ${(resultadoRocada.avisos || []).find((a) => a.includes('já estavam no sistema'))}`
              : ''
          }`,
        });
        return;
      }

      res.status(400).json({
        error: 'Não foi possível identificar o tipo da planilha. Use CONSOLIDADO (SERVIÇO/DATA/QUANTIDADE), layout unificado (TIPO DE SERVIÇO), Coleta (PLACA/PESO) ou Roçada legada.',
        tipoDetectado: classificacao.tipo,
        tipoDetectadoLabel: classificacao.label,
      });
    } catch (error: any) {
      console.error('Erro no upload por contrato:', error);
      const msg = error.message || 'Erro ao processar planilha do contrato.';
      const status = msg.includes('ciclo(s) já fechado') ? 409 : 400;
      res.status(status).json({ error: msg });
    }
  }

  /**
   * POST /api/coleta/upload
   * Faz upload e importa dados de uma planilha XLSX
   * Agora aceita estratégia de conflito para deduplicação.
   * 
   * Body (multipart):
   *   - planilha: arquivo .xlsx/.xls
   *   - servico_id: string (opcional)
   *   - estrategia: 'ignorar' | 'substituir' | 'atualizar_data' | 'inserir_data'
   *     (opcional, default 'ignorar')
   */
  async upload(req: RequestWithFile, res: Response): Promise<void> {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'Nenhum arquivo enviado.' });
        return;
      }

      // Validar extensão
      const ext = file.originalname.split('.').pop()?.toLowerCase();
      if (ext !== 'xlsx' && ext !== 'xls' && ext !== 'xlsm') {
        res.status(400).json({ error: 'Formato inválido. Envie um arquivo .xlsx, .xls ou .xlsm.' });
        return;
      }

      const { servico_id, estrategia: estrategiaRaw } = req.body;

      // Validar usuarioId contra o banco (evita FK violation se banco foi resetado)
      const usuarioIdValido = await this.validarUsuarioId(req.usuario?.id);

      // CONSOLIDADO Power Query e layout unificado legado — pipelines próprios.
      if (servico_id) {
        const servicoRepo = AppDataSource.getRepository(Servico);
        const servicoTipo = await servicoRepo.findOne({
          where: { id: servico_id },
          select: ['id', 'tipo', 'nome', 'contract_id'],
        });
        if (this.negarContractId(req, res, servicoTipo?.contract_id)) return;

        if (servicoTipo && detectarPlanilhaConsolidadoProducao(file.buffer)) {
          const substituirCons = estrategiaRaw === 'substituir' || estrategiaRaw === 'atualizar_data';
          const resultadoCons = TIPOS_ACEITA_CONSOLIDADO.has(String(servicoTipo.tipo))
            ? await ConsolidadoProducaoImportService.importar(
              file.buffer,
              file.originalname,
              servico_id,
              usuarioIdValido ?? undefined,
              substituirCons,
            )
            : await ConsolidadoProducaoImportService.importarPorContrato(
              file.buffer,
              file.originalname,
              servicoTipo.contract_id,
              usuarioIdValido ?? undefined,
              substituirCons,
            );

          const partes = resultadoCons.splitPorServico.map((s) => {
            const und = resultadoCons.porTipo.find((p) => p.tipoSistema === s.tipoSistema)?.undPrincipal || '';
            return `${s.servicoNome}: ${s.importados} reg. (${s.quantitativoTotal.toLocaleString('pt-BR')}${und ? ' ' + und : ''})`;
          });
          let mensagem = `Produção importada: ${resultadoCons.importados} registro(s). ${partes.join(' · ')}`;
          if (resultadoCons.tiposSemServico.length) {
            mensagem += ` (${resultadoCons.tiposSemServico.map((t) => `${t.registros} ${t.tipoSistema} sem serviço`).join(', ')})`;
          }

          for (const s of resultadoCons.splitPorServico || []) {
            if (s.importados > 0) {
              await tentarMergePlacasContrato(s.servicoId, s.planilhaUploadId);
            }
          }

          res.json({
            sucesso: true,
            ...resultadoCons,
            importadas: resultadoCons.importados,
            mensagem,
          });
          return;
        }

        if (
          servicoTipo
          && TIPOS_ACEITA_UNIFICADO.has(String(servicoTipo.tipo))
          && detectarPlanilhaServicosUnificados(file.buffer)
        ) {
          const resultadoUnif = await ServicosUnificadosImportService.importar(
            file.buffer,
            file.originalname,
            servico_id,
            usuarioIdValido ?? undefined,
            estrategiaRaw === 'substituir' || estrategiaRaw === 'atualizar_data',
          );

          const partes = resultadoUnif.splitPorServico.map((s) => {
            const und = resultadoUnif.porTipo.find((p) => p.tipoSistema === s.tipoSistema)?.undPrincipal || '';
            return `${s.servicoNome}: ${s.importados} reg. (${s.quantitativoTotal.toLocaleString('pt-BR')}${und ? ' ' + und : ''})`;
          });
          let mensagem = `Planilha unificada importada: ${resultadoUnif.importados} registro(s). ${partes.join(' · ')}`;
          if (resultadoUnif.tiposSemServico.length) {
            mensagem += ` (${resultadoUnif.tiposSemServico.map((t) => `${t.registros} ${t.tipoSistema} sem serviço`).join(', ')})`;
          }
          if (resultadoUnif.consolidacao?.uploadsRemovidos) {
            mensagem += ` ${resultadoUnif.consolidacao.uploadsRemovidos} planilha(s) antiga(s) removida(s).`;
          }

          for (const s of resultadoUnif.splitPorServico || []) {
            if (s.importados > 0) {
              await tentarMergePlacasContrato(s.servicoId, s.planilhaUploadId);
            }
          }

          res.json({
            sucesso: true,
            ...resultadoUnif,
            importadas: resultadoUnif.importados,
            mensagem,
          });
          return;
        }

        // Serviço de roçada: pipeline multi-modelo (não usa validação de viagem)
        if (servicoTipo?.tipo === TipoServico.ROCADEIRA || servicoTipo?.tipo === 'rocadeira') {
          const resultadoRocada = await RocadaImportService.importar(
            file.buffer,
            file.originalname,
            servico_id,
            usuarioIdValido ?? undefined,
            estrategiaRaw === 'substituir' || estrategiaRaw === 'atualizar_data',
          );

          // Gráficos padrão de roçada
          try {
            const servico = await servicoRepo.findOne({ where: { id: servico_id } });
            if (servico) {
              const colunasNomes = ['DATA', 'BAIRRO', 'Area m²', 'Equipamento', 'Operador', 'Equipe', 'LOGRADOURO'];
              const graficosAtuais = servico.configDashboard?.graficos || [];
              const graficosReResolvidos = graficosAtuais.length > 0
                ? reResolverGraficos(graficosAtuais, colunasNomes)
                : gerarConfigGraficosPadrao('rocadeira', colunasNomes);
              const cfgAtual = servico.configDashboard || {};
              servico.configDashboard = {
                ...cfgAtual,
                graficos: graficosReResolvidos,
                reResolvidoEm: new Date().toISOString(),
                graficosPadraoAplicados: true,
              };
              await servicoRepo.save(servico);
            }
          } catch (err) {
            console.warn('[ColetaController] Erro ao aplicar gráficos roçada:', err);
          }

          const split = resultadoRocada.splitPorServico;
          let mensagem = `Roçada importada (${labelModeloRocada(resultadoRocada.modelo)}): ${resultadoRocada.importados} registro(s), `
            + `${resultadoRocada.areaTotalM2.toLocaleString('pt-BR')} m² em ${resultadoRocada.dias} dia(s).`;
          if (split && split.length >= 2) {
            mensagem += ' Dashboards Manual e Mecanizada atualizados neste upload.';
          } else if (resultadoRocada.porTipoExecucao) {
            const p = resultadoRocada.porTipoExecucao;
            if (p.manual.registros > 0 && p.mecanizada.registros > 0) {
              mensagem += ` Manual ${p.manual.registros} · Mecanizada ${p.mecanizada.registros}.`;
            }
          }
          if (resultadoRocada.consolidacao?.uploadsRemovidos) {
            mensagem += ` ${resultadoRocada.consolidacao.uploadsRemovidos} planilha(s) antiga(s) removida(s).`;
          }

          res.json({
            sucesso: true,
            ...resultadoRocada,
            importadas: resultadoRocada.importados,
            mensagem,
          });
          return;
        }
      }

      if (!servico_id && this.negarContractId(req, res, null)) return;

      // Normalizar estratégia
      let estrategia: 'ignorar' | 'substituir' | 'atualizar_data' | 'inserir_data' = 'ignorar';
      if (estrategiaRaw === 'substituir') estrategia = 'substituir';
      else if (estrategiaRaw === 'atualizar_data') estrategia = 'atualizar_data';
      else if (estrategiaRaw === 'inserir_data') estrategia = 'inserir_data';

      let resultado: any;
      const agente = await conferirAgenteUpload(file.buffer, file.originalname, servico_id);

      // Estratégias por data usam o novo pipeline
      if (estrategia === 'atualizar_data' || estrategia === 'inserir_data') {
        resultado = await DeduplicacaoService.importarPorData(
          file.buffer,
          file.originalname,
          estrategia,
          usuarioIdValido ?? undefined,
          servico_id
        );
      } else {
        resultado = await DeduplicacaoService.importarComDedup(
          file.buffer,
          file.originalname,
          estrategia,
          usuarioIdValido ?? undefined,
          servico_id
        );
      }

      // Também disparar a detecção de padrão (como fazia o fluxo antigo)
      if (servico_id) {
        try {
          const { detectarPadraoPlanilha } = await import('../services/PadraoPlanilhaDetector');
          const { gerarConfigGraficosPadrao, reResolverGraficos } = await import('../services/graficosPadrao');
          const servicoRepo = AppDataSource.getRepository(Servico);
          const servico = await servicoRepo.findOne({ where: { id: servico_id } });
          if (servico) {
            const colunas = detectarPadraoPlanilha(file.buffer);
            const colunasNomes = colunas.map((c: any) => c.nome);
            const graficosAtuais = servico.configDashboard?.graficos || [];
            const graficosReResolvidos = graficosAtuais.length > 0
              ? reResolverGraficos(graficosAtuais, colunasNomes)
              : gerarConfigGraficosPadrao(servico.tipo || 'coleta_caminhao', colunasNomes);

            servico.padraoPlanilha = {
              colunas,
              totalLinhas: resultado.totalLinhas,
              ultimoUpload: resultado.planilhaUploadId,
              ultimoUploadNome: file.originalname,
              detectadoEm: new Date().toISOString(),
            };
            const cfgAtual = servico.configDashboard || {};
            const tipoColeta = servico.tipo === TipoServico.COLETA_CAMINHAO;
            const padraoColeta = tipoColeta ? buildConfigDashboardPadraoColeta() : null;
            const semKpis = !cfgAtual.kpis?.length;

            servico.configDashboard = {
              ...cfgAtual,
              kpis: semKpis && padraoColeta ? padraoColeta.kpis : cfgAtual.kpis,
              graficos: graficosReResolvidos,
              rankingsOperacionais: cfgAtual.rankingsOperacionais ?? padraoColeta?.rankingsOperacionais,
              reResolvidoEm: new Date().toISOString(),
              reResolvido: true,
              graficosPadraoAplicados: true,
              graficosPadraoTotal: graficosReResolvidos.length,
              ...(semKpis && padraoColeta ? { dashboardPadraoVersao: padraoColeta.dashboardPadraoVersao } : {}),
            };
            await servicoRepo.save(servico);
          }
        } catch (err) {
          console.warn('[ColetaController] Erro ao detectar padrão:', err);
        }
        invalidarCacheDadosServico(servico_id);
        invalidarCacheDashboardServico(servico_id);
        dashboardCache.invalidar(servico_id);
        agendarWarmupPosUpload(servico_id);
        await tentarMergePlacasContrato(servico_id, resultado?.planilhaUploadId);
      }

      let mensagem: string;
      if (estrategia === 'atualizar_data' || estrategia === 'inserir_data') {
        const cons = (resultado as any).consolidacao;
        const partes = [
          `${resultado.importados} registro(s) na planilha ativa`,
        ];
        if (resultado.datasApagadas?.length) {
          partes.push(`${resultado.datasApagadas.length} dia(s) atualizado(s)`);
        }
        if (cons?.registrosRemovidosAusentes > 0) {
          partes.push(`${cons.registrosRemovidosAusentes} registro(s) de dias só no sistema removidos`);
        } else if ((resultado as any).diasRemovidosAusentes?.length > 0) {
          const n = (resultado as any).diasRemovidosAusentes.reduce(
            (s: number, d: { registrosRemovidos: number }) => s + d.registrosRemovidos,
            0,
          );
          partes.push(`${n} registro(s) de dias só no sistema removidos`);
        }
        if (cons?.uploadsRemovidos > 0) {
          partes.push(`${cons.uploadsRemovidos} planilha(s) antiga(s) removida(s)`);
        }
        if (resultado.ignorados > 0) {
          partes.push(`${resultado.ignorados} linha(s) ignorada(s)`);
        }
        mensagem = `Planilha processada! ${partes.join('; ')}.`;
      } else {
        mensagem = resultado.ignorados > 0
          ? `Planilha processada! ${resultado.importados} registros importados, ${resultado.ignorados} duplicatas ignoradas.`
          : `Planilha processada! ${resultado.importados} registros importados de ${resultado.totalLinhas}.`;
      }

      res.json({
        sucesso: true,
        ...resultado,
        agente,
        mensagem: [mensagem, agente?.mensagem].filter(Boolean).join(' '),
      });
    } catch (error: any) {
      console.error('Erro ao importar planilha:', error);
      const msg = error.message || 'Erro ao processar planilha.';
      const status = msg.includes('ciclo(s) já fechado') ? 409 : 500;
      res.status(status).json({ error: msg });
    }
  }

  /**
   * POST /api/coleta/upload/preview-servicos-unificados
   * Pré-visualiza layout unificado (TIPO DE SERVIÇO) sem importar.
   */
  async previewServicosUnificados(req: RequestWithFile, res: Response): Promise<void> {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'Nenhum arquivo enviado.' });
        return;
      }
      const ext = file.originalname.split('.').pop()?.toLowerCase();
      if (ext !== 'xlsx' && ext !== 'xls' && ext !== 'xlsm') {
        res.status(400).json({ error: 'Formato inválido. Envie .xlsx, .xls ou .xlsm.' });
        return;
      }

      const ehConsolidado = detectarPlanilhaConsolidadoProducao(file.buffer);
      if (ehConsolidado) {
        const preview = ConsolidadoProducaoImportService.preview(file.buffer);
        const podeImportar = preview.resumo.podeImportar;
        const partes = preview.porTipo.map((p) =>
          `${p.tipoLabel}: ${p.registros} reg. (${p.quantitativoTotal.toLocaleString('pt-BR')}${p.undPrincipal ? ' ' + p.undPrincipal : ''})`,
        );
        const mensagem = podeImportar
          ? `Produção: ${preview.resumo.registros} registro(s). ${partes.join(' · ')}. Cada aba vira um serviço no contrato.`
          : (preview.avisos[0] || 'Nenhuma linha válida na aba CONSOLIDADO.');

        res.json({
          sucesso: podeImportar,
          ehUnificado: true,
          ehConsolidadoProducao: true,
          arquivo: file.originalname,
          mensagem,
          modelo: preview.modelo,
          modeloLabel: preview.resumo.modeloLabel,
          abasUsadas: preview.abasUsadas,
          avisos: preview.avisos,
          porTipo: preview.porTipo,
          podeImportar,
          resumo: preview.resumo,
        });
        return;
      }

      const ehUnificado = detectarPlanilhaServicosUnificados(file.buffer);
      if (!ehUnificado) {
        res.json({
          sucesso: false,
          ehUnificado: false,
          mensagem: 'Planilha não está no layout CONSOLIDADO (SERVIÇO/QUANTIDADE) nem unificado (TIPO DE SERVIÇO).',
        });
        return;
      }

      const preview = ServicosUnificadosImportService.preview(file.buffer);
      const podeImportar = preview.resumo.podeImportar;
      const partes = preview.porTipo.map((p) =>
        `${p.tipoLabel}: ${p.registros} reg. (${p.quantitativoTotal.toLocaleString('pt-BR')}${p.undPrincipal ? ' ' + p.undPrincipal : ''})`,
      );
      const mensagem = podeImportar
        ? `Layout unificado: ${preview.resumo.registros} registro(s). ${partes.join(' · ')}. Cada TIPO DE SERVIÇO vai para o serviço correspondente.`
        : (preview.avisos[0] || 'Nenhuma linha válida no layout unificado.');

      res.json({
        sucesso: podeImportar,
        ehUnificado: true,
        arquivo: file.originalname,
        mensagem,
        modelo: preview.modelo,
        abasUsadas: preview.abasUsadas,
        avisos: preview.avisos,
        porTipo: preview.porTipo,
        podeImportar,
        resumo: preview.resumo,
      });
    } catch (error: any) {
      console.error('Erro no preview unificado:', error);
      res.status(500).json({ error: error.message || 'Erro ao analisar planilha unificada.' });
    }
  }

  /**
   * POST /api/coleta/upload/preview-rocada
   * Pré-visualiza planilha de roçada (multi-modelo) sem importar.
   */
  async previewRocada(req: RequestWithFile, res: Response): Promise<void> {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'Nenhum arquivo enviado.' });
        return;
      }
      const ext = file.originalname.split('.').pop()?.toLowerCase();
      if (ext !== 'xlsx' && ext !== 'xls' && ext !== 'xlsm') {
        res.status(400).json({ error: 'Formato inválido. Envie .xlsx, .xls ou .xlsm.' });
        return;
      }

      const servicoId = (req.body?.servico_id as string | undefined) || undefined;
      let servicoNome: string | undefined;
      let filtroServico: 'manual' | 'mecanizada' | null = null;
      if (servicoId) {
        const servico = await AppDataSource.getRepository(Servico).findOne({ where: { id: servicoId } });
        if (servico) {
          servicoNome = servico.nome;
          filtroServico = inferirFiltroExecucaoServico(
            servico.nome,
            servico.configFaturamento as {
              valorM2Manual?: number | null;
              valorM2Mecanizada?: number | null;
              valorM2?: number | null;
            } | null,
          );
        }
      }

      // Preview da planilha completa (Manual + Mecanizada) — o import decide distribuição
      const preview = RocadaImportService.preview(file.buffer);
      const podeImportar = preview.resumo.podeImportar;
      const porTipo = preview.porTipoExecucao || preview.resumo.porTipoExecucao;
      let mensagem: string;
      if (podeImportar) {
        mensagem = `Modelo ${preview.resumo.modeloLabel || preview.resumo.modelo}: ${preview.resumo.registros} registro(s), `
          + `${preview.resumo.areaTotalM2.toLocaleString('pt-BR')} m², `
          + `${preview.resumo.dias} dia(s), ${preview.resumo.bairros} bairro(s).`;
        if (porTipo && (porTipo.manual.registros > 0 || porTipo.mecanizada.registros > 0)) {
          mensagem += ` Manual ${porTipo.manual.registros} · Mecanizada ${porTipo.mecanizada.registros}.`;
        }
        if (preview.resumo.linhasSemArea > 0) {
          mensagem += ` ${preview.resumo.linhasSemArea} linha(s) sem m² serão ignoradas.`;
        }
      } else if (preview.semColunaArea) {
        mensagem = 'Planilha sem coluna de metragem/área (m²). Inclua METRAGEM, TOTAL (M²), Área ou EXECUTADO.';
      } else if (preview.linhasSemArea > 0) {
        mensagem = `Nenhuma linha com m²/área válida (${preview.linhasSemArea} linha(s) sem metragem).`;
      } else {
        mensagem = preview.avisos[0] || 'Nenhuma linha de roçada reconhecida.';
      }

      res.json({
        sucesso: podeImportar,
        arquivo: file.originalname,
        ...preview,
        mensagem,
        podeImportar,
        filtroTipoAplicado: null,
        filtroServicoDetectado: filtroServico,
        servicoNome,
      });
    } catch (error: any) {
      console.error('Erro preview roçada:', error);
      res.status(500).json({ error: error.message || 'Erro ao analisar planilha de roçada.' });
    }
  }

  /**
   * POST /api/coleta/upload/preview
   * Analisa uma planilha sem importar — mostra o resumo de conflitos.
   * 
   * Body (multipart):
   *   - planilha: arquivo .xlsx/.xls
   *   - servico_id: string (opcional)
   */
  async previewUpload(req: RequestWithFile, res: Response): Promise<void> {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'Nenhum arquivo enviado.' });
        return;
      }

      const ext = file.originalname.split('.').pop()?.toLowerCase();
      if (ext !== 'xlsx' && ext !== 'xls' && ext !== 'xlsm') {
        res.status(400).json({ error: 'Formato inválido. Envie um arquivo .xlsx, .xls ou .xlsm.' });
        return;
      }

      const { servico_id } = req.body;

      const analise = await DeduplicacaoService.analisarPlanilha(
        file.buffer,
        servico_id
      );

      // Amostra de conflitos (até 5) para exibição
      const amostraConflitos = analise.conflitantes.slice(0, 5).map(c => ({
        indice: c.indice,
        chave: c.chave,
        dadosPlanilha: {
          dataSaida: c.dadosPlanilha.dataSaida,
          placa: c.dadosPlanilha.placa,
          turno: c.dadosPlanilha.turno,
          motorista: c.dadosPlanilha.motorista,
          regional: c.dadosPlanilha.regional,
          pesoTotal: c.dadosPlanilha.pesoTotal,
          kmTotal: c.dadosPlanilha.kmTotal,
        },
        dadosBanco: c.dadosBanco ? {
          dataSaida: (c.dadosBanco as any).dataSaida,
          placa: (c.dadosBanco as any).placa,
          turno: (c.dadosBanco as any).turno,
          motorista: (c.dadosBanco as any).motorista,
          regional: (c.dadosBanco as any).regional,
          pesoTotal: (c.dadosBanco as any).pesoTotal,
          kmTotal: (c.dadosBanco as any).kmTotal,
        } : null,
        diferencas: c.diferencas,
      }));

      const agente = await conferirAgenteUpload(file.buffer, file.originalname, servico_id);

      res.json({
        sucesso: true,
        totalLinhas: analise.totalLinhas,
        novos: analise.novos.length,
        duplicados: analise.duplicados.length,
        conflitantes: analise.conflitantes.length,
        temConflitos: analise.conflitantes.length > 0,
        amostraConflitos,
        chaveUsada: analise.chaveUsada,
        arquivo: file.originalname,
        agente,
      });
    } catch (error: any) {
      console.error('Erro ao analisar planilha:', error);
      res.status(500).json({ error: error.message || 'Erro ao analisar planilha.' });
    }
  }

  /**
   * POST /api/coleta/upload/preview-data
   * Analisa uma planilha agrupando por DATA — mostra quantas datas
   * já existem no banco e quantas são novas.
   * 
   * Body (multipart):
   *   - planilha: arquivo .xlsx/.xls
   *   - servico_id: string (opcional)
   */
  async previewUploadData(req: RequestWithFile, res: Response): Promise<void> {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'Nenhum arquivo enviado.' });
        return;
      }

      const ext = file.originalname.split('.').pop()?.toLowerCase();
      if (ext !== 'xlsx' && ext !== 'xls') {
        res.status(400).json({ error: 'Formato inválido. Envie um arquivo .xlsx ou .xls.' });
        return;
      }

      const { servico_id } = req.body;

      const analise = await DeduplicacaoService.analisarPlanilhaPorData(
        file.buffer,
        servico_id
      );

      res.json({
        sucesso: true,
        ...analise,
        arquivo: file.originalname,
      });
    } catch (error: any) {
      console.error('Erro ao analisar planilha por data:', error);
      res.status(500).json({ error: error.message || 'Erro ao analisar planilha.' });
    }
  }

  /**
   * POST /api/coleta/upload/conferencia-diaria
   * Compara planilha vs sistema por dia (rotas, viagens, peso, km).
   */
  async conferenciaDiaria(req: RequestWithFile, res: Response): Promise<void> {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'Nenhum arquivo enviado.' });
        return;
      }

      const ext = file.originalname.split('.').pop()?.toLowerCase();
      if (ext !== 'xlsx' && ext !== 'xls') {
        res.status(400).json({ error: 'Formato inválido. Envie um arquivo .xlsx ou .xls.' });
        return;
      }

      const { servico_id } = req.body;
      if (!servico_id) {
        res.status(400).json({ error: 'servico_id é obrigatório.' });
        return;
      }

      const conferencia = await DeduplicacaoService.conferirPlanilhaDiaria(
        file.buffer,
        servico_id,
      );
      const agente = await conferirAgenteUpload(file.buffer, file.originalname, servico_id);

      res.json({
        sucesso: true,
        arquivo: file.originalname,
        ...conferencia,
        agente,
      });
    } catch (error: any) {
      console.error('Erro na conferência diária:', error);
      res.status(500).json({ error: error.message || 'Erro na conferência diária.' });
    }
  }

  /**
   * POST /api/coleta/upload/agente-conferencia
   * Analisa rotas, retrabalho da sala técnica e cruzamento com o que já está no sistema.
   */
  async agenteConferencia(req: RequestWithFile, res: Response): Promise<void> {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'Nenhum arquivo enviado.' });
        return;
      }
      const ext = file.originalname.split('.').pop()?.toLowerCase();
      if (ext !== 'xlsx' && ext !== 'xls' && ext !== 'xlsm') {
        res.status(400).json({ error: 'Formato inválido. Envie um arquivo .xlsx, .xls ou .xlsm.' });
        return;
      }
      const servicoId = String(req.body?.servico_id || '').trim() || undefined;
      const agente = await conferirAgenteUpload(file.buffer, file.originalname, servicoId);
      if (!agente) {
        res.status(500).json({ error: 'Não foi possível analisar a planilha.' });
        return;
      }
      res.json({ sucesso: true, arquivo: file.originalname, ...agente });
    } catch (error: any) {
      console.error('Erro no agente de conferência:', error);
      res.status(500).json({ error: error.message || 'Erro no agente de conferência.' });
    }
  }

  /**
   * GET /api/coleta/dashboard
   * Retorna dados agregados para o dashboard
   */
  async dashboard(req: Request, res: Response): Promise<void> {
    try {
      const { dataInicio, dataFim, regional, distrito, planilhaId } = req.query;

      const filtros = {
        dataInicio: dataInicio as string | undefined,
        dataFim: dataFim as string | undefined,
        regional: regional as string | undefined,
        distrito: distrito as string | undefined,
        planilhaId: planilhaId ? parseInt(planilhaId as string) : undefined,
      };

      const [
        resumo,
        pesoPorRegional,
        pesoPorDia,
        topPlacas,
        tipoCaminhao,
        dadosPorTurno,
        topMotoristas,
        dadosPorDiaSemana,
        listaRegionais,
        listaDistritos,
        listaUploads,
      ] = await Promise.all([
        PlanilhaService.getDashboardData(filtros),
        PlanilhaService.getPesoPorRegional(filtros),
        PlanilhaService.getPesoPorDia(filtros),
        PlanilhaService.getTopPlacas(10, filtros),
        PlanilhaService.getDistribuicaoTipoCaminhao(filtros),
        PlanilhaService.getDadosPorTurno(filtros),
        PlanilhaService.getTopMotoristas(10, filtros),
        PlanilhaService.getDadosPorDiaSemana(filtros),
        PlanilhaService.getListaRegionais(),
        PlanilhaService.getListaDistritos(),
        PlanilhaService.listarUploadsResumido(),
      ]);

      // Normalizar tipos numéricos (getRawMany retorna strings)
      const normalizar = (arr: any[], campos: string[]) =>
        arr.map(item => {
          const obj: any = { ...item };
          for (const campo of campos) {
            if (obj[campo] !== undefined && obj[campo] !== null) {
              obj[campo] = Number(obj[campo]);
            }
          }
          return obj;
        });

      res.json({
        resumo,
        pesoPorRegional: normalizar(pesoPorRegional, ['total_peso', 'quantidade']),
        pesoPorDia: normalizar(pesoPorDia, ['total_peso', 'quantidade', 'total_km', 'total_viagens']),
        topPlacas: normalizar(topPlacas, ['total_peso', 'quantidade', 'total_km', 'total_viagens']),
        tipoCaminhao: normalizar(tipoCaminhao, ['quantidade', 'total_peso', 'media_peso']),
        dadosPorTurno: normalizar(dadosPorTurno, ['quantidade', 'total_peso', 'media_peso']),
        topMotoristas: normalizar(topMotoristas, ['total_peso', 'quantidade', 'total_km', 'total_viagens']),
        dadosPorDiaSemana: normalizar(dadosPorDiaSemana, ['quantidade', 'total_peso', 'total_km', 'total_viagens']),
        listaRegionais: listaRegionais.map((r: any) => r.regional),
        listaDistritos: listaDistritos.map((d: any) => d.distrito),
        listaUploads,
      });
    } catch (error: any) {
      console.error('Erro ao carregar dashboard:', error);
      res.status(500).json({ error: error.message || 'Erro ao carregar dados do dashboard.' });
    }
  }

  /**
   * GET /api/coleta/uploads
   * Lista histórico de uploads (com filtro opcional por serviço)
   */
  async uploads(req: Request, res: Response): Promise<void> {
    try {
      const { servico_id } = req.query;
      let uploads;
      if (servico_id) {
        uploads = await PlanilhaService.listarUploadsPorServico(servico_id as string);
      } else {
        uploads = await PlanilhaService.listarUploads();
      }
      res.json(uploads);
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Erro ao listar uploads.' });
    }
  }

  /**
   * GET /api/coleta/uploads/por-dia?data=YYYY-MM-DD
   * Lista uploads do dia agrupados por contrato
   */
  async uploadsPorDia(req: Request, res: Response): Promise<void> {
    try {
      const dataRaw = String(req.query.data || '').trim();
      const data = dataRaw || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
      const resultado = await PlanilhaService.listarUploadsPorDia(data);
      res.json(resultado);
    } catch (error: any) {
      const status = error.message?.includes('Data inválida') ? 400 : 500;
      res.status(status).json({ error: error.message || 'Erro ao listar uploads do dia.' });
    }
  }

  /**
   * GET /api/coleta/uploads/:id/export
   * Exporta os dados de um upload como planilha XLSX
   */
  async exportarUpload(req: Request, res: Response): Promise<void> {
    try {
      const id = parseInt(String(req.params.id));
      if (isNaN(id)) {
        res.status(400).json({ error: 'ID inválido.' });
        return;
      }

      const { buffer, nomeArquivo } = await PlanilhaService.exportarPlanilha(id);

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
      res.send(buffer);
    } catch (error: any) {
      console.error('Erro ao exportar planilha:', error);
      res.status(500).json({ error: error.message || 'Erro ao exportar planilha.' });
    }
  }

  /**
   * GET /api/coleta/dados
   * Retorna dados brutos com paginação
   */
  async dados(req: Request, res: Response): Promise<void> {
    try {
      const { page = '1', limit = '50', regional, turno, placa, dataInicio, dataFim, planilhaId } = req.query;
      const pageNum = Math.max(1, parseInt(page as string));
      const limitNum = Math.min(500, Math.max(1, parseInt(limit as string)));
      const skip = (pageNum - 1) * limitNum;

      const qb = PlanilhaService['coletaRepo'].createQueryBuilder('c')
        .orderBy('c.dataSaida', 'DESC')
        .skip(skip)
        .take(limitNum);

      if (regional) qb.andWhere('c.regional = :regional', { regional });
      if (turno) qb.andWhere('c.turno = :turno', { turno });
      if (placa) qb.andWhere('c.placa = :placa', { placa });
      if (dataInicio) qb.andWhere('c.dataSaida >= :dataInicio', { dataInicio });
      if (dataFim) qb.andWhere('c.dataSaida <= :dataFim', { dataFim });
      if (planilhaId) qb.andWhere('c.planilhaUploadId = :planilhaId', { planilhaId: parseInt(planilhaId as string) });

      const [dados, total] = await qb.getManyAndCount();

      res.json({
        dados,
        total,
        pagina: pageNum,
        totalPaginas: Math.ceil(total / limitNum),
        limite: limitNum,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Erro ao buscar dados.' });
    }
  }

  /**
   * PUT /api/coleta/dados/:id
   * Atualiza um registro de coleta
   */
  async atualizarDado(req: Request, res: Response): Promise<void> {
    try {
      const id = parseInt(String(req.params.id));
      if (isNaN(id)) {
        res.status(400).json({ error: 'ID inválido.' });
        return;
      }

      const repo = PlanilhaService['coletaRepo'];
      const registro = await repo.findOne({ where: { id } });
      if (!registro) {
        res.status(404).json({ error: 'Registro não encontrado.' });
        return;
      }
      if (await this.negarPorUploadId(req, res, registro.planilhaUploadId)) return;

      const camposPermitidos = [
        'turno', 'regional', 'distrito', 'placa', 'motorista',
        'numeroColetores', 'kmSaida', 'horaSaida', 'kmChegada', 'horaChegada',
        'peso1', 'peso2', 'peso3', 'peso4', 'peso5', 'pesoTotal',
        'kmTotal', 'numeroViagens', 'tipoCaminhao', 'dataSaida',
        'horaUltimoTerminoCarregamento', 'tempoForaUnidade', 'horasForaUnidade', 'diaSemana',
      ];

      for (const campo of camposPermitidos) {
        if (req.body[campo] !== undefined) {
          (registro as any)[campo] = req.body[campo];
        }
      }

      await repo.save(registro);
      res.json(registro);
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Erro ao atualizar registro.' });
    }
  }

  /**
   * DELETE /api/coleta/dados/:id
   * Exclui um registro de coleta
   */
  async excluirDado(req: Request, res: Response): Promise<void> {
    try {
      const id = parseInt(String(req.params.id));
      if (isNaN(id)) {
        res.status(400).json({ error: 'ID inválido.' });
        return;
      }

      const repo = PlanilhaService['coletaRepo'];
      const registro = await repo.findOne({ where: { id } });
      if (!registro) {
        res.status(404).json({ error: 'Registro não encontrado.' });
        return;
      }
      if (await this.negarPorUploadId(req, res, registro.planilhaUploadId)) return;

      await repo.remove(registro);
      res.json({ sucesso: true, mensagem: 'Registro excluído.' });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Erro ao excluir registro.' });
    }
  }

  /**
   * PUT /api/coleta/uploads/:id/rename
   * Renomeia o arquivo de um upload
   */
  async renomearUpload(req: Request, res: Response): Promise<void> {
    try {
      const id = parseInt(String(req.params.id));
      if (isNaN(id)) {
        res.status(400).json({ error: 'ID inválido.' });
        return;
      }
      const { nome } = req.body;
      if (!nome || typeof nome !== 'string' || nome.trim().length === 0) {
        res.status(400).json({ error: 'Nome inválido.' });
        return;
      }
      if (await this.negarPorUploadId(req, res, id)) return;
      const upload = await PlanilhaService.renomearUpload(id, nome.trim());
      res.json(upload);
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Erro ao renomear.' });
    }
  }

  /**
   * GET /api/coleta/estudo-viagens/:id
   * Retorna o estudo detalhado das viagens de um registro de coleta
   */
  async estudoViagens(req: Request, res: Response): Promise<void> {
    try {
      const id = parseInt(String(req.params.id));
      if (isNaN(id)) {
        res.status(400).json({ error: 'ID inválido.' });
        return;
      }
      const resultado = await PlanilhaService.getEstudoViagens(id);
      res.json(resultado);
    } catch (error: any) {
      console.error('Erro ao buscar estudo de viagens:', error);
      res.status(500).json({ error: error.message || 'Erro ao buscar estudo de viagens.' });
    }
  }

  /**
   * DELETE /api/coleta/uploads/:id
   * Exclui um upload e todos os dados vinculados
   */
  async excluirUpload(req: Request, res: Response): Promise<void> {
    try {
      const id = parseInt(String(req.params.id));
      if (isNaN(id)) {
        res.status(400).json({ error: 'ID inválido.' });
        return;
      }
      if (await this.negarPorUploadId(req, res, id)) return;
      const resultado = await PlanilhaService.excluirUpload(id);
      if (resultado.servicoId) {
        invalidarCacheDashboardServico(resultado.servicoId);
        dashboardCache.invalidar(resultado.servicoId);
        agendarWarmupPosUpload(resultado.servicoId);
      }
      res.json({ sucesso: true, mensagem: resultado.message, ...resultado });
    } catch (error: any) {
      console.error('Erro ao excluir upload:', error);
      res.status(500).json({ error: error.message || 'Erro ao excluir upload.' });
    }
  }

  /**
   * GET /api/coleta/qualidade/:uploadId
   * Retorna relatório de qualidade dos dados de um upload específico.
   * Detecta: KM negativo, viagens sem peso, sem KM inicial/final, etc.
   */
  async qualidade(req: Request, res: Response): Promise<void> {
    try {
      const uploadId = parseInt(String(req.params.uploadId));
      if (isNaN(uploadId)) {
        res.status(400).json({ error: 'ID de upload inválido.' });
        return;
      }
      const relatorio = await QualidadeDadosService.gerarRelatorio(uploadId);
      res.json(relatorio);
    } catch (error: any) {
      console.error('Erro ao gerar relatório de qualidade:', error);
      res.status(500).json({ error: error.message || 'Erro ao gerar relatório de qualidade.' });
    }
  }

  /**
   * GET /api/coleta/qualidade/servico/:servicoId
   * Retorna relatório de qualidade do último upload de um serviço
   */
  async qualidadeUltimoUpload(req: Request, res: Response): Promise<void> {
    try {
      const servicoIdParam = req.params.servicoId;
      if (!servicoIdParam || Array.isArray(servicoIdParam)) {
        res.status(400).json({ error: 'ID do serviço é obrigatório.' });
        return;
      }
      const relatorio = await QualidadeDadosService.gerarRelatorioUltimoUpload(servicoIdParam);
      if (!relatorio) {
        res.status(404).json({ error: 'Nenhum upload encontrado para este serviço.' });
        return;
      }
      res.json(relatorio);
    } catch (error: any) {
      console.error('Erro ao gerar relatório de qualidade:', error);
      res.status(500).json({ error: error.message || 'Erro ao gerar relatório de qualidade.' });
    }
  }

  /**
   * POST /api/coleta/preview-qualidade
   * Analisa a qualidade da planilha ANTES da importação.
   * Detecta células vazias, linhas vazias, dados no final,
   * duplicatas, valores negativos, etc.
   * 
   * Body (multipart):
   *   - planilha: arquivo .xlsx/.xls
   */
  async previewQualidade(req: RequestWithFile, res: Response): Promise<void> {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'Nenhum arquivo enviado.' });
        return;
      }

      const ext = file.originalname.split('.').pop()?.toLowerCase();
      if (ext !== 'xlsx' && ext !== 'xls') {
        res.status(400).json({ error: 'Formato inválido. Envie um arquivo .xlsx ou .xls.' });
        return;
      }

      const relatorio = analisarQualidadePlanilha(file.buffer, file.originalname);

      res.json({
        sucesso: true,
        ...relatorio,
      });
    } catch (error: any) {
      console.error('Erro ao analisar qualidade da planilha:', error);
      res.status(500).json({ error: error.message || 'Erro ao analisar qualidade da planilha.' });
    }
  }
}
