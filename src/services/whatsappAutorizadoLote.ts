import { getControlDataSource } from '../database/data-source';
import { WhatsappAutorizado } from '../entities/WhatsappAutorizado';
import {
  executarLote,
  type PessoaLotePronta,
} from './whatsappAgendaContatos';

export async function telefonesAutorizadosDoContrato(contractId: string): Promise<string[]> {
  const rows = await getControlDataSource().getRepository(WhatsappAutorizado).find({
    where: { contractId },
    select: ['telefone'],
  });
  return rows.map((row) => row.telefone);
}

export async function autorizarPessoasEmLote(opts: {
  role?: string;
  contractIdUsuario?: string | null;
  contractId: string;
  body: unknown;
  log?: (linha: string) => void;
}) {
  const repo = getControlDataSource().getRepository(WhatsappAutorizado);
  return executarLote({
    ...opts,
    lerExistentes: () => telefonesAutorizadosDoContrato(opts.contractId),
    salvar: async (pessoa: PessoaLotePronta) => {
      const salvo = await repo.save(repo.create({
        contractId: opts.contractId,
        nome: pessoa.nome,
        telefone: pessoa.telefone,
        lid: null,
        podeEnviarPlanilha: pessoa.podeEnviarPlanilha,
        podePedirRelatorio: pessoa.podePedirRelatorio,
        ativo: true,
      }));
      return { id: salvo.id };
    },
  });
}
