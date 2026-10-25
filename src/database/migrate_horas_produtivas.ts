/**
 * Migration: Corrigir expressões de Horas Produtivas
 * 
 * Substitui o padrão antigo SUM(HORA CHEGADA BASE) - SUM(HORA SAIDA BASE)
 * pela nova função HORAS_PRODUTIVAS() em TODOS os serviços existentes.
 * 
 * Executada automaticamente no startup do servidor (index.ts)
 * Pode ser executada manualmente com:
 *   npx ts-node src/database/migrate_horas_produtivas.ts
 */
import 'reflect-metadata';
import AppDataSource from './data-source';

const PADROES_ANTIGOS = [
  'SUM(HORA CHEGADA BASE) - SUM(HORA SAIDA BASE)',
  'SUM(HORA CHEGADA BASE) - SUM(HORA SÁIDA BASE)',
  'SUM(HORA CHEGADA BASE)-SUM(HORA SAIDA BASE)',
  'SUM(HORA CHEGADA BASE)-SUM(HORA SÁIDA BASE)',
];

/**
 * Verifica se uma expressão contém o padrão antigo problemático
 */
function temPadraoAntigo(expressao: string): boolean {
  const normalizado = expressao.replace(/\s+/g, ' ').toUpperCase();
  return PADROES_ANTIGOS.some(p => 
    normalizado.includes(p.toUpperCase().replace(/\s+/g, ' '))
  );
}

/** Receita/Hora: remove divisão por COUNT(*) — deve usar horas totais, não média por viagem */
const PADRAO_RECEITA_HORA_ERRADO =
  /DIVIDE\s*\(\s*HORAS_PRODUTIVAS\s*\([^)]+\)\s*,\s*COUNT\s*\(\s*\*\s*\)\s*\)/i;

function temFormulaReceitaHoraErrada(expressao: string): boolean {
  return PADRAO_RECEITA_HORA_ERRADO.test(expressao);
}

function corrigirFormulaReceitaHora(expressao: string): string {
  return expressao.replace(
    new RegExp(PADRAO_RECEITA_HORA_ERRADO.source, 'gi'),
    (match) => {
      const inner = match.match(/HORAS_PRODUTIVAS\s*\([^)]+\)/i);
      return inner ? inner[0] : match;
    }
  );
}

/**
 * Corrige uma expressão substituindo o padrão antigo pelo novo
 */
function corrigirExpressao(expressao: string): string {
  let resultado = expressao;

  // Caso 0: Receita por Hora dividindo por média (COUNT) em vez do total de horas
  if (temFormulaReceitaHoraErrada(resultado)) {
    resultado = corrigirFormulaReceitaHora(resultado);
  }

  // Caso 1: Expressão simples de Horas Produtivas
  // SUM(HORA CHEGADA BASE) - SUM(HORA SAIDA BASE) → HORAS_PRODUTIVAS(...)
  if (/SUM\(HORA CHEGADA BASE\)\s*-\s*SUM\(HORA S[AÁ]IDA BASE\)/i.test(resultado)) {
    // Receita por Hora: faturamento ÷ horas produtivas totais
    if (/DIVIDE\([^)]+,\s*\(SUM\(HORA CHEGADA BASE\)\s*-\s*SUM\(HORA S[AÁ]IDA BASE\)\)\)/i.test(resultado)) {
      resultado = resultado.replace(
        /\(SUM\(HORA CHEGADA BASE\)\s*-\s*SUM\(HORA S[AÁ]IDA BASE\)\)/gi,
        'HORAS_PRODUTIVAS(HORA SAIDA BASE, HORA CHEGADA BASE)'
      );
    } else {
      resultado = resultado.replace(
        /SUM\(HORA CHEGADA BASE\)\s*-\s*SUM\(HORA S[AÁ]IDA BASE\)/gi,
        'HORAS_PRODUTIVAS(HORA SAIDA BASE, HORA CHEGADA BASE)'
      );
    }
  }

  // Caso 2: Horas nas Rotas com múltiplas subtrações
  if (/SUM\(HORA SAÍDA ROTA \d+\)\s*-\s*SUM\(HORA CHEGADA ROTA \d+\)/i.test(resultado)) {
    resultado = resultado.replace(
      /SUM\(HORA SAÍDA ROTA (\d+)\)\s*-\s*SUM\(HORA CHEGADA ROTA (\d+)\)/gi,
      (_, num1, num2) => `HORAS_PRODUTIVAS(HORA CHEGADA ROTA ${num2}, HORA SAÍDA ROTA ${num1})`
    );
  }

  // Caso 3: Expressão que multiplica o resultado por 24 (já em serial)
  if (resultado.includes('* 24') && resultado.includes('HORAS_PRODUTIVAS')) {
    // Remove a multiplicação por 24, pois HORAS_PRODUTIVAS já retorna em horas
    resultado = resultado.replace(/\s*\*\s*24\s*/g, '');
  }

  return resultado;
}

/**
 * Executa a migration em todos os serviços do banco
 */
export async function migrateHorasProdutivas(): Promise<number> {
  const queryRunner = AppDataSource.createQueryRunner();

  try {
    console.log('[migrateHorasProdutivas] 🔍 Buscando serviços com expressões antigas...');

    const servicos = await queryRunner.query(
      `SELECT id, nome, "configDashboard" FROM servicos WHERE "configDashboard" IS NOT NULL`
    );

    let corrigidos = 0;

    for (const servico of servicos) {
      const config = servico.configDashboard;
      if (!config || !config.kpis || !Array.isArray(config.kpis)) continue;

      let modificou = false;

      for (const kpi of config.kpis) {
        if (!kpi.expressao || typeof kpi.expressao !== 'string') continue;

        const precisaCorrigir = temPadraoAntigo(kpi.expressao) || temFormulaReceitaHoraErrada(kpi.expressao);
        if (!precisaCorrigir) continue;

        const novaExpressao = corrigirExpressao(kpi.expressao);
        if (novaExpressao !== kpi.expressao) {
          console.log(`  📝 "${servico.nome}" — KPI "${kpi.label || kpi.nome}": corrigido`);
          kpi.expressao = novaExpressao;
          modificou = true;
        }
      }

      if (modificou) {
        await queryRunner.query(
          `UPDATE servicos SET "configDashboard" = $1::jsonb WHERE id = $2`,
          [JSON.stringify(config), servico.id]
        );
        corrigidos++;
      }
    }

    if (corrigidos > 0) {
      console.log(`[migrateHorasProdutivas] ✅ ${corrigidos} serviços corrigidos com sucesso!`);
    } else {
      console.log('[migrateHorasProdutivas] ✅ Nenhum serviço precisou de correção.');
    }

    return corrigidos;
  } catch (err) {
    console.error('[migrateHorasProdutivas] ❌ Erro:', err);
    return 0;
  } finally {
    await queryRunner.release();
  }
}

// Execução direta (quando chamado via npx ts-node)
if (require.main === module) {
  (async () => {
    await AppDataSource.initialize();
    await migrateHorasProdutivas();
    await AppDataSource.destroy();
  })();
}
