import { Router } from 'express';
import { TipoServicoController } from '../controllers/TipoServicoController';

const router = Router();
const controller = new TipoServicoController();

// GET /api/tipo-servico/categorias → Tipos organizados por categoria
router.get('/categorias', (req, res) => controller.listarCategorias(req, res));

// GET /api/tipo-servico/:tipo → Template completo
router.get('/:tipo', (req, res) => controller.getTemplate(req, res));

// GET /api/tipo-servico/:tipo/kpis → KPIs padrão
router.get('/:tipo/kpis', (req, res) => controller.getKpis(req, res));

// GET /api/tipo-servico/:tipo/graficos → Gráficos padrão
router.get('/:tipo/graficos', (req, res) => controller.getGraficos(req, res));

// GET /api/tipo-servico/:tipo/colunas → Colunas esperadas
router.get('/:tipo/colunas', (req, res) => controller.getColunas(req, res));

// GET /api/tipo-servico/:tipo/modelo → Modelo de planilha
router.get('/:tipo/modelo', (req, res) => controller.getModelo(req, res));

// POST /api/tipo-servico/:tipo/validar → Valida colunas
router.post('/:tipo/validar', (req, res) => controller.validarColunas(req, res));

export default router;
