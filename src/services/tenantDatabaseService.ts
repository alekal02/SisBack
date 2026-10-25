import { DataSource } from 'typeorm';
import {
  criarDataSource,
  getControlDataSource,
  getOrCreateTenantDataSource,
  origemDatabaseName,
  runWithTenant,
} from '../database/data-source';
import { Tenant } from '../entities/Tenant';
import { afirmarNomeBanco, nomeBancoContrato, slugificarContrato } from '../utils/slugContrato';
import { seedKpisUniversais } from '../database/seedKpiUniversal';
import { seedGraficosPadrao } from '../database/seedGraficosPadrao';

function adminQuerySource(): DataSource {
  const control = getControlDataSource();
  if (control.isInitialized) return control;
  throw new Error('DataSource de controle não inicializado');
}

export async function bancoExiste(nome: string, via?: DataSource): Promise<boolean> {
  const ds = via ?? adminQuerySource();
  const rows: Array<{ exists: number }> = await ds.query(
    'SELECT 1 AS exists FROM pg_database WHERE datname = $1',
    [nome],
  );
  return rows.length > 0;
}

export async function criarBancoSeNaoExiste(nome: string, via?: DataSource): Promise<boolean> {
  const ds = via ?? adminQuerySource();
  const identificador = afirmarNomeBanco(nome);
  if (await bancoExiste(identificador, ds)) return false;
  await ds.query(`CREATE DATABASE ${identificador}`);
  return true;
}

export async function slugUnico(nomeContrato: string): Promise<{ slug: string; databaseName: string }> {
  const control = getControlDataSource();
  const repo = control.getRepository(Tenant);
  const base = slugificarContrato(nomeContrato);
  let slug = base;
  let n = 2;
  while (await repo.findOne({ where: { slug } })) {
    slug = `${base}_${n}`.slice(0, 50);
    n += 1;
  }
  return { slug, databaseName: nomeBancoContrato(slug) };
}

export async function provisionarBancoContrato(opts: {
  contractId: string;
  numeroContrato: string;
  slug?: string;
  databaseName?: string;
}): Promise<Tenant> {
  const { slug, databaseName } = opts.slug && opts.databaseName
    ? { slug: opts.slug, databaseName: opts.databaseName }
    : await slugUnico(opts.numeroContrato);

  await criarBancoSeNaoExiste(databaseName);
  const tenantDs = await getOrCreateTenantDataSource(databaseName);

  const control = getControlDataSource();
  const repo = control.getRepository(Tenant);
  let tenant = await repo.findOne({ where: { contractId: opts.contractId } });
  if (!tenant) {
    tenant = repo.create({
      contractId: opts.contractId,
      numeroContrato: opts.numeroContrato,
      slug,
      databaseName,
      status: 'ativo',
    });
    await repo.save(tenant);
  }

  await runWithTenant(databaseName, async () => {
    await seedKpisUniversais().catch(() => undefined);
    await seedGraficosPadrao().catch(() => undefined);
  });
  return tenant;
}

const CACHE_BANCO_TTL_MS = 60_000;
const cacheBancoPorContrato = new Map<string, { db: string; expiraEm: number }>();

/** Banco do contrato, com cache curto para não consultar o controle a cada request. */
export async function bancoDoContrato(contractId: string): Promise<string | null> {
  const emCache = cacheBancoPorContrato.get(contractId);
  if (emCache && emCache.expiraEm > Date.now()) return emCache.db;

  const control = getControlDataSource();
  if (!control.isInitialized) return null;
  const tenant = await control.getRepository(Tenant).findOne({ where: { contractId } });
  if (!tenant) return null;

  cacheBancoPorContrato.set(contractId, {
    db: tenant.databaseName,
    expiraEm: Date.now() + CACHE_BANCO_TTL_MS,
  });
  return tenant.databaseName;
}

export function esquecerBancoDoContrato(contractId?: string): void {
  if (contractId) cacheBancoPorContrato.delete(contractId);
  else cacheBancoPorContrato.clear();
}

export function criarDataSourceLegado(): DataSource {
  return criarDataSource(origemDatabaseName(), 'tenant');
}
