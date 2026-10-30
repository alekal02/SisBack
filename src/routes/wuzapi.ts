import { Router } from 'express';
import { WuzapiController } from '../controllers/WuzapiController';
import { listarContatosHttp, listarParticipantesHttp } from '../controllers/whatsappAgendaHttp';
import { authenticate, authorize } from '../middlewares/authMiddleware';

const router = Router();
const controller = new WuzapiController();

/** Webhook público (WuzAPI chama sem JWT). Proteja com WUZAPI_WEBHOOK_SECRET. */
router.post('/webhook', (req, res) => controller.webhook(req, res));

router.get('/status', authenticate, (req, res) => controller.status(req, res));
router.post('/connect', authenticate, (req, res) => controller.connect(req, res));
router.post('/nova-conexao', authenticate, authorize('admin'), (req, res) => controller.novaConexao(req, res));
router.post('/disconnect', authenticate, (req, res) => controller.disconnect(req, res));
router.get('/qr', authenticate, (req, res) => controller.qr(req, res));
const gestorOuAdmin = authorize('admin');

router.get('/contatos', authenticate, gestorOuAdmin, (req, res) => listarContatosHttp(req, res));
router.get('/grupos/:jid/participantes', authenticate, gestorOuAdmin, (req, res) => listarParticipantesHttp(req, res));
router.get('/grupos-whatsapp', authenticate, (req, res) => controller.listarGruposWhatsApp(req, res));
router.get('/recebimentos', authenticate, (req, res) => controller.recebimentos(req, res));
router.get('/grupos', authenticate, (req, res) => controller.listarGrupos(req, res));
router.post('/grupos', authenticate, (req, res) => controller.criarGrupo(req, res));
router.put('/grupos/:id', authenticate, (req, res) => controller.atualizarGrupo(req, res));
router.delete('/grupos/:id', authenticate, (req, res) => controller.excluirGrupo(req, res));

export default router;
