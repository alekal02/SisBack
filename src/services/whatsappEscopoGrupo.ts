import AppDataSource, { getControlDataSource, getCurrentTenantDb, isMultiTenant } from '../database/data-source';
import { WhatsappGrupoMapa } from '../entities/WhatsappGrupoMapa';
import { WhatsappGrupoRoteamento } from '../entities/WhatsappGrupoRoteamento';

export type DecisaoEscopoWhatsapp = 'privado' | 'grupo_fora' | 'autorizado';

export type RecebimentoWhatsapp = {
  em: string;
  grupoJid: string;
  nomeGrupo: string | null;
  tipo: 'relatorio' | 'planilha' | 'ignorado';
  resumo: string;
};

const CACHE_MS = 15000;
const MAX_RECEBIMENTOS = 30;

const caches = new Map<string, { em: number; jids: Set<string> }>();
const recebimentos: RecebimentoWhatsapp[] = [];

function chaveCache(): string {
  return getCurrentTenantDb() || (isMultiTenant() ? '__control__' : '__unico__');
}

/** Conversa privada e grupo não mapeado são descartados antes de gravar ou responder. */
export function decidirEscopoWhatsapp(opts: {
  isGroup: boolean;
  grupoJid: string;
  autorizados: ReadonlySet<string>;
}): DecisaoEscopoWhatsapp {
  const jid = String(opts.grupoJid || '').trim();
  if (!opts.isGroup || !jid.endsWith('@g.us')) return 'privado';
  if (!opts.autorizados.has(jid)) return 'grupo_fora';
  return 'autorizado';
}

export function invalidarGruposAutorizados(): void {
  caches.clear();
}

export function registrarRecebimentoWhatsapp(item: Omit<RecebimentoWhatsapp, 'em'>): void {
  recebimentos.unshift({ ...item, em: new Date().toISOString() });
  if (recebimentos.length > MAX_RECEBIMENTOS) recebimentos.length = MAX_RECEBIMENTOS;
}

export function listarRecebimentosWhatsapp(): RecebimentoWhatsapp[] {
  return recebimentos.slice();
}

export async function jidsGruposAutorizados(): Promise<Set<string>> {
  const chave = chaveCache();
  const atual = caches.get(chave);
  if (atual && Date.now() - atual.em < CACHE_MS) return atual.jids;

  const jids = new Set<string>();
  const noControl = isMultiTenant() && !getCurrentTenantDb();
  if (noControl) {
    const rotas = await getControlDataSource().getRepository(WhatsappGrupoRoteamento).find({
      where: { ativo: true },
      select: ['grupoJid'],
    });
    for (const rota of rotas) {
      if (rota.grupoJid) jids.add(rota.grupoJid);
    }
  } else {
    const mapas = await AppDataSource.getRepository(WhatsappGrupoMapa).find({
      where: { ativo: true },
      select: ['grupoJid'],
    });
    for (const mapa of mapas) {
      if (mapa.grupoJid) jids.add(mapa.grupoJid);
    }
  }

  caches.set(chave, { em: Date.now(), jids });
  return jids;
}

export async function decidirEscopoDaMensagem(opts: {
  isGroup: boolean;
  grupoJid: string;
}): Promise<DecisaoEscopoWhatsapp> {
  if (!opts.isGroup || !String(opts.grupoJid || '').endsWith('@g.us')) return 'privado';
  const autorizados = await jidsGruposAutorizados();
  return decidirEscopoWhatsapp({ ...opts, autorizados });
}
