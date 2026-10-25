/**
 * Restaura PESO 1–5 e PESO TOTAL a partir das células da planilha (JSON).
 * A revalidação copiava o id da linha para PESO 2–5 vazios e inflava o total do ciclo.
 * Idempotente. Roda no startup (index.ts).
 */
import 'reflect-metadata';
import AppDataSource from './data-source';

export async function migratePesoCelulasPlanilha(): Promise<void> {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  const jsonNum = (chave: string) => `
    COALESCE(
      CASE
        WHEN NULLIF(TRIM(jsonb_extract_path_text(c.dados, '${chave}')), '') ~ '^[+-]?[0-9]+([.][0-9]+)?$'
        THEN NULLIF(TRIM(jsonb_extract_path_text(c.dados, '${chave}')), '')::double precision
        ELSE NULL
      END,
      0
    )`;

  const result = await AppDataSource.query(`
    WITH src AS (
      SELECT
        c.id,
        ${jsonNum('PESO 1')} AS j1,
        ${jsonNum('PESO 2')} AS j2,
        ${jsonNum('PESO 3')} AS j3,
        ${jsonNum('PESO 4')} AS j4,
        ${jsonNum('PESO 5')} AS j5,
        ${jsonNum('PESO TOTAL')} AS jtot,
        ${jsonNum('CONTADOR DE VIAGENS')} AS jviag
      FROM coleta_dados c
      WHERE c.dados IS NOT NULL
    ),
    calc AS (
      SELECT
        id, j1, j2, j3, j4, j5, jtot, jviag,
        (j1 + j2 + j3 + j4 + j5) AS soma,
        CASE
          WHEN (j1 + j2 + j3 + j4 + j5) > 0
               AND jtot > (j1 + j2 + j3 + j4 + j5) * 1.02
          THEN (j1 + j2 + j3 + j4 + j5)
          WHEN jtot > 0 THEN jtot
          ELSE (j1 + j2 + j3 + j4 + j5)
        END AS peso_ok
      FROM src
    )
    UPDATE coleta_dados c
    SET
      "peso1" = NULLIF(calc.j1, 0),
      "peso2" = NULLIF(calc.j2, 0),
      "peso3" = NULLIF(calc.j3, 0),
      "peso4" = NULLIF(calc.j4, 0),
      "peso5" = NULLIF(calc.j5, 0),
      "pesoTotal" = NULLIF(calc.peso_ok, 0),
      "numeroViagens" = CASE WHEN calc.jviag > 0 THEN calc.jviag::int ELSE c."numeroViagens" END,
      "viagensPorRota" = CASE WHEN calc.jviag > 0 THEN calc.jviag::int ELSE c."viagensPorRota" END,
      dados = CASE
        WHEN calc.peso_ok > 0 THEN
          jsonb_set(
            jsonb_set(c.dados, '{PESO TOTAL}', to_jsonb(calc.peso_ok), true),
            '{pesoTotal}',
            to_jsonb(calc.peso_ok),
            true
          )
        ELSE c.dados
      END
    FROM calc
    WHERE c.id = calc.id
      AND (
        calc.j2 <> COALESCE(c."peso2", 0)
        OR calc.j3 <> COALESCE(c."peso3", 0)
        OR calc.j4 <> COALESCE(c."peso4", 0)
        OR calc.j5 <> COALESCE(c."peso5", 0)
        OR ABS(COALESCE(c."pesoTotal", 0) - calc.peso_ok) > 0.5
      )
  `);

  const n = Array.isArray(result) ? result.length : (result?.[1] ?? result);
  if (n && Number(n) > 0) {
    console.log(`[migratePesoCelulasPlanilha] ✅ ${n} linhas de coleta restauradas (PESO da planilha)`);
  } else {
    console.log('[migratePesoCelulasPlanilha] Nenhuma linha inflada para restaurar');
  }
}
