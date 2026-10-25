import { Router } from 'express';
import { salaTecnicaController } from '../controllers/SalaTecnicaController';

const router = Router();

/** Público com token (X-Chatbot-Secret). Usado pela Sala técnica. */
router.get('/status', (req, res) => salaTecnicaController.status(req, res));
router.post('/enviar-relatorio', (req, res) => salaTecnicaController.enviarRelatorio(req, res));

export default router;
