import { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import AppDataSource, {
  getControlDataSource,
  isMultiTenant,
  runWithTenant,
} from '../database/data-source';
import { isSuperadmin } from '../middlewares/authMiddleware';
import { ehHubDeContratos, emCadaContrato, escopoCacheTenant } from '../services/tenantFanout';
import { Tenant } from '../entities/Tenant';
import { provisionarBancoContrato } from '../services/tenantDatabaseService';
import { Contract } from '../entities/Contract';
import { Servico } from '../entities/Servico';
import { PlanilhaUpload } from '../entities/PlanilhaUpload';
import { ColetaData } from '../entities/ColetaData';
import { invalidarPdfCache } from '../services/PdfCacheManager';
import PlanilhaService from '../services/PlanilhaService';
import { normalizarDiaInicioCiclo } from '../utils/periodoCicloContrato';
import { normalizarListaPlacasReserva } from '../utils/placasReserva';
import {
  normalizarListaNomesOperacionais,
  normalizarListaPlacasAtivas,
} from '../utils/configOperacional';
import { normalizarMapaLimitesContrato } from '../config/pesoMaximoCaminhao';
import {
  normalizarDensidadeResiduoKgL,
  normalizarMapaDensidadesKgL,
  normalizarMapaDensidadesPorPlaca,
} from '../services/analisePesoColetaService';
import { invalidarCacheComparacaoContrato, limparCacheEndpoints } from '../services/comparacaoCache';
import { garantirServicosPadraoContrato } from '../services/servicosPadraoContratoService';

const cacheSaude = new Map<string, { data: any; timestamp: number }>();
const CACHE_SAUDE_TTL_MS = 120_000;

function getCacheSaude<T>(key: string): T | null {
  const item = cacheSaude.get(key);
  if (item && Date.now() - item.timestamp < CACHE_SAUDE_TTL_MS) return item.data as T;
  cacheSaude.delete(key);
  return null;
}

function setCacheSaude(key: string, data: any): void {
  cacheSaude.set(key, { data, timestamp: Date.now() });
  if (cacheSaude.size > 20) {
    const agora = Date.now();
    for (const [k, v] of cacheSaude) {
      if (agora - v.timestamp > CACHE_SAUDE_TTL_MS) cacheSaude.delete(k);
    }
  }
}

/** Invalida lista/detalhe de saúde para refletir create/update/delete imediatamente. */
export function invalidarCacheSaudeContratos(contractId?: string): void {
  cacheSaude.delete('contracts-saude-lista');
  if (contractId) cacheSaude.delete(`contracts-saude:${contractId}`);
}

function compareContratoNome(a: string | null | undefined, b: string | null | undefined): number {
  return (a ?? '').localeCompare(b ?? '', 'pt-BR', { sensitivity: 'base' });
}

export class ContractController {
  private get repository() {
    return AppDataSource.getRepository(Contract);
  }

  async listar(req: Request, res: Response): Promise<any> {
    try {
      if (ehHubDeContratos(req.usuario)) {
        // Lê o contrato dentro do banco de cada um: o gestor vê o cadastro completo,
        // não só o nome registrado no controle.
        const partes = await emCadaContrato(async (tenant) => {
          const doBanco = await this.repository.find();
          if (doBanco.length > 0) {
            return doBanco.map((c) => ({ ...c, tenantDb: tenant.databaseName }));
          }
          return [{
            id: tenant.contractId,
            numeroContrato: tenant.numeroContrato,
            status: tenant.status,
            tenantDb: tenant.databaseName,
          }];
        });
        const contratos = partes
          .flat()
          .sort((a: any, b: any) => compareContratoNome(a.numeroContrato, b.numeroContrato));
        return res.json({ contratos, total: contratos.length });
      }

      const contracts = await this.repository.find();
      contracts.sort((a, b) => compareContratoNome(a.numeroContrato, b.numeroContrato));

      return res.json({ contratos: contracts, total: contracts.length });
    } catch (error) {
      console.error('Erro ao listar contratos:', error);
      return res.status(500).json({ error: 'Erro ao carregar contratos' });
    }
  }

  async buscarUm(req: Request, res: Response): Promise<any> {
    try {
      const { id } = req.params as { id: string };
      const contract = await this.repository.findOne({ where: { id } });

      if (!contract) {
        return res.status(404).json({ error: 'Contrato não encontrado' });
      }

      return res.json(contract);
    } catch (error) {
      console.error('Erro ao buscar contrato:', error);
      return res.status(500).json({ error: 'Erro ao carregar contrato' });
    }
  }

  async criar(req: Request, res: Response): Promise<any> {
    try {
      const { numeroContrato, valorTonelada, valorMini, valorTruck, valorToco, valorBasculante, diaInicioCiclo } = req.body;

      if (!numeroContrato || !numeroContrato.trim()) {
        return res.status(400).json({ error: 'Nome do contrato é obrigatório' });
      }

      const dados = {
        numeroContrato: numeroContrato.trim(),
        diaInicioCiclo: normalizarDiaInicioCiclo(diaInicioCiclo),
        valorTonelada: valorTonelada !== undefined ? Number(valorTonelada) : null,
        valorMini: valorMini !== undefined ? Number(valorMini) : null,
        valorTruck: valorTruck !== undefined ? Number(valorTruck) : null,
        valorToco: valorToco !== undefined ? Number(valorToco) : null,
        valorBasculante: valorBasculante !== undefined ? Number(valorBasculante) : null,
      };

      if (isMultiTenant()) {
        if (!isSuperadmin(req.usuario)) {
          return res.status(403).json({ error: 'Apenas o super-admin pode criar contratos' });
        }
        const contractId = randomUUID();
        const tenant = await provisionarBancoContrato({
          contractId,
          numeroContrato: dados.numeroContrato,
        });
        const novoContract = await runWithTenant(tenant.databaseName, async () => {
          const contract = this.repository.create({ id: contractId, ...dados });
          const salvo = await this.repository.save(contract);
          try {
            await garantirServicosPadraoContrato(salvo.id);
          } catch (err) {
            console.warn('[ContractController] Falha ao garantir serviços padrão:', err);
          }
          return salvo;
        });
        invalidarCacheSaudeContratos(novoContract.id);
        return res.status(201).json({ ...novoContract, tenantDb: tenant.databaseName });
      }

      const contract = this.repository.create(dados);
      const novoContract = await this.repository.save(contract);
      invalidarCacheSaudeContratos(novoContract.id);

      try {
        await garantirServicosPadraoContrato(novoContract.id);
      } catch (err) {
        console.warn('[ContractController] Falha ao garantir serviços padrão:', err);
      }

      return res.status(201).json(novoContract);
    } catch (error: any) {
      console.error('❌ Erro ao criar contrato:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao criar contrato' });
    }
  }

  async atualizar(req: Request, res: Response): Promise<any> {
    try {
      const { id } = req.params as { id: string };
      const {
        numeroContrato,
        valorTonelada,
        valorMini,
        valorTruck,
        valorToco,
        valorBasculante,
        diaInicioCiclo,
        configOperacional,
      } = req.body;

      const contract = await this.repository.findOne({ where: { id } });

      if (!contract) {
        return res.status(404).json({ error: 'Contrato não encontrado' });
      }

      if (numeroContrato !== undefined) {
        contract.numeroContrato = numeroContrato.trim();
      }
      if (diaInicioCiclo !== undefined) {
        contract.diaInicioCiclo = normalizarDiaInicioCiclo(diaInicioCiclo);
      }
      if (valorTonelada !== undefined) contract.valorTonelada = Number(valorTonelada);
      if (valorMini !== undefined) contract.valorMini = Number(valorMini);
      if (valorTruck !== undefined) contract.valorTruck = Number(valorTruck);
      if (valorToco !== undefined) contract.valorToco = Number(valorToco);
      if (valorBasculante !== undefined) contract.valorBasculante = Number(valorBasculante);
      if (configOperacional !== undefined) {
        const atual = contract.configOperacional || {};
        // Novo objeto + update explícito: TypeORM às vezes não detecta mudança em jsonb
        const novoConfig = {
          ...atual,
          ...configOperacional,
          ...(configOperacional.placasReserva !== undefined
            ? { placasReserva: normalizarListaPlacasReserva(configOperacional.placasReserva) }
            : {}),
          ...(configOperacional.placasAtivas !== undefined
            ? { placasAtivas: normalizarListaPlacasAtivas(configOperacional.placasAtivas) }
            : {}),
          ...(configOperacional.motoristas !== undefined
            ? { motoristas: normalizarListaNomesOperacionais(configOperacional.motoristas) }
            : {}),
          ...(configOperacional.coletores !== undefined
            ? { coletores: normalizarListaNomesOperacionais(configOperacional.coletores) }
            : {}),
          ...(configOperacional.pesoMaximoKg !== undefined
            ? { pesoMaximoKg: normalizarMapaLimitesContrato(configOperacional.pesoMaximoKg) ?? {} }
            : {}),
          ...(configOperacional.volumeL !== undefined
            ? { volumeL: normalizarMapaLimitesContrato(configOperacional.volumeL) ?? {} }
            : {}),
          ...(configOperacional.densidadeResiduoKgL !== undefined
            ? {
                densidadeResiduoKgL:
                  normalizarDensidadeResiduoKgL(configOperacional.densidadeResiduoKgL) ?? null,
              }
            : {}),
          ...(configOperacional.densidadeKgL !== undefined
            ? { densidadeKgL: normalizarMapaDensidadesKgL(configOperacional.densidadeKgL) ?? {} }
            : {}),
          ...(configOperacional.densidadeKgLPorPlaca !== undefined
            ? {
                densidadeKgLPorPlaca: normalizarMapaDensidadesPorPlaca(
                  configOperacional.densidadeKgLPorPlaca,
                ),
              }
            : {}),
          ...(configOperacional.pastaBackupPlanilhas !== undefined
            ? {
                pastaBackupPlanilhas: (() => {
                  const p = String(configOperacional.pastaBackupPlanilhas ?? '').trim();
                  return p || null;
                })(),
              }
            : {}),
        };
        contract.configOperacional = novoConfig;
        await this.repository.update(id, { configOperacional: novoConfig as any });
      }

      await this.repository.save(contract);

      // Invalidar cache do dashboard e PDF ao salvar valores do contrato
      invalidarPdfCache(id);
      invalidarPdfCache(); // limpar cache geral também
      invalidarCacheSaudeContratos(id);
      // Tarifa e limites do contrato entram em conta espalhada pelos serviços, e as
      // chaves de cache deles não carregam o id do contrato: zera tudo.
      limparCacheEndpoints();

      const atualizado = await this.repository.findOne({ where: { id } });
      return res.json(atualizado || contract);
    } catch (error: any) {
      console.error('Erro ao atualizar contrato:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao atualizar contrato' });
    }
  }

  async excluir(req: Request, res: Response): Promise<any> {
    try {
      const { id } = req.params as { id: string };

      const contract = await this.repository.findOne({ where: { id } });
      if (!contract) {
        return res.status(404).json({ error: 'Contrato não encontrado' });
      }

      const servicoRepo = AppDataSource.getRepository(Servico);
      const servicos = await servicoRepo.find({ where: { contract_id: id }, select: ['id'] });

      let uploadsRemovidos = 0;
      let registrosRemovidos = 0;
      for (const s of servicos) {
        const limpeza = await PlanilhaService.excluirTodosDadosDoServico(s.id);
        uploadsRemovidos += limpeza.uploadsRemovidos;
        registrosRemovidos += limpeza.registrosRemovidos;
      }

      // WhatsApp mapas caem via CASCADE do serviço; remove explícito por segurança
      if (servicos.length > 0) {
        const { WhatsappGrupoMapa } = await import('../entities/WhatsappGrupoMapa');
        await AppDataSource.getRepository(WhatsappGrupoMapa)
          .createQueryBuilder()
          .delete()
          .where('"servicoId" IN (:...ids)', { ids: servicos.map((s) => s.id) })
          .execute();
      }

      await this.repository.remove(contract);

      if (isMultiTenant()) {
        const tenantRepo = getControlDataSource().getRepository(Tenant);
        const tenant = await tenantRepo.findOne({ where: { contractId: id } });
        if (tenant) {
          tenant.status = 'encerrado';
          await tenantRepo.save(tenant);
        }
      }

      invalidarCacheSaudeContratos(id);
      invalidarCacheComparacaoContrato(id);
      invalidarPdfCache();

      return res.json({
        message: 'Contrato excluído com sucesso',
        servicosRemovidos: servicos.length,
        uploadsRemovidos,
        registrosRemovidos,
      });
    } catch (error: any) {
      console.error('Erro ao excluir contrato:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao excluir contrato' });
    }
  }

  /**
   * GET /api/contracts/:id/kpis
   * Retorna os KPIs configurados no contrato
   */
  async listarKpis(req: Request, res: Response): Promise<any> {
    try {
      const { id } = req.params as { id: string };
      const contract = await this.repository.findOne({ where: { id }, relations: ['servicos'] });

      if (!contract) {
        return res.status(404).json({ error: 'Contrato não encontrado' });
      }

      // Coletar colunas disponiveis de todos os servicos do contrato
      const colunasDisponiveis: { nome: string; tipo: string; servico: string }[] = [];
      for (const servico of contract.servicos || []) {
        const padrao = (servico as any).padraoPlanilha;
        if (padrao?.colunas) {
          for (const col of padrao.colunas) {
            colunasDisponiveis.push({
              nome: col.nome,
              tipo: col.tipo,
              servico: servico.nome,
            });
          }
        }
      }

      return res.json({
        kpis: contract.kpisConfig || [],
        colunasDisponiveis,
        valoresCaminhao: {
          VALOR_TONELADA: contract.valorTonelada,
          VALOR_MINI: contract.valorMini,
          VALOR_TRUCK: contract.valorTruck,
          VALOR_TOCO: contract.valorToco,
          VALOR_BASCULANTE: contract.valorBasculante,
        },
      });
    } catch (error: any) {
      console.error('Erro ao listar KPIs:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao carregar KPIs' });
    }
  }

  /**
   * PUT /api/contracts/:id/kpis
   * Salva a configuracao de KPIs do contrato
   */
  async salvarKpis(req: Request, res: Response): Promise<any> {
    try {
      const { id } = req.params as { id: string };
      const { kpis } = req.body;

      const contract = await this.repository.findOne({ where: { id } });
      if (!contract) {
        return res.status(404).json({ error: 'Contrato não encontrado' });
      }

      contract.kpisConfig = kpis || [];
      await this.repository.save(contract);

      return res.json({ message: 'KPIs salvos com sucesso!', kpis: contract.kpisConfig });
    } catch (error: any) {
      console.error('Erro ao salvar KPIs:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao salvar KPIs' });
    }
  }

  /**
   * GET /api/contracts/:id/config-resumo
   * Retorna a configuracao do resumo executivo do contrato
   */
  async getConfigResumo(req: Request, res: Response): Promise<any> {
    try {
      const { id } = req.params as { id: string };
      const contract = await this.repository.findOne({ where: { id } });

      if (!contract) {
        return res.status(404).json({ error: 'Contrato não encontrado' });
      }

      return res.json({
        configResumo: contract.configResumo || null,
      });
    } catch (error: any) {
      console.error('Erro ao buscar config resumo:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao carregar configuração do resumo' });
    }
  }

  /**
   * PUT /api/contracts/:id/config-resumo
   * Salva a configuracao do resumo executivo do contrato
   * Body: { metricas: string[] }
   */
  async salvarConfigResumo(req: Request, res: Response): Promise<any> {
    try {
      const { id } = req.params as { id: string };
      const { configResumo } = req.body;

      const contract = await this.repository.findOne({ where: { id } });
      if (!contract) {
        return res.status(404).json({ error: 'Contrato não encontrado' });
      }

      contract.configResumo = configResumo || null;
      await this.repository.save(contract);

      return res.json({ message: 'Configuração do resumo salva com sucesso!', configResumo: contract.configResumo });
    } catch (error: any) {
      console.error('Erro ao salvar config resumo:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao salvar configuração do resumo' });
    }
  }

  /**
   * ⭐ GET /api/contracts/saude
   * Retorna dados consolidados de SAÚDE de TODOS os contratos.
   * Cada contrato inclui statusSaude (green/yellow/red),
   * totalServicos, servicosConfigurados, totalRegistros, ultimoUpload, tiposServico, etc.
   */
  private async montarSaudeLista(): Promise<any[]> {
      const servicoRepo = AppDataSource.getRepository(Servico);

      const [contracts, todosServicos] = await Promise.all([
        this.repository.find(),
        servicoRepo.find(),
      ]);

      const servicosPorContrato = new Map<string, Servico[]>();
      for (const s of todosServicos) {
        if (!servicosPorContrato.has(s.contract_id)) {
          servicosPorContrato.set(s.contract_id, []);
        }
        servicosPorContrato.get(s.contract_id)!.push(s);
      }

      const servicoIds = todosServicos.map(s => s.id);
      const [contagens, ultimosUploads] = await Promise.all([
        PlanilhaService.getContagemRegistrosPorServicos(servicoIds),
        PlanilhaService.getUltimosUploadsPorServicos(servicoIds),
      ]);

      const seteDiasAtras = Date.now() - 7 * 24 * 60 * 60 * 1000;

      const resultados = contracts.map(contract => {
        const servicos = servicosPorContrato.get(contract.id) || [];

        let totalRegistros = 0;
        let ultimoUpload: string | null = null;
        const tiposSet = new Set<string>();
        let servicosConfigurados = 0;
        let servicosComUpload = 0;
        let servicosSemKpi = 0;
        let totalKpisAtivos = 0;

        for (const s of servicos) {
          const cont = contagens.get(s.id) || { total: 0, validos: 0 };
          const registros = cont.total;
          const configKpis: any[] = s.configDashboard?.kpis || [];
          const kpisAtivos = configKpis.filter((k: any) => k.ativo !== false).length;
          const ultimo = ultimosUploads.get(s.id);
          const ultimoUploadStr = ultimo ? ultimo.toISOString() : null;
          const temUpload = registros > 0;
          const temConfig = kpisAtivos > 0;

          const tiposStr = s.tipo || '';
          tiposStr.split(',').filter(Boolean).forEach((t: string) => tiposSet.add(t.trim()));

          totalRegistros += registros;
          if (ultimoUploadStr && (!ultimoUpload || new Date(ultimoUploadStr).getTime() > new Date(ultimoUpload).getTime())) {
            ultimoUpload = ultimoUploadStr;
          }
          if (temUpload) servicosComUpload++;
          if (temConfig) servicosConfigurados++;
          if (!temConfig) servicosSemKpi++;
          totalKpisAtivos += kpisAtivos;
        }

        const temUploadRecente = ultimoUpload && new Date(ultimoUpload).getTime() > seteDiasAtras;
        const todosConfigurados = servicos.length === 0 || servicosConfigurados >= servicos.length;

        let statusSaude: 'green' | 'yellow' | 'red';
        if (servicos.length === 0) statusSaude = 'yellow';
        else if (servicosComUpload === 0) statusSaude = 'red';
        else if (todosConfigurados && temUploadRecente) statusSaude = 'green';
        else statusSaude = 'yellow';

        return {
          id: contract.id,
          numeroContrato: contract.numeroContrato,
          status: contract.status,
          diaInicioCiclo: normalizarDiaInicioCiclo(contract.diaInicioCiclo),
          statusSaude,
          totalServicos: servicos.length,
          servicosConfigurados,
          servicosComUpload,
          servicosSemKpi,
          totalRegistros,
          totalKpisAtivos,
          ultimoUpload,
          tiposServico: Array.from(tiposSet),
        };
      });

      resultados.sort((a, b) => compareContratoNome(a.numeroContrato, b.numeroContrato));
      return resultados;
  }

  async saudeLista(req: Request, res: Response): Promise<any> {
    try {
      const cacheKey = `contracts-saude-lista:${escopoCacheTenant()}`;
      const cached = getCacheSaude<any>(cacheKey);
      if (cached) return res.json(cached);

      let resultados: any[];
      if (ehHubDeContratos(req.usuario)) {
        resultados = (await emCadaContrato(() => this.montarSaudeLista())).flat();
        resultados.sort((a, b) => compareContratoNome(a.numeroContrato, b.numeroContrato));
      } else {
        resultados = await this.montarSaudeLista();
      }

      const response = { contratos: resultados };
      setCacheSaude(cacheKey, response);
      return res.json(response);
    } catch (error: any) {
      console.error('Erro ao carregar saude dos contratos:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao carregar dados de saude' });
    }
  }

  /**
   * ⭐ GET /api/contracts/:id/saude
   * Retorna dados consolidados de SAÚDE de UM contrato (inclui detalhes de cada serviço).
   */
  async saudeDetalhe(req: Request, res: Response): Promise<any> {
    try {
      const { id } = req.params as { id: string };
      const servicoRepo = AppDataSource.getRepository(Servico);
      const uploadRepo = AppDataSource.getRepository(PlanilhaUpload);
      const coletaRepo = AppDataSource.getRepository(ColetaData);

      const contract = await this.repository.findOne({ where: { id } });
      if (!contract) return res.status(404).json({ error: 'Contrato não encontrado' });

      const servicos = await servicoRepo.find({ where: { contract_id: id } });

      const servicosDetalhados = await Promise.all(
        servicos.map(async (s) => {
          const uploads = await uploadRepo.find({
            where: { servico_id: s.id },
            order: { criadoEm: 'DESC' },
            take: 1,
          });

          const registros = await coletaRepo
            .createQueryBuilder('c')
            .innerJoin(PlanilhaUpload, 'u', 'u.id = c.planilhaUploadId')
            .where('u.servico_id = :sid', { sid: s.id })
            .getCount();
          const configKpis: any[] = s.configDashboard?.kpis || [];
          const kpisAtivos = configKpis.filter((k: any) => k.ativo !== false).length;

          return {
            id: s.id,
            nome: s.nome,
            tipo: s.tipo || 'coleta_caminhao',
            totalRegistros: registros,
            kpisAtivos,
            kpisTotal: configKpis.length,
            ultimoUpload: uploads[0]?.criadoEm ? uploads[0].criadoEm.toISOString() : null,
            temConfig: kpisAtivos > 0,
            temUpload: registros > 0,
          };
        })
      );

      let totalRegistros = 0;
      let ultimoUpload: string | null = null;
      let servicosConfigurados = 0;
      let servicosComUpload = 0;
      let servicosSemKpi = 0;
      let totalKpisAtivos = 0;

      for (const sd of servicosDetalhados) {
        totalRegistros += sd.totalRegistros;
        if (sd.ultimoUpload && (!ultimoUpload || new Date(sd.ultimoUpload).getTime() > new Date(ultimoUpload).getTime())) {
          ultimoUpload = sd.ultimoUpload;
        }
        if (sd.temUpload) servicosComUpload++;
        if (sd.temConfig) servicosConfigurados++;
        if (!sd.temConfig) servicosSemKpi++;
        totalKpisAtivos += sd.kpisAtivos;
      }

      const seteDiasAtras = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const temUploadRecente = ultimoUpload && new Date(ultimoUpload).getTime() > seteDiasAtras;
      const todosConfigurados = servicos.length === 0 || servicosConfigurados >= servicos.length;

      let statusSaude: 'green' | 'yellow' | 'red';
      if (servicos.length === 0) statusSaude = 'yellow';
      else if (servicosComUpload === 0) statusSaude = 'red';
      else if (todosConfigurados && temUploadRecente) statusSaude = 'green';
      else statusSaude = 'yellow';

      return res.json({
        id,
        numeroContrato: contract.numeroContrato,
        status: contract.status,
        statusSaude,
        totalServicos: servicos.length,
        servicosConfigurados,
        servicosComUpload,
        servicosSemKpi,
        totalRegistros,
        totalKpisAtivos,
        ultimoUpload,
        servicos: servicosDetalhados,
      });
    } catch (error: any) {
      console.error('Erro ao carregar saude do contrato:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao carregar dados de saude' });
    }
  }
}
