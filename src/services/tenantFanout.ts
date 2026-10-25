/**
 * Leque por contrato: quando cada contrato tem banco próprio, as telas do gestor
 * precisam ler todos os bancos e juntar o resultado. Sem multi-tenant (banco único),
 * tudo continua rodando uma única vez no banco atual.
 */
import { In } from 'typeorm';
import AppDataSource, {
  getControlDataSource,
  getCurrentTenantDb,
  isMultiTenant,
  runWithTenant,
} from '../database/data-source';
import { Tenant } from '../entities/Tenant';
import { Servico } from '../entities/Servico';
import { ehGestorGlobal, TokenPayload } from '../middlewares/authMiddleware';

/** Gestor no hub (nenhum contrato escolhido) com bancos separados por contrato. */
export function ehHubDeContratos(usuario?: TokenPayload | null): boolean {
  return isMultiTenant() && ehGestorGlobal(usuario) && !usuario?.tenantDb;
}

/**
 * Prefixo de cache do banco em uso. Sem isso o painel do gestor e o de um
 * contrato compartilhariam a mesma entrada de cache em memória.
 */
export function escopoCacheTenant(): string {
  if (!isMultiTenant()) return 'unico';
  return getCurrentTenantDb() || 'controle';
}

export async function contratosComBanco(): Promise<Tenant[]> {
  const tenants = await getControlDataSource().getRepository(Tenant).find({
    order: { numeroContrato: 'ASC' },
  });
  return tenants.filter((t) => t.status !== 'encerrado');
}

/**
 * Executa a mesma leitura no banco de cada contrato. Um contrato que falhar não
 * derruba o painel inteiro: fica registrado no log e é ignorado.
 */
export async function emCadaContrato<T>(fn: (tenant: Tenant) => Promise<T>): Promise<T[]> {
  const tenants = await contratosComBanco();
  const saida: T[] = [];
  for (const tenant of tenants) {
    try {
      saida.push(await runWithTenant(tenant.databaseName, () => fn(tenant)));
    } catch (err: any) {
      console.error(
        `[tenantFanout] contrato "${tenant.numeroContrato}" (${tenant.databaseName}) falhou:`,
        err?.message || err,
      );
    }
  }
  return saida;
}

/**
 * Roda `fn` apenas nos contratos que contêm algum dos serviços pedidos, passando
 * só o subconjunto que existe naquele banco. Usado pelos gráficos que recebem
 * servicoIds sem saber em qual contrato cada um vive.
 */
export async function emCadaContratoComServicos<T>(
  servicoIds: string[],
  fn: (idsDoContrato: string[], tenant: Tenant) => Promise<T>,
): Promise<T[]> {
  if (servicoIds.length === 0) return [];
  const partes = await emCadaContrato(async (tenant) => {
    const encontrados = await AppDataSource.getRepository(Servico).find({
      where: { id: In(servicoIds) },
      select: ['id'],
    });
    if (encontrados.length === 0) return null;
    return fn(encontrados.map((s) => s.id), tenant);
  });
  return partes.filter((p): p is T => p !== null);
}

/** Junta listas de dias (yyyy-MM-dd) sem repetir e em ordem. */
export function unirDias(partes: Array<string[] | undefined>): string[] {
  const set = new Set<string>();
  for (const p of partes) for (const d of p || []) set.add(d);
  return [...set].sort();
}
