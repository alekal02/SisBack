import { Router } from 'express';
import { DashboardController } from '../controllers/DashboardController';
import { authenticate } from '../middlewares/authMiddleware';

const router = Router();
const controller = new DashboardController();

// GET /api/dashboard/hoje — estatísticas do dia atual (autenticada)
router.get('/hoje', authenticate, (req, res) => controller.hoje(req, res));

// GET /api/dashboard/graficos — dados para gráficos (autenticada)
router.get('/graficos', authenticate, (req, res) => controller.graficos(req, res));

// POST /api/dashboard/generate-pdf — gera PDF a partir de HTML
router.post('/generate-pdf', authenticate, (req, res) => controller.generatePdf(req, res));

export default router;
