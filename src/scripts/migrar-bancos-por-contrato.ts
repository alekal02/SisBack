/**
 * Divide o banco legado `abastecimento` em sistemma_control + contrato_<slug>.
 * NUNCA dá DROP no banco de origem. Idempotente.
 *
 * Dev:  npx ts-node --transpile-only src/scripts/migrar-bancos-por-contrato.ts
 * Destino (imagem): node dist/scripts/migrar-bancos-por-contrato.js
 */
import 'reflect-metadata';
import dotenv from 'dotenv';

dotenv.config();

import { DataSource } from 'typeorm';
import {
  criarDataSource,
  getControlDataSource,
  origemDatabaseName,
} from '../database/data-source';
import { Contract } from '../entities/Contract';
import { Servico } from '../entities/Servico';
import { PlanilhaUpload } from '../entities/PlanilhaUpload';
import { ColetaData } from '../entities/ColetaData';
import { Abastecimento } from '../entities/Abastecimento';
import { User } from '../entities/User';
import { Tenant } from '../entities/Tenant';
import { KpiUniversal } from '../entities/KpiUniversal';
import { GraficoPadraoConfig } from '../entities/GraficoPadraoConfig';
import { WhatsappGrupoMapa } from '../entities/WhatsappGrupoMapa';
import { WhatsappGrupoRoteamento } from '../entities/WhatsappGrupoRoteamento';
import { criarBancoSeNaoExiste } from '../services/tenantDatabaseService';
import { nomeBancoContrato, slugificarContrato } from '../utils/slugContrato';

const ORIGEM = origemDatabaseName();
const CONTROL = process.env.CONTROL_DATABASE_NAME || 'sistemma_control';

if (CONTROL === ORIGEM) {
  console.error('CONTROL_DATABASE_NAME não pode ser igual a DATABASE_NAME (origem).');
  process.exit(1);
}

function emBlocos<T>(itens: T[], tamanho: number): T[][] {
  const blocos: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) blocos.push(itens.slice(i, i + tamanho));
  return blocos;
}

/**
 * Insere preservando os ids da origem. É SQL na mão de propósito: tanto `save`
 * quanto o insert do query builder descartam o valor de colunas com id
 * automático, o que renumeraria os uploads e arrebentaria a ligação das
 * viagens. ON CONFLICT DO NOTHING deixa rodar de novo sem duplicar.
 */
async function copiarEntidades<T extends object>(
  destino: DataSource,
  Entity: new () => T,
  itens: T[],
): Promise<number> {
  const repo = destino.getRepository(Entity);
  if (itens.length === 0) return repo.count();

  const meta = repo.metadata;
  const colunas = meta.columns.filter((c) => !!c.databaseName && !c.isVirtual);
  const nomes = colunas.map((c) => `"${c.databaseName}"`).join(', ');

  for (const bloco of emBlocos(itens, 100)) {
    const params: unknown[] = [];
    const linhas = bloco.map((item) => {
      const marcadores = colunas.map((c) => {
        const bruto = c.getEntityValue(item as any);
        params.push(destino.driver.preparePersistentValue(bruto ?? null, c));
        return `$${params.length}`;
      });
      return `(${marcadores.join(', ')})`;
    });
    await destino.query(
      `INSERT INTO "${meta.tableName}" (${nomes}) VALUES ${linhas.join(', ')} ON CONFLICT DO NOTHING`,
      params,
    );
  }
  return repo.count();
}

/**
 * Depois de copiar linhas com id explícito, as sequences continuam no zero e o
 * próximo upload real quebraria com chave duplicada. Reposiciona todas elas.
 */
async function ajustarSequencias(destino: DataSource): Promise<void> {
  const colunas: Array<{ tabela: string; coluna: string }> = await destino.query(`
    SELECT table_name AS tabela, column_name AS coluna
    FROM information_schema.columns
    WHERE table_schema = 'public' AND column_default LIKE 'nextval%'
  `);
  for (const { tabela, coluna } of colunas) {
    await destino.query(`
      SELECT setval(
        pg_get_serial_sequence('"${tabela}"', '${coluna}'),
        GREATEST(COALESCE((SELECT MAX("${coluna}") FROM "${tabela}"), 0), 1)
      )
    `);
  }
}

async function main(): Promise<void> {
  console.log('=== Migrar bancos por contrato ===');
  console.log(`Origem (somente leitura): ${ORIGEM}`);
  console.log(`Controle: ${CONTROL}`);
  console.log('O banco de origem NÃO será apagado.\n');

  const origemDs = criarDataSource(ORIGEM, 'tenant');
  await origemDs.initialize();

  await criarBancoSeNaoExiste(CONTROL, origemDs);
  process.env.CONTROL_DATABASE_NAME = CONTROL;
  process.env.MULTI_TENANT = 'true';

  const controlDs = criarDataSource(CONTROL, 'control');
  if (!controlDs.isInitialized) await controlDs.initialize();

  const users = await origemDs.getRepository(User).find();
  const userRepo = controlDs.getRepository(User);
  let adminsPromovidos = 0;
  const novosUsuarios: User[] = [];
  for (const u of users) {
    const existente = await userRepo.findOne({ where: { id: u.id } });
    if (existente) continue;
    if (u.role === 'admin' && !u.contractId) {
      u.role = 'superadmin';
      adminsPromovidos += 1;
    }
    u.contractId = u.contractId ?? null;
    novosUsuarios.push(u);
  }
  await copiarEntidades(controlDs, User, novosUsuarios);
  const usuariosNoControle = await userRepo.count();

  const kpis = await origemDs.getRepository(KpiUniversal).find();
  const graficos = await origemDs.getRepository(GraficoPadraoConfig).find();
  if (kpis.length) await copiarEntidades(controlDs, KpiUniversal, kpis).catch(() => 0);
  if (graficos.length) await copiarEntidades(controlDs, GraficoPadraoConfig, graficos).catch(() => 0);
  await ajustarSequencias(controlDs);

  const contratos = await origemDs.getRepository(Contract).find();
  const tenantRepo = controlDs.getRepository(Tenant);
  const roteamentoRepo = controlDs.getRepository(WhatsappGrupoRoteamento);

  const relatorio: Array<Record<string, unknown>> = [];

  for (const contrato of contratos) {
    const nome = contrato.numeroContrato || contrato.id;
    let tenant = await tenantRepo.findOne({ where: { contractId: contrato.id } });
    if (!tenant) {
      const slugBase = slugificarContrato(nome);
      let slug = slugBase;
      let n = 2;
      while (await tenantRepo.findOne({ where: { slug } })) {
        slug = `${slugBase}_${n}`.slice(0, 50);
        n += 1;
      }
      tenant = tenantRepo.create({
        contractId: contrato.id,
        numeroContrato: nome,
        slug,
        databaseName: nomeBancoContrato(slug),
        status: contrato.status === 'encerrado' ? 'encerrado' : 'ativo',
      });
      await tenantRepo.save(tenant);
    }

    await criarBancoSeNaoExiste(tenant.databaseName, origemDs);
    const dest = criarDataSource(tenant.databaseName, 'tenant');
    if (!dest.isInitialized) await dest.initialize();

    const jaTinhaContrato = await dest.getRepository(Contract).count();
    const servicos = await origemDs.getRepository(Servico).find({
      where: { contract_id: contrato.id },
    });
    const servicoIds = servicos.map((s) => s.id);

    let uploads: PlanilhaUpload[] = [];
    let coletas: ColetaData[] = [];
    let mapas: WhatsappGrupoMapa[] = [];
    if (servicoIds.length > 0) {
      uploads = await origemDs.getRepository(PlanilhaUpload)
        .createQueryBuilder('u')
        .where('u.servico_id IN (:...ids)', { ids: servicoIds })
        .getMany();
      const uploadIds = uploads.map((u) => u.id);
      if (uploadIds.length > 0) {
        coletas = await origemDs.getRepository(ColetaData)
          .createQueryBuilder('c')
          .where('c.planilhaUploadId IN (:...ids)', { ids: uploadIds })
          .getMany();
      }
      mapas = await origemDs.getRepository(WhatsappGrupoMapa)
        .createQueryBuilder('m')
        .where('m.servicoId IN (:...ids)', { ids: servicoIds })
        .getMany();
    }

    const abastecimentos = await origemDs.getRepository(Abastecimento).find({
      where: { contract_id: contrato.id },
    });

    await copiarEntidades(dest, Contract, [contrato]);
    await copiarEntidades(dest, Servico, servicos);
    await copiarEntidades(dest, PlanilhaUpload, uploads);
    await copiarEntidades(dest, ColetaData, coletas);
    await copiarEntidades(dest, WhatsappGrupoMapa, mapas);
    await copiarEntidades(dest, Abastecimento, abastecimentos);
    if (kpis.length) await copiarEntidades(dest, KpiUniversal, kpis).catch(() => 0);
    if (graficos.length) await copiarEntidades(dest, GraficoPadraoConfig, graficos).catch(() => 0);
    await ajustarSequencias(dest);

    for (const m of mapas) {
      const existente = await roteamentoRepo.findOne({ where: { grupoJid: m.grupoJid } });
      if (existente) continue;
      await roteamentoRepo.save(roteamentoRepo.create({
        grupoJid: m.grupoJid,
        nomeGrupo: m.nomeGrupo,
        servicoId: m.servicoId,
        tenantDb: tenant.databaseName,
        contractId: contrato.id,
        ativo: m.ativo,
        estrategia: m.estrategia,
        responderPdf: m.responderPdf,
      }));
    }

    const destServicos = await dest.getRepository(Servico).count();
    const destUploads = await dest.getRepository(PlanilhaUpload).count();
    const destColetas = await dest.getRepository(ColetaData).count();

    relatorio.push({
      contrato: nome,
      banco: tenant.databaseName,
      origemServicos: servicos.length,
      destServicos,
      origemUploads: uploads.length,
      destUploads,
      origemColetas: coletas.length,
      destColetas,
      abastecimentos: abastecimentos.length,
      whatsapp: mapas.length,
      jaExistia: jaTinhaContrato > 0,
    });

    if (dest !== getControlDataSource() && dest.isInitialized) {
      await dest.destroy();
    }
  }

  const semContrato = await origemDs.getRepository(Abastecimento)
    .createQueryBuilder('a')
    .where('a.contract_id IS NULL')
    .getCount();

  console.log('\n=== Relatório ===');
  console.table(relatorio);
  console.log(`Usuários no controle: ${usuariosNoControle} de ${users.length} na origem (admins → superadmin: ${adminsPromovidos})`);
  console.log(`Abastecimentos sem contrato (ficam só em ${ORIGEM}): ${semContrato}`);
  console.log(`\nOrigem ${ORIGEM} intacta. Para ativar: MULTI_TENANT=true e CONTROL_DATABASE_NAME=${CONTROL}`);

  await origemDs.destroy();
  if (controlDs.isInitialized) await controlDs.destroy();
}

main().catch((err) => {
  console.error('Falha na migração (origem NÃO foi apagada):', err);
  process.exit(1);
});
