/**
 * Migration: corrige KPI "Media de Horas por Viagem" — deve dividir horas totais pelo nº de viagens.
 */
import AppDataSource from './data-source';
import { Servico } from '../entities/Servico';

const FORMULA_CORRETA =
  'DIVIDE(HORAS_PRODUTIVAS(HORA SAIDA BASE, HORA CHEGADA BASE), VIAGENS_POR_ROTA())';
const DESCRICAO_CORRETA = 'Média de horas em operação por viagem';
const FORMULA_HORAS_TOTAIS = 'HORAS_PRODUTIVAS(HORA SAIDA BASE, HORA CHEGADA BASE)';

function ehMediaHorasViagem(kpi: { nome?: string; label?: string }): boolean {
  const t = `${kpi.label || ''} ${kpi.nome || ''}`.toUpperCase();
  return t.includes('MEDIA') && t.includes('HORAS') && t.includes('VIAGEM');
}

function ehHorasProdutivasTotal(kpi: { nome?: string; label?: string }): boolean {
  const t = `${kpi.label || ''} ${kpi.nome || ''}`.toUpperCase();
  return t.includes('HORAS PRODUTIVAS') && !t.includes('MEDIA');
}

export async function migrateMediaHorasViagemKpi(): Promise<void> {
  const repo = AppDataSource.getRepository(Servico);
  const servicos = await repo.find();
  let atualizados = 0;

  for (const servico of servicos) {
    const kpis: any[] = servico.configDashboard?.kpis || [];
    if (kpis.length === 0) continue;

    let mudou = false;
    const kpisNovos = kpis.map((k) => {
      const expr = (k.expressao || k.formula || '').trim();

      if (ehHorasProdutivasTotal(k) && expr !== FORMULA_HORAS_TOTAIS) {
        mudou = true;
        return { ...k, expressao: FORMULA_HORAS_TOTAIS };
      }

      if (!ehMediaHorasViagem(k)) return k;
      if (expr === FORMULA_CORRETA) return k;
      mudou = true;
      return {
        ...k,
        expressao: FORMULA_CORRETA,
        descricao: DESCRICAO_CORRETA,
      };
    });

    if (mudou) {
      servico.configDashboard = { ...(servico.configDashboard || {}), kpis: kpisNovos };
      await repo.save(servico);
      atualizados++;
    }
  }

  if (atualizados > 0) {
    console.log(`[migrateMediaHorasViagemKpi] ✅ ${atualizados} serviço(s) corrigido(s)`);
  }
}

if (require.main === module) {
  (async () => {
    await AppDataSource.initialize();
    await migrateMediaHorasViagemKpi();
    await AppDataSource.destroy();
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
