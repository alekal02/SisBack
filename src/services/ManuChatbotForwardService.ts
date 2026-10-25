/**
 * Encaminha comandos de manutenção para o ManuControl.
 * O webhook da WuzAPI continua no Sistemma; o Manu recebe só o que for comando dele.
 */
import axios from 'axios';

function normalizarTexto(raw: string): string {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function pareceComandoManu(texto: string): boolean {
  const norm = normalizarTexto(texto);
  if (!norm) return false;
  if (/^[🔧✅📊🤖❌📄]/.test(texto.trim())) return false;
  return (
    /^(manutencao|manutencoes|os|relatorio|relatorios|report)\b/.test(norm)
    || norm.includes('manutencao')
    || norm.includes('os aberta')
    || norm.includes('equipamentos parado')
    || /\bcodigo\b/.test(norm)
    || /\bidentificacao\b/.test(norm)
    || /\bpatrimonio\b/.test(norm)
    || /^[a-z0-9][a-z0-9\-_.\/]{1,40}$/i.test(norm)
    || (norm.split(/\s+/).length <= 8 && /[0-9]/.test(norm))
  );
}

export async function encaminharComandoManu(opts: {
  grupoJid: string;
  texto: string;
  sender?: string;
}): Promise<{ processado: boolean; motivo?: string }> {
  const url = (process.env.MANU_WEBHOOK_URL || '').trim();
  if (!url) {
    return { processado: false, motivo: 'MANU_WEBHOOK_URL não configurado' };
  }
  if (!pareceComandoManu(opts.texto)) {
    return { processado: false, motivo: 'Não é comando Manu' };
  }

  const secret = (
    process.env.MANU_CHATBOT_SECRET
    || process.env.WUZAPI_WEBHOOK_SECRET
    || ''
  ).trim();

  try {
    const { data } = await axios.post(
      url,
      {
        grupoJid: opts.grupoJid,
        texto: opts.texto,
        sender: opts.sender || '',
      },
      {
        timeout: 90000,
        headers: {
          'Content-Type': 'application/json',
          ...(secret ? { 'X-Webhook-Secret': secret } : {}),
        },
      },
    );
    return {
      processado: !!data?.processado,
      motivo: data?.motivo || 'manu',
    };
  } catch (err: any) {
    console.warn('[ManuChatbot] Falha ao encaminhar:', err?.message || err);
    return { processado: false, motivo: err?.message || 'Falha ao chamar Manu' };
  }
}
