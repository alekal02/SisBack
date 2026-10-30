import * as XLSX from 'xlsx';
import { extrairDataIsoComando, resolverEscolhaIndice } from './WhatsappComandoRelatorioTexto';

export const LIMITE_MENSAGENS_POR_MINUTO = 10;
export const JANELA_LIMITE_MS = 60_000;
export const TTL_PLANILHA_PENDENTE_MS = 30 * 60 * 1000;
export const TTL_CANCELAR_IMPORTACAO_MS = 10 * 60 * 1000;

export type TipoTentativaWhatsapp = 'planilha' | 'relatorio';
export type OrigemTelefoneWhatsapp = 'telefone' | 'sender_alt' | 'lid' | 'nenhuma';

export interface ContratoAutorizadoWhatsapp {
  contractId: string;
  nome: string;
  /** Número do contrato, quando for diferente do nome exibido. */
  numero?: string | null;
  podeEnviarPlanilha: boolean;
  podePedirRelatorio: boolean;
  ativo?: boolean;
}

export interface PistasPlanilhaWhatsapp {
  nomeArquivo?: string;
  abas?: string[];
  cabecalhos?: string[];
}

export interface CancelamentoImportacaoWhatsapp {
  expiraEm: number;
  contractId: string;
  nome: string;
  uploadIds: number[];
  desfazimentoSeguro: boolean;
}

export interface OpcaoContratoWhatsapp {
  contractId: string;
  nome: string;
}

export interface PendenciaWhatsapp {
  tipo: 'planilha' | 'relatorio';
  expiraEm: number;
  contratos: OpcaoContratoWhatsapp[];
  texto?: string;
  caminho?: string;
  nomeArquivo?: string;
}

export type DecisaoConversaPrivada =
  | { acao: 'grupo' }
  | { acao: 'ignorar' }
  | { acao: 'limite' }
  | { acao: 'silencio'; tipo: TipoTentativaWhatsapp }
  | { acao: 'contrato_nao_autorizado' }
  | { acao: 'perguntar_planilha'; contratos: OpcaoContratoWhatsapp[] }
  | { acao: 'importar'; contractId: string; detectado?: boolean }
  | { acao: 'planilha_outro_contrato'; nome: string }
  | { acao: 'cancelar_importacao'; contractId: string; nome: string; uploadIds: number[]; desfazimentoSeguro: boolean }
  | { acao: 'cancelar_expirado'; nome: string }
  | { acao: 'perguntar_relatorio'; contratos: OpcaoContratoWhatsapp[]; texto: string }
  | { acao: 'relatorio'; contractId: string; texto: string }
  | { acao: 'planilha_expirada' }
  | { acao: 'usar_planilha_pendente'; contractId: string }
  | { acao: 'usar_relatorio_pendente'; contractId: string; texto: string }
  | { acao: 'indice_invalido'; max: number };

const PALAVRAS_COMANDO = new Set([
  'relatorio', 'relatorios', 'report', 'pdf', 'dia', 'diario', 'diaria', 'ciclo', 'saude',
  'hodometro', 'operacional', 'evolucao', 'graficos', 'grafico', 'comparativo', 'comparar',
  'peso', 'anterior', 'passado', 'atual', 'cancelar', 'sair', 'voltar', 'menu', 'ajuda',
  'help', 'comandos', 'do', 'da', 'de', 'dos', 'das', 'o', 'a', 'os', 'as', 'para', 'qual',
  'contrato', 'por', 'em', 'no', 'na', 'ultimo', 'completa', 'completo', 'semana', 'dias',
  'analise', 'operacao', 'coleta', 'seletiva', 'caminhao', 'rocada', 'rocadeira', 'varricao',
  'varredura', 'capina', 'poda', 'remocao', 'entulho', 'pintura', 'feira', 'feiras', 'aterro',
]);

const pendencias = new Map<string, PendenciaWhatsapp>();
const cancelamentos = new Map<string, CancelamentoImportacaoWhatsapp>();
const cotas = new Map<string, number[]>();

const PALAVRAS_GENERICAS_PLANILHA = new Set([
  'producao', 'planilha', 'coleta', 'consolidado', 'contrato', 'contratos', 'servico', 'servicos',
  'produtividade', 'relatorio', 'relatorios', 'geral', 'municipal', 'prefeitura', 'filial',
  'unidade', 'tabela', 'dados', 'total', 'periodo', 'outubro', 'setembro', 'novembro',
  'dezembro', 'janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto',
]);

export function mensagemDeGrupo(opts: { isGroup?: boolean; chat?: string; sender?: string }): boolean {
  if (opts.isGroup === true) return true;
  const chat = String(opts.chat || '');
  const sender = String(opts.sender || '');
  return chat.endsWith('@g.us') || sender.endsWith('@g.us');
}

export function normalizarTextoWhatsapp(raw: string): string {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** DDI + DDD + número. Brasil: 55 + DDD + 8 (fixo) ou 9 (celular). */
export function validarTelefoneComDdi(raw: string): { ok: true; telefone: string } | { ok: false; erro: string } {
  const digitos = String(raw || '').replace(/\D/g, '');
  if (!digitos) {
    return { ok: false, erro: 'Informe o telefone com DDI, DDD e número. Ex.: 5562999998888.' };
  }
  if (!/^55[1-9]\d(?:9\d{8}|[2-5]\d{7})$/.test(digitos)) {
    return { ok: false, erro: 'Telefone inválido. Use DDI + DDD + número, ex.: 5562999998888.' };
  }
  return { ok: true, telefone: digitos };
}

function textoJid(valor: unknown): string {
  if (!valor) return '';
  if (typeof valor === 'string') return valor.trim();
  if (typeof valor === 'object') {
    const o = valor as Record<string, unknown>;
    const user = o.User ?? o.user;
    const server = o.Server ?? o.server;
    if (typeof user === 'string' && typeof server === 'string' && user && server) return `${user}@${server}`;
    if (typeof user === 'string') return user.trim();
  }
  return '';
}

function primeiroJid(...valores: unknown[]): string {
  for (const valor of valores) {
    const texto = textoJid(valor);
    if (texto) return texto;
  }
  return '';
}

export function interpretarJidWhatsapp(jid: string): { telefone: string | null; lid: string | null } {
  const texto = String(jid || '').trim();
  if (!texto) return { telefone: null, lid: null };
  const lower = texto.toLowerCase();
  const user = texto.split('@')[0].split(':')[0].replace(/\D/g, '');
  if (lower.includes('@lid')) return { telefone: null, lid: user ? `${user}@lid` : null };
  if (!lower.includes('@') && user.length >= 12 && user.length <= 15) return { telefone: user, lid: null };
  if (user.length >= 12 && user.length <= 15) return { telefone: user, lid: null };
  return { telefone: null, lid: null };
}

export interface IdentidadeRemetenteWhatsapp {
  telefone: string | null;
  lid: string | null;
  nomePerfil: string | null;
  chat: string;
  sender: string;
  origem: OrigemTelefoneWhatsapp;
  chave: string;
}

export function extrairIdentidadePayload(payload: {
  event?: { Info?: Record<string, unknown> };
  sender_pn?: unknown;
  senderPn?: unknown;
}): IdentidadeRemetenteWhatsapp {
  const info = payload.event?.Info || {};
  const sender = primeiroJid(info.Sender, info.sender);
  const chat = primeiroJid(info.Chat, info.chat);
  const alt = primeiroJid(
    info.SenderAlt,
    info.senderAlt,
    info.SenderPN,
    info.senderPN,
    info.sender_pn,
    info.SenderPn,
    payload.sender_pn,
    payload.senderPn,
  );
  const doSender = interpretarJidWhatsapp(sender);
  const doAlt = interpretarJidWhatsapp(alt);
  const doChat = interpretarJidWhatsapp(chat);
  const telefone = doSender.telefone || doAlt.telefone || doChat.telefone;
  const lid = doSender.lid || doAlt.lid || doChat.lid;
  let origem: OrigemTelefoneWhatsapp = 'nenhuma';
  if (doSender.telefone) origem = 'telefone';
  else if (doAlt.telefone) origem = 'sender_alt';
  else if (lid) origem = 'lid';
  const nomeBruto = info.PushName ?? info.pushName ?? info.Pushname;
  const nomePerfil = typeof nomeBruto === 'string' && nomeBruto.trim() ? nomeBruto.trim() : null;
  const chave = telefone || lid || chat || sender || 'sem-remetente';
  return { telefone, lid, nomePerfil, chat, sender, origem, chave };
}

export function telefoneDeRespostaLid(data: unknown, profundidade = 0): string | null {
  if (!data || profundidade > 5) return null;
  if (typeof data === 'string') return interpretarJidWhatsapp(data).telefone;
  if (typeof data !== 'object') return null;
  if (Array.isArray(data)) {
    for (const item of data) {
      const tel = telefoneDeRespostaLid(item, profundidade + 1);
      if (tel) return tel;
    }
    return null;
  }
  const o = data as Record<string, unknown>;
  const chaves = ['pn', 'PN', 'Phone', 'phone', 'jid', 'JID', 'Jid', 'SenderAlt', 'sender_pn', 'senderPn'];
  for (const chave of chaves) {
    if (chave in o) {
      const tel = telefoneDeRespostaLid(o[chave], profundidade + 1);
      if (tel) return tel;
    }
  }
  for (const valor of Object.values(o)) {
    if (valor && typeof valor === 'object') {
      const tel = telefoneDeRespostaLid(valor, profundidade + 1);
      if (tel) return tel;
    }
  }
  return null;
}

export function avaliarLimiteRemetente(
  historico: number[],
  agora: number,
  limite = LIMITE_MENSAGENS_POR_MINUTO,
  janelaMs = JANELA_LIMITE_MS,
): { permitido: boolean; historico: number[] } {
  const recentes = historico.filter((t) => agora - t < janelaMs);
  if (recentes.length >= limite) return { permitido: false, historico: recentes };
  recentes.push(agora);
  return { permitido: true, historico: recentes };
}

export function consumirCotaRemetente(chave: string, agora = Date.now()): boolean {
  const atual = cotas.get(chave) || [];
  const resultado = avaliarLimiteRemetente(atual, agora);
  cotas.set(chave, resultado.historico);
  return resultado.permitido;
}

export function limparCotaRemetente(chave?: string): void {
  if (chave) cotas.delete(chave);
  else cotas.clear();
}

export function guardarPendencia(chave: string, pendencia: PendenciaWhatsapp): void {
  pendencias.set(chave, pendencia);
}

export function obterPendencia(chave: string): PendenciaWhatsapp | null {
  return pendencias.get(chave) || null;
}

export function limparPendencia(chave: string): void {
  pendencias.delete(chave);
}

export function limparPendenciasWhatsapp(): void {
  pendencias.clear();
  cancelamentos.clear();
}

export function guardarCancelamentoImportacao(chave: string, item: CancelamentoImportacaoWhatsapp): void {
  cancelamentos.set(chave, item);
}

export function obterCancelamentoImportacao(chave: string): CancelamentoImportacaoWhatsapp | null {
  return cancelamentos.get(chave) || null;
}

export function limparCancelamentoImportacao(chave?: string): void {
  if (chave) cancelamentos.delete(chave);
  else cancelamentos.clear();
}

export function textoEscolhaContrato(_pergunta: string, contratos: Array<{ nome: string }>): string {
  const linha = contratos.map((c, i) => `${i + 1} ${c.nome}`).join(' · ');
  return `Qual contrato?\n${linha}`;
}

export function acaoSegueProcessamento(acao: DecisaoConversaPrivada['acao']): boolean {
  return acao !== 'grupo' && acao !== 'ignorar' && acao !== 'limite' && acao !== 'silencio';
}

function palavrasLivres(norm: string): string[] {
  const semData = norm
    .replace(/\b\d{1,2}[/.\\-]\d{1,2}(?:[/.\\-]\d{2,4})?\b/g, ' ')
    .replace(/\b20\d{2}-\d{1,2}-\d{1,2}\b/g, ' ');
  return semData
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((w) => w && !PALAVRAS_COMANDO.has(w) && !/^\d+$/.test(w));
}

function nomeNorm(nome: string): string {
  return normalizarTextoWhatsapp(nome).replace(/\s+/g, ' ');
}

export function citarContratoNoTexto(
  texto: string,
  contratos: OpcaoContratoWhatsapp[],
): OpcaoContratoWhatsapp | 'ambiguo' | null {
  const norm = normalizarTextoWhatsapp(texto);
  if (!norm) return null;
  const hits = contratos.filter((c) => {
    const nome = nomeNorm(c.nome);
    if (nome.length < 3) return false;
    if (norm.includes(nome)) return true;
    return nome.split(' ').filter((w) => w.length >= 4).some((w) => new RegExp(`(?:^|\\s)${w}(?:$|\\s)`).test(` ${norm} `));
  });
  if (hits.length === 0) return null;
  hits.sort((a, b) => nomeNorm(b.nome).length - nomeNorm(a.nome).length);
  const melhor = hits[0];
  const segundo = hits[1];
  if (segundo) {
    const n1 = nomeNorm(melhor.nome);
    const n2 = nomeNorm(segundo.nome);
    if (norm.includes(n2) && !n1.includes(n2)) return 'ambiguo';
  }
  return melhor;
}

export function removerNomeContrato(texto: string, nome: string): string {
  const bruto = String(texto || '').trim();
  const alvo = nomeNorm(nome);
  if (!alvo) return bruto;
  const palavras = alvo.split(' ').filter((w) => w.length >= 3);
  let resto = bruto;
  if (palavras.length) {
    const padrao = palavras.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
    resto = resto.replace(new RegExp(padrao, 'i'), ' ');
  }
  return resto.replace(/\s+/g, ' ').trim();
}

function ehEscolhaNumerica(norm: string, max: number): number | 'invalido' | null {
  const m = norm.match(/^(\d+)\b/);
  if (!m) return null;
  if (extrairDataIsoComando(norm)) return null;
  const resto = norm.replace(/^\d+\b/, ' ').replace(/[.\-—:]/g, ' ');
  if (resto.split(/\s+/).some((w) => PALAVRAS_COMANDO.has(w))) return null;
  const n = Number(m[1]);
  if (!Number.isInteger(n) || n < 1 || n > max) return 'invalido';
  return n;
}

function resumo(pessoas: ContratoAutorizadoWhatsapp[]): OpcaoContratoWhatsapp[] {
  return pessoas.map((p) => ({ contractId: p.contractId, nome: p.nome || p.contractId }));
}

function normFrase(texto: string): string {
  return normalizarTextoWhatsapp(texto).replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function ehAnoIsolado(texto: string): boolean {
  return /^(19|20)\d{2}$/.test(texto);
}

function fraseUtil(texto: string): string | null {
  const frase = normFrase(texto);
  if (frase.length < 3 || ehAnoIsolado(frase)) return null;
  const partes = frase.split(' ').filter(Boolean);
  if (partes.length > 0 && partes.every((p) => PALAVRAS_GENERICAS_PLANILHA.has(p) || ehAnoIsolado(p))) return null;
  return frase;
}

/**
 * Nome completo (duas ou mais palavras) ou número do contrato.
 * Uma palavra solta, como "Centro" numa coluna, não identifica.
 */
function frasesIdentificacao(contrato: ContratoAutorizadoWhatsapp): string[] {
  const brutas = [contrato.nome, contrato.numero || '']
    .map((item) => fraseUtil(item || ''))
    .filter((item): item is string => !!item);
  return [...new Set(brutas.filter((frase) => frase.split(' ').length >= 2 || /\d/.test(frase)))];
}

function contemFrase(corpus: string, frase: string): boolean {
  const alvo = ` ${frase} `;
  let from = 0;
  while (from < corpus.length) {
    const idx = corpus.indexOf(alvo, from);
    if (idx < 0) return false;
    const anterior = corpus.slice(0, idx).trim().split(' ').pop() || '';
    if (/^\d/.test(frase) && /^\d+$/.test(anterior)) {
      from = idx + 1;
      continue;
    }
    return true;
  }
  return false;
}

export function extrairPistasPlanilha(buffer: Buffer, nomeArquivo?: string): PistasPlanilhaWhatsapp {
  const abas: string[] = [];
  const cabecalhos: string[] = [];
  try {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false, sheetRows: 8 });
    for (const nome of wb.SheetNames.slice(0, 12)) {
      abas.push(nome);
      const ws = wb.Sheets[nome];
      if (!ws) continue;
      const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' }) as unknown[][];
      for (const row of rows.slice(0, 6)) {
        const texto = (row || []).map((celula) => String(celula ?? '').trim()).filter(Boolean).join(' ');
        if (texto) cabecalhos.push(texto);
      }
    }
  } catch {
    /* planilha ilegível: segue sem pista e a conversa pergunta o contrato */
  }
  return { nomeArquivo, abas, cabecalhos };
}

function corpusPlanilha(pistas: PistasPlanilhaWhatsapp): string {
  return ` ${normFrase([pistas.nomeArquivo, ...(pistas.abas || []), ...(pistas.cabecalhos || [])].filter(Boolean).join(' '))} `;
}

function contratosCitadosNaPlanilha(
  pistas: PistasPlanilhaWhatsapp,
  contratos: ContratoAutorizadoWhatsapp[],
): ContratoAutorizadoWhatsapp[] {
  const corpus = corpusPlanilha(pistas);
  if (corpus.trim().length < 3) return [];
  const hits = contratos
    .filter((c) => c.ativo !== false)
    .map((contrato) => ({
      contrato,
      frases: frasesIdentificacao(contrato).filter((frase) => contemFrase(corpus, frase)),
    }))
    .filter((item) => item.frases.length > 0);
  const especificos = hits.filter((item) => !hits.some((outro) => {
    if (outro.contrato.contractId === item.contrato.contractId) return false;
    return outro.frases.some((longa) => item.frases.every((curta) => longa !== curta && longa.includes(curta)));
  }));
  return especificos.map((item) => item.contrato);
}

/**
 * Entre os contratos em que a pessoa pode enviar planilha, devolve o único
 * cujo nome completo ou número aparece no arquivo, nas abas ou no cabeçalho.
 */
export function identificarContratoPlanilha(
  pistas: PistasPlanilhaWhatsapp,
  contratos: ContratoAutorizadoWhatsapp[],
): OpcaoContratoWhatsapp | null {
  const citados = contratosCitadosNaPlanilha(
    pistas,
    contratos.filter((c) => c.podeEnviarPlanilha),
  );
  if (citados.length !== 1) return null;
  const unico = citados[0];
  return { contractId: unico.contractId, nome: unico.nome || unico.contractId };
}

/** Planilha cita nome completo ou número de um contrato que não é o da pessoa. */
export function outroContratoCitadoNaPlanilha(
  pistas: PistasPlanilhaWhatsapp,
  contractIdProprio: string,
  catalogo: ContratoAutorizadoWhatsapp[],
): { nome: string } | null {
  const outros = contratosCitadosNaPlanilha(pistas, catalogo)
    .filter((c) => c.contractId !== contractIdProprio);
  if (!outros.length) return null;
  const nome = outros.length === 1
    ? (outros[0].nome || outros[0].numero || outros[0].contractId)
    : outros.map((c) => c.nome || c.contractId).join(' e ');
  return { nome };
}

export function ehPedidoCancelarImportacao(texto: string): boolean {
  return normFrase(texto) === 'cancelar';
}

export function textoPlanilhaRecebida(contrato: string): string {
  const nome = String(contrato || '').trim() || 'contrato';
  return `Planilha recebida para ${nome}. Se não for esse, responda CANCELAR em até 10 minutos.`;
}

export function textoPlanilhaOutroContrato(contrato: string): string {
  const nome = String(contrato || '').trim() || 'outro contrato';
  return `Esta planilha parece ser de ${nome}, em que você não está autorizado. Nada foi importado.`;
}

/** Os 10 minutos correm a partir do instante em que a importação terminou. */
export function expiraCancelamentoAposImportacao(fimImportacaoMs: number): number {
  return fimImportacaoMs + TTL_CANCELAR_IMPORTACAO_MS;
}

export function textoRelatorioContratoDia(contrato: string, dia: string): string {
  const nome = String(contrato || '').trim() || 'contrato';
  const data = String(dia || '').trim();
  return data ? `Relatório de ${nome}, dia ${data}` : `Relatório de ${nome}`;
}

/** Só é seguro apagar o upload novo quando a importação não removeu dado anterior. */
export function desfazimentoImportacaoSeguro(info: {
  uploadIds?: Array<number | null | undefined> | null;
  registrosRemovidos?: number | null;
}): boolean {
  const ids = (info.uploadIds || []).filter((id): id is number => Number.isInteger(id) && (id as number) > 0);
  if (!ids.length) return false;
  return (info.registrosRemovidos || 0) === 0;
}

export function textoAvisoGestorCancelamento(contrato: string, motivo: string): string {
  return `CANCELAR sem desfazer (${contrato}): ${motivo}`;
}

export function decidirConversaPrivada(opts: {
  grupo: boolean;
  parecePlanilha: boolean;
  texto: string;
  textoMerece: boolean;
  pessoas: ContratoAutorizadoWhatsapp[];
  pendencia: PendenciaWhatsapp | null;
  agora: number;
  contratoSessao?: string | null;
  pistasPlanilha?: PistasPlanilhaWhatsapp | null;
  /** Contratos conhecidos, inclusive os que esta pessoa não pode usar. */
  catalogo?: ContratoAutorizadoWhatsapp[] | null;
  cancelamento?: CancelamentoImportacaoWhatsapp | null;
}): DecisaoConversaPrivada {
  if (opts.grupo) return { acao: 'grupo' };

  const texto = String(opts.texto || '').trim();
  const norm = normalizarTextoWhatsapp(texto);
  if (!opts.parecePlanilha && opts.cancelamento && ehPedidoCancelarImportacao(texto)) {
    if (opts.cancelamento.expiraEm > opts.agora) {
      return {
        acao: 'cancelar_importacao',
        contractId: opts.cancelamento.contractId,
        nome: opts.cancelamento.nome,
        uploadIds: opts.cancelamento.uploadIds,
        desfazimentoSeguro: opts.cancelamento.desfazimentoSeguro,
      };
    }
    return { acao: 'cancelar_expirado', nome: opts.cancelamento.nome };
  }
  const pendencia = opts.pendencia;
  if (pendencia && pendencia.expiraEm <= opts.agora && pendencia.tipo === 'planilha' && !opts.parecePlanilha) {
    return { acao: 'planilha_expirada' };
  }

  const pendenciaViva = pendencia && pendencia.expiraEm > opts.agora ? pendencia : null;
  if (pendenciaViva && !opts.parecePlanilha) {
    const escolha = ehEscolhaNumerica(norm, pendenciaViva.contratos.length);
    if (escolha === 'invalido') return { acao: 'indice_invalido', max: pendenciaViva.contratos.length };
    if (typeof escolha === 'number') {
      const contrato = pendenciaViva.contratos[escolha - 1];
      if (pendenciaViva.tipo === 'planilha') {
        return { acao: 'usar_planilha_pendente', contractId: contrato.contractId };
      }
      return {
        acao: 'usar_relatorio_pendente',
        contractId: contrato.contractId,
        texto: pendenciaViva.texto || texto,
      };
    }
    if (!opts.textoMerece) return { acao: 'indice_invalido', max: pendenciaViva.contratos.length };
  }

  if (!opts.parecePlanilha && !opts.textoMerece) return { acao: 'ignorar' };

  const ativas = opts.pessoas.filter((p) => p.ativo !== false);
  if (opts.parecePlanilha) {
    const lista = ativas.filter((p) => p.podeEnviarPlanilha);
    if (lista.length === 0) return { acao: 'silencio', tipo: 'planilha' };
    if (lista.length === 1) {
      const catalogo = opts.catalogo?.length ? opts.catalogo : opts.pessoas;
      if (opts.pistasPlanilha && catalogo?.length) {
        const outro = outroContratoCitadoNaPlanilha(opts.pistasPlanilha, lista[0].contractId, catalogo);
        if (outro) return { acao: 'planilha_outro_contrato', nome: outro.nome };
      }
      return { acao: 'importar', contractId: lista[0].contractId };
    }
    if (opts.pistasPlanilha) {
      const achado = identificarContratoPlanilha(opts.pistasPlanilha, lista);
      if (achado) return { acao: 'importar', contractId: achado.contractId, detectado: true };
    }
    return { acao: 'perguntar_planilha', contratos: resumo(lista) };
  }

  const lista = ativas.filter((p) => p.podePedirRelatorio);
  if (lista.length === 0) return { acao: 'silencio', tipo: 'relatorio' };

  const livres = palavrasLivres(norm);
  const citado = citarContratoNoTexto(texto, resumo(lista));
  if (livres.length > 0 && !citado) return { acao: 'contrato_nao_autorizado' };
  if (citado === 'ambiguo') {
    return { acao: 'perguntar_relatorio', contratos: resumo(lista), texto };
  }
  if (citado) {
    return {
      acao: 'relatorio',
      contractId: citado.contractId,
      texto: removerNomeContrato(texto, citado.nome) || texto,
    };
  }

  if (opts.contratoSessao && lista.some((c) => c.contractId === opts.contratoSessao)) {
    return { acao: 'relatorio', contractId: opts.contratoSessao, texto };
  }
  if (lista.length === 1) return { acao: 'relatorio', contractId: lista[0].contractId, texto };
  return { acao: 'perguntar_relatorio', contratos: resumo(lista), texto };
}

export function indiceValido(norm: string, max: number): number | null {
  return resolverEscolhaIndice(norm, max);
}
