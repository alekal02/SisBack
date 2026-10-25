import { Router } from 'express';
import { ContractController } from '../controllers/ContractController';
import { authenticate, authorize } from '../middlewares/authMiddleware';
import { negarCriacaoContratoPreso, tenantGuard } from '../middlewares/tenantGuard';

const router = Router();
const controller = new ContractController();
const adminOnly = authorize('admin');

// ⚠️ Rotas fixas DEVEM vir antes de rotas com parâmetro :id

// Listar todos os contratos
router.get('/', authenticate, tenantGuard, (req, res) => controller.listar(req, res));

// ⭐ Saúde consolidada (NÃO mover para depois de /:id)
router.get('/saude', authenticate, tenantGuard, (req, res) => controller.saudeLista(req, res));

// Criar novo contrato
router.post('/', authenticate, negarCriacaoContratoPreso, (req, res) => controller.criar(req, res));

// Buscar um contrato específico
router.get('/:id', authenticate, tenantGuard, (req, res) => controller.buscarUm(req, res));

// Atualizar contrato
router.put('/:id', authenticate, tenantGuard, (req, res) => controller.atualizar(req, res));

// Excluir contrato — apenas admin (ação destrutiva)
router.delete('/:id', authenticate, tenantGuard, adminOnly, (req, res) => controller.excluir(req, res));

export default router;
