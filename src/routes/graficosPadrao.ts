import { Router } from 'express';
import { GraficoPadraoController } from '../controllers/GraficoPadraoController';

const router = Router();
const controller = new GraficoPadraoController();

// ═══ Rotas fixas (SEM parâmetro :id) — devem vir ANTES ═══

// GET /api/graficos-padrao/biblioteca
router.get('/biblioteca', (req, res) => controller.listarBiblioteca(req, res));

// POST /api/graficos-padrao/salvar-padrao
router.post('/salvar-padrao', (req, res) => controller.salvarComoPadrao(req, res));

// GET /api/graficos-padrao/biblioteca/estatisticas
router.get('/biblioteca/estatisticas', (req, res) => controller.listarEstatisticas(req, res));

// GET /api/graficos-padrao/biblioteca/verificar-servico/:servicoId
router.get('/biblioteca/verificar-servico/:servicoId', (req, res) => controller.verificarServico(req, res));

// ═══ Rotas com parâmetro :id — devem vir DEPOIS ═══

// PUT /api/graficos-padrao/biblioteca/:id/ativar
router.put('/biblioteca/:id/ativar', (req, res) => controller.toggleAtivo(req, res));

// PUT /api/graficos-padrao/biblioteca/:id
router.put('/biblioteca/:id', (req, res) => controller.atualizarConfig(req, res));

// DELETE /api/graficos-padrao/biblioteca/:id
router.delete('/biblioteca/:id', (req, res) => controller.excluir(req, res));

export default router;
