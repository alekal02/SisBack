import { Router, Request, Response, NextFunction } from 'express';
import multer, { FileFilterCallback } from 'multer';
import { ColetaController } from '../controllers/ColetaController';
import { authenticate } from '../middlewares/authMiddleware';

const router = Router();
const controller = new ColetaController();

// Configurar multer para memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB — alinhado com Express e nginx
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    const ext = file.originalname.split('.').pop()?.toLowerCase();
    if (ext === 'xlsx' || ext === 'xls' || ext === 'xlsm') {
      cb(null, true);
    } else {
      cb(new Error('Formato inválido. Apenas .xlsx, .xls ou .xlsm são permitidos.'));
    }
  },
});

// Middleware de debug para rotas de coleta
router.use((req, res, next) => {
  console.log('[ColetaRoutes] Requisição:', req.method, req.path);
  next();
});

// Rotas protegidas (requerem autenticação)
router.post('/upload', authenticate, upload.single('planilha'), (req, res) => controller.upload(req, res));
router.post('/upload/contrato', authenticate, upload.single('planilha'), (req, res) => controller.uploadContrato(req, res));
router.post('/upload/preview', authenticate, upload.single('planilha'), (req, res) => controller.previewUpload(req, res));
router.post('/upload/preview-data', authenticate, upload.single('planilha'), (req, res) => controller.previewUploadData(req, res));
router.post('/upload/preview-rocada', authenticate, upload.single('planilha'), (req, res) => controller.previewRocada(req, res));
router.post('/upload/preview-servicos-unificados', authenticate, upload.single('planilha'), (req, res) => controller.previewServicosUnificados(req, res));
router.post('/upload/conferencia-diaria', authenticate, upload.single('planilha'), (req, res) => controller.conferenciaDiaria(req, res));
router.post('/upload/agente-conferencia', authenticate, upload.single('planilha'), (req, res) => controller.agenteConferencia(req, res));
router.get('/dashboard', authenticate, (req, res) => controller.dashboard(req, res));
router.get('/uploads/por-dia', authenticate, (req, res) => controller.uploadsPorDia(req, res));
router.get('/uploads', authenticate, (req, res) => controller.uploads(req, res));
router.get('/dados', authenticate, (req, res) => controller.dados(req, res));
router.put('/dados/:id', authenticate, (req, res) => controller.atualizarDado(req, res));
router.delete('/dados/:id', authenticate, (req, res) => controller.excluirDado(req, res));
router.get('/uploads/:id/export', authenticate, (req, res) => controller.exportarUpload(req, res));
router.put('/uploads/:id/rename', authenticate, (req, res) => controller.renomearUpload(req, res));
router.delete('/uploads/:id', authenticate, (req, res) => controller.excluirUpload(req, res));
router.get('/estudo-viagens/:id', authenticate, (req, res) => controller.estudoViagens(req, res));
router.get('/qualidade/:uploadId', authenticate, (req, res) => {
  console.log('[QUALIDADE] Rota /qualidade/:uploadId chamada com uploadId=', req.params.uploadId);
  controller.qualidade(req, res);
});
router.get('/qualidade/servico/:servicoId', authenticate, (req, res) => {
  console.log('[QUALIDADE] Rota /qualidade/servico/:servicoId chamada com servicoId=', req.params.servicoId);
  controller.qualidadeUltimoUpload(req, res);
});

export default router;
