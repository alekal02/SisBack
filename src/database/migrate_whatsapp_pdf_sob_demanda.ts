/**
 * 4.0.0 — relatórios WhatsApp só sob demanda.
 * Desliga o PDF automático nos grupos já mapeados (o default novo já é false).
 */
import AppDataSource from './data-source';

async function colunaExiste(tabela: string, coluna: string): Promise<boolean> {
  const rows = await AppDataSource.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
     LIMIT 1`,
    [tabela, coluna],
  );
  return Array.isArray(rows) && rows.length > 0;
}

export async function migrateWhatsappPdfSobDemanda(): Promise<void> {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  const alvos: Array<{ tabela: string; coluna: string }> = [
    { tabela: 'whatsapp_grupo_mapa', coluna: 'responderPdf' },
    { tabela: 'whatsapp_grupo_roteamento', coluna: 'responderPdf' },
  ];

  for (const { tabela, coluna } of alvos) {
    if (!(await colunaExiste(tabela, coluna))) continue;
    const result = await AppDataSource.query(
      `UPDATE "${tabela}" SET "${coluna}" = false WHERE "${coluna}" = true RETURNING 1`,
    );
    const n = Array.isArray(result) ? result.length : 0;
    if (n > 0) {
      console.log(`[4.0.0] ${tabela}: ${n} grupo(s) com PDF automático desligado`);
    }
  }
}
