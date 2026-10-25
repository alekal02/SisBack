import express, { Router } from 'express';
import { CaminhaoController } from '../controllers/CaminhaoController';
import { authorize } from '../middlewares/authMiddleware';

const router: Router = express.Router();
const controller = new CaminhaoController();

// Rota de autocomplete (deve vir antes de /:id)
router.get('/autocomplete', (req, res) => controller.autocomplete(req, res));

// GET - Listar todos (qualquer autenticado)
router.get('/', (req, res) => controller.listar(req, res));

// GET - Buscar por ID (qualquer autenticado)
router.get('/:id', (req, res) => controller.buscarPorId(req, res));

// POST - Criar (apenas admin)
router.post('/', authorize('admin'), (req, res) => controller.criar(req, res));

// PUT - Atualizar (apenas admin)
router.put('/:id', authorize('admin'), (req, res) => controller.atualizar(req, res));

// DELETE - Excluir (apenas admin)
router.delete('/:id', authorize('admin'), (req, res) => controller.excluir(req, res));

export default router;
