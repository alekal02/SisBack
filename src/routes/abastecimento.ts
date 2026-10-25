import express, { Router } from 'express';
import { AbastecimentoController } from '../controllers/AbastecimentoController';
import { authenticate, authorize } from '../middlewares/authMiddleware';

const router: Router = express.Router();
const controller = new AbastecimentoController();

// POST - Upload de imagem e extração automática
router.post('/upload', (req, res) => controller.uploadImagem(req, res));

// POST - Criar abastecimento confirmado
router.post('/', (req, res) => controller.criar(req, res));

// GET - Listar com filtros
router.get('/', (req, res) => controller.listar(req, res));

// GET - Todos os logs de alteração (admin) — DEVE vir antes de /:id
router.get('/logs', authenticate, authorize('admin'), (req, res) => controller.listarTodosLogs(req, res));

// PUT - Atualizar abastecimento (qualquer usuário autenticado, só os próprios)
router.put('/:id', authenticate, (req, res) => controller.atualizar(req, res));

// GET - Logs de um abastecimento específico (admin)
router.get('/:id/logs', authenticate, authorize('admin'), (req, res) => controller.listarLogsPorAbastecimento(req, res));

export default router;
