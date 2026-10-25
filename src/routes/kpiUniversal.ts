import { Router } from 'express';
import { KpiUniversalController } from '../controllers/KpiUniversalController';
import { authorize } from '../middlewares/authMiddleware';

const router = Router();
const controller = new KpiUniversalController();
const adminOnly = authorize('admin');

// ═══ Leitura — qualquer usuário autenticado ═══

router.get('/', (req, res) => controller.listar(req, res));
router.get('/tipos', (req, res) => controller.listarTiposComKpis(req, res));
router.get('/listar-kpis-servicos', (req, res) => controller.listarKpisServicos(req, res));
router.get('/verificar-servico/:servicoId', (req, res) => controller.verificarServico(req, res));
router.get('/:id', (req, res) => controller.buscarUm(req, res));

// ═══ Escrita — apenas admin ═══

router.post('/ativar-multiplos', adminOnly, (req, res) => controller.ativarMultiplos(req, res));
router.post('/importar-de-servico', adminOnly, (req, res) => controller.importarDeServico(req, res));
router.post('/importar-todos-servicos', adminOnly, (req, res) => controller.importarTodosServicos(req, res));
router.post('/sincronizar-biblioteca', adminOnly, (req, res) => controller.sincronizarBiblioteca(req, res));
router.post('/', adminOnly, (req, res) => controller.criar(req, res));
router.put('/:id', adminOnly, (req, res) => controller.atualizar(req, res));
router.delete('/:id', adminOnly, (req, res) => controller.excluir(req, res));
router.post('/duplicar/:id', adminOnly, (req, res) => controller.duplicar(req, res));
router.post('/:id/ativar/:servicoId', adminOnly, (req, res) => controller.ativarEmServico(req, res));

export default router;
