-- Auditoria somente leitura dos quantitativos históricos.
-- Não grava dado: a transação é READ ONLY.
-- Rode pela máquina Docker com auditar-quantitativos-historicos.ps1.
--
-- Regra nova (relatórios atuais):
--   roçada = Area m² | capina e pintura = Metro Linear / COMPRIMENTO
--   varrição = KM Linear | poda = Quantidade de Arvore
--   remoção e feiras = QUANTITATIVO (pontos)
-- Regra anterior do PDF de ciclo / WhatsApp (por dia, depois somada no mês):
--   capina preferia km; poda, remoção e feiras caíam na contagem de linhas;
--   pintura usava QUANTITATIVO se não houvesse metro; área aceitava QUANTITATIVO.
-- Regra anterior da tela do ciclo:
--   capina em metros, convertendo km*1000 se o metro viesse zerado;
--   remoção e feiras usavam árvore ou QUANTITATIVO, sem contar a linha.

\pset pager off
\pset format csv
\pset csv_fieldsep ';'

BEGIN READ ONLY;
SET LOCAL statement_timeout = '180s';
SET LOCAL lock_timeout = '5s';
SET LOCAL idle_in_transaction_session_timeout = '180s';
SET LOCAL work_mem = '16MB';
SET LOCAL max_parallel_workers_per_gather = 0;
SET LOCAL jit = off;

WITH nums AS (
  SELECT
    ct."numeroContrato" AS contrato,
    s.contract_id,
    s.id AS servico_id,
    s.nome AS servico,
    s.tipo,
    CASE
      WHEN s.nome ~* 'manual' THEN 'manual'
      WHEN s.nome ~* 'mecaniz' THEN 'mecanizada'
      ELSE 'generico'
    END AS classe,
    CASE
      WHEN s.tipo = 'geral' THEN 'Feiras'
      WHEN s.tipo = 'poda' THEN 'Poda'
      WHEN s.tipo = 'remocao' THEN 'Remoção de Entulho'
      WHEN s.tipo = 'pintura_meio_fio' THEN 'Pintura'
      WHEN s.tipo = 'capina' THEN 'Capina'
      WHEN s.tipo = 'varricao' AND s.nome ~* 'manual' THEN 'Varrição Manual'
      WHEN s.tipo = 'varricao' AND s.nome ~* 'mecaniz' THEN 'Varrição Mecanizada'
      WHEN s.tipo = 'varricao' THEN 'Varrição (genérica)'
      WHEN s.tipo = 'rocadeira' AND s.nome ~* 'manual' THEN 'Roçada Manual'
      WHEN s.tipo = 'rocadeira' AND s.nome ~* 'mecaniz' THEN 'Roçada Mecanizada'
      WHEN s.tipo = 'rocadeira' THEN 'Roçada (genérica)'
      ELSE s.tipo
    END AS grupo,
    c.id AS coleta_id,
    c."validoDashboard" AS valido,
    COALESCE(to_char(c."dataSaida", 'YYYY-MM-DD'), 'sem-data') AS dia,
    COALESCE(to_char(c."dataSaida", 'YYYY-MM'), 'sem-data') AS mes,
    COALESCE(
      NULLIF(btrim(c.dados->>'LOCAL'), ''),
      NULLIF(btrim(c.dados->>'BAIRRO'), ''),
      NULLIF(btrim(c.distrito), ''),
      NULLIF(btrim(c.regional), ''),
      ''
    ) AS local_txt,
    kv.area_m2, kv.area_m2_b, kv.m2, kv.area_rocada,
    kv.metro, kv.metro_b, kv.comprimento, kv.comprimento_total,
    kv.km, kv.km_b, kv.km_varrido,
    kv.arv, kv.arv_b, kv.arv_c,
    kv.qtd, kv.qtd_b,
    c."kmTotal" AS km_tipado
  FROM coleta_dados c
  JOIN planilha_uploads u ON u.id = c."planilhaUploadId"
  JOIN servicos s ON s.id = u.servico_id
  JOIN contracts ct ON ct.id = s.contract_id
  LEFT JOIN LATERAL (
    SELECT
      MAX(v) FILTER (WHERE k = 'Area m²') AS area_m2,
      MAX(v) FILTER (WHERE k = 'AREA_M2') AS area_m2_b,
      MAX(v) FILTER (WHERE k = 'M2') AS m2,
      MAX(v) FILTER (WHERE k = 'AREA_ROCADA') AS area_rocada,
      MAX(v) FILTER (WHERE k = 'Metro Linear') AS metro,
      MAX(v) FILTER (WHERE k = 'METRO_LINEAR') AS metro_b,
      MAX(v) FILTER (WHERE k = 'COMPRIMENTO') AS comprimento,
      MAX(v) FILTER (WHERE k = 'COMPRIMENTO TOTAL') AS comprimento_total,
      MAX(v) FILTER (WHERE k = 'KM Linear') AS km,
      MAX(v) FILTER (WHERE k = 'KM_LINEAR') AS km_b,
      MAX(v) FILTER (WHERE k = 'QUILOMETROS_VARRIDOS') AS km_varrido,
      MAX(v) FILTER (WHERE k = 'Quantidade de Arvore') AS arv,
      MAX(v) FILTER (WHERE k = 'QTD_ARVORE') AS arv_b,
      MAX(v) FILTER (WHERE k = 'ARVORES_PODADAS') AS arv_c,
      MAX(v) FILTER (WHERE k = 'QUANTITATIVO') AS qtd,
      MAX(v) FILTER (WHERE k = 'QUANTIDADE') AS qtd_b
    FROM (
      SELECT e.key AS k,
        CASE
          WHEN NULLIF(btrim(e.value), '') ~ '^[+-]?[0-9]+([.][0-9]+)?$'
          THEN btrim(e.value)::double precision
        END AS v
      FROM jsonb_each_text(COALESCE(c.dados, '{}'::jsonb)) e
    ) extraido
  ) kv ON true
  WHERE s.tipo IN ('rocadeira', 'capina', 'varricao', 'poda', 'pintura_meio_fio', 'remocao', 'geral')
),
linha AS (
  SELECT
    n.*,
    COALESCE(n.area_m2, n.area_m2_b, n.m2, n.area_rocada, n.qtd, n.qtd_b, 0) AS area_antiga,
    COALESCE(NULLIF(n.area_m2, 0), NULLIF(n.area_m2_b, 0), NULLIF(n.m2, 0), NULLIF(n.area_rocada, 0), 0) AS area_nova,
    COALESCE(n.metro, n.metro_b, n.comprimento, 0) AS metro_antigo,
    COALESCE(NULLIF(n.metro, 0), NULLIF(n.metro_b, 0), NULLIF(n.comprimento, 0), NULLIF(n.comprimento_total, 0), 0) AS metro_novo,
    COALESCE(n.km, n.km_b, n.km_varrido, n.km_tipado, 0) AS km_antigo,
    COALESCE(NULLIF(n.km, 0), NULLIF(n.km_b, 0), NULLIF(n.km_varrido, 0), NULLIF(n.km_tipado, 0), 0) AS km_novo,
    COALESCE(n.arv, n.arv_b, n.arv_c, 0) AS arv_antiga,
    COALESCE(NULLIF(n.arv, 0), NULLIF(n.arv_b, 0), NULLIF(n.arv_c, 0), 0) AS arv_nova,
    COALESCE(n.qtd, n.qtd_b, 0) AS qtd_antiga,
    COALESCE(NULLIF(n.qtd, 0), NULLIF(n.qtd_b, 0), 0) AS qtd_nova
  FROM nums n
),
marcada AS (
  SELECT
    l.*,
    CASE l.tipo
      WHEN 'rocadeira' THEN l.area_nova
      WHEN 'capina' THEN l.metro_novo
      WHEN 'varricao' THEN l.km_novo
      WHEN 'poda' THEN l.arv_nova
      WHEN 'pintura_meio_fio' THEN l.metro_novo
      WHEN 'remocao' THEN l.qtd_nova
      WHEN 'geral' THEN l.qtd_nova
      ELSE 0
    END AS valor_novo,
    CASE
      WHEN l.tipo = 'rocadeira' AND l.area_nova <= 0 AND l.qtd_nova > 0 THEN 'sem Area m²; QUANTITATIVO ignorado'
      WHEN l.tipo = 'capina' AND l.metro_novo <= 0 AND (l.km_novo > 0 OR l.qtd_nova > 0) THEN 'sem Metro Linear; km/QUANTITATIVO não convertidos'
      WHEN l.tipo = 'varricao' AND l.km_novo <= 0 AND (l.metro_novo > 0 OR l.qtd_nova > 0) THEN 'sem KM Linear; metro/QUANTITATIVO não convertidos'
      WHEN l.tipo = 'poda' AND l.arv_nova <= 0 AND l.qtd_nova > 0 THEN 'sem Quantidade de Arvore'
      WHEN l.tipo = 'pintura_meio_fio' AND l.metro_novo <= 0 AND l.qtd_nova > 0 THEN 'sem metragem; QUANTITATIVO não virou metro'
      WHEN l.tipo IN ('remocao', 'geral') AND l.qtd_nova <= 0 THEN 'sem QUANTITATIVO'
      ELSE NULL
    END AS ausencia_campo,
    CASE
      WHEN l.tipo = 'capina' AND l.metro_novo > 0 AND l.km_novo > 0
        AND abs((l.metro_novo / 1000.0) - l.km_novo) > GREATEST(l.km_novo, l.metro_novo / 1000.0) * 0.02
        THEN 'capina: metro e km não são o mesmo lançamento em escalas diferentes'
      WHEN l.tipo = 'varricao' AND l.km_novo > 0 AND l.qtd_nova > 0
        AND abs(l.qtd_nova - l.km_novo) > GREATEST(l.km_novo, 0.001) * 0.02
        AND abs(l.qtd_nova - (l.km_novo * 1000)) > GREATEST(l.qtd_nova, 1) * 0.02
        THEN 'varrição: QUANTITATIVO não coincide com KM Linear nem com metros'
      WHEN l.tipo = 'pintura_meio_fio' AND l.metro_novo > 0 AND l.qtd_nova > 0
        AND abs(l.qtd_nova - l.metro_novo) > 0.01
        THEN 'pintura: QUANTITATIVO diferente da metragem'
      WHEN l.tipo = 'pintura_meio_fio' AND COALESCE(l.comprimento, 0) > 0 AND COALESCE(l.comprimento_total, 0) > 0
        AND abs(l.comprimento - l.comprimento_total) > 0.01
        THEN 'pintura: COMPRIMENTO e COMPRIMENTO TOTAL diferentes; a regra usa só COMPRIMENTO'
      WHEN l.tipo = 'poda' AND l.arv_nova > 0 AND l.qtd_nova > 0 AND abs(l.arv_nova - l.qtd_nova) > 0.01
        THEN 'poda: Quantidade de Arvore diferente de QUANTITATIVO'
      WHEN l.tipo = 'rocadeira' AND l.area_nova > 0 AND l.qtd_nova > 0 AND abs(l.area_nova - l.qtd_nova) > 0.01
        THEN 'roçada: Area m² diferente de QUANTITATIVO'
      ELSE NULL
    END AS conflito
  FROM linha l
),
validas AS (
  SELECT * FROM marcada WHERE valido IS TRUE
),
dia AS (
  SELECT
    contrato, contract_id, servico_id, servico, tipo, classe, grupo, mes, dia,
    COUNT(*) AS lancamentos,
    SUM(area_antiga) AS area_antiga,
    SUM(area_nova) AS area_nova,
    SUM(metro_antigo) AS metro_antigo,
    SUM(metro_novo) AS metro_novo,
    SUM(km_antigo) AS km_antigo,
    SUM(km_novo) AS km_novo,
    SUM(arv_antiga) AS arv_antiga,
    SUM(arv_nova) AS arv_nova,
    SUM(qtd_antiga) AS qtd_antiga,
    SUM(qtd_nova) AS qtd_nova,
    COUNT(*) FILTER (WHERE ausencia_campo IS NOT NULL) AS zerados,
    COUNT(*) FILTER (WHERE conflito IS NOT NULL) AS conflitos
  FROM validas
  GROUP BY contrato, contract_id, servico_id, servico, tipo, classe, grupo, mes, dia
),
dia_regra AS (
  SELECT
    d.*,
    CASE d.tipo
      WHEN 'rocadeira' THEN d.area_nova
      WHEN 'capina' THEN d.metro_novo
      WHEN 'varricao' THEN d.km_novo
      WHEN 'poda' THEN d.arv_nova
      WHEN 'pintura_meio_fio' THEN d.metro_novo
      WHEN 'remocao' THEN d.qtd_nova
      ELSE d.qtd_nova
    END AS total_novo,
    CASE d.tipo
      WHEN 'rocadeira' THEN 'm²'
      WHEN 'capina' THEN 'm'
      WHEN 'varricao' THEN 'km'
      WHEN 'poda' THEN 'arv'
      WHEN 'pintura_meio_fio' THEN 'm'
      ELSE 'pts'
    END AS unidade_nova,
    CASE d.tipo
      WHEN 'rocadeira' THEN d.area_antiga
      WHEN 'varricao' THEN CASE WHEN d.km_antigo > 0 THEN d.km_antigo WHEN d.qtd_antiga > 0 THEN d.qtd_antiga ELSE 0 END
      WHEN 'capina' THEN CASE WHEN d.km_antigo > 0 THEN d.km_antigo WHEN d.metro_antigo > 0 THEN d.metro_antigo ELSE d.qtd_antiga END
      WHEN 'poda' THEN CASE WHEN d.arv_antiga > 0 THEN d.arv_antiga WHEN d.qtd_antiga > 0 THEN d.qtd_antiga ELSE d.lancamentos END
      WHEN 'pintura_meio_fio' THEN CASE WHEN d.metro_antigo > 0 THEN d.metro_antigo ELSE d.qtd_antiga END
      WHEN 'remocao' THEN CASE WHEN d.qtd_antiga > 0 THEN d.qtd_antiga WHEN d.arv_antiga > 0 THEN d.arv_antiga ELSE d.lancamentos END
      ELSE CASE WHEN d.qtd_antiga > 0 THEN d.qtd_antiga WHEN d.arv_antiga > 0 THEN d.arv_antiga ELSE d.lancamentos END
    END AS total_pdf,
    CASE d.tipo
      WHEN 'rocadeira' THEN 'm²'
      WHEN 'varricao' THEN 'km'
      WHEN 'capina' THEN CASE WHEN d.km_antigo > 0 THEN 'km' WHEN d.metro_antigo > 0 THEN 'm' ELSE 'qtd' END
      WHEN 'poda' THEN 'arv'
      WHEN 'pintura_meio_fio' THEN 'm'
      ELSE 'pts'
    END AS unidade_pdf,
    CASE d.tipo
      WHEN 'rocadeira' THEN d.area_antiga
      WHEN 'varricao' THEN CASE WHEN d.km_antigo > 0 THEN d.km_antigo WHEN d.metro_antigo > 0 THEN d.metro_antigo ELSE d.qtd_antiga END
      WHEN 'capina' THEN CASE WHEN d.metro_antigo > 0 THEN d.metro_antigo WHEN d.km_antigo > 0 THEN d.km_antigo * 1000 ELSE d.qtd_antiga END
      WHEN 'poda' THEN CASE WHEN d.arv_antiga > 0 THEN d.arv_antiga ELSE d.qtd_antiga END
      WHEN 'pintura_meio_fio' THEN CASE WHEN d.metro_antigo > 0 THEN d.metro_antigo WHEN d.km_antigo > 0 THEN d.km_antigo * 1000 ELSE d.qtd_antiga END
      ELSE CASE WHEN d.arv_antiga > 0 THEN d.arv_antiga ELSE d.qtd_antiga END
    END AS total_tela,
    CASE d.tipo
      WHEN 'rocadeira' THEN 'm²'
      WHEN 'varricao' THEN CASE WHEN d.km_antigo > 0 THEN 'km' WHEN d.metro_antigo > 0 THEN 'm' ELSE 'qtd' END
      WHEN 'capina' THEN 'm'
      WHEN 'poda' THEN 'arv'
      WHEN 'pintura_meio_fio' THEN 'm'
      ELSE 'arv'
    END AS unidade_tela
  FROM dia d
),
mes AS (
  SELECT
    contrato, contract_id, servico_id, servico, tipo, classe, grupo, mes,
    SUM(lancamentos) AS lancamentos,
    SUM(zerados) AS zerados,
    SUM(conflitos) AS conflitos,
    SUM(total_novo) AS total_novo,
    MAX(unidade_nova) AS unidade_nova,
    CASE WHEN COUNT(DISTINCT unidade_pdf) = 1 THEN SUM(total_pdf) END AS total_pdf,
    CASE WHEN COUNT(DISTINCT unidade_pdf) = 1 THEN MAX(unidade_pdf) ELSE 'mista' END AS unidade_pdf,
    CASE WHEN COUNT(DISTINCT unidade_tela) = 1 THEN SUM(total_tela) END AS total_tela,
    CASE WHEN COUNT(DISTINCT unidade_tela) = 1 THEN MAX(unidade_tela) ELSE 'mista' END AS unidade_tela
  FROM dia_regra
  GROUP BY contrato, contract_id, servico_id, servico, tipo, classe, grupo, mes
),
resumo AS (
  SELECT
    '1_resumo_mes' AS secao,
    m.contrato, m.servico, m.tipo, m.classe, m.mes,
    'comparacao' AS metrica,
    replace(to_char(ROUND(m.total_novo::numeric, 3), 'FM999999999999990.000'), '.', ',') AS valor,
    m.unidade_nova AS unidade,
    CASE
      WHEN m.tipo = 'capina' AND m.unidade_pdf = 'km' AND m.total_novo > 0 AND m.total_pdf IS NOT NULL
        AND abs((m.total_pdf * 1000) - m.total_novo) <= GREATEST(m.total_novo, 1) * 0.02
        THEN 'mesma_producao_unidade_diferente'
      WHEN m.tipo = 'capina' AND m.unidade_pdf = 'km' AND COALESCE(m.total_novo, 0) = 0
        AND m.total_pdf IS NOT NULL AND m.total_tela IS NOT NULL
        AND abs(m.total_tela - (m.total_pdf * 1000)) <= GREATEST(m.total_tela, 1) * 0.02
        THEN 'quantidade_em_km_sem_metro_linear'
      WHEN m.tipo = 'poda' AND m.total_novo = 0 AND m.lancamentos > 0
        AND m.total_pdf IS NOT NULL AND abs(m.total_pdf - m.lancamentos) <= 0.05
        THEN 'pdf_contou_linhas'
      WHEN m.tipo IN ('remocao', 'geral')
        AND m.unidade_tela = 'arv' AND m.unidade_nova = 'pts'
        AND m.total_tela IS NOT NULL AND m.total_pdf IS NOT NULL
        AND abs(m.total_tela - m.total_novo) <= 0.05
        AND abs(m.total_pdf - m.total_novo) <= 0.05
        THEN 'erro_comprovado_rotulo'
      WHEN m.unidade_pdf = 'mista' OR m.unidade_tela = 'mista'
        THEN 'conferir_planilha'
      WHEN m.unidade_pdf = m.unidade_nova AND m.unidade_tela = m.unidade_nova
        AND abs(m.total_pdf - m.total_novo) <= 0.05 AND abs(m.total_tela - m.total_novo) <= 0.05
        THEN 'sem_diferenca'
      WHEN m.unidade_pdf = m.unidade_nova AND m.unidade_tela = m.unidade_nova
        THEN 'divergencia_mesma_unidade'
      ELSE 'conferir_planilha'
    END AS classificacao,
    CASE
      WHEN m.tipo = 'capina' AND m.unidade_pdf = 'km' AND m.total_novo > 0 AND m.total_pdf IS NOT NULL
        AND abs((m.total_pdf * 1000) - m.total_novo) <= GREATEST(m.total_novo, 1) * 0.02
        THEN 'Nao e perda de producao. O PDF antigo mostrou km e a regra nova mostra os mesmos metros. '
      WHEN m.tipo = 'capina' AND m.unidade_pdf = 'km' AND COALESCE(m.total_novo, 0) = 0
        AND m.total_pdf IS NOT NULL AND m.total_tela IS NOT NULL
        AND abs(m.total_tela - (m.total_pdf * 1000)) <= GREATEST(m.total_tela, 1) * 0.02
        THEN 'Nao e perda de producao. A quantidade esta em km e nao ha Metro Linear; a regra nova nao converte. '
      ELSE ''
    END
      || 'lancamentos=' || m.lancamentos
      || ' | nova=' || replace(to_char(ROUND(m.total_novo::numeric, 3), 'FM999999999999990.000'), '.', ',') || ' ' || m.unidade_nova
      || ' | pdf_anterior=' || CASE WHEN m.total_pdf IS NULL THEN 'nao_somado' ELSE replace(to_char(ROUND(m.total_pdf::numeric, 3), 'FM999999999999990.000'), '.', ',') END || ' ' || m.unidade_pdf
      || ' | tela_anterior=' || CASE WHEN m.total_tela IS NULL THEN 'nao_somado' ELSE replace(to_char(ROUND(m.total_tela::numeric, 3), 'FM999999999999990.000'), '.', ',') END || ' ' || m.unidade_tela
      || ' | zerados_sem_campo_oficial=' || m.zerados
      || ' | campos_conflitantes=' || m.conflitos
      || CASE WHEN m.unidade_pdf = 'mista' OR m.unidade_tela = 'mista'
        THEN ' | dias com unidades diferentes nao foram somados entre si' ELSE '' END
      AS detalhe
  FROM mes m
),
excluidos AS (
  SELECT
    '2_excluidos_dashboard' AS secao,
    contrato, servico, tipo, classe, mes,
    'nao_entram_no_relatorio' AS metrica,
    COUNT(*)::text AS valor,
    '' AS unidade,
    'conferir_planilha' AS classificacao,
    'validoDashboard=false; fora da soma dos relatórios' AS detalhe
  FROM marcada
  WHERE valido IS NOT TRUE
  GROUP BY contrato, servico, tipo, classe, mes
),
zerados AS (
  SELECT
    '3_sem_campo_oficial' AS secao,
    contrato, servico, tipo, classe, mes,
    ausencia_campo AS metrica,
    COUNT(*)::text AS valor,
    '' AS unidade,
    'conferir_planilha' AS classificacao,
    'A regra nova zera estes lançamentos. Confira a planilha antes de tratar como perda real.' AS detalhe
  FROM validas
  WHERE ausencia_campo IS NOT NULL
  GROUP BY contrato, servico, tipo, classe, mes, ausencia_campo
),
conflitos AS (
  SELECT
    '4_campos_conflitantes' AS secao,
    contrato, servico, tipo, classe, mes,
    conflito AS metrica,
    COUNT(*)::text AS valor,
    '' AS unidade,
    'conferir_planilha' AS classificacao,
    'Os dois campos existem e não representam a mesma medida. A regra nova não soma os dois.' AS detalhe
  FROM validas
  WHERE conflito IS NOT NULL
  GROUP BY contrato, servico, tipo, classe, mes, conflito
),
chaves AS (
  SELECT
    contract_id, contrato, tipo, classe, servico, dia,
    upper(regexp_replace(local_txt, '\s+', ' ', 'g')) AS local_norm,
    ROUND(valor_novo::numeric, 3) AS qtd
  FROM validas
  WHERE valor_novo > 0 AND local_txt <> ''
),
duplicados AS (
  SELECT
    '5_duplicidade_generico_especifico' AS secao,
    g.contrato,
    g.servico || ' ∩ ' || e.servico AS servico,
    g.tipo,
    e.classe,
    left(g.dia, 7) AS mes,
    'mesma data, local e quantidade' AS metrica,
    COUNT(DISTINCT (g.dia, g.local_norm, g.qtd))::text AS valor,
    '' AS unidade,
    'conferir_planilha' AS classificacao,
    'Pode estar contado no serviço genérico e de novo no manual/mecanizado. Não é soma automática.' AS detalhe
  FROM chaves g
  JOIN chaves e
    ON e.contract_id = g.contract_id
   AND e.tipo = g.tipo
   AND e.dia = g.dia
   AND e.local_norm = g.local_norm
   AND e.qtd = g.qtd
   AND e.classe IN ('manual', 'mecanizada')
  WHERE g.classe = 'generico'
  GROUP BY g.contrato, g.servico, e.servico, g.tipo, e.classe, left(g.dia, 7)
),
varredura_dia AS (
  SELECT contrato, servico, mes, dia, SUM(km_novo) AS km_dia, COUNT(*) AS lancamentos
  FROM validas
  WHERE tipo = 'varricao' AND classe = 'mecanizada'
  GROUP BY contrato, servico, mes, dia
),
varredura_repetida AS (
  SELECT
    '6_varricao_mecanizada_total_repetido' AS secao,
    contrato, servico, 'varricao' AS tipo, 'mecanizada' AS classe, mes,
    'km do dia igual em vários dias' AS metrica,
    replace(to_char(ROUND(MIN(km_dia)::numeric, 3), 'FM999999999999990.000'), '.', ',') AS valor,
    'km' AS unidade,
    'conferir_planilha' AS classificacao,
    'dias=' || COUNT(*) || ' lancamentos_no_mes=' || SUM(lancamentos)
      || '. O mesmo km aparece em ' || COUNT(*)
      || ' dias. Pode ser o total do mês colado pela planilha, não a produção diária.' AS detalhe
  FROM varredura_dia
  WHERE km_dia > 0
  GROUP BY contrato, servico, mes
  HAVING COUNT(*) >= 4
     AND COUNT(DISTINCT ROUND(km_dia::numeric, 1)) = 1
),
indicadores AS (
  SELECT
    '7_indicador_count' AS secao,
    ct."numeroContrato" AS contrato,
    s.nome AS servico,
    s.tipo,
    '' AS classe,
    '' AS mes,
    'configDashboard' AS metrica,
    '' AS valor,
    '' AS unidade,
    'indicador_antigo' AS classificacao,
    left(m.trecho, 180) AS detalhe
  FROM servicos s
  JOIN contracts ct ON ct.id = s.contract_id
  CROSS JOIN LATERAL regexp_matches(s."configDashboard"::text, '.{0,70}count\s*\(\s*\*\s*\).{0,70}', 'gi') AS m(trecho)
  WHERE s.tipo IN ('rocadeira', 'capina', 'varricao', 'poda', 'pintura_meio_fio', 'remocao', 'geral')
    AND s."configDashboard"::text ~* 'count\s*\(\s*\*\s*\)'
  UNION ALL
  SELECT
    '7_indicador_count',
    ct."numeroContrato",
    '(contrato)',
    '',
    '',
    '',
    'kpisConfig',
    '',
    '',
    'indicador_antigo',
    left(m.trecho, 180)
  FROM contracts ct
  CROSS JOIN LATERAL regexp_matches(ct."kpisConfig"::text, '.{0,70}count\s*\(\s*\*\s*\).{0,70}', 'gi') AS m(trecho)
  WHERE ct."kpisConfig"::text ~* 'count\s*\(\s*\*\s*\)'
),
amostra AS (
  SELECT
    '8_amostra' AS secao,
    contrato, servico, tipo, classe, dia AS mes,
    COALESCE(ausencia_campo, conflito) AS metrica,
    replace(to_char(ROUND(valor_novo::numeric, 3), 'FM999999999999990.000'), '.', ',') AS valor,
    '' AS unidade,
    CASE WHEN conflito IS NOT NULL THEN 'conferir_planilha' ELSE 'conferir_planilha' END AS classificacao,
    'id=' || coleta_id
      || ' local=' || left(local_txt, 80)
      || ' area_nova=' || ROUND(area_nova::numeric, 3)
      || ' metro_novo=' || ROUND(metro_novo::numeric, 3)
      || ' km_novo=' || ROUND(km_novo::numeric, 3)
      || ' arvores=' || ROUND(arv_nova::numeric, 3)
      || ' quantitativo=' || ROUND(qtd_nova::numeric, 3)
      AS detalhe
  FROM (
    SELECT v.*, row_number() OVER (PARTITION BY contrato, servico, COALESCE(ausencia_campo, conflito) ORDER BY dia) AS n
    FROM validas v
    WHERE ausencia_campo IS NOT NULL OR conflito IS NOT NULL
  ) a
  WHERE n <= 5
)
SELECT * FROM (
  SELECT * FROM resumo
  UNION ALL SELECT * FROM excluidos
  UNION ALL SELECT * FROM zerados
  UNION ALL SELECT * FROM conflitos
  UNION ALL SELECT * FROM duplicados
  UNION ALL SELECT * FROM varredura_repetida
  UNION ALL SELECT * FROM indicadores
  UNION ALL SELECT * FROM amostra
) resultado
ORDER BY secao, contrato, servico, mes, metrica;

ROLLBACK;
