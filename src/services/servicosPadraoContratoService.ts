/**
 * Garante serviços padrão do contrato (coleta + pacote unificado + demais tipos).
 * Consolida duplicatas vazias do mesmo tipo.
 */
import AppDataSource from '../database/data-source';
import { Servico } from '../entities/Servico';
import { Contract } from '../entities/Contract';
import { PlanilhaUpload } from '../entities/PlanilhaUpload';
import { TipoServico, TIPOS_SERVICO_META } from '../enums/TipoServico';
import { converterKpisParaConfig } from './TipoServicoTemplateService';
import { gerarConfigGraficosPadrao } from './graficosPadrao';
import { buildConfigDashboardPadraoColeta } from '../config/dashboardPadraoColeta';
import { invalidarCacheSaudeContratos } from '../controllers/ContractController';
import PlanilhaService from './PlanilhaService';

/** Tipos do upload CONSOLIDADO legado (TIPO DE SERVIÇO) — sem coleta. */
export const TIPOS_SERVICO_PADRAO_UNIFICADO: TipoServico[] = [
  TipoServico.ROCADEIRA,
  TipoServico.CAPINA,
  TipoServico.VARRICAO,
  TipoServico.PODA,
];

/** Tipos do split da aba CONSOLIDADO (Power Query), incluindo remoção. */
export const TIPOS_SERVICO_PADRAO_CONSOLIDADO: TipoServico[] = [
  TipoServico.ROCADEIRA,
  TipoServico.CAPINA,
  TipoServico.VARRICAO,
  TipoServico.PODA,
  TipoServico.REMOCAO,
];

/** Serviços auto-criados ao abrir/criar contrato (todos os tipos, exceto genérico). */
export const TIPOS_SERVICO_PADRAO_CONTRATO: TipoServico[] = [
  TipoServico.COLETA_CAMINHAO,
  TipoServico.ROCADEIRA,
  TipoServico.CAPINA,
  TipoServico.VARRICAO,
  TipoServico.PODA,
  TipoServico.PINTURA_MEIO_FIO,
  TipoServico.REMOCAO,
];

const NOMES_PADRAO: Record<string, string> = {
  [TipoServico.COLETA_CAMINHAO]: 'Coleta',
  [TipoServico.ROCADEIRA]: 'Roçada',
  [TipoServico.CAPINA]: 'Capina',
  [TipoServico.VARRICAO]: 'Varrição',
  [TipoServico.PODA]: 'Poda',
  [TipoServico.PINTURA_MEIO_FIO]: 'Pintura',
  [TipoServico.REMOCAO]: 'Remoção',
};

function nomePadraoTipo(tipo: string): string {
  if (NOMES_PADRAO[tipo]) return NOMES_PADRAO[tipo];
  const label = TIPOS_SERVICO_META[tipo]?.label || tipo;
  return label.replace(/^[^\p{L}0-9]+/u, '').trim() || tipo;
}

function montarConfigDashboard(tipo: string) {
  if (tipo === TipoServico.COLETA_CAMINHAO) {
    return buildConfigDashboardPadraoColeta();
  }
  const kpisTemplate = converterKpisParaConfig(tipo);
  const graficosPadrao = gerarConfigGraficosPadrao(tipo, []);
  return {
    kpis: kpisTemplate,
    graficos: graficosPadrao,
    kpisTemplateAplicados: kpisTemplate.length > 0,
    kpisTemplateTotal: kpisTemplate.length,
    kpisTemplateTipo: tipo,
    kpisTemplateAplicadosEm: new Date().toISOString(),
    graficosPadraoAplicados: true,
    graficosPadraoTotal: graficosPadrao.length,
    graficosPadraoTipo: tipo,
    graficosPadraoAplicadosEm: new Date().toISOString(),
  };
}

function montarConfigFaturamentoPadrao(tipo: string, contract?: Contract) {
  if (tipo === TipoServico.COLETA_CAMINHAO) {
    return {
      ativo: true,
      tipoCobranca: 'tonelada_tipo_caminhao',
      valorMini: contract?.valorMini ?? null,
      valorTruck: contract?.valorTruck ?? null,
      valorToco: contract?.valorToco ?? null,
      valorBasculante: contract?.valorBasculante ?? null,
    };
  }
  if (tipo === TipoServico.REMOCAO) {
    return { ativo: true, tipoCobranca: 'por_equipe', valorPorEquipe: null };
  }
  if (tipo === TipoServico.ROCADEIRA) {
    return {
      ativo: true,
      tipoCobranca: 'm2',
      valorM2: null,
      valorM2Manual: null,
      valorM2Mecanizada: null,
    };
  }
  if (tipo === TipoServico.PODA) {
    return { ativo: true, tipoCobranca: 'por_arvore', valorPorArvore: null };
  }
  return {
    ativo: true,
    tipoCobranca: 'km_linear',
    valorKmLinear: null,
  };
}

/**
 * Para cada tipo padrão, mantém 1 serviço (com mais dados / nome canônico)
 * e remove duplicatas sem planilha.
 */
async function consolidarDuplicatasPorTipo(
  contractId: string,
  existentes: Servico[],
): Promise<Array<{ id: string; nome: string; tipo: string }>> {
  const servicoRepo = AppDataSource.getRepository(Servico);
  const uploadRepo = AppDataSource.getRepository(PlanilhaUpload);
  const removidos: Array<{ id: string; nome: string; tipo: string }> = [];

  for (const tipo of TIPOS_SERVICO_PADRAO_CONTRATO) {
    const mesmos = existentes.filter((s) => String(s.tipo) === tipo);
    if (mesmos.length <= 1) continue;

    const scored = await Promise.all(
      mesmos.map(async (s) => {
        const uploads = await uploadRepo.count({ where: { servico_id: s.id } });
        const nomeCanonico = String(s.nome || '').trim().toLowerCase() === NOMES_PADRAO[tipo].toLowerCase() ? 1 : 0;
        const criado = s.criadoEm ? new Date(s.criadoEm).getTime() : 0;
        return { s, uploads, nomeCanonico, criado };
      }),
    );

    scored.sort((a, b) => {
      if (b.uploads !== a.uploads) return b.uploads - a.uploads;
      if (b.nomeCanonico !== a.nomeCanonico) return b.nomeCanonico - a.nomeCanonico;
      return a.criado - b.criado;
    });

    const keeper = scored[0].s;
    const nomeKeeper = String(keeper.nome || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    const especial = /manual|mecaniz/.test(nomeKeeper);
    if (!especial && keeper.nome !== NOMES_PADRAO[tipo]) {
      keeper.nome = NOMES_PADRAO[tipo];
      await servicoRepo.save(keeper);
    }

    for (const extra of scored.slice(1)) {
      const nomeExtra = String(extra.s.nome || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
      if (/manual|mecaniz/.test(nomeExtra)) continue;
      // Só remove se estiver vazio — evita apagar dados históricos
      if (extra.uploads > 0) continue;
      try {
        await PlanilhaService.excluirTodosDadosDoServico(extra.s.id);
        await servicoRepo.remove(extra.s);
        removidos.push({ id: extra.s.id, nome: extra.s.nome, tipo });
      } catch (err) {
        console.warn(`[garantirServicos] Falha ao remover duplicata ${extra.s.id}:`, err);
      }
    }
  }

  if (removidos.length > 0) {
    invalidarCacheSaudeContratos(contractId);
  }

  return removidos;
}

export async function garantirServicosPadraoContrato(contractId: string): Promise<{
  servicos: Servico[];
  criados: Array<{ id: string; nome: string; tipo: string }>;
  jaExistiam: Array<{ id: string; nome: string; tipo: string }>;
  duplicatasRemovidas: Array<{ id: string; nome: string; tipo: string }>;
}> {
  const contractRepo = AppDataSource.getRepository(Contract);
  const servicoRepo = AppDataSource.getRepository(Servico);

  const contract = await contractRepo.findOne({ where: { id: contractId } });
  if (!contract) {
    throw new Error('Contrato não encontrado');
  }

  let existentes = await servicoRepo.find({ where: { contract_id: contractId } });
  const duplicatasRemovidas = await consolidarDuplicatasPorTipo(contractId, existentes);
  if (duplicatasRemovidas.length > 0) {
    existentes = await servicoRepo.find({ where: { contract_id: contractId } });
  }

  const porTipo = new Map<string, Servico>();
  for (const s of existentes) {
    const t = String(s.tipo || '');
    if (!porTipo.has(t)) porTipo.set(t, s);
  }

  const criados: Array<{ id: string; nome: string; tipo: string }> = [];
  const jaExistiam: Array<{ id: string; nome: string; tipo: string }> = [];

  for (const tipo of TIPOS_SERVICO_PADRAO_CONTRATO) {
    const atual = porTipo.get(tipo);
    if (atual) {
      jaExistiam.push({ id: atual.id, nome: atual.nome, tipo });
      continue;
    }

    const servico = new Servico();
    servico.contract_id = contractId;
    servico.nome = nomePadraoTipo(tipo);
    servico.tipo = tipo;
    servico.descricao = TIPOS_SERVICO_META[tipo]?.descricao || null;
    servico.configDashboard = montarConfigDashboard(tipo);
    servico.configFaturamento = montarConfigFaturamentoPadrao(tipo, contract);
    servico.padraoPlanilha = null;

    const salvo = await servicoRepo.save(servico);
    porTipo.set(tipo, salvo);
    criados.push({ id: salvo.id, nome: salvo.nome, tipo });
  }

  if (criados.length > 0) {
    invalidarCacheSaudeContratos(contractId);
  }

  const servicos = await servicoRepo.find({
    where: { contract_id: contractId },
    order: { criadoEm: 'ASC' },
  });

  return { servicos, criados, jaExistiam, duplicatasRemovidas };
}

/** Resolve o serviço canônico de um tipo no contrato (cria se faltar). */
export async function obterServicoPorTipoContrato(
  contractId: string,
  tipo: TipoServico | string,
): Promise<Servico> {
  await garantirServicosPadraoContrato(contractId);
  const servicoRepo = AppDataSource.getRepository(Servico);
  const lista = await servicoRepo.find({
    where: { contract_id: contractId, tipo: String(tipo) },
    order: { criadoEm: 'ASC' },
    take: 1,
  });
  if (!lista[0]) {
    throw new Error(`Serviço do tipo ${tipo} não encontrado no contrato`);
  }
  return lista[0];
}

function normNomeServico(nome: string): string {
  return String(nome || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function execucaoDoNome(nome: string): 'manual' | 'mecanizada' | null {
  const n = normNomeServico(nome);
  if (n.includes('MANUAL')) return 'manual';
  if (n.includes('MECANIZ') || n.includes(' MEC')) return 'mecanizada';
  return null;
}

/** Cria ou reutiliza um serviço com o nome da aba (Varrição Manual ≠ Varrição Mecanizada). */
export async function garantirServicoNomeadoContrato(
  contractId: string,
  nome: string,
  tipo: TipoServico | string,
): Promise<{ servico: Servico; criado: boolean }> {
  const servicoRepo = AppDataSource.getRepository(Servico);
  const contractRepo = AppDataSource.getRepository(Contract);
  const contract = await contractRepo.findOne({ where: { id: contractId } });
  if (!contract) throw new Error('Contrato não encontrado');

  const existentes = await servicoRepo.find({ where: { contract_id: contractId } });
  const alvo = normNomeServico(nome);
  const execAlvo = execucaoDoNome(nome);

  const porNome = existentes.find((s) => normNomeServico(s.nome) === alvo);
  if (porNome) return { servico: porNome, criado: false };

  const mesmoTipo = existentes.filter((s) => String(s.tipo) === String(tipo));
  if (execAlvo) {
    const porExec = mesmoTipo.find((s) => execucaoDoNome(s.nome) === execAlvo);
    if (porExec) return { servico: porExec, criado: false };
  } else if (mesmoTipo.length === 1 && !execucaoDoNome(mesmoTipo[0].nome)) {
    if (mesmoTipo[0].nome !== nome) {
      mesmoTipo[0].nome = nome;
      await servicoRepo.save(mesmoTipo[0]);
    }
    return { servico: mesmoTipo[0], criado: false };
  }

  const servico = new Servico();
  servico.contract_id = contractId;
  servico.nome = nome;
  servico.tipo = String(tipo);
  servico.descricao = TIPOS_SERVICO_META[String(tipo)]?.descricao || null;
  servico.configDashboard = montarConfigDashboard(String(tipo));
  servico.configFaturamento = montarConfigFaturamentoPadrao(String(tipo), contract);
  servico.padraoPlanilha = null;
  const salvo = await servicoRepo.save(servico);
  invalidarCacheSaudeContratos(contractId);
  return { servico: salvo, criado: true };
}
