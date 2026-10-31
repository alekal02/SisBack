import { Router } from 'express';
import { PainelDiretoriaController } from '../controllers/PainelDiretoriaController';
import { authenticate, authorize } from '../middlewares/authMiddleware';
import { tenantGuard } from '../middlewares/tenantGuard';

const router = Router();
const controller = new PainelDiretoriaController();
const adminOnly = authorize('admin');

router.get('/diretoria', authenticate, tenantGuard, (req, res) => controller.diretoria(req, res));
router.get('/contrato/:id', authenticate, tenantGuard, (req, res) => controller.contrato(req, res));
router.get('/contrato/:id/metas', authenticate, tenantGuard, (req, res) => controller.lerMetas(req, res));
router.put('/contrato/:id/metas', authenticate, tenantGuard, adminOnly, (req, res) => controller.salvarMetas(req, res));

export default router;
