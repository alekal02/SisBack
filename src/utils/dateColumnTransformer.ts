import type { ValueTransformer } from 'typeorm';

/** yyyy-MM-dd a partir de Date (sempre componentes UTC — evita −1 dia em UTC−3) */
export function dateUtcParaIso(val: Date): string {
  const y = val.getUTCFullYear();
  const m = String(val.getUTCMonth() + 1).padStart(2, '0');
  const d = String(val.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Date meia-noite UTC a partir de yyyy-MM-dd (Postgres date) */
export function isoParaDateUtc(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * TypeORM `date` ↔ JS Date sem deslocamento de fuso.
 * Sem isso, 26/06 UTC vira 25/06 no banco em máquinas UTC−3.
 */
export const dateUtcColumnTransformer: ValueTransformer = {
  to(value: Date | string | null | undefined): string | null {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'string') {
      const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
      return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
    }
    if (value instanceof Date && !isNaN(value.getTime())) {
      return dateUtcParaIso(value);
    }
    return null;
  },
  from(value: string | Date | null | undefined): Date | null {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date && !isNaN(value.getTime())) {
      return isoParaDateUtc(dateUtcParaIso(value));
    }
    const s = String(value).trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    return isoParaDateUtc(`${m[1]}-${m[2]}-${m[3]}`);
  },
};
