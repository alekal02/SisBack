import 'reflect-metadata';
import { AsyncLocalStorage } from 'node:async_hooks';
import { DataSource } from 'typeorm';
import { CONTROL_ENTITIES, TENANT_ENTITIES } from './entities';

type TenantStore = { ds: DataSource; databaseName: string };

const als = new AsyncLocalStorage<TenantStore>();
const tenantCache = new Map<string, DataSource>();

export function isMultiTenant(): boolean {
  return process.env.MULTI_TENANT === 'true';
}

export function controlDatabaseName(): string {
  if (isMultiTenant()) {
    return process.env.CONTROL_DATABASE_NAME || 'sistemma_control';
  }
  return process.env.DATABASE_NAME || 'abastecimento';
}

export function origemDatabaseName(): string {
  return process.env.DATABASE_NAME || 'abastecimento';
}

/**
 * Em produção não logamos toda query, só as demoradas: é o que permite achar o
 * gargalo de uma tela lenta sem inundar o log. Ajuste com DB_LOG_SLOW_MS.
 */
function configLog() {
  if (process.env.NODE_ENV === 'development') {
    return { logging: true as const };
  }
  const limite = parseInt(process.env.DB_LOG_SLOW_MS || '0', 10);
  if (limite > 0) {
    return { logging: ['warn', 'error'] as ('warn' | 'error')[], maxQueryExecutionTime: limite };
  }
  return { logging: ['error'] as 'error'[] };
}

function sslDaUrl(): { rejectUnauthorized: false } | undefined {
  if (!process.env.DATABASE_URL) return undefined;
  if (process.env.DATABASE_SSL === 'false') return undefined;
  return { rejectUnauthorized: false };
}

function postgresBase() {
  const ssl = sslDaUrl();
  const pool = {
    max: parseInt(process.env.DB_POOL_MAX || '8', 10),
    idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_MS || '10000', 10),
    connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECT_MS || '20000', 10),
    options: `-c statement_timeout=${parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || '120000', 10)}`,
    ...(ssl ? { ssl } : {}),
  };
  const comum = {
    synchronize: process.env.TYPEORM_SYNCHRONIZE === 'true',
    migrationsRun: false,
    ...configLog(),
    extra: pool,
    ...(ssl ? { ssl } : {}),
  };

  if (process.env.DATABASE_URL) {
    return {
      type: 'postgres' as const,
      url: process.env.DATABASE_URL,
      ...comum,
    };
  }

  return {
    type: 'postgres' as const,
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '5432', 10),
    username: process.env.DATABASE_USER || 'neurai',
    password: process.env.DATABASE_PASSWORD || '',
    ...comum,
  };
}

export function criarDataSource(database: string, modo: 'control' | 'tenant'): DataSource {
  const base = postgresBase();
  return new DataSource({
    ...base,
    ...(process.env.DATABASE_URL ? {} : { database }),
    entities: modo === 'control' && isMultiTenant() ? CONTROL_ENTITIES : TENANT_ENTITIES,
  });
}

const ControlDataSource = criarDataSource(
  controlDatabaseName(),
  isMultiTenant() ? 'control' : 'tenant',
);

export function getControlDataSource(): DataSource {
  return ControlDataSource;
}

export function getCurrentTenantDb(): string | null {
  return als.getStore()?.databaseName ?? null;
}

function activeDataSource(): DataSource {
  return als.getStore()?.ds ?? ControlDataSource;
}

export async function getOrCreateTenantDataSource(databaseName: string): Promise<DataSource> {
  const cached = tenantCache.get(databaseName);
  if (cached?.isInitialized) return cached;

  const ds = cached ?? criarDataSource(databaseName, 'tenant');
  if (!ds.isInitialized) {
    await ds.initialize();
  }
  tenantCache.set(databaseName, ds);
  return ds;
}

export async function runWithTenant<T>(databaseName: string, fn: () => Promise<T> | T): Promise<T> {
  const ds = await getOrCreateTenantDataSource(databaseName);
  return als.run({ ds, databaseName }, fn);
}

export function runWithTenantSync<T>(ds: DataSource, databaseName: string, fn: () => T): T {
  return als.run({ ds, databaseName }, fn);
}

const AppDataSource = new Proxy(ControlDataSource, {
  get(_target, prop) {
    const ds = activeDataSource();
    const value = Reflect.get(ds, prop, ds);
    if (typeof value === 'function') return value.bind(ds);
    return value;
  },
}) as DataSource;

export default AppDataSource;
