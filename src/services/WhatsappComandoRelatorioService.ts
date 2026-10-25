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
  extrairDataIsoComando,
  ehPedidoRelatorioDia,
  extrairTipoServicoComando,
  ehPedidoMenuRelatorio,
  resolverEscolhaIndice,
  ehPedidoFormatoDiario,
  ehPedidoFormatoCiclo,
  ehPedidoFormatoEvolucao,
  ehPedidoSaude,
  ehPedidoOperacional,
  ehPedidoEvolucao,
  type QualCiclo,
} from './WhatsappComandoRelatorioTexto';
import { montarHtmlRelatorioDiaPorServico } from './relatorioDia/montarHtmlRelatorioDiaPorServico';
import { montarHtmlRelatorioCicloPorServico } from './relatorioDia/montarHtmlRelatorioCicloPorServico';
import FileStorageService from './FileStorageService';
import { analisarViagensPlanilha } from './analisarViagensPlanilhaService';
import { gerarHtmlSaudeDadosServer } from './PdfSaudeDadosHtml';
import { extrairCadastroOperacional } from '../utils/configOperacional';
import { escolherUploadParaBackup } from './planilhaOriginalStorage';

type EtapaSessao = 'menu_tipo' | 'menu_servicos' | 'menu_formato' | 'menu_relatorio' | 'menu_evolucao_janela' | 'pedir_data_dia';
type TipoRelatorioSessao = 'ciclo' | 'peso' | 'evolucao' | 'dia';

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
  qualCiclo?: QualCiclo;
  servicosMenu?: ItemMenuServico[];
  escolhido?: ItemMenuServico;
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

function menuRelatorioTexto(qual: QualCiclo = 'atual'): string {
  const escopo = qual === 'anterior'
    ? 'do *ciclo anterior* (ciclo fechado)'
    : 'do *ciclo atual*';
  return [
    '📊 *Relatórios Sistemma*',
    '',
    `Os PDFs usam *somente os dados deste contrato* (grupo mapeado) — ${escopo}.`,
    '',
    'Escolha uma opção (responda com o número):',
    '',
    '*1* — Ciclo operacional',
    'PDF gerencial do ciclo de medição — indicadores, qualidade vs ideal, frota e rankings.',
    '',
    '*2* — Análise de peso (ciclo)',
    'PDF da análise de peso vs ideal do *seu* contrato (mesmo critério da Análise de Peso no sistema).',
    '',
    '*3* — Evolução por ciclo (gráfico)',
    'PDF com o gráfico de linhas da qualidade vs peso ideal do ciclo, igual ao painel da TV. Depois dá para trocar a janela: semana, 15 dias ou ciclo anterior.',
    '',
    '*4* — Relatório do dia (operação)',
    'Varre os serviços do contrato e envia o PDF certo de cada tipo que teve dado no dia.',
    '',
    qual === 'atual'
      ? '_Atalho: *ciclo anterior* · *peso anterior* · *evolucao anterior*_'
      : '_Você pediu o ciclo anterior. Escolha 1, 2 ou 3._',
    '',
    '_Digite *cancelar* para sair._',
  ].join('\n');
}

function menuEvolucaoJanelaTexto(): string {
  return [
    '📈 *Evolução diária — janela*',
    '',
    'Escolha o período dos gráficos:',
    '',
    '*1* — Última semana',
    '*2* — Últimos 15 dias',
    '*3* — Por ciclo atual (completo)',
    '*4* — Ciclo anterior (completo)',
    '',
    '_Digite *cancelar* para sair._',
  ].join('\n');
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

function isoParaBr(iso: string): string {
  return String(iso || '').split('-').reverse().join('/');
}

function menuTipoTexto(contratoNome: string): string {
  return [
    `📊 *Relatórios* — ${contratoNome}`,
    '',
    '*1* — Diário (último dia de cada serviço)',
    '*2* — Ciclo atual',
    '*3* — Evolução por ciclo (gráfico)',
    '*4* — Saúde dos dados',
    '',
    'Atalhos: *dia 16/09* · *ciclo* · *evolucao* · *evolucao 15* · *evolucao ciclo* · *evolucao anterior* · *saude*',
    '',
    '_cancelar_ sai.',
  ].join('\n');
}

function menuServicosTexto(
  contratoNome: string,
  itens: ItemMenuServico[],
  semDados: Array<{ nome: string }>,
): string {
  const linhas = itens.map((s, i) => `*${i + 1}* — ${s.nome} · ${isoParaBr(s.ultimoDia)}`);
  return [
    `📄 *Operacional* — ${contratoNome}`,
    '',
    ...linhas,
    '',
    ...(semDados.length ? [`_Sem dado: ${semDados.map((s) => s.nome).join(', ')}_`, ''] : []),
    '_voltar_ · _cancelar_',
  ].join('\n');
}

function menuFormatoTexto(item: ItemMenuServico): string {
  const coleta = ehTipoColeta(item.tipo);
  return [
    `📄 *${item.nome}* · ${isoParaBr(item.ultimoDia)}`,
    '',
    '*1* — Diário',
    '*2* — Ciclo completo',
    ...(coleta ? ['*3* — Evolução por ciclo (gráfico)'] : []),
    '',
    '_data *16/09* · *voltar* · *cancelar*_',
  ].join('\n');
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
  const { comDados, semDados } = await varrerServicosComDados(servico, contrato, {
    dataIso: dataIsoPedido,
    tipoFiltro,
  });
  const alvo = ids.length ? comDados.filter((s) => ids.includes(s.servico.id)) : comDados;
  const contratoNome = contrato?.numeroContrato || 'este contrato';
  const filtroTxt = tipoFiltro ? ` (${labelTipoServico(tipoFiltro)})` : '';
  const umSo = alvo.length === 1;

  if (alvo.length === 0) {
    await wuzapiService.enviarTexto(
      grupoJid,
      dataIsoPedido
        ? `⚠️ ${umSo || ids.length ? 'Este serviço' : `Varredura em *${contratoNome}*${filtroTxt}`} não operou em *${isoParaBr(dataIsoPedido)}*.`
        : `⚠️ Nenhum serviço com dados${filtroTxt}. Envie a planilha ou escolha outra data (*dia 16/09*).`,
    );
    return;
  }

  if (!umSo) {
    const linhasScan = alvo.map((s) => `• *${s.servico.nome}* — ${s.tipoLabel} · ${isoParaBr(s.dataIso)}`);
    const semTxt = !ids.length && semDados.length
      ? `\nSem dado${dataIsoPedido ? ` em ${isoParaBr(dataIsoPedido)}` : ''}: ${semDados.map((s) => s.nome).join(', ')}`
      : '';
    await wuzapiService.enviarTexto(
      grupoJid,
      [
        `🔎 Varredura de *${contratoNome}*${filtroTxt}`,
        '',
        `Encontrei *${alvo.length}* serviço(s). Gerando o diário:`,
        ...linhasScan,
        semTxt,
      ].filter(Boolean).join('\n'),
    );
  } else {
    await wuzapiService.enviarTexto(
      grupoJid,
      `⏳ Relatório diário de *${alvo[0].servico.nome}* (${isoParaBr(alvo[0].dataIso)})…`,
    );
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
        `${item.servico.nome} — ${isoParaBr(item.dataIso)}`,
      );
      enviados += 1;
    } catch (err: any) {
      console.error('[WhatsappComandoRelatorio] PDF dia', item.servico.nome, err?.message || err);
      falhas.push(`${item.servico.nome} (${err?.message || 'erro'})`);
    }
  }

  if (enviados === 0) {
    await wuzapiService.enviarTexto(
      grupoJid,
      `⚠️ Não consegui montar o PDF.${falhas.length ? `\n${falhas.join('\n')}` : ''}`,
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

  await wuzapiService.enviarTexto(grupoJid, `⏳ Saúde — *${alvo.servico.nome}*…`);
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
    `Saúde dos dados — ${alvo.servico.nome}`,
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
  const nomeCiclo = qual === 'anterior' ? 'ciclo anterior' : 'ciclo atual';
  const contratoNome = contrato?.numeroContrato || 'este contrato';
  const filtroTxt = tipoFiltro ? ` (${labelTipoServico(tipoFiltro)})` : '';
  const ids = servicoIds?.filter(Boolean) || [];
  const lista = (await listarServicosDoContrato(servico, contrato))
    .filter((s) => servicoBateTipoFiltro(s, tipoFiltro))
    .filter((s) => !ids.length || ids.includes(s.id));
  const umSo = lista.length === 1;

  await wuzapiService.enviarTexto(
    grupoJid,
    umSo
      ? `⏳ Ciclo completo de *${lista[0].nome}* (${nomeCiclo})…\n${periodo.label}`
      : `🔎 Varredura de *${contratoNome}*${filtroTxt} — *${nomeCiclo}*\n${periodo.label}\n(${periodo.dataInicio} → ${periodo.dataFim})`,
  );

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
        `📄 Ciclo ${qual === 'anterior' ? 'anterior' : ''} · ${s.nome} · ${periodo.label}`.replace(/\s+/g, ' ').trim(),
      );
      enviados += 1;
    } catch (err: any) {
      console.error('[WhatsappComandoRelatorio] PDF ciclo', s.nome, err?.message || err);
      omitidos.push(`${s.nome} (erro)`);
    }
  }

  if (enviados === 0) {
    await wuzapiService.enviarTexto(
      grupoJid,
      `⚠️ Sem operação no ${nomeCiclo} (${periodo.label})${filtroTxt}.`,
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
): Promise<void> {
  const tipo = String(servicoBase.tipo || TipoServico.COLETA_CAMINHAO);
  if (tipo !== TipoServico.COLETA_CAMINHAO && tipo !== 'coleta_caminhao') {
    await wuzapiService.enviarTexto(
      grupoJid,
      '⚠️ Evolução diária está disponível apenas para *Coleta com caminhão*.',
    );
    return;
  }

  const tipoLabel = TIPOS_SERVICO_META[tipo]?.label || 'Coleta com caminhão';
  const qual: QualCiclo = janela.cicloAnterior ? 'anterior' : 'atual';
  const periodo = await periodoCicloDisponivel(servicoBase, contratoBase, qual);
  const contratoNome = contratoBase?.numeroContrato || servicoBase.nome || 'Contrato';

  await wuzapiService.enviarTexto(
    grupoJid,
    `⏳ Gerando *PDF Evolução Diária* de *${contratoNome}*…\n${periodo.label}\nJanela: *${janela.label}*`,
  );

  // Somente serviços deste contrato (grupo mapeado) — nunca outros municípios/contratos
  const servicos = await listarServicosDoContratoMesmoTipo(servicoBase);
  if (!servicos.length) {
    await wuzapiService.enviarTexto(grupoJid, '⚠️ Nenhum serviço de coleta encontrado neste contrato.');
    return;
  }

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
      `⚠️ Sem pesagens no ${qual === 'anterior' ? 'ciclo anterior' : 'ciclo atual'} (${periodo.label}) para montar a evolução diária.`,
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
    `📈 Evolução diária · ${contratoNome} · ${periodoLabel}`,
  );
}

/**
 * Processa comando de texto. Retorna true se consumiu a mensagem.
 */
export async function processarComandoTextoWhatsapp(opts: {
  grupoJid: string;
  texto: string;
  isFromMe?: boolean;
}): Promise<{ processado: boolean; motivo?: string }> {
  limparSessoes();
  const texto = opts.texto.trim();
  if (!texto) return { processado: false, motivo: 'Sem texto' };

  // Ignora eco das próprias mensagens do bot (exceto se for teste humano no mesmo número com comando explícito)
  const norm = normalizarTexto(texto);

  const resolvido = await resolverMapaGrupo(opts.grupoJid);
  if (!resolvido) {
    return { processado: false, motivo: 'Grupo não mapeado' };
  }
  if (!wuzapiService.isConfigured) {
    return { processado: false, motivo: 'WuzAPI não configurada' };
  }

  const { servico, contrato } = resolvido;
  const sessao = sessoes.get(opts.grupoJid);
  const dataNoTexto = extrairDataIsoComando(norm);
  const tipoPedido = extrairTipoServicoComando(norm);

  const enviarDia = async (
    dataIso?: string | null,
    tipoFiltro?: string | null,
    servicoIds?: string[] | null,
  ) => {
    sessoes.delete(opts.grupoJid);
    try {
      await gerarEEnviarDia(opts.grupoJid, servico, contrato, dataIso, tipoFiltro, servicoIds);
    } catch (err: any) {
      await wuzapiService.enviarTexto(
        opts.grupoJid,
        `❌ Falha ao gerar o relatório do dia: ${err?.message || 'erro'}`,
      );
    }
  };

  const enviarCicloEscolhido = async (item: ItemMenuServico, qual: QualCiclo = 'atual') => {
    sessoes.delete(opts.grupoJid);
    try {
      await gerarEEnviarCiclo(opts.grupoJid, servico, contrato, qual, null, [item.id]);
    } catch (err: any) {
      await wuzapiService.enviarTexto(
        opts.grupoJid,
        `❌ Falha ao gerar o ciclo: ${err?.message || 'erro'}`,
      );
    }
  };

  const enviarSaude = async () => {
    sessoes.delete(opts.grupoJid);
    try {
      await gerarEEnviarSaude(opts.grupoJid, servico, contrato);
    } catch (err: any) {
      await wuzapiService.enviarTexto(
        opts.grupoJid,
        `❌ Falha na saúde dos dados: ${err?.message || 'erro'}`,
      );
    }
  };

  const abrirMenuTipo = async () => {
    sessoes.set(opts.grupoJid, {
      etapa: 'menu_tipo',
      expiresAt: Date.now() + TTL_MS,
      servicoId: servico.id,
      contratoId: servico.contract_id,
      dataIso: sessao?.dataIso || dataNoTexto || null,
    });
    await wuzapiService.enviarTexto(
      opts.grupoJid,
      menuTipoTexto(contrato?.numeroContrato || 'este contrato'),
    );
  };

  const abrirMenuFormato = async (item: ItemMenuServico, dataIso?: string | null, servicosMenu?: ItemMenuServico[]) => {
    sessoes.set(opts.grupoJid, {
      etapa: 'menu_formato',
      expiresAt: Date.now() + TTL_MS,
      servicoId: servico.id,
      contratoId: servico.contract_id,
      escolhido: item,
      servicosMenu: servicosMenu || sessao?.servicosMenu,
      dataIso: dataIso || sessao?.dataIso || null,
    });
    await wuzapiService.enviarTexto(opts.grupoJid, menuFormatoTexto(item));
  };

  const abrirMenuServicos = async (tipoFiltro?: string | null, dataIso?: string | null) => {
    const { comDados, semDados } = await varrerServicosComDados(servico, contrato, {
      dataIso,
      tipoFiltro,
    });
    const contratoNome = contrato?.numeroContrato || 'este contrato';
    if (comDados.length === 0) {
      sessoes.delete(opts.grupoJid);
      await wuzapiService.enviarTexto(
        opts.grupoJid,
        dataIso
          ? `⚠️ Nenhum serviço operou em *${isoParaBr(dataIso)}* neste contrato.`
          : `⚠️ Nenhum serviço com dados em *${contratoNome}*. Envie a planilha.`,
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
    if (itens.length === 1) {
      await abrirMenuFormato(itens[0], dataIso, itens);
      return;
    }
    sessoes.set(opts.grupoJid, {
      etapa: 'menu_servicos',
      expiresAt: Date.now() + TTL_MS,
      servicoId: servico.id,
      contratoId: servico.contract_id,
      servicosMenu: itens,
      dataIso: dataIso || null,
    });
    await wuzapiService.enviarTexto(opts.grupoJid, menuServicosTexto(contratoNome, itens, semDados));
  };

  if (norm === 'cancelar' || norm === 'sair') {
    sessoes.delete(opts.grupoJid);
    await wuzapiService.enviarTexto(opts.grupoJid, 'Ok, cancelei. Digite *relatorio* quando quiser de novo.');
    return { processado: true };
  }

  if (norm === 'menu' || norm === 'ajuda' || norm === 'help' || norm === 'comandos') {
    sessoes.delete(opts.grupoJid);
    await wuzapiService.enviarTexto(
      opts.grupoJid,
      [
        '🤖 *Sistemma — comandos*',
        '',
        '*relatorio* — *1* diário, *2* ciclo, *3* evolução por ciclo, *4* saúde',
        '*saude* — PDF de saúde dos dados (coleta)',
        '*dia 16/09* — PDF do dia',
        '*ciclo* — PDF de ciclo',
        '*comparativo* / *peso* — PDF análise de peso',
        '*evolucao* — gráficos da semana',
        '*evolucao 15* · *evolucao ciclo* · *evolucao anterior*',
        '',
        'Envie a planilha para importar. Digite *relatorio* para o menu curto.',
      ].join('\n'),
    );
    return { processado: true };
  }

  if (sessao?.etapa === 'pedir_data_dia') {
    if (!dataNoTexto) {
      await wuzapiService.enviarTexto(
        opts.grupoJid,
        'Não entendi a data. Ex.: *16/09* ou *16/09/2026*. Digite *cancelar* para sair.',
      );
      return { processado: true };
    }
    const ids = sessao.escolhido ? [sessao.escolhido.id] : undefined;
    await enviarDia(dataNoTexto, null, ids);
    return { processado: true };
  }

  if (sessao?.etapa === 'menu_tipo') {
    if (ehPedidoEvolucao(norm) || resolverEscolhaIndice(norm, 4) === 3) {
      sessoes.delete(opts.grupoJid);
      const janela = resolverEscolhaIndice(norm, 4) === 3
        ? JANELAS_EVOLUCAO[2]
        : (resolverJanelaEvolucao(norm) || JANELAS_EVOLUCAO[0]);
      try {
        await gerarEEnviarEvolucaoDiaria(opts.grupoJid, servico, contrato, janela);
      } catch (err: any) {
        console.error('[WhatsappComandoRelatorio]', err?.message || err);
        await wuzapiService.enviarTexto(
          opts.grupoJid,
          `❌ Falha ao gerar evolução diária: ${err?.message || 'erro desconhecido'}`,
        );
      }
      return { processado: true };
    }
    if (ehPedidoSaude(norm) || resolverEscolhaIndice(norm, 4) === 4) {
      await enviarSaude();
      return { processado: true };
    }
    if (norm === '2' || ehPedidoFormatoCiclo(norm) || norm === 'ciclo') {
      sessoes.delete(opts.grupoJid);
      try {
        await gerarEEnviarCiclo(opts.grupoJid, servico, contrato, 'atual');
      } catch (err: any) {
        await wuzapiService.enviarTexto(
          opts.grupoJid,
          `❌ Falha ao gerar o ciclo: ${err?.message || 'erro'}`,
        );
      }
      return { processado: true };
    }
    if (ehPedidoOperacional(norm) || resolverEscolhaIndice(norm, 4) === 1 || ehPedidoFormatoDiario(norm)) {
      await abrirMenuServicos(null, sessao.dataIso);
      return { processado: true };
    }
    await wuzapiService.enviarTexto(
      opts.grupoJid,
      'Responda *1* (diário), *2* (ciclo), *3* (evolução por ciclo) ou *4* (saúde).',
    );
    return { processado: true };
  }

  if (sessao?.etapa === 'menu_servicos') {
    const itens = sessao.servicosMenu || [];
    if (norm === 'voltar' || norm === 'menu') {
      await abrirMenuTipo();
      return { processado: true };
    }
    const idx = resolverEscolhaIndice(norm, itens.length);
    let item = idx ? itens[idx - 1] : null;
    if (!item) {
      const tipo = extrairTipoServicoComando(norm);
      const hits = itens.filter((s) => {
        const nome = normalizarTexto(s.nome);
        if (nome.includes(norm) || norm.includes(nome)) return true;
        return Boolean(tipo && (s.tipo === tipo || servicoBateTipoFiltro({ tipo: s.tipo, nome: s.nome } as Servico, tipo)));
      });
      if (hits.length === 1) item = hits[0];
      else if (hits.length > 1) {
        sessoes.set(opts.grupoJid, {
          ...sessao,
          expiresAt: Date.now() + TTL_MS,
          servicosMenu: hits,
        });
        await wuzapiService.enviarTexto(
          opts.grupoJid,
          menuServicosTexto(contrato?.numeroContrato || 'este contrato', hits, []),
        );
        return { processado: true };
      }
    }
    if (!item) {
      await wuzapiService.enviarTexto(
        opts.grupoJid,
        `Não entendi. Responda com o número de *1* a *${itens.length}*, ou *cancelar*.`,
      );
      return { processado: true };
    }
    await abrirMenuFormato(item, sessao.dataIso, itens);
    return { processado: true };
  }

  if (sessao?.etapa === 'menu_formato') {
    const item = sessao.escolhido;
    if (!item) {
      await abrirMenuServicos(null, sessao.dataIso);
      return { processado: true };
    }
    if (norm === 'voltar' || norm === 'menu') {
      const lista = sessao.servicosMenu || [];
      if (lista.length <= 1) {
        await abrirMenuTipo();
        return { processado: true };
      }
      sessoes.set(opts.grupoJid, {
        etapa: 'menu_servicos',
        expiresAt: Date.now() + TTL_MS,
        servicoId: servico.id,
        contratoId: servico.contract_id,
        servicosMenu: lista,
        dataIso: sessao.dataIso || null,
      });
      await wuzapiService.enviarTexto(
        opts.grupoJid,
        menuServicosTexto(contrato?.numeroContrato || 'este contrato', lista, []),
      );
      return { processado: true };
    }
    if (dataNoTexto) {
      await enviarDia(dataNoTexto, null, [item.id]);
      return { processado: true };
    }
    if (ehTipoColeta(item.tipo) && (ehPedidoFormatoEvolucao(norm) || resolverEscolhaIndice(norm, 3) === 3)) {
      sessoes.delete(opts.grupoJid);
      try {
        await gerarEEnviarEvolucaoDiaria(opts.grupoJid, servico, contrato, JANELAS_EVOLUCAO[2]);
      } catch (err: any) {
        console.error('[WhatsappComandoRelatorio]', err?.message || err);
        await wuzapiService.enviarTexto(
          opts.grupoJid,
          `❌ Falha ao gerar evolução diária: ${err?.message || 'erro desconhecido'}`,
        );
      }
      return { processado: true };
    }
    if (ehPedidoFormatoDiario(norm) || resolverEscolhaIndice(norm, 2) === 1) {
      await enviarDia(sessao.dataIso || item.ultimoDia, null, [item.id]);
      return { processado: true };
    }
    if (ehPedidoFormatoCiclo(norm) || resolverEscolhaIndice(norm, 2) === 2) {
      const qual: QualCiclo = textoPedeCicloAnterior(norm) ? 'anterior' : 'atual';
      await enviarCicloEscolhido(item, qual);
      return { processado: true };
    }
    await wuzapiService.enviarTexto(
      opts.grupoJid,
      ehTipoColeta(item.tipo)
        ? 'Não entendi. Responda *1* (diário), *2* (ciclo), *3* (evolução por ciclo), uma data (*16/09*) ou *voltar*.'
        : 'Não entendi. Responda *1* (diário), *2* (ciclo completo), uma data (*16/09*) ou *voltar*.',
    );
    return { processado: true };
  }

  if (ehPedidoSaude(norm)) {
    await enviarSaude();
    return { processado: true };
  }

  if (ehPedidoOperacional(norm)) {
    await abrirMenuServicos(tipoPedido, dataNoTexto);
    return { processado: true };
  }

  if (ehPedidoEvolucao(norm)) {
    sessoes.delete(opts.grupoJid);
    try {
      await gerarEEnviarEvolucaoDiaria(
        opts.grupoJid,
        servico,
        contrato,
        resolverJanelaEvolucao(norm) || JANELAS_EVOLUCAO[0],
      );
    } catch (err: any) {
      console.error('[WhatsappComandoRelatorio]', err?.message || err);
      await wuzapiService.enviarTexto(
        opts.grupoJid,
        `❌ Falha ao gerar evolução diária: ${err?.message || 'erro desconhecido'}`,
      );
    }
    return { processado: true };
  }

  if (ehPedidoMenuRelatorio(norm)) {
    if (tipoPedido) {
      await abrirMenuServicos(tipoPedido, dataNoTexto);
    } else {
      await abrirMenuTipo();
    }
    return { processado: true };
  }

  if (ehPedidoRelatorioDia(norm)) {
    await enviarDia(dataNoTexto, tipoPedido);
    return { processado: true };
  }

  if (sessao?.etapa === 'menu_relatorio') {
    const escolhaCiclo = /^1\b/.test(norm) || (norm.includes('ciclo') && !norm.includes('evol') && !norm.includes('por') && !norm.includes('dia'));
    const escolhaComp = /^2\b/.test(norm) || norm.includes('compar') || norm.includes('peso') || norm.includes('analise');
    const escolhaEvol =
      /^3\b/.test(norm)
      || norm.includes('evolucao')
      || norm.includes('grafico')
      || norm.includes('gerente');
    const escolhaDia =
      /^4\b/.test(norm)
      || ehPedidoRelatorioDia(norm)
      || norm === 'diario'
      || norm.includes('do dia')
      || norm === 'operacao'
      || norm === 'pdf dia';

    if (!escolhaCiclo && !escolhaComp && !escolhaEvol && !escolhaDia) {
      if (textoPedeCicloAnterior(norm)) {
        sessoes.set(opts.grupoJid, {
          ...sessao,
          expiresAt: Date.now() + TTL_MS,
          qualCiclo: 'anterior',
        });
        await wuzapiService.enviarTexto(opts.grupoJid, menuRelatorioTexto('anterior'));
        return { processado: true };
      }
      await wuzapiService.enviarTexto(
        opts.grupoJid,
        'Não entendi. Responda *1* (ciclo), *2* (análise de peso), *3* (evolução) ou *4* (relatório do dia), ou *cancelar*.',
      );
      return { processado: true };
    }

    const tipo: TipoRelatorioSessao = escolhaDia
      ? 'dia'
      : escolhaEvol
        ? 'evolucao'
        : escolhaCiclo
          ? 'ciclo'
          : 'peso';
    const qual: QualCiclo = textoPedeCicloAnterior(norm)
      ? 'anterior'
      : (/\batual\b/.test(norm) ? 'atual' : (sessao.qualCiclo || 'atual'));

    if (tipo === 'dia') {
      await enviarDia(dataNoTexto, tipoPedido);
      return { processado: true };
    }

    if (tipo === 'evolucao' && qual === 'atual') {
      sessoes.set(opts.grupoJid, {
        etapa: 'menu_evolucao_janela',
        expiresAt: Date.now() + TTL_MS,
        servicoId: servico.id,
        contratoId: servico.contract_id,
        qualCiclo: 'atual',
      });
      await wuzapiService.enviarTexto(opts.grupoJid, menuEvolucaoJanelaTexto());
      return { processado: true };
    }

    sessoes.delete(opts.grupoJid);
    try {
      await gerarRelatorioTipo(opts.grupoJid, servico, contrato, tipo, qual);
    } catch (err: any) {
      console.error('[WhatsappComandoRelatorio]', err?.message || err);
      await wuzapiService.enviarTexto(
        opts.grupoJid,
        `❌ Falha ao gerar relatório: ${err?.message || 'erro desconhecido'}`,
      );
    }
    return { processado: true };
  }

  if (sessao?.etapa === 'menu_evolucao_janela') {
    const janela = resolverJanelaEvolucao(norm);
    if (!janela) {
      await wuzapiService.enviarTexto(
        opts.grupoJid,
        'Não entendi. Responda *1* (semana), *2* (15 dias), *3* (ciclo atual) ou *4* (ciclo anterior), ou *cancelar*.',
      );
      return { processado: true };
    }
    sessoes.delete(opts.grupoJid);
    try {
      await gerarEEnviarEvolucaoDiaria(opts.grupoJid, servico, contrato, janela);
    } catch (err: any) {
      console.error('[WhatsappComandoRelatorio]', err?.message || err);
      await wuzapiService.enviarTexto(
        opts.grupoJid,
        `❌ Falha ao gerar evolução diária: ${err?.message || 'erro desconhecido'}`,
      );
    }
    return { processado: true };
  }

  // Atalhos diretos sem menu
  if (
    norm === 'ciclo'
    || norm === 'ciclo operacional'
    || norm === 'pdf ciclo'
    || /^ciclo( operacional)? anterior$/.test(norm)
    || /^pdf ciclo anterior$/.test(norm)
    || /^(relatorio(s)?|pdf)\s+ciclo\b/.test(norm)
    || /^ciclo\s+(rocada|varricao|capina|poda|coleta|remocao|pintura|feira)/.test(norm)
  ) {
    const qual: QualCiclo = textoPedeCicloAnterior(norm) ? 'anterior' : 'atual';
    try {
      await gerarEEnviarCiclo(opts.grupoJid, servico, contrato, qual, tipoPedido);
    } catch (err: any) {
      await wuzapiService.enviarTexto(
        opts.grupoJid,
        `❌ Falha ao gerar ciclo: ${err?.message || 'erro'}`,
      );
    }
    return { processado: true };
  }
  if (
    norm === 'comparativo'
    || norm === 'comparar'
    || norm === 'pdf comparativo'
    || /^(comparativo|peso|analise de peso) anterior$/.test(norm)
    || norm === 'peso anterior'
  ) {
    const qual: QualCiclo = textoPedeCicloAnterior(norm) ? 'anterior' : 'atual';
    try {
      await gerarEEnviarComparativo(opts.grupoJid, servico, contrato, qual);
    } catch (err: any) {
      await wuzapiService.enviarTexto(
        opts.grupoJid,
        `❌ Falha ao gerar comparativo: ${err?.message || 'erro'}`,
      );
    }
    return { processado: true };
  }
  if (
    /^evolucao anterior$/.test(norm)
    || /^evolucao ciclo anterior$/.test(norm)
  ) {
    try {
      await gerarRelatorioTipo(opts.grupoJid, servico, contrato, 'evolucao', 'anterior');
    } catch (err: any) {
      await wuzapiService.enviarTexto(
        opts.grupoJid,
        `❌ Falha ao gerar evolução diária: ${err?.message || 'erro'}`,
      );
    }
    return { processado: true };
  }
  if (norm === 'evolucao ciclo' || norm === 'evolucao por ciclo') {
    try {
      await gerarEEnviarEvolucaoDiaria(opts.grupoJid, servico, contrato, JANELAS_EVOLUCAO[2]);
    } catch (err: any) {
      await wuzapiService.enviarTexto(
        opts.grupoJid,
        `❌ Falha ao gerar evolução diária: ${err?.message || 'erro'}`,
      );
    }
    return { processado: true };
  }

  return { processado: false, motivo: 'Não é comando conhecido' };
}

async function gerarRelatorioTipo(
  grupoJid: string,
  servico: Servico,
  contrato: Contract | null,
  tipo: TipoRelatorioSessao,
  qual: QualCiclo,
): Promise<void> {
  if (tipo === 'dia') {
    await wuzapiService.enviarTexto(
      grupoJid,
      'Qual dia você quer? Envie *dia 16/09*.',
    );
    return;
  }
  if (tipo === 'ciclo') {
    await gerarEEnviarCiclo(grupoJid, servico, contrato, qual);
    return;
  }
  if (tipo === 'peso') {
    await gerarEEnviarComparativo(grupoJid, servico, contrato, qual);
    return;
  }
  const janela: JanelaEvolucao = qual === 'anterior'
    ? { dias: 0, label: 'Ciclo anterior (completo)', cicloAnterior: true }
    : JANELAS_EVOLUCAO[2];
  await gerarEEnviarEvolucaoDiaria(grupoJid, servico, contrato, janela);
}
