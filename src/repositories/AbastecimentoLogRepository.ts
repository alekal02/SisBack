import { Repository, Brackets } from 'typeorm';
import { AbastecimentoLog } from '../entities/AbastecimentoLog';
import AppDataSource from '../database/data-source';

interface FiltrosLogs {
  placa?: string;
  dataInicio?: string;
  dataFim?: string;
  alteradoPorId?: string;
  page?: number;
  limit?: number;
}

class AbastecimentoLogRepository {
  private get repository(): Repository<AbastecimentoLog> {
    return AppDataSource.getRepository(AbastecimentoLog);
  }

  async registrar(
    abastecimentoId: string,
    campoAlterado: string,
    valorAntigo: string | null,
    valorNovo: string | null,
    alteradoPorId: string | null
  ): Promise<AbastecimentoLog> {
    const log = this.repository.create({
      abastecimentoId,
      campoAlterado,
      valorAntigo,
      valorNovo,
      alteradoPorId,
    });
    return this.repository.save(log);
  }

  async listarPorAbastecimento(abastecimentoId: string): Promise<AbastecimentoLog[]> {
    return this.repository.find({
      where: { abastecimentoId },
      relations: ['alteradoPor'],
      order: { criadoEm: 'DESC' },
    });
  }

  async listarTodos(filtros: FiltrosLogs = {}): Promise<{ logs: AbastecimentoLog[]; total: number }> {
    const query = this.repository.createQueryBuilder('l')
      .leftJoinAndSelect('l.alteradoPor', 'alteradoPor')
      .leftJoinAndSelect('l.abastecimento', 'abastecimento');

    if (filtros.placa) {
      query.andWhere('abastecimento.placa ILIKE :placa', { placa: `%${filtros.placa}%` });
    }

    if (filtros.dataInicio || filtros.dataFim) {
      const inicio = filtros.dataInicio ? new Date(filtros.dataInicio) : new Date('1970-01-01');
      const fim = filtros.dataFim ? new Date(filtros.dataFim) : new Date();
      query.andWhere('l.criadoEm BETWEEN :inicio AND :fim', { inicio, fim });
    }

    if (filtros.alteradoPorId) {
      query.andWhere('l.alteradoPorId = :alteradoPorId', { alteradoPorId: filtros.alteradoPorId });
    }

    const page = filtros.page && filtros.page > 0 ? filtros.page : 1;
    const limit = filtros.limit && filtros.limit > 0 ? filtros.limit : 50;
    const skip = (page - 1) * limit;

    const total = await query.getCount();

    const logs = await query
      .orderBy('l.criadoEm', 'DESC')
      .skip(skip)
      .take(limit)
      .getMany();

    return { logs, total };
  }
}

export default AbastecimentoLogRepository;
