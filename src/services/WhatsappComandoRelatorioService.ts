/**
 * Comandos de texto no WhatsApp (grupos mapeados).
 * "relatorio" → varre os serviços do contrato e envia o PDF do tipo certo.
 */
import AppDataSource from '../database/data-source';
import { WhatsappGrupoMapa } from '../entities/WhatsappGrupoMapa';
import { Servico } from '../entities/Servico';
import { Contract } from '../entities/Contract';
import { TipoServico, TIPOS_SERVICO_META } from '../enums/TipoServico';
import {
  calcularCicloMensalContrato,
  deslocarMesReferencia,
  inferirMesReferenciaAtual,
  inferirMesReferenciaDeData,
  normalizarDiaInicioCiclo,
  recortarPeriodoAteReferencia,
} from '../utils/periodoCicloContrato';
import PlanilhaService from './PlanilhaService';
import {
  TEXTO_EVOLUCAO_SO_COLETA,
  TEXTO_LISTA_INVALIDA,
  interpretarPedidoRelatorio,
  legendaRelatorioPdf,
  resolverEscolhasLista,
  rotuloCurtoServico,
  textoMenuRelatorio,
  textoMenuServicos,
  type FormatoRelatorioCurto,
  type PedidoRelatorioCurto,
} from './WhatsappComandoRelatorioTexto';
import { htmlToPdf } from './PdfGeneratorService';
import wuzapiService from './WuzapiService';
import {
  gerarHtmlComparativoContratosWhatsapp,
  gerarHtmlEvolucaoDiariaWhatsapp,
  type BlocoEvolucaoPdf,
} from './WhatsappRelatorioHtml';
import {
  analisarPesoColeta,
  normalizarDensidadeResiduoKgL,
} from './analisePesoColetaService';
import { resolverLimitesDoContrato } from '../config/pesoMaximoCaminhao';
import { normalizarDados } from './FormulaEngine';
import {
  agregarQualidadeIdeal3d,
  type FaixaDominante3d,
} from './qualidadeIdeal3dService';

import {
  textoPedeCicloAnterior,
  ehPedidoSaude,
  type QualCiclo,
} from './WhatsappComandoRelatorioTexto';
import { montarHtmlRelatorioDiaPorServico } from './relatorioDia/montarHtmlRelatorioDiaPorServico';
import { montarHtmlRelatorioCicloPorServico } from './relatorioDia/montarHtmlRelatorioCicloPorServico';
import FileStorageService from './FileStorageService';
import { analisarViagensPlanilha } from './analisarViagensPlanilhaService';
import { gerarHtmlSaudeDadosServer } from './PdfSaudeDadosHtml';
import { extrairCadastroOperacional } from '../utils/configOperacional';
import { escolherUploadParaBackup } from './planilhaOriginalStorage';

type EtapaSessao = 'menu_relatorio' | 'menu_servicos';

interface ItemMenuServico {
  id: string;
  nome: string;
  tipo: string;
  tipoLabel: string;
  ultimoDia: string;
}

interface SessaoChat {
  etapa: EtapaSessao;
  expiresAt: number;
  servicoId: string;
  contratoId: string;
  formato?: FormatoRelatorioCurto | null;
  qualCiclo?: QualCiclo;
  tipoServico?: string | null;
  servicosMenu?: ItemMenuServico[];
  dataIso?: string | null;
}

const sessoes = new Map<string, SessaoChat>();
const TTL_MS = 10 * 60 * 1000;
const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'] as const;
const FAIXAS_IDS: FaixaDominante3d[] = ['otimo', 'ruim', 'pessimo', 'excedido'];

type JanelaEvolucao = { dias: number; label: string; cicloAnterior?: boolean };

const JANELAS_EVOLUCAO: JanelaEvolucao[] = [
  { dias: 7, label: 'Última semana' },
  { dias: 15, label: 'Últimos 15 dias' },
  { dias: 0, label: 'Por ciclo (completo)' },
];

function limparSessoes(): void {
  const agora = Date.now();
  for (const [k, v] of sessoes) {
    if (v.expiresAt < agora) sessoes.delete(k);
  }
}

/** Menu em andamento: a resposta seguinte ("1", nome do serviço) precisa entrar na fila. */
export function sessaoComandoAtiva(grupoJid: string): boolean {
  limparSessoes();
  return sessoes.has(grupoJid);
}

export function contratoDaSessaoComando(grupoJid: string): string | null {
  limparSessoes();
  return sessoes.get(grupoJid)?.contratoId || null;
}

function normalizarTexto(raw: string): string {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** Extrai texto de conversation / extendedText / caption do payload WuzAPI. */
export function extrairTextoMensagem(payload: {
  event?: { Message?: Record<string, any> };
}): string {
  const msg = payload.event?.Message || {};
  const candidatos = [
    msg.conversation,
    msg.Conversation,
    msg.extendedTextMessage?.text,
    msg.ExtendedTextMessage?.Text,
    msg.ExtendedTextMessage?.text,
    msg.imageMessage?.caption,
    msg.ImageMessage?.Caption,
    msg.documentMessage?.caption,
    msg.DocumentMessage?.Caption,
  ];
  for (const c of candidatos) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return '';
}

function resolverJanelaEvolucao(norm: string): JanelaEvolucao | null {
  if (norm === '4' || textoPedeCicloAnterior(norm)) {
    return { dias: 0, label: 'Ciclo anterior (completo)', cicloAnterior: true };
  }
  if (norm === '1' || norm.includes('semana')) return JANELAS_EVOLUCAO[0];
  if (norm === '2' || norm.includes('15')) return JANELAS_EVOLUCAO[1];
  if (
    norm === '3'
    || norm.includes('ciclo')
    || norm === 'completo'
    || norm.includes('por ciclo')
  ) {
    return JANELAS_EVOLUCAO[2];
  }
  return null;
}

/** Atalho e opção 3 do menu: o PDF do ciclo completo, no gráfico de linhas. */
export function janelaEvolucaoDoChatbot(texto: string): { dias: number; label: string; cicloCompleto: boolean } {
  const norm = normalizarTexto(texto);
  if (
    norm === '3'
    || norm === 'evolucao ciclo'
    || norm === 'evolucao por ciclo'
    || norm === 'por ciclo'
    || norm === 'completo'
  ) {
    return { dias: JANELAS_EVOLUCAO[2].dias, label: JANELAS_EVOLUCAO[2].label, cicloCompleto: true };
  }
  const janela = resolverJanelaEvolucao(norm) || JANELAS_EVOLUCAO[0];
  return {
    dias: janela.dias,
    label: janela.label,
    cicloCompleto: janela.dias === 0 && !janela.cicloAnterior,
  };
}

function fmtEixoDia(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const semana = DIAS_SEMANA[new Date(y, m - 1, d, 12).getDay()] || '';
  const dd = String(d).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  return semana ? `${semana} ${dd}/${mm}` : `${dd}/${mm}`;
}

function zeradoFaixas(): Record<FaixaDominante3d, number> {
  return { otimo: 0, ruim: 0, pessimo: 0, excedido: 0 };
}

async function resolverMapaGrupo(grupoJid: string): Promise<{
  mapa: WhatsappGrupoMapa;
  servico: Servico;
  contrato: Contract | null;
} | null> {
  const mapaRepo = AppDataSource.getRepository(WhatsappGrupoMapa);
  const mapa = await mapaRepo.findOne({
    where: { grupoJid, ativo: true },
    relations: ['servico', 'servico.contract'],
  });
  if (!mapa) return null;

  const servico = mapa.servico
    || await AppDataSource.getRepository(Servico).findOne({
      where: { id: mapa.servicoId },
      relations: ['contract'],
    });
  if (!servico) return null;

  const contrato = (servico as any).contract
    || await AppDataSource.getRepository(Contract).findOne({ where: { id: servico.contract_id } });

  return { mapa, servico, contrato: contrato || null };
}

async function periodoCicloDisponivel(
  servico: Servico,
  contrato: Contract | null,
  qual: QualCiclo = 'atual',
): Promise<{
  dataInicio: string;
  dataFim: string;
  label: string;
  mes: number;
  ano: number;
}> {
  const dia = normalizarDiaInicioCiclo(contrato?.diaInicioCiclo);
  const irmaos = await listarServicosDoContrato(servico, contrato);
  let dataFimMaisRecente: string | null = null;
  for (const s of irmaos) {
    const periodoDados = await PlanilhaService.getPeriodoDadosPorServico(s.id);
    if (periodoDados?.dataFim && (!dataFimMaisRecente || periodoDados.dataFim > dataFimMaisRecente)) {
      dataFimMaisRecente = periodoDados.dataFim;
    }
  }
  const { mes, ano } = dataFimMaisRecente
    ? inferirMesReferenciaDeData(dataFimMaisRecente, dia)
    : inferirMesReferenciaAtual(dia);
  const ref = qual === 'anterior' ? deslocarMesReferencia(mes, ano, -1) : { mes, ano };
  const ciclo = calcularCicloMensalContrato(ref.ano, ref.mes, dia);

  if (qual === 'anterior') {
    return {
      dataInicio: ciclo.dataInicio,
      dataFim: ciclo.dataFim,
      label: `Ciclo anterior — ${ciclo.label}`,
      mes: ref.mes,
      ano: ref.ano,
    };
  }

  const recorte = recortarPeriodoAteReferencia(ciclo.dataInicio, ciclo.dataFim);
  return {
    dataInicio: recorte.dataInicio,
    dataFim: recorte.dataFim,
    label: recorte.emAndamento
      ? `${ciclo.label} — ${recorte.diasDecorridos} dia${recorte.diasDecorridos === 1 ? '' : 's'} decorrido${recorte.diasDecorridos === 1 ? '' : 's'}`
      : ciclo.label,
    mes,
    ano,
  };
}

/** Serviços do mesmo tipo no *mesmo contrato* do grupo mapeado (nunca outros contratos). */
async function listarServicosDoContratoMesmoTipo(servicoBase: Servico): Promise<Servico[]> {
  const contractId = servicoBase.contract_id;
  if (!contractId) return [servicoBase];
  const tipo = String(servicoBase.tipo || TipoServico.COLETA_CAMINHAO);
  const lista = await AppDataSource.getRepository(Servico).find({
    where: { contract_id: contractId, tipo: tipo as any },
    relations: ['contract'],
    order: { nome: 'ASC' },
  });
  if (!lista.length) return [servicoBase];
  if (!lista.some((s) => s.id === servicoBase.id)) {
    lista.unshift(servicoBase);
  }
  return lista;
}

async function listarServicosDoContrato(servicoBase: Servico, contrato: Contract | null): Promise<Servico[]> {
  const contractId = contrato?.id || servicoBase.contract_id;
  if (!contractId) return [servicoBase];
  const lista = await AppDataSource.getRepository(Servico).find({
    where: { contract_id: contractId },
    relations: ['contract'],
    order: { nome: 'ASC' },
  });
  if (!lista.length) return [servicoBase];
  return lista;
}

function labelTipoServico(tipo: string, nome?: string): string {
  return TIPOS_SERVICO_META[tipo]?.label || nome || tipo || 'Serviço';
}

function diaTemOperacao(d?: {
  rotas: number;
  viagens: number;
  pesoTotalKg: number;
  areaM2: number;
  metroLinear: number;
  kmLinear: number;
  qtdArvore: number;
  quantitativo: number;
} | null): boolean {
  if (!d) return false;
  return (
    d.rotas > 0
    || d.viagens > 0
    || d.pesoTotalKg > 0
    || d.areaM2 > 0
    || d.metroLinear > 0
    || d.kmLinear > 0
    || d.qtdArvore > 0
    || d.quantitativo > 0
  );
}

function servicoBateTipoFiltro(servico: Servico, tipoFiltro?: string | null): boolean {
  if (!tipoFiltro) return true;
  const tipo = String(servico.tipo || '');
  if (tipo === tipoFiltro) return true;
  const nome = normalizarTexto(servico.nome || '');
  if (tipoFiltro === 'rocadeira' && nome.includes('rocad')) return true;
  if (tipoFiltro === 'varricao' && (nome.includes('varr') || nome.includes('varred'))) return true;
  if (tipoFiltro === 'capina' && nome.includes('capina')) return true;
  if (tipoFiltro === 'poda' && nome.includes('poda')) return true;
  if (tipoFiltro === 'remocao' && (nome.includes('remo') || nome.includes('entulho'))) return true;
  if (tipoFiltro === 'coleta_caminhao' && nome.includes('coleta')) return true;
  if (tipoFiltro === 'pintura_meio_fio' && nome.includes('pintura')) return true;
  if (tipoFiltro === 'geral' && (nome.includes('feira') || tipo === 'geral')) return true;
  return false;
}

interface ServicoVarrido {
  servico: Servico;
  tipo: string;
  tipoLabel: string;
  dataIso: string;
}

async function varrerServicosComDados(
  servicoBase: Servico,
  contrato: Contract | null,
  opts?: { dataIso?: string | null; tipoFiltro?: string | null },
): Promise<{ comDados: ServicoVarrido[]; semDados: Array<{ nome: string; tipoLabel: string }> }> {
  const lista = (await listarServicosDoContrato(servicoBase, contrato))
    .filter((s) => servicoBateTipoFiltro(s, opts?.tipoFiltro));
  const comDados: ServicoVarrido[] = [];
  const semDados: Array<{ nome: string; tipoLabel: string }> = [];
  const dataPedido = String(opts?.dataIso || '').trim();

  for (const s of lista) {
    const tipo = String(s.tipo || '');
    const tipoLabel = labelTipoServico(tipo, s.nome);
    if (dataPedido) {
      const dias = await PlanilhaService.getMetricasPorDia(s.id, dataPedido, dataPedido);
      if (!diaTemOperacao(dias[0])) {
        semDados.push({ nome: s.nome, tipoLabel });
        continue;
      }
      comDados.push({ servico: s, tipo, tipoLabel, dataIso: dataPedido });
      continue;
    }
    const periodo = await PlanilhaService.getPeriodoDadosPorServico(s.id);
    if (!periodo?.dataFim) {
      semDados.push({ nome: s.nome, tipoLabel });
      continue;
    }
    comDados.push({ servico: s, tipo, tipoLabel, dataIso: periodo.dataFim });
  }

  return { comDados, semDados };
}

function ehTipoColeta(tipo: string): boolean {
  return tipo === TipoServico.COLETA_CAMINHAO || tipo === 'coleta_caminhao';
}

async function gerarEEnviarDia(
  grupoJid: string,
  servico: Servico,
  contrato: Contract | null,
  dataIsoPedido?: string | null,
  tipoFiltro?: string | null,
  servicoIds?: string[] | null,
): Promise<void> {
  const ids = servicoIds?.filter(Boolean) || [];
  const { comDados } = await varrerServicosComDados(servico, contrato, {
    dataIso: dataIsoPedido,
    tipoFiltro,
  });
  const alvo = ids.length ? comDados.filter((s) => ids.includes(s.servico.id)) : comDados;
  const contratoNome = contrato?.numeroContrato || 'este contrato';

  if (alvo.length === 0) {
    await wuzapiService.enviarTexto(
      grupoJid,
      dataIsoPedido ? '⚠️ Sem dados nesse dia.' : '⚠️ Nenhum serviço com dados.',
    );
    return;
  }

  let enviados = 0;
  const falhas: string[] = [];
  for (const item of alvo) {
    try {
      const gerado = await montarHtmlRelatorioDiaPorServico(item.servico, contrato, item.dataIso);
      if (!gerado) {
        falhas.push(`${item.servico.nome} (sem HTML)`);
        continue;
      }
      const pdf = await htmlToPdf(gerado.html, {
        useCache: false,
        margin: { top: '10mm', bottom: '10mm', left: '8mm', right: '8mm' },
      });
      await wuzapiService.enviarDocumento(
        grupoJid,
        gerado.nomeArquivo,
        pdf,
        legendaRelatorioPdf(
          'Dia',
          rotuloCurtoServico(item.tipo, item.servico.nome),
          contratoNome,
          item.dataIso,
          item.dataIso,
        ),
      );
      enviados += 1;
    } catch (err: any) {
      console.error('[WhatsappComandoRelatorio] PDF dia', item.servico.nome, err?.message || err);
      falhas.push(rotuloCurtoServico(item.tipo, item.servico.nome));
    }
  }

  if (enviados === 0) {
    await wuzapiService.enviarTexto(
      grupoJid,
      falhas.length
        ? `⚠️ Não consegui montar o PDF de ${falhas.join(', ')}.`
        : '⚠️ Não consegui montar o PDF.',
    );
    return;
  }
  if (falhas.length) {
    await wuzapiService.enviarTexto(grupoJid, `⚠️ Não gerado: ${falhas.join(' · ')}`);
  }
}

function ehColetaServico(servico: Servico): boolean {
  const tipo = String(servico.tipo || '');
  return tipo === TipoServico.COLETA_CAMINHAO || tipo === 'coleta_caminhao';
}

async function obterBufferUltimaPlanilha(servicoId: string): Promise<{ buffer: Buffer; nomeArquivo: string } | null> {
  const uploads = await PlanilhaService.listarUploadsPorServico(servicoId);
  const escolhido = escolherUploadParaBackup(uploads);
  if (!escolhido) return null;
  if (escolhido.urlDownload) {
    try {
      const buffer = await FileStorageService.downloadArquivo(escolhido.urlDownload);
      return { buffer, nomeArquivo: escolhido.nomeArquivo || 'planilha.xlsx' };
    } catch (err: any) {
      console.warn('[WhatsappComandoRelatorio] MinIO saúde:', err?.message || err);
    }
  }
  try {
    return await PlanilhaService.exportarPlanilha(escolhido.id);
  } catch (err: any) {
    console.warn('[WhatsappComandoRelatorio] Export saúde:', err?.message || err);
    return null;
  }
}

/** Um PDF de saúde dos dados (hodômetro/peso) — coleta, sem encher o grupo. */
async function gerarEEnviarSaude(
  grupoJid: string,
  servicoBase: Servico,
  contrato: Contract | null,
): Promise<void> {
  const lista = await listarServicosDoContrato(servicoBase, contrato);
  const coletas = lista.filter(ehColetaServico);
  const candidatos = (coletas.length ? coletas : lista).slice().sort((a, b) => {
    if (a.id === servicoBase.id) return -1;
    if (b.id === servicoBase.id) return 1;
    return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR');
  });

  let alvo: { servico: Servico; buffer: Buffer; nomeArquivo: string } | null = null;
  for (const s of candidatos) {
    const arquivo = await obterBufferUltimaPlanilha(s.id);
    if (!arquivo) continue;
    alvo = { servico: s, ...arquivo };
    if (ehColetaServico(s)) break;
  }

  if (!alvo) {
    await wuzapiService.enviarTexto(
      grupoJid,
      '⚠️ Sem planilha de *Coleta* para montar a saúde dos dados.',
    );
    return;
  }

  const cadastro = extrairCadastroOperacional(contrato?.configOperacional);
  const relatorio = analisarViagensPlanilha(alvo.buffer, alvo.nomeArquivo, cadastro);
  const html = gerarHtmlSaudeDadosServer({
    relatorio,
    contratoNome: contrato?.numeroContrato || '—',
    servicoNome: alvo.servico.nome,
    tipoLabel: labelTipoServico(String(alvo.servico.tipo || ''), alvo.servico.nome),
  });
  const pdf = await htmlToPdf(html, {
    useCache: false,
    margin: { top: '10mm', bottom: '10mm', left: '8mm', right: '8mm' },
  });
  await wuzapiService.enviarDocumento(
    grupoJid,
    `Saude_Dados_${alvo.servico.nome.replace(/[^\w\-]+/g, '_')}.pdf`,
    pdf,
    legendaRelatorioPdf('Saúde', rotuloCurtoServico(String(alvo.servico.tipo || ''), alvo.servico.nome), contrato?.numeroContrato || ''),
  );
}

async function gerarEEnviarCiclo(
  grupoJid: string,
  servico: Servico,
  contrato: Contract | null,
  qual: QualCiclo = 'atual',
  tipoFiltro?: string | null,
  servicoIds?: string[] | null,
): Promise<void> {
  const periodo = await periodoCicloDisponivel(servico, contrato, qual);
  const contratoNome = contrato?.numeroContrato || 'este contrato';
  const ids = servicoIds?.filter(Boolean) || [];
  const lista = (await listarServicosDoContrato(servico, contrato))
    .filter((s) => servicoBateTipoFiltro(s, tipoFiltro))
    .filter((s) => !ids.length || ids.includes(s.id));

  let enviados = 0;
  const omitidos: string[] = [];
  for (const s of lista) {
    try {
      const gerado = await montarHtmlRelatorioCicloPorServico(s, contrato, {
        dataInicio: periodo.dataInicio,
        dataFim: periodo.dataFim,
        label: periodo.label,
      });
      if (!gerado) {
        omitidos.push(s.nome);
        continue;
      }
      const pdf = await htmlToPdf(gerado.html, {
        useCache: false,
        margin: { top: '8mm', bottom: '8mm', left: '8mm', right: '8mm' },
      });
      await wuzapiService.enviarDocumento(
        grupoJid,
        gerado.nomeArquivo,
        pdf,
        legendaRelatorioPdf(
          qual === 'anterior' ? 'Ciclo anterior' : 'Ciclo',
          rotuloCurtoServico(String(s.tipo || ''), s.nome),
          contratoNome,
          periodo.dataInicio,
          periodo.dataFim,
        ),
      );
      enviados += 1;
    } catch (err: any) {
      console.error('[WhatsappComandoRelatorio] PDF ciclo', s.nome, err?.message || err);
      omitidos.push(rotuloCurtoServico(String(s.tipo || ''), s.nome));
    }
  }

  if (enviados === 0) {
    await wuzapiService.enviarTexto(
      grupoJid,
      '⚠️ Sem dados neste ciclo.',
    );
    return;
  }
  if (omitidos.length) {
    await wuzapiService.enviarTexto(
      grupoJid,
      `⚠️ Sem dado no ciclo: ${omitidos.join(' · ')}`,
    );
  }
}

async function gerarEEnviarComparativo(
  grupoJid: string,
  servicoBase: Servico,
  contratoBase: Contract | null,
  qual: QualCiclo = 'atual',
): Promise<void> {
  const tipo = String(servicoBase.tipo || TipoServico.COLETA_CAMINHAO);
  const tipoLabel = TIPOS_SERVICO_META[tipo]?.label || tipo;
  const contratoNome = contratoBase?.numeroContrato || servicoBase.nome || 'Contrato';
  const nomeCiclo = qual === 'anterior' ? 'ciclo anterior' : 'ciclo atual';

  await wuzapiService.enviarTexto(
    grupoJid,
    `⏳ Gerando *análise de peso* do contrato *${contratoNome}* (${nomeCiclo})…\nTipo: ${tipoLabel}`,
  );

  const servicos = await listarServicosDoContratoMesmoTipo(servicoBase);
  const periodoBase = await periodoCicloDisponivel(servicoBase, contratoBase, qual);
  const linhas: Array<{
    contratoNome: string;
    servicoNome: string;
    totalRegistros: number;
    periodoLabel: string;
    analise: NonNullable<ReturnType<typeof analisarPesoColeta>>;
  }> = [];

  for (const s of servicos) {
    const contrato = (s as any).contract as Contract | undefined
      || await AppDataSource.getRepository(Contract).findOne({ where: { id: s.contract_id } });
    const periodo = await periodoCicloDisponivel(s, contrato || null, qual);
    const diasPeriodo = await PlanilhaService.getMetricasPorDia(
      s.id,
      periodo.dataInicio,
      periodo.dataFim,
    );
    const datasAtivas = diasPeriodo.filter((d) => d.viagens > 0).map((d) => d.data);
    const dadosPeriodo: Record<string, any>[] = [];
    for (const data of datasAtivas) {
      const pagina = await PlanilhaService.getDadosBrutosPorDia(s.id, data, {
        apenasValidos: true,
      });
      dadosPeriodo.push(...pagina.dados);
    }
    if (dadosPeriodo.length === 0) continue;

    const cfgOp = contrato?.configOperacional;
    const limites = resolverLimitesDoContrato(cfgOp);
    const analise = analisarPesoColeta(normalizarDados(dadosPeriodo), s.id, {
      colunaTipoCaminhao: s.configFaturamento?.colunaTipoCaminhao || undefined,
      limitesPeso: limites.peso,
      limitesVolume: limites.volume,
      densidadeOtima: normalizarDensidadeResiduoKgL(cfgOp?.densidadeResiduoKgL),
      densidadeKgL: cfgOp?.densidadeKgL || null,
      densidadeKgLPorPlaca: cfgOp?.densidadeKgLPorPlaca || null,
    });
    if (!analise) continue;

    linhas.push({
      contratoNome: contrato?.numeroContrato || '—',
      servicoNome: s.nome,
      totalRegistros: dadosPeriodo.length,
      periodoLabel: periodo.label,
      analise,
    });
  }

  if (linhas.length < 1) {
    await wuzapiService.enviarTexto(
      grupoJid,
      `⚠️ Sem dados no ${nomeCiclo} (${periodoBase.label}) para *${contratoNome}*.`,
    );
    return;
  }

  const html = gerarHtmlComparativoContratosWhatsapp({
    tipoLabel,
    periodoRef: periodoBase.label,
    linhas,
  });
  const pdf = await htmlToPdf(html, { useCache: false });
  const nomeSafe = String(contratoNome).replace(/[^\w\-]+/g, '_');
  const tag = qual === 'anterior' ? 'Anterior' : periodoBase.dataInicio;
  const nome = `Analise_Peso_${nomeSafe}_${tag}_${periodoBase.dataInicio}.pdf`;
  await wuzapiService.enviarDocumento(
    grupoJid,
    nome,
    pdf,
    `📊 Análise de peso · ${contratoNome} · ${periodoBase.label}`,
  );
}

async function gerarEEnviarEvolucaoDiaria(
  grupoJid: string,
  servicoBase: Servico,
  contratoBase: Contract | null,
  janela: JanelaEvolucao = JANELAS_EVOLUCAO[0],
  servicoIds?: string[] | null,
): Promise<void> {
  const ids = servicoIds?.filter(Boolean) || [];
  const servicos = (await listarServicosDoContrato(servicoBase, contratoBase))
    .filter((s) => ehColetaServico(s))
    .filter((s) => !ids.length || ids.includes(s.id));
  if (!servicos.length) {
    await wuzapiService.enviarTexto(grupoJid, TEXTO_EVOLUCAO_SO_COLETA);
    return;
  }
  const tipoLabel = 'Coleta';
  const qual: QualCiclo = janela.cicloAnterior ? 'anterior' : 'atual';
  const periodo = await periodoCicloDisponivel(servicos[0], contratoBase, qual);
  const contratoNome = contratoBase?.numeroContrato || servicoBase.nome || 'Contrato';

  const dataInicio = periodo.dataInicio;
  const dataFim = periodo.dataFim;

  const result = await agregarQualidadeIdeal3d({
    servicoIds: servicos.map((s) => s.id),
    dataInicio,
    dataFim,
  });

  const diasComDados = [...new Set(result.pontos.map((p) => p.data))].sort();
  const diasJanela = janela.dias > 0 ? diasComDados.slice(-janela.dias) : diasComDados;
  if (diasJanela.length === 0) {
    await wuzapiService.enviarTexto(
      grupoJid,
      '⚠️ Sem dados para a evolução.',
    );
    return;
  }

  const dentro = new Set(diasJanela);
  const porContrato = new Map<string, {
    nome: string;
    porDia: Map<string, Record<FaixaDominante3d, number>>;
    total: Record<FaixaDominante3d, number>;
  }>();
  const totalGeral = zeradoFaixas();

  for (const p of result.pontos) {
    if (!dentro.has(p.data)) continue;
    const chave = p.contratoId || p.servicoId;
    let bloco = porContrato.get(chave);
    if (!bloco) {
      const nome = String(p.contratoNome || 'Contrato').trim() || 'Contrato';
      const servico = String(p.servicoNome || '').trim();
      bloco = {
        nome: servico ? `${nome} · ${servico}` : nome,
        porDia: new Map(),
        total: zeradoFaixas(),
      };
      porContrato.set(chave, bloco);
    }
    const faixas = p.faixas || zeradoFaixas();
    const doDia = bloco.porDia.get(p.data) || zeradoFaixas();
    for (const f of FAIXAS_IDS) {
      const n = Number(faixas[f]) || 0;
      doDia[f] += n;
      bloco.total[f] += n;
      totalGeral[f] += n;
    }
    bloco.porDia.set(p.data, doDia);
  }

  const montarLinhas = (porDia: Map<string, Record<FaixaDominante3d, number>>) =>
    diasJanela.map((data) => {
      const c = porDia.get(data);
      const viagens = c ? FAIXAS_IDS.reduce((s, f) => s + c[f], 0) : 0;
      if (!c || viagens === 0) {
        return {
          data,
          label: fmtEixoDia(data),
          viagens: 0,
          otimo: null,
          ruim: null,
          pessimo: null,
          excedido: null,
        };
      }
      const pct = (n: number) => Math.round((n / viagens) * 1000) / 10;
      return {
        data,
        label: fmtEixoDia(data),
        viagens,
        otimo: pct(c.otimo),
        ruim: pct(c.ruim),
        pessimo: pct(c.pessimo),
        excedido: pct(c.excedido),
      };
    });

  const blocos: BlocoEvolucaoPdf[] = [...porContrato.entries()]
    .map(([id, b]) => {
      const viagens = FAIXAS_IDS.reduce((s, f) => s + b.total[f], 0);
      const pct = Object.fromEntries(
        FAIXAS_IDS.map((f) => [f, viagens > 0 ? (b.total[f] / viagens) * 100 : 0]),
      ) as Record<FaixaDominante3d, number>;
      return { id, nome: b.nome, viagens, pct, linhas: montarLinhas(b.porDia) };
    })
    .filter((b) => b.viagens > 0)
    .sort((a, b) => b.viagens - a.viagens);

  if (blocos.length === 0) {
    await wuzapiService.enviarTexto(grupoJid, '⚠️ Sem dados de qualidade vs peso ideal na janela.');
    return;
  }

  const totalViagens = FAIXAS_IDS.reduce((s, f) => s + totalGeral[f], 0);
  const pctGeral = Object.fromEntries(
    FAIXAS_IDS.map((f) => [f, totalViagens > 0 ? (totalGeral[f] / totalViagens) * 100 : 0]),
  ) as Record<FaixaDominante3d, number>;

  const periodoLabel = `${fmtEixoDia(diasJanela[0])} a ${fmtEixoDia(diasJanela[diasJanela.length - 1])}`;
  const html = gerarHtmlEvolucaoDiariaWhatsapp({
    tipoLabel,
    periodoLabel,
    janelaLabel: janela.dias > 0 ? `${janela.label} (${diasJanela.length} dias)` : `Por ciclo · ${diasJanela.length} dias`,
    geradoEm: new Date().toLocaleString('pt-BR'),
    totalViagens,
    pctGeral,
    blocos,
  });

  const pdf = await htmlToPdf(html, { useCache: false, waitMs: 0 });
  const nomeSafe = String(contratoNome).replace(/[^\w\-]+/g, '_');
  const nome = `Evolucao_Diaria_${nomeSafe}_${diasJanela[0]}_${diasJanela[diasJanela.length - 1]}.pdf`;
  await wuzapiService.enviarDocumento(
    grupoJid,
    nome,
    pdf,
    legendaRelatorioPdf(
      'Evolução',
      rotuloCurtoServico(String(servicos[0].tipo || ''), servicos[0].nome),
      contratoNome,
      diasJanela[0],
      diasJanela[diasJanela.length - 1],
    ),
  );
}

/**
 * Processa comando de texto. Retorna true se consumiu a mensagem.
 */
export async function processarComandoTextoWhatsapp(opts: {
  grupoJid: string;
  texto: string;
  isFromMe?: boolean;
  contextoContrato?: { servico: Servico; contrato: Contract | null };
}): Promise<{ processado: boolean; motivo?: string }> {
  limparSessoes();
  const texto = opts.texto.trim();
  if (!texto) return { processado: false, motivo: 'Sem texto' };

  const norm = normalizarTexto(texto);

  const resolvido = opts.contextoContrato?.servico
    ? { servico: opts.contextoContrato.servico, contrato: opts.contextoContrato.contrato }
    : await resolverMapaGrupo(opts.grupoJid);
  if (!resolvido?.servico) {
    return { processado: false, motivo: opts.contextoContrato ? 'Contrato sem serviço' : 'Grupo não mapeado' };
  }
  if (!wuzapiService.isConfigured) {
    return { processado: false, motivo: 'WuzAPI não configurada' };
  }

  const { servico, contrato } = resolvido;
  const sessao = sessoes.get(opts.grupoJid);
  function rotulosDistintos(itens: ItemMenuServico[]): string[] {
    const base = itens.map((s) => rotuloCurtoServico(s.tipo, s.nome));
    const contagem = new Map<string, number>();
    for (const rotulo of base) contagem.set(rotulo, (contagem.get(rotulo) || 0) + 1);
    return itens.map((s, i) => ((contagem.get(base[i]) || 0) > 1 ? s.nome : base[i]));
  }

  function janelaDoTexto(textoNorm: string, qual: QualCiclo): JanelaEvolucao {
    if (qual === 'anterior') return { dias: 0, label: 'Ciclo anterior', cicloAnterior: true };
    if (/\b15\b/.test(textoNorm)) return JANELAS_EVOLUCAO[1];
    if (/\bsemana\b/.test(textoNorm)) return JANELAS_EVOLUCAO[0];
    return JANELAS_EVOLUCAO[2];
  }

  const enviarSelecionados = async (
    formato: FormatoRelatorioCurto,
    itens: ItemMenuServico[],
    dataIso: string | null | undefined,
    qual: QualCiclo,
    textoNorm: string,
  ) => {
    sessoes.delete(opts.grupoJid);
    const ids = itens.map((item) => item.id);
    try {
      if (formato === 'dia') {
        await gerarEEnviarDia(opts.grupoJid, servico, contrato, dataIso, null, ids);
        return;
      }
      if (formato === 'ciclo') {
        await gerarEEnviarCiclo(opts.grupoJid, servico, contrato, qual, null, ids);
        return;
      }
      const coletas = itens.filter((item) => ehTipoColeta(item.tipo));
      const outros = itens.filter((item) => !ehTipoColeta(item.tipo));
      if (outros.length) {
        await wuzapiService.enviarTexto(opts.grupoJid, TEXTO_EVOLUCAO_SO_COLETA);
      }
      if (!coletas.length) return;
      const janela = janelaDoTexto(textoNorm, qual);
      for (const item of coletas) {
        await gerarEEnviarEvolucaoDiaria(opts.grupoJid, servico, contrato, janela, [item.id]);
      }
    } catch (err: any) {
      console.error('[WhatsappComandoRelatorio]', err?.message || err);
      await wuzapiService.enviarTexto(opts.grupoJid, '❌ Não consegui gerar o relatório.');
    }
  };

  const pedirServicosOuEnviar = async (pedido: PedidoRelatorioCurto, textoNorm: string) => {
    if (!pedido.formato) {
      sessoes.set(opts.grupoJid, {
        etapa: 'menu_relatorio',
        expiresAt: Date.now() + TTL_MS,
        servicoId: servico.id,
        contratoId: servico.contract_id,
        tipoServico: pedido.tipoServico,
        dataIso: pedido.dataIso,
        qualCiclo: pedido.qualCiclo,
      });
      await wuzapiService.enviarTexto(opts.grupoJid, textoMenuRelatorio());
      return;
    }
    const { comDados } = await varrerServicosComDados(servico, contrato, {
      dataIso: pedido.formato === 'dia' ? pedido.dataIso : null,
      tipoFiltro: pedido.todos ? null : pedido.tipoServico,
    });
    if (comDados.length === 0) {
      sessoes.delete(opts.grupoJid);
      await wuzapiService.enviarTexto(
        opts.grupoJid,
        pedido.dataIso ? '⚠️ Sem dados nesse dia.' : '⚠️ Nenhum serviço com dados.',
      );
      return;
    }
    const itens: ItemMenuServico[] = comDados.map((s) => ({
      id: s.servico.id,
      nome: s.servico.nome,
      tipo: s.tipo,
      tipoLabel: s.tipoLabel,
      ultimoDia: s.dataIso,
    }));
    const definido = pedido.todos || Boolean(pedido.tipoServico) || itens.length === 1;
    if (!definido) {
      sessoes.set(opts.grupoJid, {
        etapa: 'menu_servicos',
        expiresAt: Date.now() + TTL_MS,
        servicoId: servico.id,
        contratoId: servico.contract_id,
        formato: pedido.formato,
        qualCiclo: pedido.qualCiclo,
        dataIso: pedido.dataIso,
        servicosMenu: itens,
      });
      await wuzapiService.enviarTexto(opts.grupoJid, textoMenuServicos(rotulosDistintos(itens)));
      return;
    }
    await enviarSelecionados(pedido.formato, itens, pedido.dataIso, pedido.qualCiclo, textoNorm);
  };

  if (norm === 'cancelar' || norm === 'sair') {
    sessoes.delete(opts.grupoJid);
    await wuzapiService.enviarTexto(opts.grupoJid, 'Ok, cancelei.');
    return { processado: true };
  }

  const pedidoLivre = interpretarPedidoRelatorio(norm);
  if (pedidoLivre?.formato && (pedidoLivre.tipoServico || pedidoLivre.todos)) {
    await pedirServicosOuEnviar(pedidoLivre, norm);
    return { processado: true };
  }

  if (sessao?.etapa === 'menu_servicos') {
    const itens = sessao.servicosMenu || [];
    const escolha = resolverEscolhasLista(norm, itens.length);
    if (!escolha) {
      await wuzapiService.enviarTexto(opts.grupoJid, TEXTO_LISTA_INVALIDA);
      return { processado: true };
    }
    const selecionados = escolha === 'todos' ? itens : escolha.map((n) => itens[n - 1]);
    await enviarSelecionados(
      sessao.formato || 'ciclo',
      selecionados,
      sessao.dataIso,
      sessao.qualCiclo || 'atual',
      norm,
    );
    return { processado: true };
  }

  if (sessao?.etapa === 'menu_relatorio') {
    const formato = formatoDaOpcaoMenu(norm, pedidoLivre);
    if (!formato) {
      await wuzapiService.enviarTexto(opts.grupoJid, TEXTO_LISTA_INVALIDA);
      return { processado: true };
    }
    await pedirServicosOuEnviar({
      formato,
      tipoServico: sessao.tipoServico || null,
      todos: false,
      dataIso: pedidoLivre?.dataIso || sessao.dataIso || null,
      qualCiclo: pedidoLivre?.qualCiclo || sessao.qualCiclo || 'atual',
      abrirMenuTipo: false,
    }, norm);
    return { processado: true };
  }

  if (ehPedidoSaude(norm)) {
    sessoes.delete(opts.grupoJid);
    try {
      await gerarEEnviarSaude(opts.grupoJid, servico, contrato);
    } catch (err: any) {
      console.error('[WhatsappComandoRelatorio] saúde', err?.message || err);
      await wuzapiService.enviarTexto(opts.grupoJid, '❌ Não consegui gerar a saúde dos dados.');
    }
    return { processado: true };
  }

  if (
    norm === 'comparativo'
    || norm === 'comparar'
    || norm === 'pdf comparativo'
    || /^(comparativo|peso|analise de peso)( anterior)?$/.test(norm)
    || norm === 'peso anterior'
    || norm === 'peso'
  ) {
    const qual: QualCiclo = textoPedeCicloAnterior(norm) ? 'anterior' : 'atual';
    sessoes.delete(opts.grupoJid);
    try {
      await gerarEEnviarComparativo(opts.grupoJid, servico, contrato, qual);
    } catch (err: any) {
      console.error('[WhatsappComandoRelatorio] comparativo', err?.message || err);
      await wuzapiService.enviarTexto(opts.grupoJid, '❌ Não consegui gerar o relatório.');
    }
    return { processado: true };
  }

  if (pedidoLivre) {
    await pedirServicosOuEnviar(pedidoLivre, norm);
    return { processado: true };
  }

  if (norm === 'menu' || norm === 'ajuda' || norm === 'help' || norm === 'comandos') {
    await pedirServicosOuEnviar({
      formato: null,
      tipoServico: null,
      todos: false,
      dataIso: null,
      qualCiclo: 'atual',
      abrirMenuTipo: true,
    }, norm);
    return { processado: true };
  }

  return { processado: false, motivo: 'Não é comando conhecido' };
}

function formatoDaOpcaoMenu(
  norm: string,
  pedido: PedidoRelatorioCurto | null,
): FormatoRelatorioCurto | null {
  if (norm === '1' || norm === 'dia' || norm === 'diario' || norm === 'diaria') return 'dia';
  if (norm === '2' || norm === 'ciclo') return 'ciclo';
  if (norm === '3' || norm === 'evolucao' || norm === 'grafico' || norm === 'graficos') return 'evolucao';
  if (pedido?.formato && !pedido.tipoServico && !pedido.todos) return pedido.formato;
  return null;
}
