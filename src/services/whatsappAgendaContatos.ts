/**
 * Agenda do WhatsApp para autorizar pessoas.
 * Os contatos ficam só em memória (cache de 5 minutos) e não são gravados nem logados.
 */

export const MENSAGEM_SESSAO_DESCONECTADA = 'Conecte o WhatsApp do Sistemma para listar os contatos.';
export const CACHE_CONTATOS_MS = 5 * 60 * 1000;

const TELEFONE_COM_DDI = /^55[1-9]\d(?:9\d{8}|[2-5]\d{7})$/;

export interface ContatoAgenda {
  nome: string;
  telefone: string;
}

export interface ContatoAgendaApi extends ContatoAgenda {
  jaAutorizado: boolean;
}

export interface PessoaLoteEntrada {
  nome?: unknown;
  telefone?: unknown;
  podeEnviarPlanilha?: unknown;
  podePedirRelatorio?: unknown;
}

export interface PessoaLotePronta {
  nome: string;
  telefone: string;
  podeEnviarPlanilha: boolean;
  podePedirRelatorio: boolean;
}

export interface PessoaLoteIgnorada {
  nome: string;
  telefone: string;
  motivo: string;
}

export interface SessaoAgenda {
  logado: boolean;
  jidProprio: string;
}

interface CacheContatos {
  ate: number;
  chave: string;
  itens: ContatoAgenda[];
}

let cacheContatos: CacheContatos | null = null;

export function limparCacheContatosAgenda(): void {
  cacheContatos = null;
}

/** Some DDI+número e tokens longos de texto de log. */
export function redigirTelefones(texto: string): string {
  return String(texto || '')
    .replace(/\b[0-9a-f]{32,}\b/gi, '[redigido]')
    .replace(/\d{10,15}/g, (bloco) => `${bloco.slice(0, 2)}****${bloco.slice(-2)}`);
}

export function mascararTelefoneLista(telefone: string): string {
  const d = String(telefone || '').replace(/\D/g, '');
  if (/^55\d{2}9\d{8}$/.test(d)) {
    return `(${d.slice(2, 4)}) 9****-${d.slice(-4)}`;
  }
  if (/^55\d{2}\d{8}$/.test(d)) {
    return `(${d.slice(2, 4)}) ****-${d.slice(-4)}`;
  }
  if (d.length >= 8) return `${d.slice(0, 2)}****${d.slice(-2)}`;
  return '****';
}

/**
 * Só dígitos, com DDI 55. Celular brasileiro antigo (sem o nono dígito) ganha o 9.
 * Devolve null quando o número não fecha DDI + DDD + assinante.
 */
export function normalizarTelefoneAgenda(raw: string): string | null {
  let digitos = String(raw || '').replace(/\D/g, '');
  if (!digitos) return null;
  if (digitos.startsWith('00')) digitos = digitos.slice(2);
  if ((digitos.length === 10 || digitos.length === 11) && /^[1-9]/.test(digitos)) {
    digitos = `55${digitos}`;
  }
  if (/^55\d{2}[6-9]\d{7}$/.test(digitos)) {
    digitos = `${digitos.slice(0, 4)}9${digitos.slice(4)}`;
  }
  if (!TELEFONE_COM_DDI.test(digitos)) return null;
  return digitos;
}

/** O número e a forma irmã, com ou sem o nono dígito do celular. */
export function chavesTelefone(telefone: string): string[] {
  const d = String(telefone || '').replace(/\D/g, '');
  const chaves = new Set<string>();
  if (d) chaves.add(d);
  if (/^55\d{2}9\d{8}$/.test(d)) chaves.add(d.slice(0, 4) + d.slice(5));
  if (/^55\d{2}[6-9]\d{7}$/.test(d)) chaves.add(`${d.slice(0, 4)}9${d.slice(4)}`);
  return [...chaves];
}

export function telefoneJaAutorizado(telefone: string, autorizados: Iterable<string>): boolean {
  const conhecidas = new Set<string>();
  for (const item of autorizados) {
    for (const chave of chavesTelefone(item)) conhecidas.add(chave);
  }
  return chavesTelefone(telefone).some((chave) => conhecidas.has(chave));
}

export function marcarJaAutorizados(
  contatos: ContatoAgenda[],
  autorizados: Iterable<string>,
): ContatoAgendaApi[] {
  const lista = [...autorizados];
  return contatos.map((contato) => ({
    ...contato,
    jaAutorizado: telefoneJaAutorizado(contato.telefone, lista),
  }));
}

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

function nomeDaAgenda(info: Record<string, unknown>): string {
  const agenda = texto(info.FullName) || texto(info.fullName)
    || texto(info.FirstName) || texto(info.firstName);
  const push = texto(info.PushName) || texto(info.pushName) || texto(info.Pushname)
    || texto(info.DisplayName) || texto(info.displayName);
  return agenda || push || 'Sem nome';
}

function jidEhGrupo(jid: string): boolean {
  return jid.toLowerCase().endsWith('@g.us');
}

function jidEhLid(jid: string): boolean {
  return jid.toLowerCase().includes('@lid');
}

function telefoneDeclarado(info: Record<string, unknown>): string {
  const direto = info.Phone ?? info.phone ?? info.PhoneNumber ?? info.phoneNumber ?? info.PN ?? info.pn;
  if (typeof direto === 'string') return direto;
  if (direto && typeof direto === 'object') {
    const o = direto as Record<string, unknown>;
    const user = texto(o.User) || texto(o.user);
    const server = texto(o.Server) || texto(o.server);
    if (user && server) return `${user}@${server}`;
    if (user) return user;
  }
  return '';
}

function telefoneDoIdentificador(jid: string, info: Record<string, unknown>): string | null {
  const id = String(jid || '').trim();
  if (!id || jidEhGrupo(id) || info.IsGroup === true || info.isGroup === true) return null;
  const declarado = telefoneDeclarado(info);
  if (jidEhLid(id)) {
    if (!declarado || declarado.toLowerCase().includes('@lid')) return null;
    return normalizarTelefoneAgenda(declarado);
  }
  const user = id.split('@')[0].split(':')[0];
  return normalizarTelefoneAgenda(user) || normalizarTelefoneAgenda(declarado);
}

function proprioNormalizado(jidProprio: string): string | null {
  const id = String(jidProprio || '').trim();
  if (!id) return null;
  return normalizarTelefoneAgenda(id.split('@')[0].split(':')[0]);
}

function ordenarPorNome(lista: ContatoAgenda[]): ContatoAgenda[] {
  return [...lista].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }));
}

function acrescentar(
  destino: Map<string, ContatoAgenda>,
  jid: string,
  info: Record<string, unknown>,
  proprio: string | null,
): void {
  const telefone = telefoneDoIdentificador(jid, info);
  if (!telefone) return;
  if (proprio && telefoneJaAutorizado(telefone, [proprio])) return;
  const nome = nomeDaAgenda(info);
  const atual = destino.get(telefone);
  if (!atual || atual.nome === 'Sem nome') {
    destino.set(telefone, { nome, telefone });
  }
}

function pareceMapaDeJid(obj: Record<string, unknown>): boolean {
  return Object.keys(obj).some((chave) => chave.includes('@'));
}

function infoDeItem(item: unknown): { jid: string; info: Record<string, unknown> } | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const info = item as Record<string, unknown>;
  const jid = texto(info.JID) || texto(info.jid) || texto(info.Jid) || texto(info.Id) || texto(info.id);
  return { jid, info };
}

function varrer(payload: unknown, destino: Map<string, ContatoAgenda>, proprio: string | null, profundidade: number): void {
  if (!payload || profundidade > 4) return;
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const parsed = infoDeItem(item);
      if (parsed) acrescentar(destino, parsed.jid, parsed.info, proprio);
      else varrer(item, destino, proprio, profundidade + 1);
    }
    return;
  }
  if (typeof payload !== 'object') return;
  const obj = payload as Record<string, unknown>;
  if (pareceMapaDeJid(obj)) {
    for (const [jid, valor] of Object.entries(obj)) {
      if (valor && typeof valor === 'object') {
        acrescentar(destino, jid, valor as Record<string, unknown>, proprio);
      }
    }
    return;
  }
  const aninhado = obj.data ?? obj.Data ?? obj.contacts ?? obj.Contacts ?? obj.Participants ?? obj.participants;
  if (aninhado) varrer(aninhado, destino, proprio, profundidade + 1);
}

/** Tira grupo, @lid sem telefone, o próprio número e telefone repetido. */
export function filtrarAgendaWuzapi(payload: unknown, jidProprio = ''): ContatoAgenda[] {
  const destino = new Map<string, ContatoAgenda>();
  varrer(payload, destino, proprioNormalizado(jidProprio), 0);
  return ordenarPorNome([...destino.values()]);
}

export function linhaLogContatos(quantidade: number): string {
  return `[Wuzapi] contatos listados: ${quantidade}`;
}

export function linhaLogLote(criados: number, ignorados: number): string {
  return `[Wuzapi] autorizados em lote: criados=${criados} ignorados=${ignorados}`;
}

export function perfilPodeAutorizar(role: string | undefined): boolean {
  return role === 'admin' || role === 'superadmin';
}

export function acessoAgendaContrato(
  role: string | undefined,
  contractIdUsuario: string | null | undefined,
  contractId: string,
): { ok: true } | { ok: false; status: number; error: string } {
  if (!perfilPodeAutorizar(role)) {
    return { ok: false, status: 403, error: 'Acesso negado: você não tem permissão para esta ação' };
  }
  if (role === 'admin' && contractIdUsuario && contractIdUsuario !== contractId) {
    return { ok: false, status: 403, error: 'Sem acesso a este contrato.' };
  }
  return { ok: true };
}

function lerCache(chave: string, agora: number): ContatoAgenda[] | null {
  if (!cacheContatos) return null;
  if (cacheContatos.chave !== chave || cacheContatos.ate <= agora) return null;
  return cacheContatos.itens;
}

function gravarCache(chave: string, itens: ContatoAgenda[], agora: number): void {
  cacheContatos = { chave, itens, ate: agora + CACHE_CONTATOS_MS };
}

export async function listarContatosAgenda(opts: {
  role?: string;
  contractIdUsuario?: string | null;
  contractId: string;
  sessao: SessaoAgenda;
  buscarContatos: () => Promise<unknown>;
  telefonesAutorizados: Iterable<string>;
  agora?: number;
  log?: (linha: string) => void;
}): Promise<{ status: number; body: ContatoAgendaApi[] | { error: string } }> {
  const acesso = acessoAgendaContrato(opts.role, opts.contractIdUsuario, opts.contractId);
  if (!acesso.ok) return { status: acesso.status, body: { error: acesso.error } };
  if (!opts.sessao.logado) {
    return { status: 409, body: { error: MENSAGEM_SESSAO_DESCONECTADA } };
  }

  const agora = opts.agora ?? Date.now();
  const chave = proprioNormalizado(opts.sessao.jidProprio) || 'sem-jid';
  let contatos = lerCache(chave, agora);
  if (!contatos) {
    try {
      const bruto = await opts.buscarContatos();
      contatos = filtrarAgendaWuzapi(bruto, opts.sessao.jidProprio);
      gravarCache(chave, contatos, agora);
    } catch (error: unknown) {
      const msg = redigirTelefones(error instanceof Error ? error.message : 'falha');
      opts.log?.(redigirTelefones(`[Wuzapi] falha ao listar contatos: ${msg}`));
      return { status: 500, body: { error: 'Erro ao listar contatos' } };
    }
  }

  const resposta = marcarJaAutorizados(contatos, opts.telefonesAutorizados);
  opts.log?.(linhaLogContatos(resposta.length));
  return { status: 200, body: resposta };
}

export async function listarParticipantesAgenda(opts: {
  role?: string;
  contractIdUsuario?: string | null;
  contractId: string;
  jid: string;
  gruposDoContrato: Iterable<string>;
  sessao: SessaoAgenda;
  buscarGrupo: (jid: string) => Promise<unknown>;
  telefonesAutorizados: Iterable<string>;
  log?: (linha: string) => void;
}): Promise<{ status: number; body: ContatoAgendaApi[] | { error: string } }> {
  const acesso = acessoAgendaContrato(opts.role, opts.contractIdUsuario, opts.contractId);
  if (!acesso.ok) return { status: acesso.status, body: { error: acesso.error } };
  if (!opts.sessao.logado) {
    return { status: 409, body: { error: MENSAGEM_SESSAO_DESCONECTADA } };
  }
  const jid = String(opts.jid || '').trim();
  const permitidos = new Set([...opts.gruposDoContrato].map((item) => String(item || '').trim()));
  if (!jidEhGrupo(jid) || !permitidos.has(jid)) {
    return { status: 404, body: { error: 'Este grupo não está neste contrato.' } };
  }
  try {
    const bruto = await opts.buscarGrupo(jid);
    const participantes = filtrarAgendaWuzapi(bruto, opts.sessao.jidProprio);
    const resposta = marcarJaAutorizados(participantes, opts.telefonesAutorizados);
    opts.log?.(redigirTelefones(linhaLogContatos(resposta.length)));
    return { status: 200, body: resposta };
  } catch (error: unknown) {
    const msg = redigirTelefones(error instanceof Error ? error.message : 'falha');
    opts.log?.(redigirTelefones(`[Wuzapi] falha ao listar participantes: ${msg}`));
    return { status: 500, body: { error: 'Erro ao listar participantes' } };
  }
}

function lerPessoas(body: unknown): PessoaLoteEntrada[] | null {
  if (Array.isArray(body)) return body as PessoaLoteEntrada[];
  if (body && typeof body === 'object' && Array.isArray((body as { pessoas?: unknown }).pessoas)) {
    return (body as { pessoas: PessoaLoteEntrada[] }).pessoas;
  }
  return null;
}

export function separarLote(
  pessoas: PessoaLoteEntrada[],
  existentes: Iterable<string>,
): { criar: PessoaLotePronta[]; ignorados: PessoaLoteIgnorada[] } {
  const criar: PessoaLotePronta[] = [];
  const ignorados: PessoaLoteIgnorada[] = [];
  const ja = new Set<string>();
  for (const item of existentes) {
    for (const chave of chavesTelefone(item)) ja.add(chave);
  }

  for (const pessoa of pessoas) {
    const nome = texto(pessoa?.nome);
    const telefoneBruto = texto(pessoa?.telefone);
    const telefone = normalizarTelefoneAgenda(telefoneBruto);
    const rotulo = telefone || telefoneBruto.replace(/\D/g, '') || '';
    if (!nome) {
      ignorados.push({ nome: '', telefone: rotulo, motivo: 'Informe o nome.' });
      continue;
    }
    if (!telefone) {
      ignorados.push({ nome, telefone: rotulo, motivo: 'Telefone inválido. Use DDI + DDD + número.' });
      continue;
    }
    if (chavesTelefone(telefone).some((chave) => ja.has(chave))) {
      ignorados.push({ nome, telefone, motivo: 'já autorizado' });
      continue;
    }
    for (const chave of chavesTelefone(telefone)) ja.add(chave);
    criar.push({
      nome: nome.slice(0, 160),
      telefone,
      podeEnviarPlanilha: pessoa?.podeEnviarPlanilha === true,
      podePedirRelatorio: pessoa?.podePedirRelatorio === true,
    });
  }

  return { criar, ignorados };
}

export async function executarLote(opts: {
  role?: string;
  contractIdUsuario?: string | null;
  contractId: string;
  body: unknown;
  lerExistentes: () => Promise<Iterable<string>>;
  salvar: (pessoa: PessoaLotePronta) => Promise<{ id: string }>;
  log?: (linha: string) => void;
}): Promise<{
  status: number;
  body: { criados: Array<PessoaLotePronta & { id: string }>; ignorados: PessoaLoteIgnorada[] } | { error: string };
}> {
  const acesso = acessoAgendaContrato(opts.role, opts.contractIdUsuario, opts.contractId);
  if (!acesso.ok) return { status: acesso.status, body: { error: acesso.error } };
  if (!opts.contractId) return { status: 400, body: { error: 'Informe o contrato.' } };
  const pessoas = lerPessoas(opts.body);
  if (!pessoas || pessoas.length === 0) {
    return { status: 400, body: { error: 'Informe ao menos uma pessoa.' } };
  }

  const plano = separarLote(pessoas, await opts.lerExistentes());
  const criados: Array<PessoaLotePronta & { id: string }> = [];
  const ignorados = [...plano.ignorados];
  for (const pessoa of plano.criar) {
    try {
      const salvo = await opts.salvar(pessoa);
      criados.push({ ...pessoa, id: salvo.id });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : '';
      const duplicado = /23505|duplicate|já está/i.test(msg);
      if (duplicado) {
        ignorados.push({ nome: pessoa.nome, telefone: pessoa.telefone, motivo: 'já autorizado' });
        continue;
      }
      opts.log?.(redigirTelefones(`[Wuzapi] falha ao autorizar em lote: ${redigirTelefones(msg || 'falha')}`));
      return { status: 500, body: { error: 'Erro ao autorizar as pessoas' } };
    }
  }
  opts.log?.(redigirTelefones(linhaLogLote(criados.length, ignorados.length)));
  return { status: 201, body: { criados, ignorados } };
}
