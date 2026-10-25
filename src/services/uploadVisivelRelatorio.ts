/**
 * Relatório de produção.
 * O upload mais recente de cada dia define quais locais entram.
 * Se um reenvio gravou só as linhas novas, os locais que já existiam
 * no envio anterior continuam no mesmo dia. Local que não aparece
 * em nenhum upload recente fica de fora. Ciclo fechado prevalece.
 * Se o envio recente tem a metade ou menos dos locais do dia, ele não
 * apaga os setores que já estavam no envio anterior.
 */
export interface CandidatoUploadDia {
  uploadId: number;
  criadoEm: number;
  fechado: boolean;
}

export interface LinhaRelatorioProducao extends CandidatoUploadDia {
  dia: string;
  local: string;
  valor: number;
}

export function escolherUploadDoDia(candidatos: CandidatoUploadDia[]): number | null {
  if (candidatos.length === 0) return null;
  const ordenados = [...candidatos].sort((a, b) => {
    if (a.fechado !== b.fechado) return a.fechado ? -1 : 1;
    return b.criadoEm - a.criadoEm;
  });
  return ordenados[0].uploadId;
}

export function normalizarLocalRelatorio(local: string): string {
  return String(local || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

export function linhasVisiveisNoRelatorio(linhas: LinhaRelatorioProducao[]): LinhaRelatorioProducao[] {
  const porDia = new Map<string, LinhaRelatorioProducao[]>();
  for (const linha of linhas) {
    const lista = porDia.get(linha.dia) || [];
    lista.push(linha);
    porDia.set(linha.dia, lista);
  }

  let maxNoUploadRecente = 0;
  let maxNoDia = 0;
  const locaisDoRecente = new Map<string, Set<string>>();
  for (const [dia, lista] of porDia) {
    const uploadId = escolherUploadDoDia(lista);
    const doRecente = new Set<string>();
    const doDia = new Set<string>();
    for (const linha of lista) {
      const local = normalizarLocalRelatorio(linha.local);
      if (!local) continue;
      doDia.add(local);
      if (linha.uploadId === uploadId) doRecente.add(local);
    }
    locaisDoRecente.set(dia, doRecente);
    maxNoUploadRecente = Math.max(maxNoUploadRecente, doRecente.size);
    maxNoDia = Math.max(maxNoDia, doDia.size);
  }
  // Reenvio com metade (ou menos) dos setores: não esconde o que já estava no dia.
  const reenvioIncompleto = maxNoUploadRecente > 0 && maxNoUploadRecente * 2 <= maxNoDia;

  const locaisValidos = new Set<string>();
  for (const [dia, lista] of porDia) {
    if (reenvioIncompleto) {
      for (const linha of lista) {
        const local = normalizarLocalRelatorio(linha.local);
        if (local) locaisValidos.add(local);
      }
      continue;
    }
    for (const local of locaisDoRecente.get(dia) || []) locaisValidos.add(local);
  }

  const porDiaLocal = new Map<string, LinhaRelatorioProducao[]>();
  for (const linha of linhas) {
    const local = normalizarLocalRelatorio(linha.local);
    if (!local || !locaisValidos.has(local)) continue;
    const chave = `${linha.dia}|${local}`;
    const lista = porDiaLocal.get(chave) || [];
    lista.push(linha);
    porDiaLocal.set(chave, lista);
  }

  const visiveis: LinhaRelatorioProducao[] = [];
  for (const lista of porDiaLocal.values()) {
    const uploadId = escolherUploadDoDia(lista);
    visiveis.push(...lista.filter((linha) => linha.uploadId === uploadId));
  }
  return visiveis;
}

export function somarLinhasVisiveis(linhas: LinhaRelatorioProducao[]): number {
  const total = linhasVisiveisNoRelatorio(linhas).reduce((soma, linha) => soma + linha.valor, 0);
  return Math.round(total * 1000) / 1000;
}

/** Mantém, por dia e local, o upload vigente. Reenvio pela metade não apaga setor antigo. */
export function sqlSomenteUploadVigenteDoDia(alias: string): string {
  const localNorm = (a: string) =>
    `upper(trim(COALESCE(NULLIF(${a}.distrito, ''), NULLIF(${a}.regional, ''), '')))`;
  const vencedores = `
    SELECT upload_id, dia FROM (
      SELECT DISTINCT ON (dia) upload_id, dia
      FROM (
        SELECT nv."planilhaUploadId" AS upload_id,
               TO_CHAR(nv."dataSaida", 'YYYY-MM-DD') AS dia,
               uv."criadoEm" AS criado,
               uv."cicloFechadoEm" AS fechado
        FROM coleta_dados nv
        INNER JOIN planilha_uploads uv ON uv.id = nv."planilhaUploadId"
        WHERE nv."planilhaUploadId" IN (:...uploadIds)
          AND nv."validoDashboard" IS TRUE
          AND ${localNorm('nv')} <> ''
      ) dias_upload
      ORDER BY dia, (fechado IS NULL) ASC, criado DESC
    ) vencedores
  `;
  const reenvioIncompleto = `
    COALESCE((
      SELECT MAX(qtd) FROM (
        SELECT COUNT(DISTINCT ${localNorm('a')}) AS qtd
        FROM coleta_dados a
        WHERE a."planilhaUploadId" IN (:...uploadIds)
          AND a."validoDashboard" IS TRUE
          AND ${localNorm('a')} <> ''
          AND (a."planilhaUploadId", TO_CHAR(a."dataSaida", 'YYYY-MM-DD')) IN (${vencedores})
        GROUP BY TO_CHAR(a."dataSaida", 'YYYY-MM-DD')
      ) por_dia_recente
    ), 0) * 2
    <=
    COALESCE((
      SELECT MAX(qtd) FROM (
        SELECT COUNT(DISTINCT ${localNorm('b')}) AS qtd
        FROM coleta_dados b
        WHERE b."planilhaUploadId" IN (:...uploadIds)
          AND b."validoDashboard" IS TRUE
          AND ${localNorm('b')} <> ''
        GROUP BY TO_CHAR(b."dataSaida", 'YYYY-MM-DD')
      ) por_dia_todos
    ), 0)
  `;
  return `${alias}.id IN (
    SELECT id FROM (
      SELECT c_loc.id,
        ROW_NUMBER() OVER (
          PARTITION BY TO_CHAR(c_loc."dataSaida", 'YYYY-MM-DD'), ${localNorm('c_loc')}
          ORDER BY CASE WHEN u_loc."cicloFechadoEm" IS NULL THEN 1 ELSE 0 END,
                   u_loc."criadoEm" DESC,
                   c_loc.id DESC
        ) AS rn
      FROM coleta_dados c_loc
      INNER JOIN planilha_uploads u_loc ON u_loc.id = c_loc."planilhaUploadId"
      WHERE c_loc."planilhaUploadId" IN (:...uploadIds)
        AND c_loc."validoDashboard" IS TRUE
        AND ${localNorm('c_loc')} <> ''
        AND ${localNorm('c_loc')} IN (
          SELECT DISTINCT ${localNorm('n')}
          FROM coleta_dados n
          WHERE n."planilhaUploadId" IN (:...uploadIds)
            AND n."validoDashboard" IS TRUE
            AND ${localNorm('n')} <> ''
            AND (
              (n."planilhaUploadId", TO_CHAR(n."dataSaida", 'YYYY-MM-DD')) IN (${vencedores})
              OR (${reenvioIncompleto})
            )
        )
    ) escolhidos
    WHERE rn = 1
  )`;
}
