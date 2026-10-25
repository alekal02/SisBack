-- Identifica lançamentos de ciclo aberto somados por reenvios de planilha.
-- Somente leitura. Não escolhe o último upload como planilha correta.
-- Rode na máquina Docker com auditar-acumulo-uploads.ps1.

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

WITH base AS (
  SELECT
    ct."numeroContrato" AS contrato,
    s.id AS servico_id,
    s.nome AS servico,
    s.tipo,
    CASE
      WHEN s.nome ~* 'manual' THEN 'manual'
      WHEN s.nome ~* 'mecaniz' THEN 'mecanizada'
      ELSE 'generico'
    END AS classe,
    c.id AS coleta_id,
    c."planilhaUploadId" AS upload_id,
    c."dataSaida" AS data_saida,
    c."validoDashboard" AS valido,
    u."criadoEm" AS criado_em,
    u."nomeArquivo" AS nome_arquivo,
    COALESCE(u.resumo->>'origem', 'sem-origem') AS origem,
    COALESCE(u.resumo->>'modelo', '') AS modelo,
    u."cicloFechadoEm" IS NOT NULL AS ciclo_fechado,
    COALESCE(u."cicloAnoReferencia"::text, '') AS ano_ref,
    COALESCE(u."cicloMesReferencia"::text, '') AS mes_ref,
    CASE s.tipo
      WHEN 'varricao' THEN 'km'
      WHEN 'rocadeira' THEN 'm2'
      WHEN 'capina' THEN 'm'
      WHEN 'pintura_meio_fio' THEN 'm'
      WHEN 'poda' THEN 'arv'
      WHEN 'remocao' THEN 'pts'
      WHEN 'geral' THEN 'pts'
      ELSE 'qtd'
    END AS unidade,
    CASE s.tipo
      WHEN 'varricao' THEN COALESCE(
        NULLIF(CASE WHEN NULLIF(TRIM(c.dados->>'KM Linear'), '') ~ '^[+-]?[0-9]+([.][0-9]+)?$' THEN TRIM(c.dados->>'KM Linear')::double precision END, 0),
        NULLIF(CASE WHEN NULLIF(TRIM(c.dados->>'KM_LINEAR'), '') ~ '^[+-]?[0-9]+([.][0-9]+)?$' THEN TRIM(c.dados->>'KM_LINEAR')::double precision END, 0),
        NULLIF(CASE WHEN NULLIF(TRIM(c.dados->>'QUILOMETROS_VARRIDOS'), '') ~ '^[+-]?[0-9]+([.][0-9]+)?$' THEN TRIM(c.dados->>'QUILOMETROS_VARRIDOS')::double precision END, 0),
        NULLIF(c."kmTotal", 0),
        0)
      WHEN 'rocadeira' THEN COALESCE(
        NULLIF(CASE WHEN NULLIF(TRIM(c.dados->>'Area m²'), '') ~ '^[+-]?[0-9]+([.][0-9]+)?$' THEN TRIM(c.dados->>'Area m²')::double precision END, 0),
        NULLIF(CASE WHEN NULLIF(TRIM(c.dados->>'AREA_M2'), '') ~ '^[+-]?[0-9]+([.][0-9]+)?$' THEN TRIM(c.dados->>'AREA_M2')::double precision END, 0),
        NULLIF(CASE WHEN NULLIF(TRIM(c.dados->>'M2'), '') ~ '^[+-]?[0-9]+([.][0-9]+)?$' THEN TRIM(c.dados->>'M2')::double precision END, 0),
        NULLIF(CASE WHEN NULLIF(TRIM(c.dados->>'AREA_ROCADA'), '') ~ '^[+-]?[0-9]+([.][0-9]+)?$' THEN TRIM(c.dados->>'AREA_ROCADA')::double precision END, 0),
        0)
      WHEN 'capina' THEN COALESCE(
        NULLIF(CASE WHEN NULLIF(TRIM(c.dados->>'Metro Linear'), '') ~ '^[+-]?[0-9]+([.][0-9]+)?$' THEN TRIM(c.dados->>'Metro Linear')::double precision END, 0),
        NULLIF(CASE WHEN NULLIF(TRIM(c.dados->>'METRO_LINEAR'), '') ~ '^[+-]?[0-9]+([.][0-9]+)?$' THEN TRIM(c.dados->>'METRO_LINEAR')::double precision END, 0),
        NULLIF(CASE WHEN NULLIF(TRIM(c.dados->>'COMPRIMENTO'), '') ~ '^[+-]?[0-9]+([.][0-9]+)?$' THEN TRIM(c.dados->>'COMPRIMENTO')::double precision END, 0),
        NULLIF(CASE WHEN NULLIF(TRIM(c.dados->>'COMPRIMENTO TOTAL'), '') ~ '^[+-]?[0-9]+([.][0-9]+)?$' THEN TRIM(c.dados->>'COMPRIMENTO TOTAL')::double precision END, 0),
        0)
      WHEN 'pintura_meio_fio' THEN COALESCE(
        NULLIF(CASE WHEN NULLIF(TRIM(c.dados->>'Metro Linear'), '') ~ '^[+-]?[0-9]+([.][0-9]+)?$' THEN TRIM(c.dados->>'Metro Linear')::double precision END, 0),
        NULLIF(CASE WHEN NULLIF(TRIM(c.dados->>'METRO_LINEAR'), '') ~ '^[+-]?[0-9]+([.][0-9]+)?$' THEN TRIM(c.dados->>'METRO_LINEAR')::double precision END, 0),
        NULLIF(CASE WHEN NULLIF(TRIM(c.dados->>'COMPRIMENTO'), '') ~ '^[+-]?[0-9]+([.][0-9]+)?$' THEN TRIM(c.dados->>'COMPRIMENTO')::double precision END, 0),
        NULLIF(CASE WHEN NULLIF(TRIM(c.dados->>'COMPRIMENTO TOTAL'), '') ~ '^[+-]?[0-9]+([.][0-9]+)?$' THEN TRIM(c.dados->>'COMPRIMENTO TOTAL')::double precision END, 0),
        0)
      WHEN 'poda' THEN COALESCE(
        NULLIF(CASE WHEN NULLIF(TRIM(c.dados->>'Quantidade de Arvore'), '') ~ '^[+-]?[0-9]+([.][0-9]+)?$' THEN TRIM(c.dados->>'Quantidade de Arvore')::double precision END, 0),
        NULLIF(CASE WHEN NULLIF(TRIM(c.dados->>'QTD_ARVORE'), '') ~ '^[+-]?[0-9]+([.][0-9]+)?$' THEN TRIM(c.dados->>'QTD_ARVORE')::double precision END, 0),
        NULLIF(CASE WHEN NULLIF(TRIM(c.dados->>'ARVORES_PODADAS'), '') ~ '^[+-]?[0-9]+([.][0-9]+)?$' THEN TRIM(c.dados->>'ARVORES_PODADAS')::double precision END, 0),
        0)
      ELSE COALESCE(
        NULLIF(CASE WHEN NULLIF(TRIM(c.dados->>'QUANTITATIVO'), '') ~ '^[+-]?[0-9]+([.][0-9]+)?$' THEN TRIM(c.dados->>'QUANTITATIVO')::double precision END, 0),
        NULLIF(CASE WHEN NULLIF(TRIM(c.dados->>'QUANTIDADE'), '') ~ '^[+-]?[0-9]+([.][0-9]+)?$' THEN TRIM(c.dados->>'QUANTIDADE')::double precision END, 0),
        0)
    END AS metrica
  FROM coleta_dados c
  JOIN planilha_uploads u ON u.id = c."planilhaUploadId"
  JOIN servicos s ON s.id = u.servico_id
  JOIN contracts ct ON ct.id = s.contract_id
  WHERE s.tipo IN ('varricao', 'rocadeira', 'capina', 'pintura_meio_fio', 'poda', 'remocao', 'geral')
),
validas AS (
  SELECT * FROM base WHERE valido IS TRUE
),
por_upload AS (
  SELECT
    contrato, servico_id, servico, tipo, classe, unidade,
    upload_id, origem, modelo, nome_arquivo, ciclo_fechado,
    ano_ref, mes_ref,
    MIN(criado_em) AS criado_em,
    MIN(data_saida) AS dia_ini,
    MAX(data_saida) AS dia_fim,
    COUNT(*) AS linhas,
    SUM(metrica) AS total
  FROM validas
  GROUP BY contrato, servico_id, servico, tipo, classe, unidade,
    upload_id, origem, modelo, nome_arquivo, ciclo_fechado, ano_ref, mes_ref
),
soma_aberta AS (
  SELECT servico_id, SUM(total) AS soma, COUNT(*) AS n_uploads
  FROM por_upload
  WHERE NOT ciclo_fechado
  GROUP BY servico_id
),
datas_abertas AS (
  SELECT servico_id, data_saida, COUNT(DISTINCT upload_id) AS n_uploads
  FROM validas
  WHERE NOT ciclo_fechado
  GROUP BY servico_id, data_saida
),
sobrepostas AS (
  SELECT * FROM datas_abertas WHERE n_uploads > 1
)
SELECT * FROM (
  SELECT
    'upload' AS secao,
    p.contrato,
    p.servico_id::text,
    p.servico,
    p.tipo,
    p.classe,
    CASE WHEN p.ano_ref <> '' THEN p.ano_ref || '-' || lpad(p.mes_ref, 2, '0') ELSE '' END AS ciclo,
    to_char(p.dia_ini, 'YYYY-MM-DD') || ' a ' || to_char(p.dia_fim, 'YYYY-MM-DD') AS dia,
    p.upload_id::text,
    '' AS coleta_id,
    to_char(p.criado_em, 'YYYY-MM-DD HH24:MI:SS') AS criado_em,
    p.origem,
    p.nome_arquivo,
    CASE WHEN p.ciclo_fechado THEN 'sim' ELSE 'nao' END AS ciclo_fechado,
    replace(to_char(ROUND(p.total::numeric, 3), 'FM999999999999990.000'), '.', ',') AS metrica,
    p.unidade,
    p.linhas::text AS linhas,
    CASE WHEN p.ciclo_fechado THEN '' ELSE replace(to_char(ROUND(sa.soma::numeric, 3), 'FM999999999999990.000'), '.', ',') END AS soma_abertos,
    CASE WHEN p.ciclo_fechado THEN '' ELSE replace(to_char(ROUND((sa.soma - p.total)::numeric, 3), 'FM999999999999990.000'), '.', ',') END AS excesso_se_este_for_a_referencia,
    CASE WHEN p.ciclo_fechado THEN 'preservar_ciclo_fechado' ELSE 'conferir_referencia' END AS situacao,
    CASE
      WHEN p.ciclo_fechado THEN 'nao alterar'
      WHEN sa.n_uploads > 1 THEN 'ha ' || sa.n_uploads::text || ' uploads abertos neste servico; a referencia ainda nao foi escolhida'
      ELSE 'um unico upload aberto'
    END AS detalhe
  FROM por_upload p
  LEFT JOIN soma_aberta sa ON sa.servico_id = p.servico_id

  UNION ALL

  SELECT
    'data_sobreposta',
    v.contrato,
    v.servico_id::text,
    v.servico,
    v.tipo,
    v.classe,
    '',
    to_char(s.data_saida, 'YYYY-MM-DD'),
    string_agg(DISTINCT v.upload_id::text, ',' ORDER BY v.upload_id::text),
    '',
    '',
    '',
    '',
    'nao',
    replace(to_char(ROUND(SUM(v.metrica)::numeric, 3), 'FM999999999999990.000'), '.', ','),
    v.unidade,
    COUNT(*)::text,
    '',
    '',
    'sobreposta_a_confirmar',
    s.n_uploads::text || ' uploads abertos na mesma data'
  FROM sobrepostas s
  JOIN validas v ON v.servico_id = s.servico_id AND v.data_saida = s.data_saida AND NOT v.ciclo_fechado
  GROUP BY v.contrato, v.servico_id, v.servico, v.tipo, v.classe, v.unidade, s.data_saida, s.n_uploads

  UNION ALL

  SELECT
    'linha_candidata',
    v.contrato,
    v.servico_id::text,
    v.servico,
    v.tipo,
    v.classe,
    '',
    to_char(v.data_saida, 'YYYY-MM-DD'),
    v.upload_id::text,
    v.coleta_id::text,
    to_char(v.criado_em, 'YYYY-MM-DD HH24:MI:SS'),
    v.origem,
    v.nome_arquivo,
    'nao',
    replace(to_char(ROUND(v.metrica::numeric, 3), 'FM999999999999990.000'), '.', ','),
    v.unidade,
    '1',
    '',
    '',
    'sobreposta_a_confirmar',
    'so entra no saneamento depois da planilha de referencia'
  FROM validas v
  JOIN sobrepostas s ON s.servico_id = v.servico_id AND s.data_saida = v.data_saida
  WHERE NOT v.ciclo_fechado

  UNION ALL

  SELECT
    'sem_upload',
    '',
    '',
    '',
    '',
    '',
    '',
    COALESCE(to_char(MIN(c."dataSaida"), 'YYYY-MM-DD'), '') || ' a ' || COALESCE(to_char(MAX(c."dataSaida"), 'YYYY-MM-DD'), ''),
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    COUNT(*)::text,
    '',
    '',
    'preservar_sem_planilha',
    'lancamento sem planilhaUploadId; nao da para ligar a um servico e fica fora da exclusao'
  FROM coleta_dados c
  WHERE c."planilhaUploadId" IS NULL
  HAVING COUNT(*) > 0
) resultado
ORDER BY secao, contrato, servico, dia, upload_id, coleta_id;

ROLLBACK;
