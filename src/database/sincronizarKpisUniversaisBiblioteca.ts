/**
 * Sincroniza a biblioteca de KPIs universais com o catálogo do código.
 * Remove KPIs de sistema (isPersonalizado=false) que não existem mais nos seeds.
 *
 * Executada automaticamente no startup após os seeds.
 */
import AppDataSource from './data-source';
import { KpiUniversal } from '../entities/KpiUniversal';
import { buildKpisUniversaisPrincipais } from './seedKpiUniversal';
import { buildKpisUniversaisExtraNovos } from './seedKpiUniversalExtra';
import { buildKpisUniversaisReceita } from './seedKpiUniversalReceita';
import {
  KPIS_UNIVERSAIS_REMOVIDOS_COLETA,
  KPIS_UNIVERSAIS_NOMES_LEGADOS,
  chaveCatalogoKpiUniversal,
} from '../services/kpiDeduplicacaoService';

export interface ResultadoSyncKpisUniversais {
  removidosObsoletos: number;
  removidosForaCatalogo: number;
  removidosDuplicados: number;
  totalCatalogo: number;
  totalRestante: number;
}

function montarCatalogoCanônico(): Set<string> {
  const catalogo = new Set<string>();
  const definicoes = [
    ...buildKpisUniversaisPrincipais(),
    ...buildKpisUniversaisExtraNovos(),
    ...buildKpisUniversaisReceita(),
  ];

  for (const kpi of definicoes) {
    if (!kpi.nome || !kpi.tipoServico) continue;
    if (KPIS_UNIVERSAIS_REMOVIDOS_COLETA.includes(kpi.nome as (typeof KPIS_UNIVERSAIS_REMOVIDOS_COLETA)[number])) {
      continue;
    }
    catalogo.add(chaveCatalogoKpiUniversal(kpi.nome, kpi.tipoServico));
  }

  return catalogo;
}

export async function sincronizarKpisUniversaisBiblioteca(): Promise<ResultadoSyncKpisUniversais> {
  if (process.env.SYNC_KPIS_UNIVERSAIS === 'false') {
    console.log('[syncKpisUniversais] Desabilitado (SYNC_KPIS_UNIVERSAIS=false).');
    return {
      removidosObsoletos: 0,
      removidosForaCatalogo: 0,
      removidosDuplicados: 0,
      totalCatalogo: 0,
      totalRestante: 0,
    };
  }

  const repo = AppDataSource.getRepository(KpiUniversal);
  const catalogo = montarCatalogoCanônico();
  let removidosObsoletos = 0;
  let removidosForaCatalogo = 0;
  let removidosDuplicados = 0;

  const nomesParaRemover = [
    ...KPIS_UNIVERSAIS_REMOVIDOS_COLETA,
    ...KPIS_UNIVERSAIS_NOMES_LEGADOS,
  ];

  for (const nome of nomesParaRemover) {
    const obsoletos = await repo.find({ where: { nome, isPersonalizado: false } });
    if (obsoletos.length > 0) {
      await repo.remove(obsoletos);
      removidosObsoletos += obsoletos.length;
    }
  }

  const sistema = await repo.find({ where: { isPersonalizado: false } });
  const foraCatalogo = sistema.filter(
    (kpi) => !catalogo.has(chaveCatalogoKpiUniversal(kpi.nome, kpi.tipoServico)),
  );
  if (foraCatalogo.length > 0) {
    await repo.remove(foraCatalogo);
    removidosForaCatalogo = foraCatalogo.length;
  }

  const restantes = await repo.find({ where: { isPersonalizado: false } });
  const porChave = new Map<string, KpiUniversal[]>();
  for (const kpi of restantes) {
    const chave = chaveCatalogoKpiUniversal(kpi.nome, kpi.tipoServico);
    const grupo = porChave.get(chave) || [];
    grupo.push(kpi);
    porChave.set(chave, grupo);
  }

  const duplicadosParaRemover: KpiUniversal[] = [];
  for (const grupo of porChave.values()) {
    if (grupo.length <= 1) continue;
    grupo.sort((a, b) => a.criadoEm.getTime() - b.criadoEm.getTime());
    duplicadosParaRemover.push(...grupo.slice(1));
  }
  if (duplicadosParaRemover.length > 0) {
    await repo.remove(duplicadosParaRemover);
    removidosDuplicados = duplicadosParaRemover.length;
  }

  const totalRestante = await repo.count({ where: { isPersonalizado: false } });
  const resultado: ResultadoSyncKpisUniversais = {
    removidosObsoletos,
    removidosForaCatalogo,
    removidosDuplicados,
    totalCatalogo: catalogo.size,
    totalRestante,
  };

  const totalRemovidos = removidosObsoletos + removidosForaCatalogo + removidosDuplicados;
  if (totalRemovidos > 0) {
    console.log(
      `[syncKpisUniversais] ✅ Biblioteca sincronizada: -${totalRemovidos} obsoletos ` +
        `(lista=${removidosObsoletos}, fora catálogo=${removidosForaCatalogo}, duplicados=${removidosDuplicados}). ` +
        `Catálogo=${catalogo.size}, restantes=${totalRestante}`,
    );
  } else {
    console.log(`[syncKpisUniversais] Biblioteca OK (${totalRestante} KPIs de sistema, catálogo=${catalogo.size}).`);
  }

  return resultado;
}

if (require.main === module) {
  (async () => {
    try {
      await AppDataSource.initialize();
      const r = await sincronizarKpisUniversaisBiblioteca();
      console.log(JSON.stringify(r, null, 2));
      await AppDataSource.destroy();
      process.exit(0);
    } catch (err) {
      console.error('[syncKpisUniversais] Erro:', err);
      process.exit(1);
    }
  })();
}
