import { WhatsappInstancia } from '../entities/WhatsappInstancia';

export interface RegistroWhatsappInstancia {
  id: string;
  nomeInstancia: string;
  token: string;
  criadoEm: Date;
  ativo: boolean;
}

export interface WhatsappInstanciaRepositorio {
  obterAtiva(): Promise<RegistroWhatsappInstancia | null>;
  substituirAtiva(
    nomeInstancia: string,
    token: string,
  ): Promise<{ nova: RegistroWhatsappInstancia; anterior: RegistroWhatsappInstancia | null }>;
}

function mapear(row: Pick<WhatsappInstancia, 'id' | 'nomeInstancia' | 'token' | 'criadoEm' | 'ativo'>): RegistroWhatsappInstancia {
  return {
    id: row.id,
    nomeInstancia: row.nomeInstancia,
    token: row.token,
    criadoEm: row.criadoEm,
    ativo: row.ativo,
  };
}

/** Banco de controle. O import do data-source só acontece quando a tabela é lida. */
export function repositorioWhatsappInstanciaControl(): WhatsappInstanciaRepositorio {
  return {
    async obterAtiva() {
      const { getControlDataSource } = await import('../database/data-source');
      const row = await getControlDataSource().getRepository(WhatsappInstancia).findOne({
        where: { ativo: true },
        order: { criadoEm: 'DESC' },
      });
      return row ? mapear(row) : null;
    },
    async substituirAtiva(nomeInstancia, token) {
      const { getControlDataSource } = await import('../database/data-source');
      const ds = getControlDataSource();
      return ds.transaction(async (manager) => {
        const repo = manager.getRepository(WhatsappInstancia);
        const anterior = await repo.findOne({ where: { ativo: true } });
        if (anterior) {
          anterior.ativo = false;
          await repo.save(anterior);
        }
        const criada = await repo.save(repo.create({ nomeInstancia, token, ativo: true }));
        return {
          nova: mapear(criada),
          anterior: anterior ? mapear(anterior) : null,
        };
      });
    },
  };
}
