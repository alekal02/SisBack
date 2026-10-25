-- KPIs Universais para PODA
-- Placeholders comuns:
-- ARVORES_PLACEHOLDER: ['ARVORES PODADAS', 'QTDE ARVORES', 'ARVORES', 'N ARVORES', 'QUANTIDADE']
-- FUNCIONARIO_PLACEHOLDER: ['FUNCIONARIO', 'NOME', 'OPERADOR', 'MOTORISTA', 'EQUIPE', 'FUNCIONARIO']
-- BAIRRO_PLACEHOLDER: ['BAIRRO', 'LOCAL', 'REGIONAL', 'REGIAO', 'SETOR', 'ROTA', 'DESTINO']
-- HORA_PLACEHOLDER: ['HORA INICIO', 'HORA', 'HORAS', 'HORAS PRODUTIVAS', 'HORA SAIDA', 'HORASAIDA', 'DURACAO', 'TEMPO']
-- KM_PLACEHOLDER: ['KM TOTAL', 'KM', 'KMTOTAL', 'KM RODADO', 'QUILOMETRO', 'DISTANCIA']

-- 1. Horas Produtivas
INSERT INTO kpis_universais (id, nome, label, formula, agregacao, formato, unidade, categoria, cor, descricao, "tipoServico", placeholders, "isPersonalizado")
SELECT uuid_generate_v4(), 'Horas Produtivas', 'Horas Produtivas', 'SUM(HORA_PLACEHOLDER)', 'sum', 'numero', 'h', 'Produtividade', '#06b6d4', 'Total de horas trabalhadas nas atividades de poda', 'poda', '[{"nome":"HORA_PLACEHOLDER","label":"Coluna de Hora","colunasCandidatas":["HORA INICIO","HORA","HORAS","HORAS PRODUTIVAS","HORA SAIDA","HORASAIDA","DURACAO","TEMPO"]}]'::jsonb, false
WHERE NOT EXISTS (SELECT 1 FROM kpis_universais WHERE nome = 'Horas Produtivas' AND "tipoServico" = 'poda');

-- 2. Produtividade por Hora
INSERT INTO kpis_universais (id, nome, label, formula, agregacao, formato, unidade, categoria, cor, descricao, "tipoServico", placeholders, "isPersonalizado")
SELECT uuid_generate_v4(), 'Produtividade por Hora', 'Arv./Hora', 'DIVIDE(SUM(ARVORES_PLACEHOLDER), SUM(HORA_PLACEHOLDER))', 'sum', 'numero', 'arv./h', 'Eficiencia', '#22c55e', 'Media de arvores podadas por hora trabalhada', 'poda', '[{"nome":"ARVORES_PLACEHOLDER","label":"Coluna de Arvores Podadas","colunasCandidatas":["ARVORES PODADAS","QTDE ARVORES","ARVORES","N ARVORES","QUANTIDADE"]},{"nome":"HORA_PLACEHOLDER","label":"Coluna de Hora","colunasCandidatas":["HORA INICIO","HORA","HORAS","HORAS PRODUTIVAS","HORA SAIDA","HORASAIDA","DURACAO","TEMPO"]}]'::jsonb, false
WHERE NOT EXISTS (SELECT 1 FROM kpis_universais WHERE nome = 'Produtividade por Hora' AND "tipoServico" = 'poda');

-- 3. KM Total Rodado
INSERT INTO kpis_universais (id, nome, label, formula, agregacao, formato, unidade, categoria, cor, descricao, "tipoServico", placeholders, "isPersonalizado")
SELECT uuid_generate_v4(), 'KM Total Rodado', 'KM Rodado', 'SUM(KM_PLACEHOLDER)', 'sum', 'numero', 'km', 'Produtividade', '#f59e0b', 'Total de quilometros rodados nas atividades de poda', 'poda', '[{"nome":"KM_PLACEHOLDER","label":"Coluna de KM","colunasCandidatas":["KM TOTAL","KM","KMTOTAL","KM RODADO","QUILOMETRO","DISTANCIA"]}]'::jsonb, false
WHERE NOT EXISTS (SELECT 1 FROM kpis_universais WHERE nome = 'KM Total Rodado' AND "tipoServico" = 'poda');

-- 4. Bairros Atendidos
INSERT INTO kpis_universais (id, nome, label, formula, agregacao, formato, unidade, categoria, cor, descricao, "tipoServico", placeholders, "isPersonalizado")
SELECT uuid_generate_v4(), 'Bairros Atendidos', 'Bairros Atendidos', 'COUNT(DISTINCT BAIRRO_PLACEHOLDER)', 'count', 'numero', 'bairros', 'Cobertura', '#a855f7', 'Quantidade de bairros/locais distintos onde houve poda', 'poda', '[{"nome":"BAIRRO_PLACEHOLDER","label":"Coluna de Bairro","colunasCandidatas":["BAIRRO","LOCAL","REGIONAL","REGIAO","SETOR","ROTA","DESTINO"]}]'::jsonb, false
WHERE NOT EXISTS (SELECT 1 FROM kpis_universais WHERE nome = 'Bairros Atendidos' AND "tipoServico" = 'poda');

-- 5. Media de Horas por Equipe
INSERT INTO kpis_universais (id, nome, label, formula, agregacao, formato, unidade, categoria, cor, descricao, "tipoServico", placeholders, "isPersonalizado")
SELECT uuid_generate_v4(), 'Media Horas por Equipe', 'Horas/Equipe', 'DIVIDE(SUM(HORA_PLACEHOLDER), COUNT(DISTINCT FUNCIONARIO_PLACEHOLDER))', 'sum', 'numero', 'h/equipe', 'Equipe', '#0ea5e9', 'Media de horas trabalhadas por equipe nas atividades de poda', 'poda', '[{"nome":"HORA_PLACEHOLDER","label":"Coluna de Hora","colunasCandidatas":["HORA INICIO","HORA","HORAS","HORAS PRODUTIVAS","HORA SAIDA","HORASAIDA","DURACAO","TEMPO"]},{"nome":"FUNCIONARIO_PLACEHOLDER","label":"Coluna de Funcionario","colunasCandidatas":["FUNCIONARIO","NOME","OPERADOR","MOTORISTA","EQUIPE","FUNCIONARIO"]}]'::jsonb, false
WHERE NOT EXISTS (SELECT 1 FROM kpis_universais WHERE nome = 'Media Horas por Equipe' AND "tipoServico" = 'poda');

-- 6. KM por Arvore
INSERT INTO kpis_universais (id, nome, label, formula, agregacao, formato, unidade, categoria, cor, descricao, "tipoServico", placeholders, "isPersonalizado")
SELECT uuid_generate_v4(), 'KM por Arvore', 'KM/Arv.', 'DIVIDE(SUM(KM_PLACEHOLDER), SUM(ARVORES_PLACEHOLDER))', 'sum', 'numero', 'km/arv.', 'Eficiencia', '#f97316', 'Relacao de KM rodado por arvore podada (eficiencia logistica)', 'poda', '[{"nome":"KM_PLACEHOLDER","label":"Coluna de KM","colunasCandidatas":["KM TOTAL","KM","KMTOTAL","KM RODADO","QUILOMETRO","DISTANCIA"]},{"nome":"ARVORES_PLACEHOLDER","label":"Coluna de Arvores Podadas","colunasCandidatas":["ARVORES PODADAS","QTDE ARVORES","ARVORES","N ARVORES","QUANTIDADE"]}]'::jsonb, false
WHERE NOT EXISTS (SELECT 1 FROM kpis_universais WHERE nome = 'KM por Arvore' AND "tipoServico" = 'poda');

-- 7. Media Arvores por Bairro
INSERT INTO kpis_universais (id, nome, label, formula, agregacao, formato, unidade, categoria, cor, descricao, "tipoServico", placeholders, "isPersonalizado")
SELECT uuid_generate_v4(), 'Media Arvores por Bairro', 'Arv./Bairro', 'DIVIDE(SUM(ARVORES_PLACEHOLDER), COUNT(DISTINCT BAIRRO_PLACEHOLDER))', 'sum', 'numero', 'arv./bairro', 'Cobertura', '#d946ef', 'Media de arvores podadas por bairro atendido', 'poda', '[{"nome":"ARVORES_PLACEHOLDER","label":"Coluna de Arvores Podadas","colunasCandidatas":["ARVORES PODADAS","QTDE ARVORES","ARVORES","N ARVORES","QUANTIDADE"]},{"nome":"BAIRRO_PLACEHOLDER","label":"Coluna de Bairro","colunasCandidatas":["BAIRRO","LOCAL","REGIONAL","REGIAO","SETOR","ROTA","DESTINO"]}]'::jsonb, false
WHERE NOT EXISTS (SELECT 1 FROM kpis_universais WHERE nome = 'Media Arvores por Bairro' AND "tipoServico" = 'poda');

-- 8. Registros de Poda
INSERT INTO kpis_universais (id, nome, label, formula, agregacao, formato, unidade, categoria, cor, descricao, "tipoServico", placeholders, "isPersonalizado")
SELECT uuid_generate_v4(), 'Registros de Poda', 'Registros', 'COUNT(*)', 'count', 'numero', 'registros', 'Geral', '#64748b', 'Total de registros de atividades de poda', 'poda', '[]'::jsonb, false
WHERE NOT EXISTS (SELECT 1 FROM kpis_universais WHERE nome = 'Registros de Poda' AND "tipoServico" = 'poda');
