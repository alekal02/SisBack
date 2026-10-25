SELECT s.id,
       c."numeroContrato",
       s.nome,
       s.tipo,
       (s."padraoPlanilha" IS NOT NULL) AS tem_padrao,
       jsonb_array_length(COALESCE(s."padraoPlanilha"->'colunas', '[]'::jsonb)) AS n_colunas,
       (SELECT COUNT(*) FROM planilha_uploads u WHERE u.servico_id = s.id) AS uploads,
       (SELECT COUNT(*) FROM coleta_dados cd
        INNER JOIN planilha_uploads u ON u.id = cd."planilhaUploadId"
        WHERE u.servico_id = s.id) AS registros,
       (SELECT COUNT(*) FROM coleta_dados cd
        INNER JOIN planilha_uploads u ON u.id = cd."planilhaUploadId"
        WHERE u.servico_id = s.id AND cd."validoDashboard" = true) AS validos,
       jsonb_array_length(COALESCE(s."configDashboard"->'kpis', '[]'::jsonb)) AS n_kpis,
       jsonb_array_length(COALESCE(s."configDashboard"->'graficos', '[]'::jsonb)) AS n_graficos
FROM servicos s
JOIN contracts c ON c.id = s.contract_id
ORDER BY c."numeroContrato", s.nome;
