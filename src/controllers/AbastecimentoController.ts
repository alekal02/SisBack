import { Request, Response } from 'express';
import AbastecimentoRepository from '../repositories/AbastecimentoRepository';
import AbastecimentoLogRepository from '../repositories/AbastecimentoLogRepository';
import { OCRService } from '../services/OCRService';
import fileStorageService from '../services/FileStorageService';
import {
  CriarAbastecimentoRequest,
  DadosExtraidosOCR,
  FiltrosRelatorio,
} from '../types/Abastecimento';

const ocrService = new OCRService();
const abastecimentoRepository = new AbastecimentoRepository();
const logRepository = new AbastecimentoLogRepository();

export class AbastecimentoController {
  /**
   * POST /api/abastecimentos/upload
   * Salva imagem no MinIO, extrai dados automaticamente e retorna a URL
   */
  async uploadImagem(req: Request, res: Response): Promise<void> {
    try {
      const { imagem } = req.body;

      if (!imagem) {
        res.status(400).json({ error: 'Imagem é obrigatória' });
        return;
      }

      // 1. Salvar imagem no MinIO
      const imagemUrl = await fileStorageService.uploadImagem(imagem);

      // 2. Extrair dados via OCR
      const extraido: DadosExtraidosOCR = await ocrService.extrairDadosImagem(imagem);

      res.json({
        sucesso: true,
        imagemUrl,
        extraido,
        confiavel: ocrService.ehConfiavel(extraido),
      });
    } catch (error) {
      res
        .status(500)
        .json({ error: error instanceof Error ? error.message : 'Erro desconhecido' });
    }
  }

  /**
   * POST /api/abastecimentos
   * Salva um abastecimento com dados confirmados (imagemUrl já está no MinIO)
   */
  async criar(req: Request, res: Response): Promise<void> {
    try {
      const { placa, litragem, valor, dataHora, imagemUrl, observacoes, litragemExtraida, valorExtraido } =
        req.body as CriarAbastecimentoRequest;

      if (!placa || litragem === undefined || valor === undefined || !dataHora || !imagemUrl) {
        res.status(400).json({ error: 'Campos obrigatórios faltando' });
        return;
      }

      const abastecimento = await abastecimentoRepository.save({
        placa,
        litragem,
        valor,
        dataAbastecimento: new Date(dataHora),
        imagemUrl,
        observacoes,
        litragemExtraida: litragemExtraida ?? null,
        valorExtraido: valorExtraido ?? null,
        statusExtracao: 'sucesso',
        usuarioCriadorId: req.usuario?.id || null,
      });

      res.status(201).json({ sucesso: true, abastecimento });
    } catch (error) {
      res
        .status(500)
        .json({ error: error instanceof Error ? error.message : 'Erro desconhecido' });
    }
  }

  /**
   * PUT /api/abastecimentos/:id
   * Atualiza dados de um abastecimento e registra log das alterações
   * Admin pode editar qualquer abastecimento; usuário comum só os próprios
   */
  async atualizar(req: Request, res: Response): Promise<void> {
    try {
      const id = String(req.params.id);
      const { placa, litragem, valor, dataHora, observacoes } = req.body;

      const abastecimento = await abastecimentoRepository.findById(id);
      if (!abastecimento) {
        res.status(404).json({ error: 'Abastecimento não encontrado' });
        return;
      }

      // Verifica permissão: admin pode tudo, usuário só os próprios registros
      const userId = req.usuario?.id;
      const ehAdmin = req.usuario?.role === 'admin';
      if (!ehAdmin && abastecimento.usuarioCriadorId !== userId) {
        res.status(403).json({ error: 'Você só pode editar seus próprios abastecimentos.' });
        return;
      }

      // Compara os campos e registra log para cada alteração
      const alteracoes: { campo: string; antigo: string | null; novo: string | null }[] = [];

      if (placa !== undefined && placa !== abastecimento.placa) {
        alteracoes.push({ campo: 'placa', antigo: abastecimento.placa, novo: placa });
        abastecimento.placa = placa;
      }

      if (litragem !== undefined && Number(litragem) !== Number(abastecimento.litragem)) {
        alteracoes.push({
          campo: 'litragem',
          antigo: String(abastecimento.litragem),
          novo: String(litragem),
        });
        abastecimento.litragem = Number(litragem);
      }

      if (valor !== undefined && Number(valor) !== Number(abastecimento.valor)) {
        alteracoes.push({
          campo: 'valor',
          antigo: String(abastecimento.valor),
          novo: String(valor),
        });
        abastecimento.valor = Number(valor);
      }

      if (dataHora !== undefined) {
        // Normaliza ambas as datas para string YYYY-MM-DDTHH:MM usando UTC
        const normalizarUTC = (d: Date): string => {
          const ano = d.getUTCFullYear();
          const mes = String(d.getUTCMonth() + 1).padStart(2, '0');
          const dia = String(d.getUTCDate()).padStart(2, '0');
          const hora = String(d.getUTCHours()).padStart(2, '0');
          const min = String(d.getUTCMinutes()).padStart(2, '0');
          return `${ano}-${mes}-${dia}T${hora}:${min}`;
        };

        const antigoStr = normalizarUTC(new Date(abastecimento.dataAbastecimento));
        const novoStr = normalizarUTC(new Date(dataHora));

        if (antigoStr !== novoStr) {
          alteracoes.push({
            campo: 'dataAbastecimento',
            antigo: antigoStr,
            novo: novoStr,
          });
          abastecimento.dataAbastecimento = new Date(dataHora);
        }
      }

      if (observacoes !== undefined && observacoes !== (abastecimento.observacoes ?? '')) {
        alteracoes.push({
          campo: 'observacoes',
          antigo: abastecimento.observacoes,
          novo: observacoes,
        });
        abastecimento.observacoes = observacoes;
      }

      if (alteracoes.length === 0) {
        res.json({ sucesso: true, abastecimento, mensagem: 'Nenhuma alteração detectada.' });
        return;
      }

      // Salva o abastecimento atualizado
      const atualizado = await abastecimentoRepository.save(abastecimento);

      // Registra logs
      const usuarioId = req.usuario?.id || null;
      for (const alt of alteracoes) {
        await logRepository.registrar(id, alt.campo, alt.antigo, alt.novo, usuarioId);
      }

      res.json({
        sucesso: true,
        abastecimento: atualizado,
        alteracoes: alteracoes.length,
      });
    } catch (error) {
      res
        .status(500)
        .json({ error: error instanceof Error ? error.message : 'Erro desconhecido' });
    }
  }

  /**
   * GET /api/abastecimentos/:id/logs
   * Retorna os logs de alteração de um abastecimento específico
   */
  async listarLogsPorAbastecimento(req: Request, res: Response): Promise<void> {
    try {
      const id = String(req.params.id);
      const logs = await logRepository.listarPorAbastecimento(id);
      res.json({ sucesso: true, logs });
    } catch (error) {
      res
        .status(500)
        .json({ error: error instanceof Error ? error.message : 'Erro desconhecido' });
    }
  }

  /**
   * GET /api/abastecimentos/logs
   * Lista todos os logs de alteração (admin)
   */
  async listarTodosLogs(req: Request, res: Response): Promise<void> {
    try {
      const resultado = await logRepository.listarTodos({
        placa: typeof req.query.placa === 'string' ? req.query.placa : undefined,
        dataInicio: typeof req.query.dataInicio === 'string' ? req.query.dataInicio : undefined,
        dataFim: typeof req.query.dataFim === 'string' ? req.query.dataFim : undefined,
        alteradoPorId: typeof req.query.alteradoPorId === 'string' ? req.query.alteradoPorId : undefined,
        page: req.query.page ? Number(req.query.page) : 1,
        limit: req.query.limit ? Number(req.query.limit) : 50,
      });
      res.json({
        sucesso: true,
        logs: resultado.logs,
        total: resultado.total,
        pagina: req.query.page ? Number(req.query.page) : 1,
        totalPaginas: Math.ceil(resultado.total / (req.query.limit ? Number(req.query.limit) : 50)),
      });
    } catch (error) {
      res
        .status(500)
        .json({ error: error instanceof Error ? error.message : 'Erro desconhecido' });
    }
  }

  /**
   * GET /api/abastecimentos
   * Lista abastecimentos com filtros opcionais e paginação
   */
  async listar(req: Request, res: Response): Promise<void> {
    try {
      const filtros: FiltrosRelatorio = {
        dataInicio: typeof req.query.dataInicio === 'string' ? req.query.dataInicio : undefined,
        dataFim: typeof req.query.dataFim === 'string' ? req.query.dataFim : undefined,
        placa: typeof req.query.placa === 'string' ? req.query.placa : undefined,
        statusExtracao:
          req.query.statusExtracao === 'pendente' ||
            req.query.statusExtracao === 'sucesso' ||
            req.query.statusExtracao === 'erro'
            ? req.query.statusExtracao
            : undefined,
        usuarioCriadorId: typeof req.query.usuarioCriadorId === 'string' ? req.query.usuarioCriadorId : undefined,
        page: req.query.page ? Number(req.query.page) : undefined,
        limit: req.query.limit !== undefined ? Number(req.query.limit) : undefined,
      };

      const resultado = await abastecimentoRepository.findByFilters(filtros);

      res.json({ sucesso: true, ...resultado });
    } catch (error) {
      res
        .status(500)
        .json({ error: error instanceof Error ? error.message : 'Erro desconhecido' });
    }
  }
}
