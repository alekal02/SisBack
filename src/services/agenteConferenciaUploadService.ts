/**
 * Agente de conferência no upload: conta rotas vs viagens, detecta retrabalho
 * da sala técnica (mesma operação com equipe diferente) e cruza com o que já
 * está no sistema (planilha do dia seguinte traz ontem + hoje).
 */
import * as XLSX from 'xlsx';
import { formatarDataPlanilha, parseDataPlanilha } from '../utils/formatarDataPlanilha';
import { encontrarChavePlanilha } from '../utils/encontrarChavePlanilha';
import { normalizarPlaca } from '../utils/normalizarPlaca';

export interface ParRetrabalhoUpload {
  linhas: number[];
  data: string | null;
  placa: string | null;
  distrito: string | null;
  motoristas: string[];
  kmTotal: number | null;
  pesoTotal: number | null;
  contador: number | null;
  motivo: string;
}

export interface RelatorioAgenteUpload {
  aba: string;
  linhasArquivo: number;
  rotasPlanilha: number;
  linhasTemplate: number;
  viagensContador: number;
  duplicatasExatas: ParRetrabalhoUpload[];
  retrabalhosMesmaRota: ParRetrabalhoUpload[];
  rotasJaNoSistema: number;
  rotasNovas: number;
  rotasConflitantes: number;
  mensagem: string;
  avisos: string[];
}

type LinhaAgente = {
  excel: number;
  data: string | null;
  placa: string | null;
  motorista: string;
  chaveOperacao: string;
  chaveEquipe: string;
  rota: boolean;
  template: boolean;
  contador: string;
};

function celula(obj: Record<string, unknown>, ...nomes: string[]): unknown {
  for (const n of nomes) {
    const ch = encontrarChavePlanilha(obj, n);
    if (ch) return obj[ch];
  }
  return null;
}

function txt(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

function num(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return 'NA';
  return String(Math.round(n * 10) / 10);
}

function parsearLinhasAgente(buffer: Buffer): { aba: string; linhasArquivo: number; linhas: LinhaAgente[] } {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false, raw: true });
  const aba = wb.SheetNames[0] || '';
  const sheet = wb.Sheets[aba];
  const aoa: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    blankrows: true,
    raw: true,
  });
  if (aoa.length < 2) {
    return { aba, linhasArquivo: aoa.length, linhas: [] };
  }
  const header = (aoa[0] || []).map((h) => String(h ?? ''));
  const linhas: LinhaAgente[] = [];

  for (let i = 1; i < aoa.length; i++) {
    const row = aoa[i] || [];
    const obj: Record<string, unknown> = {};
    header.forEach((h, idx) => {
      if (h && !h.startsWith('__EMPTY')) obj[h] = row[idx];
    });

    const dataRaw = celula(obj, 'DATA SAIDA', 'DATA SAÍDA', 'DATA DE SAIDA');
    const parsed = parseDataPlanilha(dataRaw);
    const data = formatarDataPlanilha(dataRaw) || (parsed ? formatarDataPlanilha(parsed) : null);
    const placaBruta = celula(obj, 'PLACA');
    const placa = normalizarPlaca(placaBruta ? String(placaBruta) : null) || txt(placaBruta) || null;
    const motorista = txt(celula(obj, 'MOTORISTA'));
    const turno = txt(celula(obj, 'TURNO')) || 'SEM_TURNO';
    const distrito = txt(celula(obj, 'DISTRITO')) || 'SEM_DISTRITO';
    const regional = txt(celula(obj, 'REGIONAL')) || 'SEM_REGIONAL';
    const kmSaida = num(celula(obj, 'KM SAIDA'));
    const kmTotal = num(celula(obj, 'KM TOTAL'));
    const pesoTotal = num(celula(obj, 'PESO TOTAL'));
    const contador = num(celula(obj, 'CONTADOR DE VIAGENS', 'CONTADOR VIAGENS'));
    const coletores = ['COLETOR 01', 'COLETOR 02', 'COLETOR 03', 'COLETOR 04']
      .map((c) => txt(celula(obj, c)))
      .filter(Boolean)
      .join('+');

    const temData = Boolean(data);
    const temPlaca = Boolean(placa);
    const kmN = Number(kmTotal);
    const pesoN = Number(pesoTotal);
    const template = !temData && !temPlaca && !(kmN > 0) && !(pesoN > 0);
    const rota = temData && temPlaca;

    linhas.push({
      excel: i + 1,
      data,
      placa,
      motorista,
      chaveOperacao: [
        data || 'SEM_DATA',
        placa || 'SEM_PLACA',
        turno,
        distrito,
        regional,
        kmSaida,
        kmTotal,
        pesoTotal,
        contador,
      ].join('|'),
      chaveEquipe: `${motorista}|${coletores}`,
      rota,
      template,
      contador,
    });
  }

  return { aba, linhasArquivo: aoa.length, linhas };
}

function parDeGrupo(grupo: LinhaAgente[], motivo: string): ParRetrabalhoUpload {
  return {
    linhas: grupo.map((g) => g.excel),
    data: grupo[0].data,
    placa: grupo[0].placa,
    distrito: null,
    motoristas: [...new Set(grupo.map((g) => g.motorista).filter(Boolean))],
    kmTotal: null,
    pesoTotal: null,
    contador: Number(grupo[0].contador) || null,
    motivo,
  };
}

function montarMensagem(r: Omit<RelatorioAgenteUpload, 'mensagem'>): string {
  const cabecalho = r.linhasArquivo > 0 ? 1 : 0;
  const partes = [
    `Excel (${r.aba || '1ª aba'}): ${r.linhasArquivo} linha(s) = ${cabecalho} cabeçalho + ${r.rotasPlanilha} rota(s)`
    + (r.linhasTemplate > 0 ? ` + ${r.linhasTemplate} template/rodapé` : '')
    + `.`,
    `Rotas operacionais: ${r.rotasPlanilha}. CONTADOR DE VIAGENS: ${r.viagensContador}.`,
  ];
  if (r.retrabalhosMesmaRota.length > 0) {
    const extra = r.retrabalhosMesmaRota.reduce((s, p) => s + p.linhas.length - 1, 0);
    const ex = r.retrabalhosMesmaRota[0];
    partes.push(
      `${extra} rota(s) repetem a mesma operação com equipe diferente`
      + ` (ex.: linhas ${ex.linhas.join(' e ')}, placa ${ex.placa || '—'}, ${ex.data || 'sem data'}`
      + (ex.motoristas.length ? `, motoristas: ${ex.motoristas.join(' / ')}` : '')
      + '). As duas ficam no sistema; confira se a sala técnica reenviou a mesma rota.',
    );
  }
  if (r.duplicatasExatas.length > 0) {
    partes.push(`${r.duplicatasExatas.length} grupo(s) com linhas iguais (mesma operação e mesma equipe) — só a primeira entra.`);
  }
  if (r.rotasJaNoSistema > 0 || r.rotasNovas > 0 || r.rotasConflitantes > 0) {
    partes.push(
      `Versus dados já no sistema: ${r.rotasNovas} nova(s), ${r.rotasJaNoSistema} já cadastrada(s), ${r.rotasConflitantes} conflitante(s) (mesmo dia/placa com equipe ou métrica diferente).`,
    );
  }
  return partes.join(' ');
}

export function analisarConferenciaPlanilha(buffer: Buffer, _nomeArquivo?: string): RelatorioAgenteUpload {
  const { aba, linhasArquivo, linhas } = parsearLinhasAgente(buffer);
  const rotas = linhas.filter((l) => l.rota);
  const templates = linhas.filter((l) => l.template);
  const viagensContador = rotas.reduce((s, l) => {
    const n = Number(l.contador);
    return s + (Number.isFinite(n) && n > 0 ? Math.round(n) : 0);
  }, 0);

  const porOperacao = new Map<string, LinhaAgente[]>();
  for (const l of rotas) {
    const arr = porOperacao.get(l.chaveOperacao) || [];
    arr.push(l);
    porOperacao.set(l.chaveOperacao, arr);
  }

  const duplicatasExatas: ParRetrabalhoUpload[] = [];
  const retrabalhosMesmaRota: ParRetrabalhoUpload[] = [];
  for (const grupo of porOperacao.values()) {
    if (grupo.length < 2) continue;
    const equipes = new Set(grupo.map((g) => g.chaveEquipe));
    if (equipes.size === 1) {
      duplicatasExatas.push(parDeGrupo(grupo, 'Linhas idênticas na planilha'));
    } else {
      retrabalhosMesmaRota.push(parDeGrupo(
        grupo,
        'Mesma data/placa/distrito/KM/peso com motorista ou coletores diferentes (possível retrabalho da sala técnica)',
      ));
    }
  }

  const avisos: string[] = [];
  if (retrabalhosMesmaRota.length > 0) {
    avisos.push(
      'Há rotas repetidas com nomes de equipe diferentes. Isso não é linha em branco: a sala técnica reescreveu a mesma operação. As duas linhas ficam no sistema.',
    );
  }

  const base: Omit<RelatorioAgenteUpload, 'mensagem'> = {
    aba,
    linhasArquivo,
    rotasPlanilha: rotas.length,
    linhasTemplate: templates.length,
    viagensContador,
    duplicatasExatas,
    retrabalhosMesmaRota,
    rotasJaNoSistema: 0,
    rotasNovas: rotas.length,
    rotasConflitantes: 0,
    avisos,
  };
  return { ...base, mensagem: montarMensagem(base) };
}

function chaveSistema(c: {
  dataSaida?: Date | string | null;
  placa?: string | null;
  turno?: string | null;
  distrito?: string | null;
  regional?: string | null;
  kmSaida?: number | null;
  kmTotal?: number | null;
  pesoTotal?: number | null;
  numeroViagens?: number | null;
  viagensPorRota?: number | null;
  motorista?: string | null;
}): string {
  const dataBr = formatarDataPlanilha(c.dataSaida)
    || (c.dataSaida instanceof Date ? c.dataSaida.toISOString().slice(0, 10) : String(c.dataSaida || 'SEM_DATA').slice(0, 10));
  return [
    dataBr,
    normalizarPlaca(c.placa) || txt(c.placa) || 'SEM_PLACA',
    txt(c.turno) || 'SEM_TURNO',
    txt(c.distrito) || 'SEM_DISTRITO',
    txt(c.regional) || 'SEM_REGIONAL',
    num(c.kmSaida),
    num(c.kmTotal),
    num(c.pesoTotal),
    num(c.numeroViagens ?? c.viagensPorRota),
  ].join('|');
}

export async function analisarConferenciaPlanilhaVsSistema(
  buffer: Buffer,
  nomeArquivo: string,
  servicoId?: string,
): Promise<RelatorioAgenteUpload> {
  const rel = analisarConferenciaPlanilha(buffer, nomeArquivo);
  if (!servicoId) return rel;

  const [{ default: AppDataSource }, { ColetaData }, { obterUploadIdsModificaveis }] = await Promise.all([
    import('../database/data-source'),
    import('../entities/ColetaData'),
    import('./cicloPlanilhaService'),
  ]);
  const uploadIds = await obterUploadIdsModificaveis(servicoId);
  if (!uploadIds.length) return rel;

  const existentes = await AppDataSource.getRepository(ColetaData)
    .createQueryBuilder('c')
    .where('c.planilhaUploadId IN (:...uploadIds)', { uploadIds })
    .getMany();

  const mapa = new Map<string, (typeof existentes)[number]>();
  for (const r of existentes) {
    const k = chaveSistema(r);
    if (!mapa.has(k)) mapa.set(k, r);
  }

  const { linhas } = parsearLinhasAgente(buffer);
  let rotasJaNoSistema = 0;
  let rotasNovas = 0;
  let rotasConflitantes = 0;
  for (const l of linhas.filter((x) => x.rota)) {
    const hit = mapa.get(l.chaveOperacao);
    if (!hit) {
      rotasNovas++;
      continue;
    }
    const motSis = txt(hit.motorista);
    if (motSis && l.motorista && motSis !== l.motorista) rotasConflitantes++;
    else rotasJaNoSistema++;
  }

  const avisos = [...rel.avisos];
  if (rotasJaNoSistema > 0 && rotasNovas > 0) {
    avisos.push(
      'A planilha mistura dias já importados com dias novos. O sistema atualiza os dias que já existem e acrescenta só o que falta.',
    );
  }

  const completo: Omit<RelatorioAgenteUpload, 'mensagem'> = {
    ...rel,
    rotasJaNoSistema,
    rotasNovas,
    rotasConflitantes,
    avisos,
  };
  return { ...completo, mensagem: montarMensagem(completo) };
}

export function textoAgenteWhatsapp(rel: RelatorioAgenteUpload): string {
  const linhas = [rel.mensagem, ...rel.avisos].filter(Boolean);
  return linhas.join('\n');
}
