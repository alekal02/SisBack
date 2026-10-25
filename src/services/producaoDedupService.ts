/**
 * Deduplicação das planilhas de produção (CONSOLIDADO / unificado / roçada).
 * Mesma ideia da coleta: se a linha já está no banco, não sobe de novo.
 */
import { EntityManager } from 'typeorm';
import AppDataSource from '../database/data-source';
import { ColetaData } from '../entities/ColetaData';
import { obterUploadIdsModificaveis } from './cicloPlanilhaService';
import { lerCampoDados, textoMaisLongo } from '../utils/textoColunaColeta';

function isoData(d: Date | string | null | undefined): string {
  if (!d) return '';
  if (typeof d === 'string') return String(d).slice(0, 10);
  try {
    return d.toISOString().slice(0, 10);
  } catch {
    return '';
  }
}

function normTxt(s: unknown): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

function qtdNorm(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0';
  return String(Math.round(n * 1000) / 1000);
}

function quantitativoDeDados(dados: Record<string, unknown> | null | undefined): unknown {
  if (!dados) return 0;
  return dados.QUANTITATIVO
    ?? dados.AREA_M2
    ?? dados['Area m²']
    ?? dados.KM_LINEAR
    ?? dados['KM Linear']
    ?? dados.METRO_LINEAR
    ?? dados.QTD_ARVORE
    ?? 0;
}

function localCompleto(c: Pick<ColetaData, 'distrito' | 'regional' | 'dados'>): string {
  const dados = (c.dados || {}) as Record<string, unknown>;
  return textoMaisLongo(
    lerCampoDados(dados, [
      'DISTRITO_COMPLETO',
      'LOCAL_COMPLETO',
      'LOGRADOURO',
      'LOCAL',
      'BAIRRO',
      'TRECHO',
      'DISTRITO',
    ]),
    c.distrito,
    c.regional,
  );
}

export function chaveProducaoColeta(c: Pick<ColetaData, 'dataSaida' | 'distrito' | 'regional' | 'tipoCaminhao' | 'turno' | 'motorista' | 'kmTotal' | 'dados'>): string {
  const dados = (c.dados || {}) as Record<string, unknown>;
  const qtd = quantitativoDeDados(dados) || c.kmTotal || 0;
  const local = localCompleto(c);
  const localNorm = normTxt(local);
  const setor = normTxt(lerCampoDados(dados, ['SETOR']));
  const observacao = normTxt(lerCampoDados(dados, ['OBSERVACAO', 'OBSERVAÇÃO']));
  return [
    isoData(c.dataSaida),
    localNorm,
    setor && setor !== localNorm ? setor : '',
    observacao,
    normTxt(c.tipoCaminhao || dados.Equipamento || dados.EQUIPAMENTO),
    normTxt(c.turno || dados.Equipe || dados.EQUIPE || dados.TIPO_EXECUCAO),
    normTxt(c.motorista || dados.Operador || dados.OPERADOR),
    qtdNorm(qtd),
  ].join('|');
}

export async function carregarChavesProducaoExistentes(
  servicoId: string,
  manager?: EntityManager,
): Promise<Set<string>> {
  const existentes = new Set<string>();
  const uploadIds = await obterUploadIdsModificaveis(servicoId, manager);
  if (!uploadIds.length) return existentes;
  const rows = await (manager ?? AppDataSource.manager).getRepository(ColetaData)
    .createQueryBuilder('c')
    .where('c.planilhaUploadId IN (:...uploadIds)', { uploadIds })
    .getMany();
  for (const r of rows) existentes.add(chaveProducaoColeta(r));
  return existentes;
}

export function filtrarColetasProducaoNovas<T>(
  linhas: T[],
  montar: (linha: T) => ColetaData,
  existentes: Set<string>,
): { novas: ColetaData[]; ignoradas: number } {
  const novas: ColetaData[] = [];
  const noArquivo = new Set<string>();
  let ignoradas = 0;
  for (const linha of linhas) {
    const coleta = montar(linha);
    const chave = chaveProducaoColeta(coleta);
    if (!chave || existentes.has(chave) || noArquivo.has(chave)) {
      ignoradas++;
      continue;
    }
    noArquivo.add(chave);
    existentes.add(chave);
    novas.push(coleta);
  }
  return { novas, ignoradas };
}
