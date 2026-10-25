import { Request, Response } from 'express';
import CaminhaoRepository from '../repositories/CaminhaoRepository';

const caminhaoRepository = new CaminhaoRepository();

export class CaminhaoController {
  /**
   * POST /api/caminhoes
   * Cria um novo caminhão (apenas admin)
   */
  async criar(req: Request, res: Response): Promise<void> {
    try {
      const { modelo, ano, placa, codigo } = req.body;

      if (!modelo || !ano || !placa || !codigo) {
        res.status(400).json({ error: 'Campos obrigatórios: modelo, ano, placa, codigo' });
        return;
      }

      const placaExistente = await caminhaoRepository.findByPlaca(placa.toUpperCase());
      if (placaExistente) {
        res.status(409).json({ error: 'Já existe um caminhão cadastrado com esta placa' });
        return;
      }

      const caminhao = await caminhaoRepository.save({
        modelo: modelo.trim(),
        ano: Number(ano),
        placa: placa.toUpperCase().trim(),
        codigo: codigo.trim().toUpperCase(),
      });

      res.status(201).json({ sucesso: true, caminhao });
    } catch (error) {
      console.error('Erro ao criar caminhão:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro desconhecido' });
    }
  }

  /**
   * GET /api/caminhoes
   * Lista todos os caminhões
   */
  async listar(req: Request, res: Response): Promise<void> {
    try {
      const caminhoes = await caminhaoRepository.findAll();
      res.json({ sucesso: true, caminhoes });
    } catch (error) {
      console.error('Erro ao listar caminhões:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro desconhecido' });
    }
  }

  /**
   * GET /api/caminhoes/:id
   * Busca um caminhão por ID
   */
  async buscarPorId(req: Request, res: Response): Promise<void> {
    try {
      const id = String(req.params.id);
      const caminhao = await caminhaoRepository.findById(id);

      if (!caminhao) {
        res.status(404).json({ error: 'Caminhão não encontrado' });
        return;
      }

      res.json({ sucesso: true, caminhao });
    } catch (error) {
      console.error('Erro ao buscar caminhão:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro desconhecido' });
    }
  }

  /**
   * GET /api/caminhoes/autocomplete?termo=
   * Busca caminhões por placa (autocomplete)
   */
  async autocomplete(req: Request, res: Response): Promise<void> {
    try {
      const termo = typeof req.query.termo === 'string' ? req.query.termo : '';
      const caminhoes = await caminhaoRepository.searchByPlaca(termo);
      res.json({ sucesso: true, caminhoes });
    } catch (error) {
      console.error('Erro no autocomplete:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro desconhecido' });
    }
  }

  /**
   * PUT /api/caminhoes/:id
   * Atualiza um caminhão (apenas admin)
   */
  async atualizar(req: Request, res: Response): Promise<void> {
    try {
      const id = String(req.params.id);
      const { modelo, ano, placa, codigo } = req.body;

      const caminhao = await caminhaoRepository.findById(id);
      if (!caminhao) {
        res.status(404).json({ error: 'Caminhão não encontrado' });
        return;
      }

      const dadosAtualizar: Record<string, unknown> = {};
      if (modelo) dadosAtualizar.modelo = modelo.trim();
      if (ano) dadosAtualizar.ano = Number(ano);
      if (placa) {
        const placaUpper = placa.toUpperCase().trim();
        const placaExistente = await caminhaoRepository.findByPlaca(placaUpper);
        if (placaExistente && placaExistente.id !== String(id)) {
          res.status(409).json({ error: 'Já existe outro caminhão com esta placa' });
          return;
        }
        dadosAtualizar.placa = placaUpper;
      }
      if (codigo) dadosAtualizar.codigo = codigo.trim().toUpperCase();

      const atualizado = await caminhaoRepository.update(id, dadosAtualizar);
      res.json({ sucesso: true, caminhao: atualizado });
    } catch (error) {
      console.error('Erro ao atualizar caminhão:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro desconhecido' });
    }
  }

  /**
   * DELETE /api/caminhoes/:id
   * Exclui um caminhão (apenas admin)
   */
  async excluir(req: Request, res: Response): Promise<void> {
    try {
      const id = String(req.params.id);

      const caminhao = await caminhaoRepository.findById(id);
      if (!caminhao) {
        res.status(404).json({ error: 'Caminhão não encontrado' });
        return;
      }

      await caminhaoRepository.delete(String(id));
      res.json({ sucesso: true, message: 'Caminhão excluído com sucesso' });
    } catch (error) {
      console.error('Erro ao excluir caminhão:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Erro desconhecido' });
    }
  }
}
