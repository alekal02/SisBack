import wuzapiService from './WuzapiService';

let avisoDeslogado = false;

export function decidirAcaoVigia(sessao: { connected: boolean; loggedIn: boolean }): 'reconectar' | 'aguardar_qr' | 'ok' {
  if (!sessao.connected) return 'reconectar';
  if (!sessao.loggedIn) return 'aguardar_qr';
  return 'ok';
}

/**
 * A sessão do WhatsApp cai quando a WuzAPI reinicia ou o celular oscila.
 * Sem este ciclo o webhook fica mudo até alguém escanear o QR de novo.
 */
export function iniciarVigiaSessaoWhatsapp(): void {
  if (!wuzapiService.isConfigured) return;
  const intervalo = parseInt(process.env.WUZAPI_VIGIA_MS || '60000', 10);
  const tick = async () => {
    try {
      const sessao = await wuzapiService.getStatus();
      const acao = decidirAcaoVigia(sessao);
      if (acao === 'reconectar') {
        console.warn('[WuzapiVigia] Sessão desconectada. Reabrindo com o pareamento salvo.');
        await wuzapiService.conectarSessao();
        avisoDeslogado = false;
        return;
      }
      if (acao === 'aguardar_qr') {
        if (!avisoDeslogado) {
          avisoDeslogado = true;
          console.warn('[WuzapiVigia] WhatsApp sem login. É preciso escanear o QR na tela de conexão.');
        }
        return;
      }
      avisoDeslogado = false;
    } catch (err) {
      console.warn('[WuzapiVigia] Falha ao verificar a sessão:', (err as Error)?.message || err);
    }
  };
  setInterval(() => {
    void tick();
  }, intervalo);
  console.log(`[WuzapiVigia] Sessão verificada a cada ${Math.round(intervalo / 1000)}s`);
}
