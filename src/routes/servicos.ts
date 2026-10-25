import { Router } from 'express';
import { ServicoController } from '../controllers/ServicoController';
import { authenticate } from '../middlewares/authMiddleware';
import { tenantGuard } from '../middlewares/tenantGuard';

const router = Router({ mergeParams: true }); // mergeParams para acessar :contractId
const controller = new ServicoController();
router.use(authenticate, tenantGuard);

// GET /api/contracts/:contractId/servicos
router.get('/', authenticate, (req, res) => controller.listar(req, res));

// GET /api/contracts/:contractId/servicos-kpis
router.get('/kpis', authenticate, (req, res) => controller.listarKpisDeServicos(req, res));

// GET /api/contracts/:contractId/servicos/comparar-por-tipo?tipoServico=coleta_caminhao
router.get('/comparar-por-tipo', authenticate, (req, res) => controller.getCompararKpisPorTipo(req, res));

// POST /api/contracts/:contractId/servicos
router.post('/', authenticate, (req, res) => controller.criar(req, res));

// POST /api/contracts/:contractId/servicos/garantir-padrao
router.post('/garantir-padrao', authenticate, (req, res) => controller.garantirPadrao(req, res));

// GET /api/contracts/:contractId/servicos/:id
router.get('/:id', authenticate, (req, res) => controller.buscarUm(req, res));

// GET /api/contracts/:contractId/servicos/:id/padrao
router.get('/:id/padrao', authenticate, (req, res) => controller.getPadrao(req, res));

// GET /api/contracts/:contractId/servicos/:id/dados
router.get('/:id/dados', authenticate, (req, res) => controller.listarDados(req, res));

// GET /api/contracts/:contractId/servicos/:id/dados-brutos
router.get('/:id/dados-brutos', authenticate, (req, res) => controller.listarDadosBrutos(req, res));

// GET /api/contracts/:contractId/servicos/:id/dados-dia/:data
router.get('/:id/dados-dia/:data', authenticate, (req, res) => controller.listarDadosDia(req, res));

// DELETE /api/contracts/:contractId/servicos/:id/dados-dia/:data
router.delete('/:id/dados-dia/:data', authenticate, (req, res) => controller.excluirDadosDia(req, res));

// GET /api/contracts/:contractId/servicos/:id/rocada/agregacao
router.get('/:id/rocada/agregacao', authenticate, (req, res) => controller.getRocadaAgregacao(req, res));

// GET /api/contracts/:contractId/servicos/:id/coleta/agregacao
router.get('/:id/coleta/agregacao', authenticate, (req, res) => controller.getColetaAgregacao(req, res));

// GET /api/contracts/:contractId/servicos/:id/mapeamento-operacional
router.get('/:id/mapeamento-operacional', authenticate, (req, res) => controller.getMapeamentoOperacional(req, res));

// GET /api/contracts/:contractId/servicos/:id/relatorio-dia-operacao?data=YYYY-MM-DD
router.get('/:id/relatorio-dia-operacao', authenticate, (req, res) => controller.getRelatorioDiaOperacao(req, res));

// GET /api/contracts/:contractId/servicos/:id/rotas-ciclo
router.get('/:id/rotas-ciclo', authenticate, (req, res) => controller.getRotasCiclo(req, res));

// GET /api/contracts/:contractId/servicos/:id/inconsistencias-viagens
router.get('/:id/inconsistencias-viagens', authenticate, (req, res) => controller.getInconsistenciasViagens(req, res));

// GET /api/contracts/:contractId/servicos/:id/resumo-ciclo-por-dia
router.get('/:id/resumo-ciclo-por-dia', authenticate, (req, res) => controller.getResumoCicloPorDia(req, res));

// GET /api/contracts/:contractId/servicos/:id/ciclos-fechados
router.get('/:id/ciclos-fechados', authenticate, (req, res) => controller.listarCiclosFechados(req, res));

// GET /api/contracts/:contractId/servicos/:id/ciclos/status
router.get('/:id/ciclos/status', authenticate, (req, res) => controller.getStatusCiclo(req, res));

// POST /api/contracts/:contractId/servicos/:id/ciclos/fechar
router.post('/:id/ciclos/fechar', authenticate, (req, res) => controller.fecharCiclo(req, res));

// POST /api/contracts/:contractId/servicos/:id/ciclos/reabrir
router.post('/:id/ciclos/reabrir', authenticate, (req, res) => controller.reabrirCiclo(req, res));

// GET /api/contracts/:contractId/servicos/:id/verificacao-viagens
router.get('/:id/verificacao-viagens', authenticate, (req, res) => controller.getVerificacaoViagens(req, res));

// GET /api/contracts/:contractId/servicos/:id/relatorio-sobrecarga-peso
router.get('/:id/relatorio-sobrecarga-peso', authenticate, (req, res) => controller.getRelatorioSobrecargaPeso(req, res));

// PUT /api/contracts/:contractId/servicos/:id/config-dashboard
router.put('/:id/config-dashboard', authenticate, (req, res) => controller.salvarConfigDashboard(req, res));

// POST /api/contracts/:contractId/servicos/:id/gerar-indicadores
router.post('/:id/gerar-indicadores', authenticate, (req, res) => controller.gerarIndicadores(req, res));

// POST /api/contracts/:contractId/servicos/:id/analisar-indicadores-automaticos
// ⭐ Analisa colunas e retorna indicadores + gráficos sugeridos (tela de revisão)
router.post('/:id/analisar-indicadores-automaticos', authenticate, (req, res) => controller.analisarIndicadoresAutomaticos(req, res));

// POST /api/contracts/:contractId/servicos/:id/confirmar-indicadores-automaticos
// Confirma e salva os indicadores automáticos sugeridos
router.post('/:id/confirmar-indicadores-automaticos', authenticate, (req, res) => controller.confirmarIndicadoresAutomaticos(req, res));

// POST /api/contracts/:contractId/servicos/:id/reanalisar-colunas
// Reanalisa colunas após novo upload e detecta mudanças
router.post('/:id/reanalisar-colunas', authenticate, (req, res) => controller.reanalisarColunas(req, res));

// GET /api/contracts/:contractId/servicos/:id/config-resumo
router.get('/:id/config-resumo', authenticate, (req, res) => controller.getConfigResumo(req, res));

// PUT /api/contracts/:contractId/servicos/:id/config-resumo
router.put('/:id/config-resumo', authenticate, (req, res) => controller.salvarConfigResumo(req, res));

// PUT /api/contracts/:contractId/servicos/:id/colunas/tipo
router.put('/:id/colunas/tipo', authenticate, (req, res) => controller.alterarTipoColuna(req, res));

// POST /api/contracts/:contractId/servicos/:id/kpi-preview
router.post('/:id/kpi-preview', authenticate, (req, res) => controller.previewKpi(req, res));

// GET /api/contracts/:contractId/servicos/:id/kpi-valores
// FONTE ÚNICA DE VERDADE — calcula todos os KPIs (contrato + serviço) no backend
router.get('/:id/kpi-valores', authenticate, (req, res) => controller.getKpiValores(req, res));

// GET /api/contracts/:contractId/servicos/:id/kpi-exec-metrics
router.get('/:id/kpi-exec-metrics', authenticate, (req, res) => controller.getExecMetrics(req, res));

// POST /api/contracts/:contractId/servicos/:id/kpi-calculate
router.post('/:id/kpi-calculate', authenticate, (req, res) => controller.calculateKpis(req, res));

// POST /api/contracts/:contractId/servicos/:id/grafico-agregado
router.post('/:id/grafico-agregado', authenticate, (req, res) => controller.getGraficoAgregado(req, res));

// POST /api/contracts/:contractId/servicos/:id/graficos-agregados — todos os gráficos em 1 requisição
router.post('/:id/graficos-agregados', authenticate, (req, res) => controller.getGraficosAgregadosBatch(req, res));

// GET /api/contracts/:contractId/servicos/:id/modelo-executivo
// Retorna o template de fórmulas do Modelo Executivo + valores do contrato
router.get('/:id/modelo-executivo', authenticate, (req, res) => controller.getModeloExecutivo(req, res));

// POST /api/contracts/:contractId/servicos/:id/aplicar-modelo-executivo
// Aplica todas as fórmulas do Modelo Executivo no configDashboard
router.post('/:id/aplicar-modelo-executivo', authenticate, (req, res) => controller.aplicarModeloExecutivo(req, res));

// GET /api/contracts/:contractId/servicos/:id/config-faturamento
// Retorna a config de faturamento do servico
router.get('/:id/config-faturamento', authenticate, (req, res) => controller.getConfigFaturamento(req, res));

// PUT /api/contracts/:contractId/servicos/:id/config-faturamento
// Salva a config de faturamento do servico
router.put('/:id/config-faturamento', authenticate, (req, res) => controller.salvarConfigFaturamento(req, res));

// GET /api/contracts/:contractId/servicos/:id/kpi-operacional-motoristas
// ⭐ KPIs agregados por motorista e rota
router.get('/:id/kpi-operacional-motoristas', authenticate, (req, res) => controller.getKpiOperacionalMotoristas(req, res));

// POST /api/contracts/:contractId/servicos/:id/aplicar-graficos-padrao
// Aplica graficos padrao automaticamente com base no tipo de servico e colunas
router.post('/:id/aplicar-graficos-padrao', authenticate, (req, res) => controller.aplicarGraficosPadrao(req, res));

// GET /api/contracts/:contractId/servicos/:id/graficos-padrao-lista
// Retorna lista de graficos padrao disponiveis para o servico
router.get('/:id/graficos-padrao-lista', authenticate, (req, res) => controller.getGraficosPadraoLista(req, res));

// POST /api/contracts/:contractId/servicos/:id/re-resolver-graficos
// ⭐ Re-resolve placeholders dos graficos existentes com base nas colunas atuais
router.post('/:id/re-resolver-graficos', authenticate, (req, res) => controller.reResolverGraficosPlaceholder(req, res));

// PUT /api/contracts/:contractId/servicos/:id
router.put('/:id', authenticate, (req, res) => controller.atualizar(req, res));

// DELETE /api/contracts/:contractId/servicos/:id
router.delete('/:id', authenticate, (req, res) => controller.excluir(req, res));

export default router;
