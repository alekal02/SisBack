import { Repository } from 'typeorm';
import { Abastecimento } from '../entities/Abastecimento';
import AppDataSource from '../database/data-source';
import { FiltrosRelatorio } from '../types/Abastecimento';

/** Resposta paginada usando o tipo da entidade */
interface RespostaPaginada {
  abastecimentos: Abastecimento[];
  total: number;
  pagina: number;
  totalPaginas: number;
  limite: number;
}

class AbastecimentoRepository {
  private get repository(): Repository<Abastecimento> {
    return AppDataSource.getRepository(Abastecimento);
  }

  /**
   * Salva um novo abastecimento ou atualiza um existente
   */
  async save(abastecimento: Partial<Abastecimento>): Promise<Abastecimento> {
    return this.repository.save(abastecimento);
  }

  /**
   * Busca abastecimento por ID
   */
  async findById(id: string): Promise<Abastecimento | null> {
    return this.repository.findOne({ where: { id } });
  }

  /**
   * Lista todos os abastecimentos
   */
  async findAll(): Promise<Abastecimento[]> {
    return this.repository.find({ order: { criadoEm: 'DESC' } });
  }

  /**
   * Busca abastecimentos com filtros (data, placa, status) e paginação
   */
  async findByFilters(filtros: FiltrosRelatorio): Promise<RespostaPaginada> {
    const query = this.repository.createQueryBuilder('a');

    if (filtros.dataInicio || filtros.dataFim) {
      const inicio = filtros.dataInicio ? new Date(filtros.dataInicio) : new Date('1970-01-01');
      const fim = filtros.dataFim ? new Date(filtros.dataFim) : new Date();
      query.andWhere('a.dataAbastecimento BETWEEN :inicio AND :fim', { inicio, fim });
    }

    if (filtros.placa) {
      query.andWhere('a.placa ILIKE :placa', { placa: `%${filtros.placa}%` });
    }

    if (filtros.statusExtracao) {
      query.andWhere('a.statusExtracao = :status', { status: filtros.statusExtracao });
    }

    if (filtros.usuarioCriadorId) {
      query.andWhere('a.usuarioCriadorId = :usuarioCriadorId', {
        usuarioCriadorId: filtros.usuarioCriadorId,
      });
    }

    // Primeiro conta o total (sem paginação)
    const total = await query.getCount();

    // Aplica paginação (se limit === 0, retorna todos)
    const page = filtros.page && filtros.page > 0 ? filtros.page : 1;
    const limit = filtros.limit !== undefined && filtros.limit >= 0 ? filtros.limit : 50;

    let abastecimentos: Abastecimento[];

    if (limit === 0) {
      // Sem paginação — retorna todos
      abastecimentos = await query
        .leftJoinAndSelect('a.usuarioCriador', 'usuarioCriador')
        .orderBy('a.criadoEm', 'DESC')
        .getMany();
    } else {
      const skip = (page - 1) * limit;
      abastecimentos = await query
        .leftJoinAndSelect('a.usuarioCriador', 'usuarioCriador')
        .orderBy('a.criadoEm', 'DESC')
        .skip(skip)
        .take(limit)
        .getMany();
    }

    return {
      abastecimentos,
      total,
      pagina: page,
      totalPaginas: Math.ceil(total / limit),
      limite: limit,
    };
  }

  /**
   * Deleta um abastecimento por ID
   */
  async delete(id: string): Promise<boolean> {
    const result = await this.repository.delete(id);
    return result.affected ? result.affected > 0 : false;
  }

  /**
   * Atualiza um abastecimento parcialmente
   */
  async update(id: string, dados: Partial<Abastecimento>): Promise<Abastecimento | null> {
    await this.repository.update(id, dados);
    return this.findById(id);
  }
}

export default AbastecimentoRepository;
