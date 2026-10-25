/**
 * Diagnóstico de dashboards — executa localmente contra o banco.
 * Uso: npm run diagnostico:dashboards
 *      npm run diagnostico:dashboards -- --contractId=UUID
 *      npm run diagnostico:dashboards -- --servicoId=UUID
 */
import 'reflect-metadata';
import dotenv from 'dotenv';
dotenv.config();

import AppDataSource from '../src/database/data-source';
import { diagnosticarDashboards } from '../src/services/diagnosticoDashboardService';

function arg(name: string): string | undefined {
  const pref = `--${name}=`;
  const found = process.argv.find(a => a.startsWith(pref));
  return found ? found.slice(pref.length) : undefined;
}

async function main() {
  await AppDataSource.initialize();
  const contractId = arg('contractId');
  const servicoId = arg('servicoId');

  console.log('═'.repeat(60));
  console.log('Diagnóstico de dashboards — Sistemma v2');
  console.log('═'.repeat(60));

  const rel = await diagnosticarDashboards({ contractId, servicoId });

  console.log(`Ambiente: TAG=${rel.ambiente.imageTag} | limite=${rel.ambiente.limiteDadosMax} linhas`);
  console.log(`Resumo: ${rel.resumo.servicos} serviço(s) | ${rel.resumo.comDadosValidos} com dados | ${rel.resumo.semDados} sem dados | ${rel.resumo.comAvisos} com avisos\n`);

  for (const s of rel.servicos) {
    const status = s.ok ? 'OK' : (s.registrosValidos === 0 ? 'SEM DADOS' : 'AVISO');
    console.log(`[${status}] ${s.contratoNome} / ${s.servicoNome} (${s.tipo})`);
    console.log(`  Uploads: ${s.uploads} | Válidos: ${s.registrosValidos} | Inválidos: ${s.registrosInvalidos}`);
    console.log(`  Período: ${s.periodoDados ? `${s.periodoDados.dataInicio} → ${s.periodoDados.dataFim}` : '—'}`);
    console.log(`  Brutos: ${s.amostraBrutos500}/${s.registrosValidos} (limite 500) | ${s.amostraBrutosLimiteMax}/${s.registrosValidos} (limite max)`);
    console.log(`  Executivo 30d: ${s.executivo30d.registrosPeriodo} reg | ${s.executivo30d.viagens} viagens | R$ ${s.executivo30d.faturamento.toFixed(2)} | ${s.executivo30d.pesoTon.toFixed(2)} t`);
    if (s.avisos.length) {
      for (const a of s.avisos) console.log(`  ⚠ ${a}`);
    }
    console.log('');
  }

  await AppDataSource.destroy();
  process.exit(rel.resumo.comAvisos > 0 || rel.resumo.semDados > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Erro:', err);
  process.exit(2);
});
