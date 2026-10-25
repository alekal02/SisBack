import { Router } from 'express';
import { pdfController } from '../controllers/PdfController';

const router = Router();

router.post('/generate', (req, res) => pdfController.generate(req, res));

export default router;
