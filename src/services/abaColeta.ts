import * as XLSX from 'xlsx';

function normCab(s: string): string {
  return s
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Aba de coleta pelo cabeçalho (DATA SAIDA, PLACA, PESO 1), não pela primeira aba. */
export function nomeAbaColeta(workbook: XLSX.WorkBook): string {
  const alvos = ['DATA SAIDA', 'PLACA', 'PESO 1'];
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as unknown[][];
    const header = (rows[0] || []).map((c) => normCab(String(c ?? '')));
    const ok = alvos.every((alvo) => header.some((h) => h === alvo || h.includes(alvo)));
    if (ok) return name;
  }
  throw new Error('Nenhuma aba de coleta com os cabeçalhos DATA SAIDA, PLACA e PESO 1.');
}

/** Número da linha no Excel (1 = cabeçalho) das linhas não vazias, na ordem do sheet_to_json. */
export function linhasExcelPreenchidas(sheet: XLSX.WorkSheet): number[] {
  const ref = sheet['!ref'];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  const rows: number[] = [];
  for (let R = range.s.r + 1; R <= range.e.r; R++) {
    let vazia = true;
    for (let C = range.s.c; C <= range.e.c; C++) {
      const cell = sheet[XLSX.utils.encode_cell({ r: R, c: C })];
      if (cell && cell.v !== null && cell.v !== undefined && cell.v !== '') {
        vazia = false;
        break;
      }
    }
    if (!vazia) rows.push(R + 1);
  }
  return rows;
}

/**
 * Entre colunas que batem com a chave, prefere BASE e ignora ROTA
 * quando a chave pedida não é de rota. Assim KM/HORA CHEGADA não cai em ROTA 01.
 */
export function escolherChaveColuna(
  obj: Record<string, unknown>,
  key: string,
  normalizar: (s: string) => string,
): string | null {
  const tentativas = [key, key.trim(), ` ${key} `, ` ${key}`, `${key} `];
  for (const tentativa of tentativas) {
    if (
      Object.prototype.hasOwnProperty.call(obj, tentativa)
      && obj[tentativa] !== undefined
      && obj[tentativa] !== null
    ) {
      return tentativa;
    }
  }

  const keyNorm = normalizar(key);
  const querRota = /ROTA/i.test(key);
  const matches: string[] = [];
  for (const ch of Object.keys(obj)) {
    const chNorm = normalizar(ch);
    if (keyNorm.length > 0 && chNorm.includes(keyNorm)) {
      matches.push(ch);
      continue;
    }
    if (chNorm.length >= 5 && keyNorm.includes(chNorm)) matches.push(ch);
  }
  if (!matches.length) return null;
  const semRota = matches.filter((ch) => !/ROTA\s*\d/i.test(ch));
  const pool = !querRota && semRota.length ? semRota : matches;
  return pool.find((ch) => /BASE/i.test(ch)) || pool[0];
}
