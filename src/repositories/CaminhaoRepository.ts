import { Repository } from 'typeorm';
import { Caminhao } from '../entities/Caminhao';
import AppDataSource from '../database/data-source';

class CaminhaoRepository {
  private get repository(): Repository<Caminhao> {
    return AppDataSource.getRepository(Caminhao);
  }

  /**
   * Salva um novo caminhão ou atualiza um existente
   */
  async save(caminhao: Partial<Caminhao>): Promise<Caminhao> {
    return this.repository.save(caminhao);
  }

  /**
   * Busca caminhão por ID
   */
  async findById(id: string): Promise<Caminhao | null> {
    return this.repository.findOne({ where: { id } });
  }

  /**
   * Busca caminhão por placa
   */
  async findByPlaca(placa: string): Promise<Caminhao | null> {
    return this.repository.findOne({ where: { placa } });
  }

  /**
   * Lista todos os caminhões ordenados por placa
   */
  async findAll(): Promise<Caminhao[]> {
    return this.repository.find({ order: { placa: 'ASC' } });
  }

  /**
   * Busca caminhões cuja placa contenha o termo (autocomplete)
   */
  async searchByPlaca(termo: string): Promise<Caminhao[]> {
    return this.repository
      .createQueryBuilder('c')
      .where('c.placa ILIKE :termo', { termo: `%${termo}%` })
      .orderBy('c.placa', 'ASC')
      .getMany();
  }

  /**
   * Atualiza um caminhão parcialmente
   */
  async update(id: string, dados: Partial<Caminhao>): Promise<Caminhao | null> {
    await this.repository.update(id, dados);
    return this.findById(id);
  }

  /**
   * Deleta um caminhão por ID
   */
  async delete(id: string): Promise<boolean> {
    const result = await this.repository.delete(id);
    return result.affected ? result.affected > 0 : false;
  }
}

export default CaminhaoRepository;
