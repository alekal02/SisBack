import { Router } from 'express';
import { WhatsAppController } from '../controllers/WhatsAppController';
import { authenticate } from '../middlewares/authMiddleware';

const router = Router();
const controller = new WhatsAppController();

// Status da configuração
router.get('/status', authenticate, (req, res) => controller.status(req, res));

// Envio de dashboard via WhatsApp
router.post('/enviar-dashboard', authenticate, (req, res) => controller.enviarDashboard(req, res));

// Envio com HTML (gera PDF automaticamente e envia)
router.post('/enviar-com-html', authenticate, (req, res) => controller.enviarComHtml(req, res));

export default router;
