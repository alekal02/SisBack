/**
 * Liga o chatbot WhatsApp do Sistemma à Sala técnica (RelatoriosColeta.exe).
 * O painel local gera o PDF de GPS e devolve neste servidor para enviar no grupo.
 */
import axios from 'axios';
import wuzapiService from './WuzapiService';
import { extrairDataIsoComando } from './WhatsappComandoRelatorioTexto';
import { segredoWebhookConfere } from './wuzapiWebhookAuth';

function normalizarTexto(raw: string): string {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function secretSalaTecnica(): string {
  return (
    process.env.SALA_TECNICA_SECRET
    || process.env.CHATBOT_API_SECRET
    || process.env.MANU_CHATBOT_SECRET
    || process.env.WUZAPI_WEBHOOK_SECRET
    || ''
  ).trim();
}

export function urlSalaTecnica(): string {
  return (process.env.SALA_TECNICA_URL || '').trim().replace(/\/$/, '');
}

export function pareceComandoGps(texto: string): boolean {
  const norm = normalizarTexto(texto);
  if (!norm) return false;
  if (/^[🔧✅📊🤖❌📄📍]/.test(texto.trim()) && !/\bgps\b/.test(norm)) return false;
  return (
    /^(gps|rastreio|rastreamento)\b/.test(norm)
    || /^(relatorio|pdf|report)\s+(gps|rastreio|rastreamento|cobertura)\b/.test(norm)
    || /^cobertura\s+(gps|rastreio)\b/.test(norm)
    || /^sala\s*tecnica\b/.test(norm)
  );
}

export function validarSecretChatbot(header: string, query?: string): boolean {
  const esperado = secretSalaTecnica();
  if (!esperado) return false;
  const recebido = String(header || query || '').trim();
  if (!recebido) return false;
  return segredoWebhookConfere(esperado, recebido);
}

export async function dispararSalaTecnica(opts: {
  grupoJid: string;
  texto: string;
}): Promise<{ processado: boolean; motivo?: string }> {
  const base = urlSalaTecnica();
  if (!base) {
    return { processado: false, motivo: 'SALA_TECNICA_URL não configurado' };
  }
  if (!pareceComandoGps(opts.texto)) {
    return { processado: false, motivo: 'Não é comando GPS' };
  }

  const data = extrairDataIsoComando(opts.texto) || undefined;
  const secret = secretSalaTecnica();

  try {
    const { data: resp } = await axios.post(
      `${base}/api/chatbot/gerar`,
      {
        grupoJid: opts.grupoJid,
        texto: opts.texto,
        data: data || null,
      },
      {
        timeout: 20000,
        headers: {
          'Content-Type': 'application/json',
          ...(secret ? { 'X-Chatbot-Secret': secret } : {}),
        },
        validateStatus: (s) => s < 500,
      },
    );
    if (resp?.ok === false && resp?.erro) {
      return { processado: false, motivo: String(resp.erro) };
    }
    return { processado: true, motivo: data ? `gps-${data}` : 'gps-hoje' };
  } catch (err: any) {
    console.warn('[SalaTecnica] Falha ao disparar:', err?.message || err);
    return { processado: false, motivo: err?.message || 'Sala técnica inacessível' };
  }
}

export async function processarComandoGpsWhatsapp(opts: {
  grupoJid: string;
  texto: string;
}): Promise<{ processado: boolean; motivo?: string }> {
  if (!pareceComandoGps(opts.texto)) {
    return { processado: false, motivo: 'Não é comando GPS' };
  }
  if (!wuzapiService.isConfigured) {
    return { processado: false, motivo: 'WuzAPI não configurada' };
  }

  const data = extrairDataIsoComando(opts.texto);
  const rotulo = data
    ? data.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3/$2/$1')
    : 'hoje';

  if (!urlSalaTecnica()) {
    await wuzapiService.enviarTexto(
      opts.grupoJid,
      [
        '📍 *GPS / Sala técnica*',
        '',
        'O chatbot está no ar, mas o Sistemma ainda não sabe o endereço da Sala técnica.',
        'No servidor, preencha *SALA_TECNICA_URL* (ex.: http://127.0.0.1:6473).',
        'Ou gere o relatório no painel da Sala técnica, com a URL deste servidor no campo Chatbot.',
      ].join('\n'),
    );
    return { processado: true, motivo: 'gps-sem-url' };
  }

  await wuzapiService.enviarTexto(
    opts.grupoJid,
    `⏳ Pedindo o relatório GPS da Sala técnica (*${rotulo}*)…`,
  );
  const r = await dispararSalaTecnica({
    grupoJid: opts.grupoJid,
    texto: opts.texto,
  });
  if (!r.processado) {
    await wuzapiService.enviarTexto(
      opts.grupoJid,
      `❌ Não consegui falar com a Sala técnica: ${r.motivo || 'sem resposta'}.\nConfira se o *RelatoriosColeta.exe* está aberto.`,
    );
    return { processado: true, motivo: r.motivo };
  }
  await wuzapiService.enviarTexto(
    opts.grupoJid,
    '🛠️ A Sala técnica está gerando o PDF. Ele chega neste grupo quando terminar.',
  );
  return { processado: true, motivo: r.motivo };
}
