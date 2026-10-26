import AppDataSource from '../database/data-source';

export interface CacheExecutivoLido {
  payload: Record<string, unknown>;
  calculadoEm: Date;
}

/** Chave estável do ciclo na tabela. O mês de referência vira AAAA-MM. */
export function chaveCicloExecutivo(consulta: {
  periodo?: string;
  mesReferencia?: number;
  anoReferencia?: number;
  dataInicio?: string;
  dataFim?: string;
  servicoId?: string;
}): string {
  const servico = consulta.servicoId ? `:s:${consulta.servicoId}` : '';
  const periodo = consulta.periodo || 'ciclo';
  if (periodo === 'ciclo' && consulta.mesReferencia && consulta.anoReferencia) {
    const mes = String(consulta.mesReferencia).padStart(2, '0');
    return `${consulta.anoReferencia}-${mes}${servico}`;
  }
  return `${periodo}:${consulta.dataInicio || ''}:${consulta.dataFim || ''}${servico}`;
}

export function cacheAindaVale(calculadoEm: Date, ultimaImportacao: Date | null): boolean {
  if (!ultimaImportacao) return true;
  return calculadoEm.getTime() >= ultimaImportacao.getTime();
}

const SQL_ULTIMA_IMPORTACAO = `
  SELECT MAX(u."criadoEm") AS ultima
  FROM planilha_uploads u
  INNER JOIN servicos s ON s.id = u.servico_id
  WHERE s.contract_id = $1
`;

export async function ultimaImportacaoDoContrato(contratoId: string): Promise<Date | null> {
  const linhas = await AppDataSource.query(SQL_ULTIMA_IMPORTACAO, [contratoId]) as { ultima: Date | string | null }[];
  const valor = linhas[0]?.ultima;
  if (!valor) return null;
  const data = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(data.getTime()) ? null : data;
}

export async function lerExecutivoCache(
  contratoId: string,
  ciclo: string,
): Promise<CacheExecutivoLido | null> {
  let linhas: { payload: Record<string, unknown>; calculado_em: Date | string }[];
  try {
    linhas = await AppDataSource.query(
      `
      SELECT payload, calculado_em
      FROM executivo_cache
      WHERE contrato_id = $1
        AND ciclo = $2
        AND calculado_em >= COALESCE((${SQL_ULTIMA_IMPORTACAO}), calculado_em)
      `,
      [contratoId, ciclo],
    );
  } catch (err) {
    const mensagem = (err as Error)?.message || '';
    if (/executivo_cache/i.test(mensagem) && /does not exist|não existe/i.test(mensagem)) return null;
    throw err;
  }
  const linha = linhas[0];
  if (!linha?.payload) return null;
  const calculadoEm = linha.calculado_em instanceof Date
    ? linha.calculado_em
    : new Date(linha.calculado_em);
  return { payload: linha.payload, calculadoEm };
}

export function marcarCacheTabela(
  payload: Record<string, unknown>,
  calculadoEm: Date,
): Record<string, unknown> {
  const meta = payload.metadados && typeof payload.metadados === 'object'
    ? payload.metadados as Record<string, unknown>
    : {};
  const idade = Math.max(0, Math.round((Date.now() - calculadoEm.getTime()) / 1000));
  return {
    ...payload,
    metadados: {
      ...meta,
      cacheHit: true,
      cacheIdadeSegundos: idade,
      cacheOrigem: 'tabela',
    },
  };
}

/** Não grava se uma importação entrou enquanto o cálculo rodava. */
export async function gravarExecutivoCache(
  contratoId: string,
  ciclo: string,
  payload: unknown,
  iniciadoEm: Date,
): Promise<void> {
  const ultima = await ultimaImportacaoDoContrato(contratoId);
  if (!cacheAindaVale(iniciadoEm, ultima)) {
    console.log(`[ExecutivoCache] cálculo de ${ciclo} descartado: importação mais nova`);
    return;
  }
  await AppDataSource.query(
    `
    INSERT INTO executivo_cache (contrato_id, ciclo, payload, calculado_em)
    VALUES ($1, $2, $3::jsonb, now())
    ON CONFLICT (contrato_id, ciclo)
    DO UPDATE SET payload = EXCLUDED.payload, calculado_em = now()
    `,
    [contratoId, ciclo, JSON.stringify(payload)],
  );
}

export async function invalidarExecutivoDoServico(
  servicoId: string,
  contractId?: string,
): Promise<void> {
  if (!AppDataSource.isInitialized) return;
  let contrato = contractId;
  if (!contrato) {
    const linhas = await AppDataSource.query(
      `SELECT contract_id FROM servicos WHERE id = $1 LIMIT 1`,
      [servicoId],
    ) as { contract_id: string | null }[];
    contrato = linhas[0]?.contract_id || undefined;
  }
  if (!contrato) return;
  try {
    await AppDataSource.query(
      `DELETE FROM executivo_cache WHERE contrato_id = $1`,
      [contrato],
    );
    console.log(`[ExecutivoCache] invalidado ${contrato}`);
  } catch (err) {
    console.warn('[ExecutivoCache] Falha ao invalidar:', (err as Error)?.message || err);
  }
}
