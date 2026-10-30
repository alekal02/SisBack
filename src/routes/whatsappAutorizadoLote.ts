import { Router } from 'express';
import { criarLoteHttp } from '../controllers/whatsappAgendaHttp';
import { authenticate, authorize } from '../middlewares/authMiddleware';

const router = Router();

router.post(
  '/:id/whatsapp-autorizados/lote',
  authenticate,
  authorize('admin'),
  (req, res) => criarLoteHttp(req, res),
);

export default router;
