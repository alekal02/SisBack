import { Repository } from 'typeorm';
import { KpiUniversal } from '../entities/KpiUniversal';

const CAMPOS_ATUALIZAVEIS: (keyof KpiUniversal)[] = [
  'label',
  'formula',
  'agregacao',
  'formato',
  'unidade',
  'categoria',
  'cor',
  'descricao',
  'metaSugerida',
  'placeholders',
];

function camposIguais(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Insere KPI de sistema ou atualiza metadados se já existir (nome + tipoServico). */
export async function upsertKpiSistema(
  repo: Repository<KpiUniversal>,
  kpiData: Partial<KpiUniversal>,
): Promise<'created' | 'updated' | 'skipped'> {
  const existente = await repo.findOne({
    where: {
      nome: kpiData.nome!,
      tipoServico: kpiData.tipoServico!,
    },
  });

  if (!existente) {
    const kpi = repo.create({ ...kpiData, isPersonalizado: false });
    await repo.save(kpi);
    return 'created';
  }

  if (existente.isPersonalizado) return 'skipped';

  let changed = false;
  for (const campo of CAMPOS_ATUALIZAVEIS) {
    const novo = kpiData[campo];
    if (novo !== undefined && !camposIguais(existente[campo], novo)) {
      Object.assign(existente, { [campo]: novo });
      changed = true;
    }
  }

  if (changed) await repo.save(existente);
  return changed ? 'updated' : 'skipped';
}

/** Renomeia KPI de sistema mantendo o registro (ex.: correção de nomenclatura). */
export async function renomearKpiSistema(
  repo: Repository<KpiUniversal>,
  nomeAntigo: string,
  nomeNovo: string,
  tipoServico: string,
  patch?: Partial<KpiUniversal>,
): Promise<void> {
  const kpi = await repo.findOne({ where: { nome: nomeAntigo, tipoServico } });
  if (!kpi || kpi.isPersonalizado) return;

  const jaExisteNovo = await repo.findOne({ where: { nome: nomeNovo, tipoServico } });
  if (jaExisteNovo && jaExisteNovo.id !== kpi.id) {
    await repo.remove(kpi);
    return;
  }

  kpi.nome = nomeNovo;
  if (patch) Object.assign(kpi, patch);
  await repo.save(kpi);
}
