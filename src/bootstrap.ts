import fs from 'fs';
import path from 'path';
import type { Express } from 'express';
import AppDataSource, { isMultiTenant, runWithTenant } from './database/data-source';
import { criarUsuariosIniciaisSeNecessario } from './database/seed';
import { seedKpisUniversais } from './database/seedKpiUniversal';
import { seedKpisUniversaisExtra } from './database/seedKpiUniversalExtra';
import { seedKpisUniversaisReceita } from './database/seedKpiUniversalReceita';
import { seedGraficosPadrao } from './database/seedGraficosPadrao';
import { migrateHorasProdutivas } from './database/migrate_horas_produtivas';
import { migrateColetoresEquipeKpi } from './database/migrate_coletores_equipe_kpi';
import { migrateMediaHorasViagemKpi } from './database/migrate_media_horas_viagem_kpi';
import { migratePesoCelulasPlanilha } from './database/migrate_peso_celulas_planilha';
import { migrateWhatsappPdfSobDemanda } from './database/migrate_whatsapp_pdf_sob_demanda';
import { migrateArquivosStorage } from './database/migrate_arquivos_storage';
import { migrateImportacaoDiaHash } from './database/migrate_importacao_dia_hash';
import { sincronizarKpisUniversaisBiblioteca } from './database/sincronizarKpisUniversaisBiblioteca';
import { iniciarAgendamentoWarmupExecutivo } from './services/executivoCacheWarmupService';
import { recuperarMensagensWhatsappPendentes } from './services/WhatsappPlanilhaPipelineService';
import wuzapiService from './services/WuzapiService';
import { urlSemSegredoWebhook } from './services/wuzapiWebhookAuth';
import { iniciarVigiaSessaoWhatsapp } from './services/WhatsappSessaoVigia';

/** A sessão já conectada guarda a URL antiga. Sem isso o chatbot fica mudo depois do deploy. */
async function garantirWebhookWuzapi(): Promise<void> {
  if (!wuzapiService.isConfigured) return;
  if (!wuzapiService.webhookUrl) {
    console.warn('[Wuzapi] WUZAPI_WEBHOOK_URL ausente. O webhook da sessão não foi alterado.');
    return;
  }
  try {
    await wuzapiService.configurarWebhook(
      wuzapiService.webhookUrl,
      ['Message', 'Connected', 'QR'],
    );
    console.log(`[Wuzapi] Webhook da sessão: ${urlSemSegredoWebhook(wuzapiService.webhookUrl)}`);
  } catch (err) {
    console.warn('[Wuzapi] Não foi possível renovar o webhook:', (err as Error)?.message || err);
  }
}

/** Pastas relativas ao processo. Recria se alguém apagar no meio da execução. */
export function garantirPastasDisco(): void {
  const planilhas = process.env.PLANILHAS_BACKUP_HOST_DIR || 'planilhas-ciclo';
  const cache = process.env.DASHBOARD_CACHE_DIR
    || path.join(process.cwd(), 'uploads', 'dashboard-cache');
  const inbox = process.env.WHATSAPP_INBOX_DIR
    || path.join(process.cwd(), 'whatsapp-inbox');
  const pastas = [
    path.isAbsolute(planilhas) ? planilhas : path.resolve(process.cwd(), planilhas),
    path.isAbsolute(cache) ? cache : path.resolve(process.cwd(), cache),
    path.isAbsolute(inbox) ? inbox : path.resolve(process.cwd(), inbox),
    path.join(process.cwd(), 'uploads'),
  ];
  for (const pasta of pastas) {
    try {
      fs.mkdirSync(pasta, { recursive: true });
    } catch (err) {
      console.warn(`[disco] Não foi possível criar ${pasta}:`, (err as Error)?.message || err);
    }
  }
}

/** Só depois do servidor responder. Retomar planilha no boot derrubava o processo antes do healthcheck. */
function agendarRetomadaWhatsapp(): void {
  const espera = parseInt(process.env.WHATSAPP_RETOMADA_MS || '20000', 10);
  setTimeout(() => {
    void (async () => {
      try {
        if (isMultiTenant()) {
          const { contratosComBanco } = await import('./services/tenantFanout');
          const bancos = await contratosComBanco();
          for (const tenant of bancos) {
            await runWithTenant(tenant.databaseName, () => recuperarMensagensWhatsappPendentes());
          }
        } else {
          await recuperarMensagensWhatsappPendentes();
        }
      } catch (err) {
        console.error('[WhatsappLedger] Retomada adiada falhou:', (err as Error)?.message || err);
      }
    })();
  }, espera);
}

export async function prepararBancoAtivo(): Promise<void> {
  const skipStartup = process.env.SKIP_STARTUP_SEED === 'true';

  if (!skipStartup) {
    try {
      await criarUsuariosIniciaisSeNecessario();
    } catch (err) {
      console.error('⚠️ Erro ao criar usuários iniciais:', err);
    }
    try {
      await seedKpisUniversais();
    } catch (err) {
      console.error('⚠️ Erro ao seed KPIs universais:', err);
    }
    try {
      await seedKpisUniversaisExtra();
    } catch (err) {
      console.error('⚠️ Erro ao seed KPIs universais extra:', err);
    }
    try {
      await seedKpisUniversaisReceita();
    } catch (err) {
      console.error('⚠️ Erro ao seed KPIs universais receita:', err);
    }
    if (process.env.SYNC_KPIS_UNIVERSAIS !== 'false') {
      try {
        await sincronizarKpisUniversaisBiblioteca();
      } catch (err) {
        console.error('⚠️ Erro ao sincronizar biblioteca de KPIs universais:', err);
      }
    }
    try {
      await seedGraficosPadrao();
    } catch (err) {
      console.error('⚠️ Erro ao seed gráficos padrão:', err);
    }
  } else {
    console.log('⏭️ SKIP_STARTUP_SEED=true — seeds de biblioteca ignorados');
  }

  if (process.env.SKIP_STARTUP_MIGRATIONS !== 'true') {
    try {
      await migrateHorasProdutivas();
    } catch (err) {
      console.error('⚠️ Erro na migration de horas produtivas:', err);
    }
    try {
      await migrateColetoresEquipeKpi();
    } catch (err) {
      console.error('⚠️ Erro na migration de coletores na equipe:', err);
    }
    try {
      await migrateMediaHorasViagemKpi();
    } catch (err) {
      console.error('⚠️ Erro na migration de média horas/viagem:', err);
    }
    try {
      await migratePesoCelulasPlanilha();
    } catch (err) {
      console.error('⚠️ Erro na migration de peso das células da planilha:', err);
    }
    try {
      await migrateWhatsappPdfSobDemanda();
    } catch (err) {
      console.error('⚠️ Erro na migration de PDF WhatsApp sob demanda:', err);
    }
    try {
      await migrateArquivosStorage();
    } catch (err) {
      console.error('⚠️ Erro na migration de arquivos_storage:', err);
    }
    try {
      await migrateImportacaoDiaHash();
    } catch (err) {
      console.error('⚠️ Erro na migration de importacao_dia_hash:', err);
    }
  } else {
    console.log('⏭️ SKIP_STARTUP_MIGRATIONS=true — migrations automáticas ignoradas');
  }
}

async function aquecerAplicacao(): Promise<void> {
  try {
    await AppDataSource.initialize();
    console.log('✅ Banco de dados conectado com sucesso');

    if (process.env.NODE_ENV === 'production' && !String(process.env.WUZAPI_WEBHOOK_SECRET || '').trim()) {
      console.warn(
        '[WuzapiWebhook] Produção sem WUZAPI_WEBHOOK_SECRET. O webhook continua aceitando chamadas sem segredo. '
        + 'Definir o segredo sem a WuzAPI enviá-lo interrompe o chatbot até a sessão ser reconectada.',
      );
    }
    const hmacConfigurada = Boolean(
      String(process.env.WUZAPI_WEBHOOK_HMAC_KEY || process.env.WUZAPI_GLOBAL_HMAC_KEY || '').trim(),
    );
    console.log(
      `[WuzapiWebhook] HMAC obrigatório=${process.env.WUZAPI_WEBHOOK_ENFORCE === 'true'} chaveConfigurada=${hmacConfigurada}`,
    );

    if (isMultiTenant()) {
      const { contratosComBanco } = await import('./services/tenantFanout');
      const bancos = await contratosComBanco();
      console.log(`🗂️ Modo um-banco-por-contrato — ${bancos.length} contrato(s) para preparar`);
      for (const tenant of bancos) {
        try {
          await runWithTenant(tenant.databaseName, async () => {
            await prepararBancoAtivo();
          });
          console.log(`   ✔ ${tenant.numeroContrato} (${tenant.databaseName})`);
        } catch (err) {
          console.error(`   ✖ ${tenant.numeroContrato} (${tenant.databaseName}):`, err);
        }
      }
    } else {
      await prepararBancoAtivo();
    }

    iniciarAgendamentoWarmupExecutivo();
    void garantirWebhookWuzapi();
    iniciarVigiaSessaoWhatsapp();
    agendarRetomadaWhatsapp();
  } catch (error) {
    console.error('❌ Erro ao conectar ao banco de dados:', error);
    process.exit(1);
  }
}

export async function iniciarAplicacao(app: Express, port: number): Promise<void> {
  garantirPastasDisco();
  const servidor = app.listen(port, '0.0.0.0', () => {
    console.log(`✅ Servidor em http://0.0.0.0:${port} (health em /health, aquecimento do banco em seguida)`);
  });
  servidor.on('error', (erro) => {
    console.error('❌ Falha ao escutar a porta:', erro);
    process.exit(1);
  });
  void aquecerAplicacao();
}
