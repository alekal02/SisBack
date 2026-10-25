/**
 * Migration: corrige KPI "Total Coletores na Equipe"
 * de SUM(Nº DE COLETORES) para COLETORES_UNICOS().
 *
 * Executada automaticamente no startup (index.ts).
 */
import 'reflect-metadata';
import AppDataSource from './data-source';
import { Servico } from '../entities/Servico';

const LABEL_ALVO = 'Total Coletores na Equipe';
const DESCRICAO_CORRETA =
  'Coletores únicos (COLETOR 01–04): mesma pessoa em várias viagens conta apenas uma vez';

const PADROES_ERRADOS: RegExp[] = [
  /SUM\s*\(\s*N[º°]?\s*DE\s*COLETORES\s*\)/i,
  /AVG\s*\(\s*N[º°]?\s*DE\s*COLETORES\s*\)/i,
  /ROUND\s*\(\s*AVG\s*\(\s*N[º°]?\s*DE\s*COLETORES\s*\)/i,
  /DIVIDE\s*\([^)]*SUM\s*\(\s*N[º°]?\s*DE\s*COLETORES\s*\)/i,
];

function expressaoColetoresEquipeErrada(expressao: string, label: string, nome: string): boolean {
  const lbl = (label || nome || '').trim();
  if (lbl === LABEL_ALVO || lbl.includes('Coletores na Equipe')) {
    if (expressao.trim() === 'COLETORES_UNICOS()') return false;
    return true;
  }
  return PADROES_ERRADOS.some(re => re.test(expressao));
}

function corrigirExpressaoColetoresEquipe(
  kpi: { nome?: string; label?: string; expressao?: string; formula?: string; descricao?: string },
): { expressao: string; descricao: string } | null {
  const label = (kpi.label || kpi.nome || '') as string;
  const nome = (kpi.nome || '') as string;
  const expr = (kpi.expressao || kpi.formula || '').trim();

  if (!expressaoColetoresEquipeErrada(expr, label, nome)) return null;

  return {
    expressao: 'COLETORES_UNICOS()',
    descricao: DESCRICAO_CORRETA,
  };
}

export async function migrateColetoresEquipeKpi(): Promise<void> {
  const repo = AppDataSource.getRepository(Servico);
  const servicos = await repo.find();
  let atualizados = 0;

  for (const servico of servicos) {
    const kpis: any[] = servico.configDashboard?.kpis || [];
    if (kpis.length === 0) continue;

    let mudou = false;
    const kpisNovos = kpis.map((k) => {
      const patch = corrigirExpressaoColetoresEquipe(k);
      if (!patch) return k;
      mudou = true;
      return { ...k, expressao: patch.expressao, descricao: patch.descricao };
    });

    if (mudou) {
      servico.configDashboard = { ...(servico.configDashboard || {}), kpis: kpisNovos };
      await repo.save(servico);
      atualizados++;
    }
  }

  if (atualizados > 0) {
    console.log(`[migrateColetoresEquipeKpi] ✅ ${atualizados} serviço(s) corrigido(s)`);
  }
}

if (require.main === module) {
  (async () => {
    await AppDataSource.initialize();
    await migrateColetoresEquipeKpi();
    await AppDataSource.destroy();
  })().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
