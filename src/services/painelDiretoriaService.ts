/**
 * Painel da diretoria. Quantidade da planilha × preço cadastrado.
 * O cálculo pesado pode ir para o worker do executivo; o processo
 * principal só espera a mensagem, e o /health continua respondendo.
 */
import AppDataSource, { isMultiTenant, getCurrentTenantDb } from '../database/data-source';
import { Contract } from '../entities/Contract';
import { Servico } from '../entities/Servico';
import { ColetaData } from '../entities/ColetaData';
import { PlanilhaUpload } from '../entities/PlanilhaUpload';
import { TipoServico } from '../enums/TipoServico';
import { buildValoresFixosFaturamento } from './configFaturamentoValores';
import PlanilhaService from './PlanilhaService';
import { aplicarFiltroViagensValidasDashboard } from './validacaoViagemService';
import { sqlDataIsoDia, sqlExprPesoEfetivoKg } from './viagensPorRotaService';
import { emCadaContrato, escopoCacheTenant } from './tenantFanout';
import {
  calcularCicloMensalContrato,
  inferirMesReferenciaAtual,
  listarDatasIntervalo,
  montarJanelasComparativoCiclo,
  metricaOficialServico,
} from '@sistemma/shared';
import {
  comporFaturamentoColeta,
  pctDaMeta,
  projetarFechamento,
  semaforoDiretoria,
  tarifaProducaoDe,
  unidadeDaMetrica,
  variacaoPercentual,
  type ComposicaoColeta,
  type LuzDiretoria,
  type ParteTipo,
} from './painelDiretoriaCalculo';
import { gravarCachePainel, invalidarCachePainel, lerCachePainelBanco } from './painelCache';
import { calcularPainelNoWorker, workerExecutivoOcupado } from './executivoPiscina';

export interface PontoCiclo {
  dia: number;
  data: string;
  valor: number;
}

export interface CardPainel {
  id: string;
  nome: string;
  cicloLabel: string;
  cicloInicio: string;
  intervalo: string;
  diasDecorridos: number;
  diasCiclo: number;
  temTarifa: boolean;
  temPlanilha: boolean;
  faturamento: number | null;
  toneladas: number | null;
  producaoTexto: string;
  variacao: number | null;
  variacaoProducao: number | null;
  pctMeta: number | null;
  metaFaturamento: number | null;
  luz: LuzDiretoria;
  serie: PontoCiclo[];
  tarifaUnica: number | null;
  tarifas: {
    geral: number | null;
    mini: number | null;
    truck: number | null;
    toco: number | null;
    basculante: number | null;
    tem: boolean;
  };
}

export interface LinhaServicoPainel {
  id: string;
  nome: string;
  quantidade: number | null;
  unidade: string;
  tarifa: number | null;
  reais: number | null;
  meta: number | null;
}

export interface VisaoFinanceira {
  card: CardPainel;
  projecao: number | null;
  rsDia: number | null;
  rsTon: number | null;
  tarifaCadastrada: number | null;
  servicos: LinhaServicoPainel[];
  tipos: Array<{ tipo: string; toneladas: number | null; tarifa: number | null; reais: number | null }>;
  custoGlosa: 'não cadastrado';
  divergencias: Array<{ campo: string; noContrato: number; noServico: number }>;
}

interface MetaCiclo {
  metaFaturamento: number | null;
  metasProducao: Record<string, number>;
}

interface Janela {
  inicio: string;
  fim: string;
  datas: string[];
  diasDecorridos: number;
  diasCiclo: number;
  label: string;
  anteriorInicio: string;
  anteriorFim: string;
}

const emVoo = new Map<string, Promise<unknown>>();

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function num(valor: unknown): number | null {
  if (valor == null || valor === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function hojeIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${dia}`;
}

function chaveLista(): string {
  return `${escopoCacheTenant()}:diretoria:${hojeIso()}`;
}

function chaveContrato(id: string, cicloInicio: string): string {
  return `${escopoCacheTenant()}:contrato:${id}:${cicloInicio}:${hojeIso()}`;
}

async function contratosDoBanco(): Promise<Contract[]> {
  const lista = await AppDataSource.getRepository(Contract).find();
  lista.sort((a, b) => String(a.numeroContrato || '').localeCompare(String(b.numeroContrato || ''), 'pt-BR'));
  return lista;
}

async function servicosDoContrato(contractId: string): Promise<Servico[]> {
  return AppDataSource.getRepository(Servico).find({
    where: { contract_id: contractId },
    order: { nome: 'ASC' },
  });
}

function janelaDoContrato(diaInicio: number): Janela {
  const dia = diaInicio || 1;
  const ref = inferirMesReferenciaAtual(dia);
  const ciclo = calcularCicloMensalContrato(ref.ano, ref.mes, dia);
  const janela = montarJanelasComparativoCiclo(ciclo);
  return {
    inicio: janela.atual.dataInicio,
    fim: janela.atual.dataFim,
    datas: listarDatasIntervalo(janela.atual.dataInicio, janela.atual.dataFim),
    diasDecorridos: janela.diasDecorridos,
    diasCiclo: janela.diasCicloCompleto,
    label: ciclo.label,
    anteriorInicio: janela.anterior.dataInicio,
    anteriorFim: janela.anterior.dataFim,
  };
}

function cicloInicioDe(diaInicio: number): string {
  const dia = diaInicio || 1;
  const ref = inferirMesReferenciaAtual(dia);
  return calcularCicloMensalContrato(ref.ano, ref.mes, dia).dataInicio;
}

async function metaDoCiclo(contratoId: string, cicloInicio: string): Promise<MetaCiclo> {
  try {
    const rows = await AppDataSource.query(
      `SELECT meta_faturamento, metas_producao
       FROM meta_ciclo
       WHERE contrato_id = $1 AND ciclo_inicio = $2`,
      [contratoId, cicloInicio],
    );
    const row = rows?.[0];
    if (!row) return { metaFaturamento: null, metasProducao: {} };
    const metas = row.metas_producao && typeof row.metas_producao === 'object'
      ? row.metas_producao as Record<string, number>
      : {};
    return { metaFaturamento: num(row.meta_faturamento), metasProducao: metas };
  } catch {
    return { metaFaturamento: null, metasProducao: {} };
  }
}

async function pesoPorTipoDia(
  servicoId: string,
  inicio: string,
  fim: string,
): Promise<Array<{ data: string; tipo: string; pesoKg: number }>> {
  if (!inicio || !fim || inicio > fim) return [];
  const uploads = await AppDataSource.getRepository(PlanilhaUpload).find({
    where: { servico_id: servicoId },
    select: ['id'],
  });
  const uploadIds = uploads.map((u) => u.id);
  if (uploadIds.length === 0) return [];
  const qb = AppDataSource.getRepository(ColetaData).createQueryBuilder('c')
    .select([
      `${sqlDataIsoDia('c')} AS data`,
      `COALESCE(NULLIF(TRIM(c."tipoCaminhao"), ''), 'Não informado') AS tipo`,
      `COALESCE(SUM(${sqlExprPesoEfetivoKg('c')}), 0) AS peso_kg`,
    ])
    .where('c.planilhaUploadId IN (:...uploadIds)', { uploadIds })
    .andWhere('c.dataSaida >= :inicio', { inicio: `${inicio}T00:00:00.000Z` })
    .andWhere('c.dataSaida <= :fim', { fim: `${fim}T23:59:59.999Z` })
    .groupBy(sqlDataIsoDia('c'))
    .addGroupBy(`COALESCE(NULLIF(TRIM(c."tipoCaminhao"), ''), 'Não informado')`);
  aplicarFiltroViagensValidasDashboard(qb, 'c');
  const rows = await qb.getRawMany();
  return rows.map((r) => ({
    data: String(r.data || '').slice(0, 10),
    tipo: String(r.tipo || 'Não informado'),
    pesoKg: Number(r.peso_kg ?? 0),
  }));
}

function serieDoCiclo(datas: string[], porDia: Map<string, number>, temTarifa: boolean): PontoCiclo[] {
  return datas.map((data, i) => ({
    dia: i + 1,
    data,
    valor: temTarifa ? round2(porDia.get(data) || 0) : 0,
  }));
}

function tarifasDe(valores: Record<string, number>) {
  const geral = num(valores.VALOR_TONELADA);
  const mini = num(valores.VALOR_MINI);
  const truck = num(valores.VALOR_TRUCK);
  const toco = num(valores.VALOR_TOCO);
  const basculante = num(valores.VALOR_BASCULANTE);
  return {
    geral, mini, truck, toco, basculante,
    tem: [geral, mini, truck, toco, basculante].some((v) => v != null),
  };
}

function tarifaUnica(partes: ParteTipo[]): number | null {
  const com = partes.filter((p) => p.tarifa != null);
  const tarifas = [...new Set(com.map((p) => p.tarifa!.toFixed(2)))];
  return tarifas.length === 1 ? com[0].tarifa : null;
}

async function quantidadeProducao(
  servico: Servico,
  inicio: string,
  fim: string,
): Promise<{ quantidade: number; unidade: string; registros: number; porDia: Map<string, number> }> {
  const dias = inicio && fim && inicio <= fim
    ? await PlanilhaService.getMetricasPorDia(servico.id, inicio, fim)
    : [];
  const total = { areaM2: 0, metroLinear: 0, kmLinear: 0, qtdArvore: 0, quantitativo: 0 };
  const porDia = new Map<string, number>();
  let registros = 0;
  for (const dia of dias) {
    registros += Number(dia.rotas) || 0;
    total.areaM2 += Number(dia.areaM2) || 0;
    total.metroLinear += Number(dia.metroLinear) || 0;
    total.kmLinear += Number(dia.kmLinear) || 0;
    total.qtdArvore += Number(dia.qtdArvore) || 0;
    total.quantitativo += Number(dia.quantitativo) || 0;
    const oficial = metricaOficialServico(servico.tipo, {
      areaM2: Number(dia.areaM2) || 0,
      metroLinear: Number(dia.metroLinear) || 0,
      kmLinear: Number(dia.kmLinear) || 0,
      qtdArvore: Number(dia.qtdArvore) || 0,
      quantitativo: Number(dia.quantitativo) || 0,
    });
    if (oficial.valor > 0) porDia.set(dia.data, (porDia.get(dia.data) || 0) + oficial.valor);
  }
  const fechado = metricaOficialServico(servico.tipo, total);
  return {
    quantidade: round2(fechado.valor),
    unidade: unidadeDaMetrica(fechado.sufixo, servico.tipo),
    registros,
    porDia,
  };
}

async function mapaLimite<T, R>(itens: T[], limite: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const saida: R[] = new Array(itens.length);
  let cursor = 0;
  async function worker() {
    while (cursor < itens.length) {
      const i = cursor;
      cursor += 1;
      saida[i] = await fn(itens[i]);
    }
  }
  if (itens.length === 0) return [];
  const n = Math.max(1, Math.min(limite, itens.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return saida;
}

function divergenciasPreco(contract: Contract, coleta?: Servico) {
  const config = (coleta?.configFaturamento || null) as Record<string, unknown> | null;
  if (!config || config.ativo !== true) return [];
  const pares: Array<[string, unknown, unknown]> = [
    ['R$/t', contract.valorTonelada, config.valorTonelada],
    ['Mini', contract.valorMini, config.valorMini],
    ['Truck', contract.valorTruck, config.valorTruck],
    ['Toco', contract.valorToco, config.valorToco],
    ['Basculante', contract.valorBasculante, config.valorBasculante],
  ];
  const saida: Array<{ campo: string; noContrato: number; noServico: number }> = [];
  for (const [campo, a, b] of pares) {
    const na = num(a);
    const nb = num(b);
    if (na != null && nb != null && na.toFixed(2) !== nb.toFixed(2)) {
      saida.push({ campo, noContrato: na, noServico: nb });
    }
  }
  return saida;
}

async function montarUm(
  contract: Contract,
  servicos: Servico[],
): Promise<{ card: CardPainel; visao: VisaoFinanceira }> {
  const dia = Number(contract.diaInicioCiclo) || 1;
  const janela = janelaDoContrato(dia);
  const cicloInicio = cicloInicioDe(dia);
  const meta = await metaDoCiclo(contract.id, cicloInicio);
  const coleta = servicos.find((s) => s.tipo === TipoServico.COLETA_CAMINHAO);
  const valores = buildValoresFixosFaturamento(contract, coleta?.configFaturamento);
  const tarifas = tarifasDe(valores);

  let coletaAtual: ComposicaoColeta = {
    toneladas: 0, faturamento: null, porTipo: [], porDia: [], temPreco: false, temSemPreco: false,
  };
  let coletaAnterior: ComposicaoColeta = coletaAtual;
  let temPlanilhaColeta = false;
  if (coleta && janela.diasDecorridos > 0) {
    const [atual, anterior] = await Promise.all([
      pesoPorTipoDia(coleta.id, janela.inicio, janela.fim),
      pesoPorTipoDia(coleta.id, janela.anteriorInicio, janela.anteriorFim),
    ]);
    temPlanilhaColeta = atual.length > 0;
    coletaAtual = comporFaturamentoColeta(atual, valores);
    coletaAnterior = comporFaturamentoColeta(anterior, valores);
  }

  const producao = servicos.filter((s) => s.tipo !== TipoServico.COLETA_CAMINHAO);
  const linhasProd = await mapaLimite(producao, 4, async (servico) => {
    if (janela.diasDecorridos <= 0) return null;
    const [atual, anterior] = await Promise.all([
      quantidadeProducao(servico, janela.inicio, janela.fim),
      quantidadeProducao(servico, janela.anteriorInicio, janela.anteriorFim),
    ]);
    if (!(atual.quantidade > 0) && atual.registros === 0) return null;
    const config = (servico.configFaturamento || null) as Record<string, unknown> | null;
    const tarifa = tarifaProducaoDe(servico.tipo, servico.nome, config);
    const reais = tarifa != null && atual.quantidade > 0 ? round2(atual.quantidade * tarifa) : null;
    const reaisAnt = tarifa != null && anterior.quantidade > 0 ? round2(anterior.quantidade * tarifa) : null;
    return {
      id: servico.id,
      nome: servico.nome,
      quantidade: atual.quantidade > 0 ? atual.quantidade : null,
      unidade: atual.unidade,
      tarifa,
      reais,
      meta: num(meta.metasProducao[servico.id]),
      reaisAnt,
      quantidadeAnt: anterior.quantidade,
      porDia: atual.porDia,
    };
  });
  const servicosLinha = linhasProd.filter((l): l is NonNullable<typeof l> => l != null);
  const reaisProducao = servicosLinha.reduce((s, l) => s + (l.reais || 0), 0);
  const reaisProducaoAnt = servicosLinha.reduce((s, l) => s + (l.reaisAnt || 0), 0);
  const temTarifa = tarifas.tem || servicosLinha.some((l) => l.tarifa != null);
  const temPlanilha = temPlanilhaColeta || servicosLinha.some((l) => (l.quantidade || 0) > 0);
  const fatColeta = coletaAtual.faturamento;
  const faturamento = temTarifa && temPlanilha
    ? round2((fatColeta || 0) + reaisProducao)
    : null;
  const faturamentoAnt = (coletaAnterior.faturamento || 0) + reaisProducaoAnt;
  const toneladas = temPlanilhaColeta ? coletaAtual.toneladas : null;
  const variacao = temTarifa && faturamento != null
    ? variacaoPercentual(faturamento, faturamentoAnt)
    : variacaoPercentual(coletaAtual.toneladas, coletaAnterior.toneladas);
  const variacaoProducao = temPlanilhaColeta
    ? variacaoPercentual(coletaAtual.toneladas, coletaAnterior.toneladas)
    : variacaoPercentual(
      servicosLinha.reduce((s, l) => s + (l.quantidade || 0), 0),
      servicosLinha.reduce((s, l) => s + l.quantidadeAnt, 0),
    );
  const pct = pctDaMeta(faturamento, meta.metaFaturamento);
  const porDia = new Map<string, number>();
  if (temTarifa) {
    for (const p of coletaAtual.porDia) porDia.set(p.data, (porDia.get(p.data) || 0) + p.reais);
    for (const linha of servicosLinha) {
      if (linha.tarifa == null) continue;
      for (const [data, qtd] of linha.porDia) {
        porDia.set(data, (porDia.get(data) || 0) + qtd * linha.tarifa);
      }
    }
  }
  const producaoTexto = toneladas != null
    ? `${toneladas.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} t`
    : (() => {
      const primeira = servicosLinha.find((l) => (l.quantidade || 0) > 0);
      return primeira?.quantidade != null
        ? `${primeira.quantidade.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ${primeira.unidade}`
        : '—';
    })();

  const card: CardPainel = {
    id: contract.id,
    nome: contract.numeroContrato || 'Contrato',
    cicloLabel: janela.label,
    cicloInicio,
    intervalo: `${janela.inicio}–${fimCiclo(dia)}`,
    diasDecorridos: janela.diasDecorridos,
    diasCiclo: janela.diasCiclo,
    temTarifa,
    temPlanilha,
    faturamento: temTarifa ? faturamento : null,
    toneladas,
    producaoTexto: temPlanilha ? producaoTexto : '—',
    variacao,
    variacaoProducao: temPlanilha ? variacaoProducao : null,
    pctMeta: pct,
    metaFaturamento: meta.metaFaturamento,
    luz: semaforoDiretoria({ temTarifa, temPlanilha, variacao, pctMeta: pct }),
    serie: serieDoCiclo(janela.datas, porDia, temTarifa),
    tarifaUnica: tarifaUnica(coletaAtual.porTipo),
    tarifas,
  };

  const visao: VisaoFinanceira = {
    card,
    projecao: faturamento != null
      ? projetarFechamento(faturamento, janela.diasDecorridos, janela.diasCiclo)
      : null,
    rsDia: faturamento != null && janela.diasDecorridos > 0
      ? round2(faturamento / janela.diasDecorridos)
      : null,
    rsTon: fatColeta != null && coletaAtual.toneladas > 0
      ? round2(fatColeta / coletaAtual.toneladas)
      : null,
    tarifaCadastrada: tarifaUnica(coletaAtual.porTipo),
    servicos: [
      ...(coleta && coletaAtual.toneladas > 0
        ? [{
          id: coleta.id,
          nome: coleta.nome,
          quantidade: coletaAtual.toneladas,
          unidade: 't',
          tarifa: card.tarifaUnica,
          reais: fatColeta,
          meta: num(meta.metasProducao[coleta.id]),
        }]
        : []),
      ...servicosLinha.map((l) => ({
        id: l.id,
        nome: l.nome,
        quantidade: l.quantidade,
        unidade: l.unidade,
        tarifa: l.tarifa,
        reais: l.reais,
        meta: l.meta,
      })),
    ],
    tipos: coletaAtual.porTipo
      .filter((p) => p.toneladas > 0)
      .map((p) => ({ tipo: p.tipo, toneladas: p.toneladas, tarifa: p.tarifa, reais: p.reais })),
    custoGlosa: 'não cadastrado',
    divergencias: divergenciasPreco(contract, coleta),
  };
  return { card, visao };
}

function fimCiclo(diaInicio: number): string {
  const dia = diaInicio || 1;
  const ref = inferirMesReferenciaAtual(dia);
  return calcularCicloMensalContrato(ref.ano, ref.mes, dia).dataFim;
}

function cardVazio(contract: Contract, janela: Janela): CardPainel {
  return {
    id: contract.id,
    nome: contract.numeroContrato || 'Contrato',
    cicloLabel: janela.label,
    cicloInicio: janela.inicio,
    intervalo: `${janela.inicio}–${janela.fim}`,
    diasDecorridos: janela.diasDecorridos,
    diasCiclo: janela.diasCiclo,
    temTarifa: false,
    temPlanilha: false,
    faturamento: null,
    toneladas: null,
    producaoTexto: '—',
    variacao: null,
    variacaoProducao: null,
    pctMeta: null,
    metaFaturamento: null,
    luz: 'vermelho',
    serie: janela.datas.map((data, i) => ({ dia: i + 1, data, valor: 0 })),
    tarifaUnica: null,
    tarifas: { geral: null, mini: null, truck: null, toco: null, basculante: null, tem: false },
  };
}

async function montarDiretoriaNoBanco(): Promise<{ geradoEm: string; cards: CardPainel[] }> {
  const contratos = await contratosDoBanco();
  const cards = await mapaLimite(contratos, 4, async (contract) => {
    try {
      const servicos = await servicosDoContrato(contract.id);
      const { card } = await montarUm(contract, servicos);
      return card;
    } catch (err) {
      console.error('[painel]', contract.numeroContrato, (err as Error)?.message || err);
      return cardVazio(contract, janelaDoContrato(Number(contract.diaInicioCiclo) || 1));
    }
  });
  return { geradoEm: new Date().toISOString(), cards };
}

/** Cálculo em si. O worker chama isto; a rota espera o resultado. */
export async function calcularPainelDireto(contratoId?: string): Promise<unknown> {
  if (contratoId) return calcularContratoDireto(contratoId);
  if (isMultiTenant() && !getCurrentTenantDb()) {
    const partes = await emCadaContrato(async () => montarDiretoriaNoBanco());
    const cards = partes.flatMap((p) => p.cards);
    cards.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    return { geradoEm: new Date().toISOString(), cards };
  }
  return montarDiretoriaNoBanco();
}

export async function calcularContratoDireto(contratoId: string): Promise<VisaoFinanceira | null> {
  if (isMultiTenant() && !getCurrentTenantDb()) {
    const partes = await emCadaContrato(async () => {
      const contract = await AppDataSource.getRepository(Contract).findOne({ where: { id: contratoId } });
      if (!contract) return null;
      const servicos = await servicosDoContrato(contract.id);
      const montado = await montarUm(contract, servicos);
      return montado.visao;
    });
    return partes.find((p) => p != null) ?? null;
  }
  const contract = await AppDataSource.getRepository(Contract).findOne({ where: { id: contratoId } });
  if (!contract) return null;
  const servicos = await servicosDoContrato(contract.id);
  const { visao } = await montarUm(contract, servicos);
  return visao;
}

async function comCache<T>(chave: string, direto: () => Promise<T>, contratoId?: string): Promise<T> {
  const cache = await lerCachePainelBanco<T>(chave);
  if (cache) return cache;
  const pendente = emVoo.get(chave) as Promise<T> | undefined;
  if (pendente) return pendente;
  const promessa = (async () => {
    if (workerExecutivoOcupado()) return direto();
    try {
      return await calcularPainelNoWorker(contratoId) as T;
    } catch (err) {
      console.warn('[painel] worker indisponível, cálculo no processo:', (err as Error)?.message || err);
      return direto();
    }
  })();
  emVoo.set(chave, promessa);
  try {
    const payload = await promessa;
    gravarCachePainel(chave, payload);
    return payload;
  } finally {
    emVoo.delete(chave);
  }
}

export async function obterPainelDiretoria(): Promise<{ geradoEm: string; cards: CardPainel[] }> {
  return comCache(chaveLista(), () => calcularPainelDireto() as Promise<{ geradoEm: string; cards: CardPainel[] }>);
}

export async function obterPainelContrato(contratoId: string): Promise<VisaoFinanceira | null> {
  let inicio = 'ciclo';
  if (!(isMultiTenant() && !getCurrentTenantDb())) {
    const contract = await AppDataSource.getRepository(Contract).findOne({ where: { id: contratoId } });
    if (!contract) return null;
    inicio = cicloInicioDe(Number(contract.diaInicioCiclo) || 1);
  }
  return comCache(
    chaveContrato(contratoId, inicio),
    () => calcularContratoDireto(contratoId),
    contratoId,
  );
}

export { invalidarCachePainel };
