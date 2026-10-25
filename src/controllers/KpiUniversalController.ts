import { Request, Response } from 'express';
import { In } from 'typeorm';
import AppDataSource from '../database/data-source';
import { KpiUniversal, PlaceholderKpi } from '../entities/KpiUniversal';
import { Servico } from '../entities/Servico';
import { TIPOS_SERVICO_VALORES } from '../enums/TipoServico';
import { deduplicarKpisLista } from '../services/kpiDeduplicacaoService';
import { sincronizarKpisUniversaisBiblioteca } from '../database/sincronizarKpisUniversaisBiblioteca';

/** Helper: extrai param como string */
function paramStr(req: Request, name: string): string {
  const v = req.params[name];
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Resolve placeholders de um KPI universal contra as colunas reais de um serviço.
 * Busca em 3 níveis: nome exato → similaridade → não resolvido
 */
function resolverPlaceholders(
  placeholders: PlaceholderKpi[],
  colunasServico: { nome: string; tipo: string }[]
): { resolvidos: Record<string, string>; falhas: PlaceholderKpi[] } {
  const resolvidos: Record<string, string> = {};
  const falhas: PlaceholderKpi[] = [];

  const normalizar = (s: string) =>
    s.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');

  const nomesColunasNorm = colunasServico.map(c => ({
    original: c.nome,
    norm: normalizar(c.nome),
  }));

  for (const ph of placeholders) {
    let resolvido = false;

    // Nível 1: busca por nome exato (ignorando case/acentos)
    const phNorm = normalizar(ph.nome);
    for (const cn of nomesColunasNorm) {
      if (cn.norm === phNorm) {
        resolvidos[ph.nome] = cn.original;
        resolvido = true;
        break;
      }
    }
    if (resolvido) continue;

    // Nível 2: busca por similaridade nas colunas candidatas
    for (const candidato of ph.colunasCandidatas) {
      const candNorm = normalizar(candidato);
      for (const cn of nomesColunasNorm) {
        if (cn.norm === candNorm) {
          resolvidos[ph.nome] = cn.original;
          resolvido = true;
          break;
        }
        if (cn.norm.includes(candNorm) || candNorm.includes(cn.norm)) {
          resolvidos[ph.nome] = cn.original;
          resolvido = true;
          break;
        }
      }
      if (resolvido) break;
    }
    if (resolvido) continue;

    // Nível 3: busca por similaridade mais ampla (contém tokens)
    const tokensPH = phNorm.split(/\s+/);
    let melhorMatch = '';
    let melhorScore = 0;
    for (const cn of nomesColunasNorm) {
      let score = 0;
      for (const token of tokensPH) {
        if (cn.norm.includes(token)) score += 1;
      }
      if (score > melhorScore) {
        melhorScore = score;
        melhorMatch = cn.original;
      }
    }
    if (melhorScore > 0) {
      resolvidos[ph.nome] = melhorMatch;
      resolvido = true;
    }

    if (!resolvido) {
      falhas.push(ph);
    }
  }

  return { resolvidos, falhas };
}

/**
 * Substitui placeholders na fórmula pelos nomes reais das colunas
 */
function aplicarPlaceholdersNaFormula(
  formula: string,
  resolvidos: Record<string, string>
): string {
  let resultado = formula;
  for (const [placeholder, colunaReal] of Object.entries(resolvidos)) {
    // Substitui o placeholder na fórmula
    const regex = new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    resultado = resultado.replace(regex, colunaReal);
  }
  return resultado;
}

export class KpiUniversalController {
  private get repository() {
    return AppDataSource.getRepository(KpiUniversal);
  }

  private get servicoRepo() {
    return AppDataSource.getRepository(Servico);
  }

  /**
   * GET /api/kpis-universais
   * Lista todos os KPIs universais, opcionalmente filtrados por tipo de serviço
   */
  async listar(req: Request, res: Response): Promise<any> {
    try {
      const { tipoServico } = req.query;
      const where: any = {};
      if (tipoServico && typeof tipoServico === 'string') {
        where.tipoServico = tipoServico;
      }
      const kpis = await this.repository.find({
        where,
        order: { categoria: 'ASC', nome: 'ASC' },
      });
      return res.json({ kpis, total: kpis.length });
    } catch (error) {
      console.error('Erro ao listar KPIs universais:', error);
      return res.status(500).json({ error: 'Erro ao carregar KPIs universais' });
    }
  }

  /**
   * GET /api/kpis-universais/:id
   * Busca um KPI universal específico
   */
  async buscarUm(req: Request, res: Response): Promise<any> {
    try {
      const kpi = await this.repository.findOne({ where: { id: paramStr(req, 'id') } });
      if (!kpi) return res.status(404).json({ error: 'KPI universal não encontrado' });
      return res.json(kpi);
    } catch (error) {
      console.error('Erro ao buscar KPI universal:', error);
      return res.status(500).json({ error: 'Erro ao carregar KPI universal' });
    }
  }

  /**
   * POST /api/kpis-universais
   * Cria um novo KPI universal
   */
  async criar(req: Request, res: Response): Promise<any> {
    try {
      const { nome, label, formula, agregacao, formato, unidade, categoria, cor, descricao, metaSugerida, tipoServico, placeholders } = req.body;

      if (!nome || !label || !formula || !categoria || !tipoServico) {
        return res.status(400).json({ error: 'Campos obrigatórios: nome, label, formula, categoria, tipoServico' });
      }

      if (!TIPOS_SERVICO_VALORES.includes(tipoServico)) {
        return res.status(400).json({ error: `Tipo de serviço inválido. Valores: ${TIPOS_SERVICO_VALORES.join(', ')}` });
      }

      const kpi = new KpiUniversal();
      kpi.nome = nome.trim();
      kpi.label = label.trim();
      kpi.formula = formula;
      kpi.agregacao = agregacao || 'sum';
      kpi.formato = formato || 'numero';
      kpi.unidade = unidade || null;
      kpi.categoria = categoria.trim();
      kpi.cor = cor || '#6366f1';
      kpi.descricao = descricao || null;
      kpi.metaSugerida = metaSugerida || null;
      kpi.tipoServico = tipoServico;
      kpi.placeholders = placeholders || [];
      kpi.isPersonalizado = true;

      const novo = await this.repository.save(kpi);
      return res.status(201).json(novo);
    } catch (error) {
      console.error('Erro ao criar KPI universal:', error);
      return res.status(500).json({ error: 'Erro ao criar KPI universal' });
    }
  }

  /**
   * PUT /api/kpis-universais/:id
   * Atualiza um KPI universal
   */
  async atualizar(req: Request, res: Response): Promise<any> {
    try {
      const kpi = await this.repository.findOne({ where: { id: paramStr(req, 'id') } });
      if (!kpi) return res.status(404).json({ error: 'KPI universal não encontrado' });
      if (!kpi.isPersonalizado) {
        return res.status(403).json({ error: 'KPIs de sistema não podem ser editados. Duplique para criar uma versão personalizada.' });
      }

      const { nome, label, formula, agregacao, formato, unidade, categoria, cor, descricao, metaSugerida, tipoServico, placeholders } = req.body;

      if (nome !== undefined) kpi.nome = nome.trim();
      if (label !== undefined) kpi.label = label.trim();
      if (formula !== undefined) kpi.formula = formula;
      if (agregacao !== undefined) kpi.agregacao = agregacao;
      if (formato !== undefined) kpi.formato = formato;
      if (unidade !== undefined) kpi.unidade = unidade;
      if (categoria !== undefined) kpi.categoria = categoria.trim();
      if (cor !== undefined) kpi.cor = cor;
      if (descricao !== undefined) kpi.descricao = descricao;
      if (metaSugerida !== undefined) kpi.metaSugerida = metaSugerida;
      if (tipoServico !== undefined) {
        if (!TIPOS_SERVICO_VALORES.includes(tipoServico)) {
          return res.status(400).json({ error: `Tipo de serviço inválido. Valores: ${TIPOS_SERVICO_VALORES.join(', ')}` });
        }
        kpi.tipoServico = tipoServico;
      }
      if (placeholders !== undefined) kpi.placeholders = placeholders;

      await this.repository.save(kpi);
      return res.json(kpi);
    } catch (error) {
      console.error('Erro ao atualizar KPI universal:', error);
      return res.status(500).json({ error: 'Erro ao atualizar KPI universal' });
    }
  }

  /**
   * DELETE /api/kpis-universais/:id
   * Remove um KPI universal (apenas se nenhum serviço estiver usando)
   */
  async excluir(req: Request, res: Response): Promise<any> {
    try {
      const kpi = await this.repository.findOne({ where: { id: paramStr(req, 'id') } });
      if (!kpi) return res.status(404).json({ error: 'KPI universal não encontrado' });
      if (!kpi.isPersonalizado) {
        return res.status(403).json({ error: 'KPIs de sistema não podem ser excluídos. Duplique para criar uma versão personalizada.' });
      }

      await this.repository.remove(kpi);
      return res.json({ message: 'KPI universal excluído com sucesso' });
    } catch (error) {
      console.error('Erro ao excluir KPI universal:', error);
      return res.status(500).json({ error: 'Erro ao excluir KPI universal' });
    }
  }

  /**
   * POST /api/kpis-universais/duplicar/:id
   * Duplica um KPI universal
   */
  async duplicar(req: Request, res: Response): Promise<any> {
    try {
      const original = await this.repository.findOne({ where: { id: paramStr(req, 'id') } });
      if (!original) return res.status(404).json({ error: 'KPI universal não encontrado' });

      const novo = new KpiUniversal();
      novo.nome = original.nome + ' (cópia)';
      novo.label = original.label;
      novo.formula = original.formula;
      novo.agregacao = original.agregacao;
      novo.formato = original.formato;
      novo.unidade = original.unidade;
      novo.categoria = original.categoria;
      novo.cor = original.cor;
      novo.descricao = original.descricao;
      novo.metaSugerida = original.metaSugerida;
      novo.tipoServico = original.tipoServico;
      novo.placeholders = original.placeholders ? JSON.parse(JSON.stringify(original.placeholders)) : [];
      novo.isPersonalizado = true;

      const criado = await this.repository.save(novo);
      return res.status(201).json(criado);
    } catch (error) {
      console.error('Erro ao duplicar KPI universal:', error);
      return res.status(500).json({ error: 'Erro ao duplicar KPI universal' });
    }
  }

  /**
   * POST /api/kpis-universais/:id/ativar/:servicoId
   * Ativa um KPI universal em um serviço, resolvendo placeholders automaticamente
   * ⭐ Salva no configDashboard do serviço
   */
  async ativarEmServico(req: Request, res: Response): Promise<any> {
    try {
      const id = paramStr(req, 'id');
      const servicoId = paramStr(req, 'servicoId');

      const [kpi, servico] = await Promise.all([
        this.repository.findOne({ where: { id } }),
        this.servicoRepo.findOne({ where: { id: servicoId } }),
      ]);

      if (!kpi) return res.status(404).json({ error: 'KPI universal não encontrado' });
      if (!servico) return res.status(404).json({ error: 'Serviço não encontrado' });

      if (!servico.padraoPlanilha?.colunas?.length) {
        return res.status(400).json({
          error: 'Serviço não possui planilha vinculada. Faça upload primeiro.',
          resolvido: false,
        });
      }

      const colunas = servico.padraoPlanilha.colunas;
      const colunasParaResolver = colunas.map((c: any) => ({ nome: c.nome, tipo: c.tipo || 'texto' }));

      // Resolver placeholders
      const placeholders = kpi.placeholders || [];
      const { resolvidos, falhas } = resolverPlaceholders(placeholders, colunasParaResolver);

      // Aplicar placeholders na fórmula
      let formulaFinal = kpi.formula;
      if (Object.keys(resolvidos).length > 0) {
        formulaFinal = aplicarPlaceholdersNaFormula(formulaFinal, resolvidos);
      }

      const kpiAtivado = {
        id: `universal_${kpi.id}`,
        nome: kpi.nome,
        label: kpi.label,
        expressao: formulaFinal,
        agregacao: kpi.agregacao,
        formato: kpi.formato,
        unidade: kpi.unidade,
        categoria: kpi.categoria,
        cor: kpi.cor,
        descricao: kpi.descricao,
        meta: kpi.metaSugerida,
        ativo: true,
        origemUniversal: kpi.id,
        placeholdersNaoResolvidos: falhas.length > 0 ? falhas.map(f => f.nome) : undefined,
        placeholdersResolvidos: resolvidos,
      };

      // ═══ SALVAR no configDashboard ═══
      const kpisExistentes: any[] = servico.configDashboard?.kpis || [];
      
      // Remove KPI universal com mesmo origemUniversal (evitar duplicação)
      // ⭐ Mantém os OUTROS KPIs universais (que têm origemUniversal diferente)
      // ⭐ Mantém os KPIs manuais (que NÃO têm origemUniversal)
      const kpisSemEste = kpisExistentes.filter((k: any) => k.origemUniversal !== kpi.id);

      const { kpis: kpisDedup } = deduplicarKpisLista([...kpisSemEste, kpiAtivado], { manterInativos: true });

      servico.configDashboard = {
        ...(servico.configDashboard || {}),
        kpis: kpisDedup,
        graficos: servico.configDashboard?.graficos || [],
        ultimaAtivacaoUniversal: new Date().toISOString(),
      };

      await this.servicoRepo.save(servico);
      // ══════════════════════════════════

      return res.json({
        kpi: kpiAtivado,
        resolvido: falhas.length === 0,
        placeholdersResolvidos: resolvidos,
        placeholdersNaoResolvidos: falhas.map(f => ({
          nome: f.nome,
          label: f.label,
          colunasCandidatas: f.colunasCandidatas,
        })),
        salvoEm: servico.configDashboard.ultimaAtivacaoUniversal,
      });
    } catch (error: any) {
      console.error('Erro ao ativar KPI universal em serviço:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao ativar KPI universal' });
    }
  }

  /**
   * POST /api/kpis-universais/ativar-multiplos
   * Ativa múltiplos KPIs universais em um serviço de uma vez
   * ⭐ Resolve placeholders, monta os KPIs e SALVA no configDashboard do serviço.
   * Body: { servicoId, kpiIds: string[] }
   */
  async ativarMultiplos(req: Request, res: Response): Promise<any> {
    try {
      const { servicoId, kpiIds } = req.body;

      if (!servicoId || !kpiIds || !Array.isArray(kpiIds) || kpiIds.length === 0) {
        return res.status(400).json({ error: 'servicoId e kpiIds são obrigatórios' });
      }

      const [kpis, servico] = await Promise.all([
        this.repository.find({ where: { id: In(kpiIds) } }),
        this.servicoRepo.findOne({ where: { id: servicoId } }),
      ]);

      if (!servico) return res.status(404).json({ error: 'Serviço não encontrado' });

      const semPlanilha = !servico.padraoPlanilha?.colunas?.length;

      if (semPlanilha) {
        // Sem planilha vinculada: ativa KPIs com fórmula original e avisa
        const kpisAtivados: any[] = kpis.map(kpi => ({
          id: `universal_${kpi.id}`,
          nome: kpi.nome,
          label: kpi.label,
          expressao: kpi.formula,
          agregacao: kpi.agregacao,
          formato: kpi.formato,
          unidade: kpi.unidade,
          categoria: kpi.categoria,
          cor: kpi.cor,
          descricao: kpi.descricao,
          meta: kpi.metaSugerida,
          ativo: true,
          origemUniversal: kpi.id,
          placeholdersNaoResolvidos: (kpi.placeholders || []).map((p: any) => p.nome),
        }));

        // Salvar mesmo sem planilha
        const kpisExistentes: any[] = servico.configDashboard?.kpis || [];
        const kpisManuais = kpisExistentes.filter((k: any) => !k.origemUniversal);
        const idsSendoAtivados = new Set(kpiIds);
        const kpisUniversaisExistentes = kpisExistentes.filter(
          (k: any) => k.origemUniversal && !idsSendoAtivados.has(k.origemUniversal)
        );
        const { kpis: kpisFinais } = deduplicarKpisLista(
          [...kpisManuais, ...kpisUniversaisExistentes, ...kpisAtivados],
          { manterInativos: true },
        );

        servico.configDashboard = {
          ...(servico.configDashboard || {}),
          kpis: kpisFinais,
          ultimaAtivacaoUniversal: new Date().toISOString(),
          graficos: servico.configDashboard?.graficos || [],
        };

        await this.servicoRepo.save(servico);

        return res.json({
          kpis: kpisAtivados,
          totalAtivados: kpisAtivados.length,
          totalComFalha: kpisAtivados.length,
          semPlanilha: true,
          aviso: 'Serviço sem planilha vinculada. Os placeholders serão resolvidos automaticamente após o upload.',
        });
      }

      const colunas = servico.padraoPlanilha.colunas;
      const colunasParaResolver = colunas.map((c: any) => ({ nome: c.nome, tipo: c.tipo || 'texto' }));

      const kpisAtivados: any[] = [];
      const falhasTotais: any[] = [];

      for (const kpi of kpis) {
        const placeholders = kpi.placeholders || [];
        const { resolvidos, falhas } = resolverPlaceholders(placeholders, colunasParaResolver);

        let formulaFinal = kpi.formula;
        if (Object.keys(resolvidos).length > 0) {
          formulaFinal = aplicarPlaceholdersNaFormula(formulaFinal, resolvidos);
        }

        kpisAtivados.push({
          id: `universal_${kpi.id}`,
          nome: kpi.nome,
          label: kpi.label,
          expressao: formulaFinal,
          agregacao: kpi.agregacao,
          formato: kpi.formato,
          unidade: kpi.unidade,
          categoria: kpi.categoria,
          cor: kpi.cor,
          descricao: kpi.descricao,
          meta: kpi.metaSugerida,
          ativo: true,
          origemUniversal: kpi.id,
          placeholdersNaoResolvidos: falhas.length > 0 ? falhas.map(f => f.nome) : undefined,
        });

        if (falhas.length > 0) {
          falhasTotais.push({
            kpiNome: kpi.nome,
            placeholders: falhas.map(f => ({
              nome: f.nome,
              label: f.label,
              colunasCandidatas: f.colunasCandidatas,
            })),
          });
        }
      }

      // ════════════════════════════════════════════════════════════
      // ⭐ SALVAR no configDashboard do serviço (COM DEDUPLICAÇÃO)
      // ════════════════════════════════════════════════════════════
      const kpisExistentes: any[] = servico.configDashboard?.kpis || [];

      // 1) Manter KPIs manuais (que não têm origemUniversal)
      const kpisManuais = kpisExistentes.filter((k: any) => !k.origemUniversal);

      // 2) Manter KPIs universais que NÃO estão sendo reativados agora
      const idsSendoAtivados = new Set(kpiIds);
      const kpisUniversaisExistentes = kpisExistentes.filter(
        (k: any) => k.origemUniversal && !idsSendoAtivados.has(k.origemUniversal)
      );

      // 3) Juntar e deduplicar (nome, fórmula e aliases)
      const { kpis: kpisFinais } = deduplicarKpisLista(
        [...kpisManuais, ...kpisUniversaisExistentes, ...kpisAtivados],
        { manterInativos: true },
      );

      servico.configDashboard = {
        ...(servico.configDashboard || {}),
        kpis: kpisFinais,
        ultimaAtivacaoUniversal: new Date().toISOString(),
        // Manter outras configurações existentes (gráficos, etc.)
        graficos: servico.configDashboard?.graficos || [],
      };

      await this.servicoRepo.save(servico);
      // ════════════════════════════════════════════════════════════

      return res.json({
        kpis: kpisAtivados,
        totalAtivados: kpisAtivados.length,
        totalComFalha: falhasTotais.length,
        falhas: falhasTotais.length > 0 ? falhasTotais : undefined,
        salvoEm: servico.configDashboard.ultimaAtivacaoUniversal,
      });
    } catch (error: any) {
      console.error('Erro ao ativar múltiplos KPIs universais:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao ativar múltiplos KPIs universais' });
    }
  }

  /**
   * POST /api/kpis-universais/sincronizar-biblioteca
   * Remove KPIs de sistema obsoletos e alinha a biblioteca ao catálogo do código.
   */
  async sincronizarBiblioteca(req: Request, res: Response): Promise<any> {
    try {
      const resultado = await sincronizarKpisUniversaisBiblioteca();
      return res.json({ sucesso: true, ...resultado });
    } catch (error) {
      console.error('Erro ao sincronizar biblioteca de KPIs universais:', error);
      return res.status(500).json({ error: 'Erro ao sincronizar biblioteca de KPIs universais' });
    }
  }

  /**
   * GET /api/kpis-universais/tipos
   * Retorna os tipos de serviço que têm KPIs universais cadastrados
   */
  async listarTiposComKpis(req: Request, res: Response): Promise<any> {
    try {
      const tipos = await this.repository
        .createQueryBuilder('k')
        .select('k.tipoServico')
        .addSelect('COUNT(*)', 'total')
        .groupBy('k.tipoServico')
        .orderBy('k.tipoServico')
        .getRawMany();

      return res.json({ tipos: tipos.map((t: any) => ({ tipo: t.k_tipoServico, total: parseInt(t.total) })) });
    } catch (error) {
      console.error('Erro ao listar tipos:', error);
      return res.status(500).json({ error: 'Erro ao listar tipos' });
    }
  }

  /**
   * POST /api/kpis-universais/importar-de-servico
   * Importa KPIs de um serviço existente para a biblioteca universal
   * Body: { servicoId, tipoServico, kpiIds?: string[] }
   */
  async importarDeServico(req: Request, res: Response): Promise<any> {
    try {
      const { servicoId, tipoServico, kpiIds } = req.body;

      if (!servicoId || !tipoServico) {
        return res.status(400).json({ error: 'servicoId e tipoServico são obrigatórios' });
      }

      const servico = await this.servicoRepo.findOne({ where: { id: servicoId } });
      if (!servico) return res.status(404).json({ error: 'Serviço não encontrado' });

      const kpisOriginais: any[] = servico.configDashboard?.kpis || [];
      const kpisParaImportar = kpiIds
        ? kpisOriginais.filter((k: any) => kpiIds.includes(k.nome || k.id))
        : kpisOriginais;

      const importados: KpiUniversal[] = [];

      for (const kpi of kpisParaImportar) {
        const nomeKpi = (kpi.nome || kpi.label || '').trim();
        if (!nomeKpi) continue;

        const existente = await this.repository.findOne({
          where: { nome: nomeKpi, tipoServico },
        });
        if (existente) continue;

        // Extrair placeholders da fórmula
        const placeholders: PlaceholderKpi[] = [];
        if (kpi.expressao) {
          // Detecta nomes de colunas na fórmula (tokens em maiúsculo)
          const colRegex = /\b([A-ZÀ-Ú][A-ZÀ-Ú\s]+[A-ZÀ-Ú])\b/g;
          let match;
          while ((match = colRegex.exec(kpi.expressao)) !== null) {
            const nome = match[1].trim();
            if (nome.length > 2 && !['SUM', 'AVG', 'MIN', 'MAX', 'COUNT', 'DISTINCT', 'IF', 'ABS', 'ROUND', 'DIVIDE', 'MULTIPLY', 'FATURAMENTO_EST', 'SE', 'TRUE', 'FALSE'].includes(nome) && !/^\d+(\.\d+)?$/.test(nome)) {
              const jaExiste = placeholders.some(p => p.nome === nome);
              if (!jaExiste) {
                placeholders.push({
                  nome,
                  label: nome,
                  colunasCandidatas: [nome],
                });
              }
            }
          }
        }

        const novo = new KpiUniversal();
        novo.nome = nomeKpi;
        novo.label = kpi.label || nomeKpi || 'KPI importado';
        novo.formula = kpi.expressao || '';
        novo.agregacao = kpi.agregacao || 'sum';
        novo.formato = kpi.formato || 'numero';
        novo.unidade = kpi.unidade || null;
        novo.categoria = kpi.categoria || 'Importado';
        novo.cor = kpi.cor || '#6366f1';
        novo.descricao = kpi.descricao || `Importado do serviço: ${servico.nome}`;
        novo.metaSugerida = kpi.meta || null;
        novo.tipoServico = tipoServico;
        novo.placeholders = placeholders.length > 0 ? placeholders : null;
        novo.isPersonalizado = true;

        importados.push(novo);
      }

      const salvos = await this.repository.save(importados);
      return res.status(201).json({ kpis: salvos, totalImportados: salvos.length });
    } catch (error: any) {
      console.error('Erro ao importar KPIs de serviço:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao importar KPIs de serviço' });
    }
  }

  /**
   * GET /api/kpis-universais/verificar-servico/:servicoId
   * Verifica se um serviço tem KPIs de origem universal
   */
  async verificarServico(req: Request, res: Response): Promise<any> {
    try {
      const servico = await this.servicoRepo.findOne({ where: { id: paramStr(req, 'servicoId') } });
      if (!servico) return res.status(404).json({ error: 'Serviço não encontrado' });

      const kpis = servico.configDashboard?.kpis || [];
      const kpisUniversal = kpis.filter((k: any) => k.origemUniversal);

      return res.json({
        totalKpis: kpis.length,
        kpisUniversal: kpisUniversal.length,
        kpis: kpisUniversal,
      });
    } catch (error) {
      console.error('Erro ao verificar serviço:', error);
      return res.status(500).json({ error: 'Erro ao verificar serviço' });
    }
  }

  /**
   * POST /api/kpis-universais/importar-todos-servicos
   * Importa KPIs de TODOS os serviços para a biblioteca universal
   * Body (opcional): { contratoId?: string } — se quiser filtrar por contrato
   */
  async importarTodosServicos(req: Request, res: Response): Promise<any> {
    try {
      const { contratoId } = req.body;

      const whereServicos: any = {};
      if (contratoId) whereServicos.contract_id = contratoId;

      const servicos = await this.servicoRepo.find({ where: whereServicos });
      const servicosComKpis = servicos.filter(s => s.configDashboard?.kpis?.length > 0);

      let totalImportados = 0;
      let totalServicosComKpis = 0;
      const resultados: any[] = [];

      for (const servico of servicosComKpis) {
        const kpisOriginais: any[] = servico.configDashboard?.kpis || [];
        const tipoServico = servico.tipo || 'geral';
        let importadosServico = 0;

        for (const kpi of kpisOriginais) {
          // Extrair placeholders da fórmula
          const placeholders: PlaceholderKpi[] = [];
          if (kpi.expressao) {
            const colRegex = /\b([A-ZÀ-Ú][A-ZÀ-Ú\s]+[A-ZÀ-Ú])\b/g;
            let match;
            while ((match = colRegex.exec(kpi.expressao)) !== null) {
              const nome = match[1].trim();
              if (nome.length > 2 && !['SUM', 'AVG', 'MIN', 'MAX', 'COUNT', 'DISTINCT', 'IF', 'ABS', 'ROUND', 'DIVIDE', 'MULTIPLY', 'FATURAMENTO_EST', 'SE', 'TRUE', 'FALSE'].includes(nome) && !/^\d+(\.\d+)?$/.test(nome)) {
                const jaExiste = placeholders.some(p => p.nome === nome);
                if (!jaExiste) {
                  placeholders.push({
                    nome,
                    label: nome,
                    colunasCandidatas: [nome],
                  });
                }
              }
            }
          }

          // Verificar se já existe KPI igual pelo nome + tipo
          const existente = await this.repository.findOne({
            where: { nome: kpi.nome || kpi.label, tipoServico },
          });
          if (existente) continue; // Pula se já existe

          const novo = new KpiUniversal();
          novo.nome = kpi.nome || kpi.label || 'KPI importado';
          novo.label = kpi.label || kpi.nome || 'KPI importado';
          novo.formula = kpi.expressao || '';
          novo.agregacao = kpi.agregacao || 'sum';
          novo.formato = kpi.formato || 'numero';
          novo.unidade = kpi.unidade || null;
          novo.categoria = kpi.categoria || 'Importado';
          novo.cor = kpi.cor || '#6366f1';
          novo.descricao = kpi.descricao || `Importado do serviço: ${servico.nome}`;
          novo.metaSugerida = kpi.meta || null;
          novo.tipoServico = tipoServico;
          novo.placeholders = placeholders.length > 0 ? placeholders : null;
          novo.isPersonalizado = true;

          await this.repository.save(novo);
          importadosServico++;
          totalImportados++;
        }

        if (importadosServico > 0) {
          totalServicosComKpis++;
          resultados.push({
            servicoId: servico.id,
            servicoNome: servico.nome,
            tipoServico,
            importados: importadosServico,
          });
        }
      }

      return res.json({
        totalImportados,
        totalServicos: servicosComKpis.length,
        servicosComKpis: totalServicosComKpis,
        resultados,
        mensagem: `${totalImportados} KPI(s) importado(s) de ${totalServicosComKpis} serviço(s)`,
      });
    } catch (error: any) {
      console.error('Erro ao importar todos os serviços:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao importar KPIs de todos os serviços' });
    }
  }

  /**
   * GET /api/kpis-universais/listar-kpis-servicos
   * Lista TODOS os KPIs de todos os serviços do sistema (para visualização)
   * Opcional: ?contratoId=xxx
   */
  async listarKpisServicos(req: Request, res: Response): Promise<any> {
    try {
      const { contratoId } = req.query;
      const whereServicos: any = {};
      if (contratoId && typeof contratoId === 'string') {
        whereServicos.contract_id = contratoId;
      }

      const servicos = await this.servicoRepo.find({
        where: whereServicos,
      });

      const kpisPorServico = servicos
        .filter(s => s.configDashboard?.kpis?.length > 0)
        .map(s => ({
          servicoId: s.id,
          servicoNome: s.nome,
          tipoServico: s.tipo || 'geral',
          kpis: (s.configDashboard?.kpis || []).map((k: any) => ({
            nome: k.nome,
            label: k.label,
            formula: k.expressao,
            agregacao: k.agregacao,
            formato: k.formato,
            unidade: k.unidade,
            categoria: k.categoria,
            cor: k.cor,
            descricao: k.descricao,
            meta: k.meta,
            ativo: k.ativo,
          })),
        }));

      const totalKpis = kpisPorServico.reduce((acc, s) => acc + s.kpis.length, 0);

      return res.json({
        servicos: kpisPorServico,
        totalServicos: kpisPorServico.length,
        totalKpis,
      });
    } catch (error: any) {
      console.error('Erro ao listar KPIs dos serviços:', error?.message || error);
      return res.status(500).json({ error: 'Erro ao listar KPIs dos serviços' });
    }
  }
}
