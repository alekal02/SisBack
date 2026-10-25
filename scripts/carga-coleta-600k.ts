/**
 * Teste de carga: ~600 mil registros de coleta.
 * Uso: npx ts-node --transpile-only scripts/carga-coleta-600k.ts
 *
 * Opções:
 *   --somente-medir   não insere, só mede endpoints no serviço de carga
 *   --limpar          remove o serviço de carga e seus dados
 */
import 'dotenv/config';
import { Client } from 'pg';
import { randomUUID } from 'crypto';

const TOTAL = Number(process.env.CARGA_TOTAL || 600_000);
const BATCH = Number(process.env.CARGA_BATCH || 2_000); // ≤65535 params PG (16 cols × 2000)
const CONTRACT_ID = process.env.CARGA_CONTRACT_ID || '79dbd539-46e2-4820-b2f7-e04aafab952f';
const API = process.env.CARGA_API || 'http://localhost:3200';
const EMAIL = process.env.CARGA_EMAIL || 'admin@teste.com';
const SENHA = process.env.CARGA_SENHA || '123456';
const NOME_SERVICO = 'Carga Coleta 600k (teste)';

const args = new Set(process.argv.slice(2));
const somenteMedir = args.has('--somente-medir');
const limpar = args.has('--limpar');

const REGIONAIS = ['Norte', 'Sul', 'Leste', 'Oeste', 'Centro'];
const DISTRITOS = ['D01', 'D02', 'D03', 'D04', 'D05', 'D06', 'D07', 'D08'];
const MOTORISTAS = ['JOAO', 'MARIA', 'PEDRO', 'ANA', 'CARLOS', 'LUCAS', 'PAULA', 'RAFAEL'];
const TIPOS = ['TRUCK', 'TOCO', 'MINI', 'TRUCK', 'TRUCK'];
const TURNOS = ['MANHA', 'TARDE', 'NOITE'];

function pgClient() {
  return new Client({
    host: process.env.DATABASE_HOST || 'localhost',
    port: Number(process.env.DATABASE_PORT || 5432),
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
  });
}

function dataCiclo(i: number): string {
  const day = 1 + (i % 30);
  const d = new Date(Date.UTC(2026, 5, day)); // junho/2026
  return d.toISOString().slice(0, 10);
}

function placa(i: number): string {
  const n = (i % 80) + 1;
  return `ABC${String(n).padStart(4, '0')}`;
}

async function login(): Promise<string> {
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, senha: SENHA }),
  });
  if (!res.ok) throw new Error(`Login falhou: ${res.status} ${await res.text()}`);
  const j = await res.json() as { token?: string };
  if (!j.token) throw new Error('Token ausente no login');
  return j.token;
}

async function medir(token: string, path: string): Promise<{ ms: number; status: number; bytes: number }> {
  const t0 = Date.now();
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const buf = Buffer.from(await res.arrayBuffer());
  return { ms: Date.now() - t0, status: res.status, bytes: buf.length };
}

async function garantirIndices(c: Client) {
  await c.query(`
    CREATE INDEX IF NOT EXISTS "IDX_coleta_dados_motorista" ON coleta_dados ("motorista");
    CREATE INDEX IF NOT EXISTS "IDX_coleta_dados_tipoCaminhao" ON coleta_dados ("tipoCaminhao");
    CREATE INDEX IF NOT EXISTS "IDX_coleta_dados_upload_valido_data"
      ON coleta_dados ("planilhaUploadId", "validoDashboard", "dataSaida");
    CREATE INDEX IF NOT EXISTS "IDX_planilha_uploads_servico_id" ON planilha_uploads (servico_id);
  `);
  try {
    await c.query(`CREATE INDEX IF NOT EXISTS "IDX_coleta_dados_dados_gin" ON coleta_dados USING GIN (dados)`);
  } catch (e: any) {
    console.warn('GIN index skip:', e.message);
  }
  console.log('Índices 600k garantidos');
}

async function main() {
  const c = pgClient();
  await c.connect();
  console.log(`DB ${process.env.DATABASE_HOST}:${process.env.DATABASE_PORT}/${process.env.DATABASE_NAME}`);
  await garantirIndices(c);

  if (limpar) {
    const del = await c.query(
      `DELETE FROM servicos WHERE contract_id = $1 AND nome = $2 RETURNING id`,
      [CONTRACT_ID, NOME_SERVICO],
    );
    console.log(`Limpeza: ${del.rowCount} serviço(s) removido(s).`);
    await c.end();
    return;
  }

  let servicoId: string;

  if (somenteMedir) {
    const found = await c.query(
      `SELECT id FROM servicos WHERE contract_id = $1 AND nome = $2 LIMIT 1`,
      [CONTRACT_ID, NOME_SERVICO],
    );
    if (!found.rows[0]) throw new Error('Serviço de carga não encontrado. Rode sem --somente-medir primeiro.');
    servicoId = found.rows[0].id;
    console.log(`Medindo serviço existente ${servicoId}`);
  } else {
    const existing = await c.query(
      `SELECT id FROM servicos WHERE contract_id = $1 AND nome = $2 LIMIT 1`,
      [CONTRACT_ID, NOME_SERVICO],
    );
    if (existing.rows[0]) {
      await c.query(`DELETE FROM servicos WHERE id = $1`, [existing.rows[0].id]);
      console.log('Serviço anterior removido');
    }

    servicoId = randomUUID();
    await c.query(
      `INSERT INTO servicos (id, contract_id, nome, tipo, descricao, "configDashboard", "padraoPlanilha", "configFaturamento", "criadoEm", "atualizadoEm")
       VALUES ($1,$2,$3,'coleta_caminhao',$4,$5,$6,$7,NOW(),NOW())`,
      [
        servicoId,
        CONTRACT_ID,
        NOME_SERVICO,
        'Serviço sintético para teste de carga 600k coleta',
        JSON.stringify({ kpis: [], graficos: [] }),
        JSON.stringify({
          colunas: [
            { nome: 'DATA SAIDA', tipo: 'data' },
            { nome: 'PLACA', tipo: 'texto' },
            { nome: 'MOTORISTA', tipo: 'texto' },
            { nome: 'PESO TOTAL', tipo: 'numero' },
            { nome: 'KM TOTAL', tipo: 'numero' },
            { nome: 'TIPO CAMINHAO', tipo: 'texto' },
          ],
        }),
        JSON.stringify({
          ativo: true,
          valorTonelada: 120,
          valorTruck: 120,
          valorToco: 110,
          valorMini: 100,
        }),
      ],
    );

    const up = await c.query(
      `INSERT INTO planilha_uploads
        ("nomeArquivo","totalLinhas","linhasImportadas","linhasComErro","linhasIgnoradas","linhasSubstituidas","linhasConflitantes",estrategia,servico_id,resumo,"criadoEm")
       VALUES ($1,$2,$2,0,0,0,0,'ignorar',$3,$4,NOW())
       RETURNING id`,
      [
        `carga_coleta_${TOTAL}.xlsx`,
        TOTAL,
        servicoId,
        JSON.stringify({
          novos: TOTAL,
          viagensValidasDashboard: TOTAL,
        }),
      ],
    );
    const uploadId = up.rows[0].id as number;
    console.log(`Serviço ${servicoId} / upload ${uploadId} — inserindo ${TOTAL} linhas...`);

    const tIns = Date.now();
    let inseridos = 0;
    for (let offset = 0; offset < TOTAL; offset += BATCH) {
      const n = Math.min(BATCH, TOTAL - offset);
      const values: any[] = [];
      const placeholders: string[] = [];
      let p = 1;
      for (let i = 0; i < n; i++) {
        const idx = offset + i;
        const peso = 8000 + (idx % 7000);
        const km = 40 + (idx % 80);
        const viagens = 1 + (idx % 3);
        const horas = 4 + (idx % 8);
        const data = dataCiclo(idx);
        placeholders.push(
          `($${p++},$${p++}::date,$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++}::jsonb,$${p++})`,
        );
        values.push(
          uploadId,
          data,
          TURNOS[idx % TURNOS.length],
          REGIONAIS[idx % REGIONAIS.length],
          DISTRITOS[idx % DISTRITOS.length],
          placa(idx),
          MOTORISTAS[idx % MOTORISTAS.length],
          2 + (idx % 3),
          peso,
          km,
          TIPOS[idx % TIPOS.length],
          viagens,
          horas,
          true,
          JSON.stringify({
            'PESO TOTAL': peso,
            'KM TOTAL': km,
            'CONTADOR DE VIAGENS': viagens,
            'TIPO CAMINHAO': TIPOS[idx % TIPOS.length],
          }),
          (idx % 7) + 1,
        );
      }
      await c.query(
        `INSERT INTO coleta_dados
          ("planilhaUploadId","dataSaida",turno,regional,distrito,placa,motorista,"numeroColetores",
           "pesoTotal","kmTotal","tipoCaminhao","viagensPorRota","horasForaUnidade","validoDashboard",dados,"diaSemana")
         VALUES ${placeholders.join(',')}`,
        values,
      );
      inseridos += n;
      if (inseridos % 50_000 === 0 || inseridos === TOTAL) {
        const elapsed = ((Date.now() - tIns) / 1000).toFixed(1);
        const rate = Math.round(inseridos / ((Date.now() - tIns) / 1000));
        console.log(`  ${inseridos.toLocaleString('pt-BR')} / ${TOTAL.toLocaleString('pt-BR')} (${elapsed}s, ~${rate}/s)`);
      }
    }
    console.log(`Inserção OK em ${((Date.now() - tIns) / 1000).toFixed(1)}s`);
  }

  const stats = await c.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE "validoDashboard" = true)::int AS validos,
            to_char(MIN("dataSaida"), 'YYYY-MM-DD') AS min_d,
            to_char(MAX("dataSaida"), 'YYYY-MM-DD') AS max_d
     FROM coleta_dados c
     JOIN planilha_uploads u ON u.id = c."planilhaUploadId"
     WHERE u.servico_id = $1`,
    [servicoId],
  );
  console.log('Stats DB:', stats.rows[0]);
  await c.end();

  console.log('\n=== Benchmarks API ===');
  const token = await login();
  const base = `/api/contracts/${CONTRACT_ID}/servicos/${servicoId}`;
  const minD = String(stats.rows[0].min_d);
  const maxD = String(stats.rows[0].max_d);

  const endpoints = [
    `${base}/padrao`,
    `${base}/resumo-ciclo-por-dia?dataInicio=${minD}&dataFim=${maxD}`,
    `${base}/coleta/agregacao?dataInicio=${minD}&dataFim=${maxD}`,
    `${base}/coleta/agregacao?data=${minD}`,
    `${base}/dados-dia/${minD}?page=1&limit=100`,
    `${base}/kpi-operacional-motoristas?dataInicio=${minD}&dataFim=${maxD}`,
    `${base}/inconsistencias-viagens?revalidar=0`,
    `${base}/kpi-valores?dataInicio=${minD}&dataFim=${maxD}`,
    `${base}/kpi-exec-metrics?dataInicio=${minD}&dataFim=${maxD}`,
  ];

  for (const path of endpoints) {
    try {
      const r = await medir(token, path);
      console.log(
        `${r.status} ${String(r.ms).padStart(6)}ms  ${(r.bytes / 1024).toFixed(0).padStart(6)} KB  ${path.replace(base, '')}`,
      );
    } catch (e: any) {
      console.log(`FAIL ${path}: ${e.message}`);
    }
  }

  console.log('\n=== Resultado ===');
  console.log({
    servicoId,
    nome: NOME_SERVICO,
    registros: stats.rows[0].total,
    periodo: `${minD} → ${maxD}`,
    urlUI: `http://localhost:5175/contratos/${CONTRACT_ID}/servicos/${servicoId}`,
    nota: 'Coleta: KPIs/agregação/rankings/dados-dia paginado via SQL.',
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
