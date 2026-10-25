/**
 * Teste de carga: ~520 mil registros de roçada.
 * Uso: npx ts-node --transpile-only scripts/carga-rocada-500k.ts
 *
 * Opções:
 *   --somente-medir   não insere, só mede endpoints no serviço de carga
 *   --limpar          remove o serviço de carga e seus dados
 */
import 'dotenv/config';
import { Client } from 'pg';
import { randomUUID } from 'crypto';

const TOTAL = Number(process.env.CARGA_TOTAL || 520_000);
const BATCH = Number(process.env.CARGA_BATCH || 5_000);
const CONTRACT_ID = process.env.CARGA_CONTRACT_ID || '79dbd539-46e2-4820-b2f7-e04aafab952f';
const API = process.env.CARGA_API || 'http://localhost:3200';
const EMAIL = process.env.CARGA_EMAIL || 'admin@teste.com';
const SENHA = process.env.CARGA_SENHA || '123456';
const NOME_SERVICO = 'Carga Roçada 500k (teste)';

const args = new Set(process.argv.slice(2));
const somenteMedir = args.has('--somente-medir');
const limpar = args.has('--limpar');

const BAIRROS = [
  'Centro', 'JD Buriti Sereno', 'Esplanada', 'Industrial', 'Norte',
  'Sul', 'Leste', 'Oeste', 'Vila Nova', 'Parque das Águas',
];
const OPERADORES = ['TR01', 'TR02', 'TR03', 'TR04', 'TR05', 'TR06', 'TR07', 'TR08'];
const EQUIPES = ['Equipe 1', 'Equipe 2', 'Equipe 3', 'Equipe 4'];
const EQUIP = ['TRATOR', 'ROÇADEIRA', 'GIRO-ZERO', 'MECANIZADA'];

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
  // Espalha em ~60 dias a partir de 2026-04-01
  const day = 1 + (i % 60);
  const d = new Date(Date.UTC(2026, 3, day));
  return d.toISOString().slice(0, 10);
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

async function medir(token: string, path: string): Promise<{ ms: number; status: number; bytes: number; snippet: string }> {
  const t0 = Date.now();
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const ms = Date.now() - t0;
  return {
    ms,
    status: res.status,
    bytes: buf.length,
    snippet: buf.toString('utf8', 0, Math.min(180, buf.length)).replace(/\s+/g, ' '),
  };
}

async function main() {
  const c = pgClient();
  await c.connect();
  console.log(`DB ${process.env.DATABASE_HOST}:${process.env.DATABASE_PORT}/${process.env.DATABASE_NAME}`);

  if (limpar) {
    const del = await c.query(
      `DELETE FROM servicos WHERE contract_id = $1 AND nome = $2 RETURNING id`,
      [CONTRACT_ID, NOME_SERVICO],
    );
    console.log(`Limpeza: ${del.rowCount} serviço(s) removido(s) (cascade nos uploads/dados).`);
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
    // Remove carga anterior
    await c.query(
      `DELETE FROM servicos WHERE contract_id = $1 AND nome = $2`,
      [CONTRACT_ID, NOME_SERVICO],
    );

    servicoId = randomUUID();
    const padrao = {
      colunas: [
        { nome: 'DATA', tipo: 'data' },
        { nome: 'BAIRRO', tipo: 'texto' },
        { nome: 'Area m²', tipo: 'numero' },
        { nome: 'Equipamento', tipo: 'texto' },
        { nome: 'Operador', tipo: 'texto' },
        { nome: 'Equipe', tipo: 'texto' },
      ],
      totalLinhas: TOTAL,
      detectadoEm: new Date().toISOString(),
      modeloRocada: 'carga_sintetica',
    };

    await c.query(
      `INSERT INTO servicos (id, contract_id, nome, tipo, descricao, "configDashboard", "padraoPlanilha", "configFaturamento", "criadoEm", "atualizadoEm")
       VALUES ($1,$2,$3,'rocadeira',$4,$5,$6,$7,NOW(),NOW())`,
      [
        servicoId,
        CONTRACT_ID,
        NOME_SERVICO,
        'Serviço sintético para teste de carga 500k+',
        JSON.stringify({ kpis: [], graficos: [] }),
        JSON.stringify(padrao),
        JSON.stringify({ ativo: true, tipoCobranca: 'm2', valorM2: 0.43 }),
      ],
    );

    const up = await c.query(
      `INSERT INTO planilha_uploads
        ("nomeArquivo","totalLinhas","linhasImportadas","linhasComErro","linhasIgnoradas","linhasSubstituidas","linhasConflitantes",estrategia,servico_id,resumo,"criadoEm")
       VALUES ($1,$2,$2,0,0,0,0,'ignorar',$3,$4,NOW())
       RETURNING id`,
      [
        `carga_sintetica_${TOTAL}.xlsx`,
        TOTAL,
        servicoId,
        JSON.stringify({
          novos: TOTAL,
          viagensValidasDashboard: TOTAL,
          consolidacao: { registrosPreservados: 0, uploadsRemovidos: 0 },
        }),
      ],
    );
    const uploadId = up.rows[0].id as number;
    console.log(`Serviço ${servicoId} | upload ${uploadId} | inserindo ${TOTAL.toLocaleString('pt-BR')} linhas...`);

    const tIns = Date.now();
    let inseridos = 0;

    while (inseridos < TOTAL) {
      const n = Math.min(BATCH, TOTAL - inseridos);
      const values: unknown[] = [];
      const placeholders: string[] = [];
      let p = 1;

      for (let i = 0; i < n; i++) {
        const idx = inseridos + i;
        const data = dataCiclo(idx);
        const bairro = BAIRROS[idx % BAIRROS.length];
        const operador = OPERADORES[idx % OPERADORES.length];
        const equipe = EQUIPES[idx % EQUIPES.length];
        const equipamento = EQUIP[idx % EQUIP.length];
        const area = Math.round((80 + (idx % 900) + (idx % 17) * 0.37) * 100) / 100;
        const dados = {
          DATA: data,
          BAIRRO: bairro,
          'Area m²': area,
          AREA_M2: area,
          M2: area,
          AREA_ROCADA: area,
          Equipamento: equipamento,
          EQUIPAMENTO: equipamento,
          Operador: operador,
          OPERADOR: operador,
          Equipe: equipe,
          EQUIPE: equipe,
          _tipoServico: 'rocadeira',
          _modeloPlanilha: 'carga_sintetica',
        };

        placeholders.push(
          `($${p++},$${p++}::date,$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++}::jsonb,$${p++},$${p++})`,
        );
        values.push(
          uploadId,
          data,
          equipe.slice(0, 20),
          bairro.slice(0, 50),
          null, // distrito
          operador.slice(0, 100),
          equipamento.slice(0, 30),
          1, // numeroViagens
          1, // viagensPorRota
          true, // validoDashboard
          JSON.stringify(dados),
          ((new Date(`${data}T12:00:00Z`).getUTCDay() + 1)),
          null, // motivos
        );
      }

      await c.query(
        `INSERT INTO coleta_dados
          ("planilhaUploadId","dataSaida",turno,regional,distrito,motorista,"tipoCaminhao",
           "numeroViagens","viagensPorRota","validoDashboard",dados,"diaSemana","motivosInconsistencia")
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

    const count = await c.query(
      `SELECT COUNT(*)::int AS n FROM coleta_dados WHERE "planilhaUploadId" = $1`,
      [uploadId],
    );
    console.log(`Inserção OK em ${((Date.now() - tIns) / 1000).toFixed(1)}s — COUNT=${count.rows[0].n}`);
  }

  // Contagens
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

  // Benchmarks HTTP
  console.log('\n=== Benchmarks API ===');
  const token = await login();
  const base = `/api/contracts/${CONTRACT_ID}/servicos/${servicoId}`;
  const minD = String(stats.rows[0].min_d);
  const maxD = String(stats.rows[0].max_d);

  const endpoints = [
    `${base}/padrao`,
    `${base}/resumo-ciclo-por-dia?dataInicio=${minD}&dataFim=${maxD}`,
    `${base}/rocada/agregacao?dataInicio=${minD}&dataFim=${maxD}`,
    `${base}/rocada/agregacao?data=${minD}`,
    `${base}/dados-dia/${minD}?page=1&limit=100`,
    `${base}/inconsistencias-viagens?revalidar=0`,
    `${base}/verificacao-viagens`,
    `${base}/kpi-valores?dataInicio=${minD}&dataFim=${maxD}`,
  ];

  const resultados: Array<Record<string, unknown>> = [];
  for (const path of endpoints) {
    try {
      const r = await medir(token, path);
      resultados.push({ path: path.replace(base, ''), ...r });
      console.log(
        `${r.status} ${String(r.ms).padStart(6)}ms  ${(r.bytes / 1024).toFixed(0).padStart(6)} KB  ${path.replace(base, '')}`,
      );
    } catch (e: any) {
      console.log(`FAIL ${path}: ${e.message}`);
      resultados.push({ path, error: e.message });
    }
  }

  const resumoRes = await fetch(
    `${API}${base}/resumo-ciclo-por-dia?dataInicio=${minD}&dataFim=${maxD}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const resumo = await resumoRes.json() as any;

  console.log('\n=== Resultado ===');
  console.log({
    servicoId,
    nome: NOME_SERVICO,
    registros: stats.rows[0].total,
    validos: stats.rows[0].validos,
    periodo: `${minD} → ${maxD}`,
    cicloRotas: resumo.totais?.rotas,
    cicloAreaM2: resumo.totais?.areaM2,
    diasComDados: resumo.dias?.length,
    urlUI: `http://localhost:5175/contratos/${CONTRACT_ID}/servicos/${servicoId}`,
    nota: 'Roçada: ciclo, agregação, KPIs e dados-dia paginado usam SQL — não materializam 500k linhas.',
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
