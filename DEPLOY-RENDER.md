# Sistemma na Render (sem Docker)

Serviço web Node. O build é `npm install && npm run build` e o start é `npm start`.
O health check é `GET /health` e responde assim que o processo escuta a porta, antes do aquecimento do banco.

## O que o build faz

1. Instala dependências, inclusive o pacote `shared` em `./shared`.
2. Compila `shared` e o TypeScript do backend.
3. Baixa o Chrome do Puppeteer para `.cache/puppeteer` (ver `.puppeteerrc.cjs`).

Na Render, defina `PUPPETEER_CACHE_DIR=/opt/render/project/src/.cache/puppeteer` para o runtime achar o mesmo Chrome. O processo lança o navegador com `--no-sandbox` e `--disable-dev-shm-usage`.

## Banco

- `DATABASE_URL`: connection string (Postgres da Render). SSL com `rejectUnauthorized: false`, a menos que `DATABASE_SSL=false`.
- Sem `DATABASE_URL`, usa `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_USER`, `DATABASE_PASSWORD` e `DATABASE_NAME`.
- `MULTI_TENANT=false` neste deploy (um banco só).
- `TYPEORM_SYNCHRONIZE=true` só no primeiro boot, para criar as tabelas. Depois volte para `false`.

O primeiro boot cria o usuário `admin@teste.com` se a tabela de usuários estiver vazia desse e-mail. Troque a senha assim que entrar.

## Disco

Sem `MINIO_ENDPOINT`, arquivos ficam na pasta `uploads/` do disco da instância. Esse disco é apagado a cada deploy. Planilhas de ciclo vão para `planilhas-ciclo/` e o cache do dashboard para `uploads/dashboard-cache/`. As pastas são recriadas no boot.

## WhatsApp

A WuzAPI já existe fora deste serviço. Configure só as variáveis `WUZAPI_*`. O backend não usa host fixo de Docker. Sem `WUZAPI_WEBHOOK_URL`, o processo não altera o webhook da sessão.

## Variáveis mínimas de produção

`NODE_ENV`, `DATABASE_URL`, `TYPEORM_SYNCHRONIZE`, `MULTI_TENANT`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `JWT_EXPIRES_IN`, `JWT_REFRESH_EXPIRY`, `CORS_ORIGIN`, `ACESSO_LIVRE`, `WUZAPI_URL`, `WUZAPI_TOKEN`, `WUZAPI_ADMIN_TOKEN`, `WUZAPI_INSTANCE_NAME`, `WUZAPI_WEBHOOK_URL`, `WUZAPI_WEBHOOK_ENFORCE`, `PUPPETEER_CACHE_DIR`, `DB_POOL_MAX`, `NODE_OPTIONS`.

`ACESSO_LIVRE` fica `false` em produção. O `POST /api/auth/acesso-direto` só abre sessão sem senha quando o valor é exatamente `true`.

A lista completa está em `.env.example`.
