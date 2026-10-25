import * as XLSX from 'xlsx';

/** Colunas artefato do Excel (cabeçalho vazio → __EMPTY, __EMPTY_1, …) */
export function isNomeColunaInvalido(nome: string): boolean {
  const n = (nome || '').trim();
  if (!n) return true;
  if (n.startsWith('__EMPTY')) return true;
  return false;
}

/** Coluna sem nenhum valor preenchido em todas as linhas */
export function isColunaTotalmenteVazia(nulos: number, totalLinhas: number): boolean {
  return totalLinhas > 0 && nulos >= totalLinhas;
}

export interface ColunaDetectada {
  nome: string;
  tipo: 'numero' | 'texto' | 'data' | 'hora' | 'desconhecido';
  amostras: (string | number | null)[];
  valoresUnicos: number;
  nulos: number;
}

/**
 * Converte serial de hora do Excel (0..1) para string HH:mm
 */
function serialParaHora(serial: number): string {
  const totalMinutos = Math.round(serial * 24 * 60);
  const h = Math.floor(totalMinutos / 60);
  const m = totalMinutos % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

/**
 * Verifica se um valor se parece com hora (string)
 */
function pareceHoraString(valor: any): boolean {
  if (typeof valor !== 'string') return false;
  return /^\d{1,2}:\d{2}(:\d{2})?$/.test(valor.trim());
}

/**
 * Verifica se um número é serial de hora do Excel (0 < valor < 1)
 */
function pareceHoraSerial(valor: any): boolean {
  return typeof valor === 'number' && valor > 0 && valor < 1;
}

/**
 * Tenta converter string no formato brasileiro para número
 * Ex: "1.234,56" → 1234.56, "R$ 1.234,56" → 1234.56, "1.234" → 1234
 */
function converterNumeroBrasileiro(valor: string): number | null {
  let limpo = valor.trim().replace(/[R$\s]/g, '');
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(limpo) || /^\d+(,\d+)?$/.test(limpo)) {
    const numerico = parseFloat(limpo.replace(/\./g, '').replace(',', '.'));
    if (!isNaN(numerico) && numerico > 0) return numerico;
  }
  return null;
}

/**
 * Verifica se uma string parece data brasileira (dd/mm/aaaa ou dd/mm/aa)
 */
function pareceDataBrasileira(valor: any): boolean {
  if (typeof valor !== 'string') return false;
  return /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(valor.trim());
}

/**
 * Verifica se um número parece serial de data Excel (valor > 40000 e < 60000)
 */
function pareceDataSerial(valor: any): boolean {
  return typeof valor === 'number' && valor > 40000 && valor < 60000;
}

/**
 * Verifica se uma string parece número formatado no padrão brasileiro
 * Ex: "1.234,56", "1.234", "0,50", "R$ 1.234,56"
 */
function pareceNumeroBrasileiroString(valor: any): boolean {
  if (typeof valor !== 'string') return false;
  const limpo = valor.trim().replace(/[R$\s]/g, '');
  return /^\d{1,3}(\.\d{3})*(,\d+)?$/.test(limpo) || /^\d+(,\d+)?$/.test(limpo);
}

/**
 * Extrai o padrão (colunas + tipos) a partir de linhas já parseadas (objetos chave→valor).
 */
export function detectarPadraoDeObjetos(linhas: Record<string, any>[]): ColunaDetectada[] {
  if (!linhas.length) return [];

  const colunas = new Map<string, { valores: any[]; nulos: number }>();

  for (const linha of linhas) {
    if (!linha || typeof linha !== 'object') continue;
    for (const [chave, valor] of Object.entries(linha)) {
      if (!colunas.has(chave)) {
        colunas.set(chave, { valores: [], nulos: 0 });
      }
      const col = colunas.get(chave)!;
      if (valor === null || valor === undefined || valor === '') {
        col.nulos++;
      } else {
        col.valores.push(valor);
      }
    }
  }

  const resultado: ColunaDetectada[] = [];
  const totalLinhas = linhas.length;

  for (const [nome, info] of colunas.entries()) {
    if (isNomeColunaInvalido(nome)) continue;
    if (isColunaTotalmenteVazia(info.nulos, totalLinhas)) continue;

    const naoNulos = info.valores.filter(v => v !== null && v !== undefined && v !== '');
    const valoresUnicos = new Set(naoNulos.map(v => String(v))).size;
    const total = naoNulos.length;

    let tipo: ColunaDetectada['tipo'] = 'desconhecido';
    const nomeUpper = nome.toUpperCase().trim();

    if (total > 0) {
      const nomePareceHora =
        nomeUpper.includes('HORA') ||
        nomeUpper.includes('HORAR') ||
        nomeUpper.includes('TEMPO') ||
        nomeUpper.includes('DURAÇÃO') ||
        nomeUpper.includes('DURACAO') ||
        nomeUpper.includes('MINUTO');

      const horasPorSerial = naoNulos.filter(v => pareceHoraSerial(v)).length;
      const horasPorString = naoNulos.filter(v => pareceHoraString(v)).length;

      if (nomePareceHora || horasPorSerial > total * 0.5 || horasPorString > total * 0.5) {
        tipo = 'hora';
      } else if (
        nomeUpper.includes('DATA') ||
        nomeUpper.includes('DIA') ||
        naoNulos.filter(v => pareceDataSerial(v) || pareceDataBrasileira(v)).length > total * 0.5
      ) {
        tipo = 'data';
      } else {
        const nativosNumericos = naoNulos.filter(v => typeof v === 'number' || (!isNaN(Number(v)) && String(v).trim() !== '')).length;
        const brasileirosNumericos = naoNulos.filter(v => typeof v === 'string' && pareceNumeroBrasileiroString(v)).length;

        if (nativosNumericos > total * 0.5 || brasileirosNumericos > total * 0.3) {
          tipo = 'numero';
        } else {
          tipo = 'texto';
        }
      }
    }

    if (info.nulos > totalLinhas * 0.5 && tipo === 'desconhecido' && total > 0) {
      const apenasValidos = naoNulos;
      if (apenasValidos.length > 0) {
        const numericosValidos = apenasValidos.filter(v => typeof v === 'number' || (!isNaN(Number(v)) && String(v).trim() !== '')).length;
        const brValidos = apenasValidos.filter(v => typeof v === 'string' && pareceNumeroBrasileiroString(v)).length;

        if (numericosValidos > apenasValidos.length * 0.5 || brValidos > apenasValidos.length * 0.3) {
          tipo = 'numero';
        } else if (
          apenasValidos.filter(v => pareceDataSerial(v) || pareceDataBrasileira(v)).length > apenasValidos.length * 0.5
        ) {
          tipo = 'data';
        } else {
          tipo = 'texto';
        }
      }
    }

    const amostras = info.valores.slice(0, 5).map(v => {
      if (v === null || v === undefined) return null;
      if (tipo === 'hora' && pareceHoraSerial(v)) {
        return serialParaHora(v as number);
      }
      if (tipo === 'numero' && typeof v === 'string' && pareceNumeroBrasileiroString(v)) {
        const convertido = converterNumeroBrasileiro(v);
        if (convertido !== null) return convertido;
      }
      if (typeof v === 'number') return v;
      return String(v);
    });

    resultado.push({
      nome: nome.trim(),
      tipo,
      amostras,
      valoresUnicos,
      nulos: info.nulos,
    });
  }

  return resultado;
}

/**
 * Extrai o padrão (colunas + tipos) de um buffer de planilha XLSX
 * ⚡ HEURÍSTICAS MELHORADAS:
 * - Reconhece números formatados como texto no padrão brasileiro (1.234,56)
 * - Reconhece datas brasileiras em texto (dd/mm/aaaa)
 * - Colunas com >50% nulos recebem tipo da minoria não nula
 * - Analisa todas as linhas disponíveis
 */
export function detectarPadraoPlanilha(buffer: Buffer): ColunaDetectada[] {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const nomeAba = workbook.SheetNames[0];
  const sheet = workbook.Sheets[nomeAba];
  const linhas: Record<string, any>[] = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true });
  return detectarPadraoDeObjetos(linhas);
}
