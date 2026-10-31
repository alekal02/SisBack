import 'reflect-metadata';
import dotenv from 'dotenv';

// Carregar variáveis de ambiente ANTES de qualquer outro módulo
dotenv.config();

import path from 'path';
import { readFileSync } from 'fs';
import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import AppDataSource, { isMultiTenant } from './database/data-source';
import { MAX_BODY_BYTES, limiteCorpoPorRota } from './config/limitesRecursos';
import { receberCorpoWebhook } from './services/webhookCorpoStream';
import { iniciarAplicacao } from './bootstrap';

const app: Express = express();
const PORT = Number(process.env.PORT || process.env.APP_PORT || 3200);

function versaoDoPacote(): string {
  try {
    const bruto = readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8');
    const pkg = JSON.parse(bruto) as { version?: string };
    if (pkg.version) return pkg.version;
  } catch {
    /* package.json fora do lugar esperado */
  }
  return 'unknown';
}

// A Render encaminha o cliente em X-Forwarded-For. Um salto só.
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// Middlewares globais
const corsOrigins = (
  process.env.CORS_ORIGIN ||
  'http://localhost:5175,http://127.0.0.1:5175,http://localhost:3300,http://127.0.0.1:3300'
)
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
const isProd = process.env.NODE_ENV === 'production';
app.use(cors({
  origin: (origin, callback) => {
    // Nunca lançar Error aqui: o Express transforma em HTTP 500 e mascara o problema real.
    if (!origin || !isProd || corsOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(null, false);
  },
  credentials: process.env.CORS_CREDENTIALS !== 'false',
}));
app.use((req, res, next) => {
  if (req.method === 'POST' && (req.path || '').startsWith('/api/wuzapi/webhook')) {
    return receberCorpoWebhook(req, res, next);
  }
  const limite = limiteCorpoPorRota(req.path || '');
  return express.json({ limit: limite })(req, res, next);
});
app.use(express.urlencoded({ limit: MAX_BODY_BYTES, extended: true }));
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    version: versaoDoPacote(),
    buildSha: process.env.BUILD_SHA || 'unknown',
    tag: process.env.IMAGE_TAG || process.env.TAG || 'unknown',
    multiTenant: isMultiTenant(),
  });
});

import authRoutes from './routes/auth';
import coletaRoutes from './routes/coleta';
import contractsRoutes from './routes/contracts';
import servicosRoutes from './routes/servicos';
import { authenticate } from './middlewares/authMiddleware';
import { ServicoController } from './controllers/ServicoController';
import kpiUniversalRoutes from './routes/kpiUniversal';
import graficosPadraoRoutes from './routes/graficosPadrao';
import wuzapiRoutes from './routes/wuzapi';
import salaTecnicaRoutes from './routes/salaTecnica';
import pdfRoutes from './routes/pdf';
import painelRoutes from './routes/painel';
import { DashboardExecutivoController } from './controllers/DashboardExecutivoController';
import { registrarControllerExecutivo } from './services/executivoCacheWarmupService';

const servicoCtrl = new ServicoController();
const dashboardExecutivoCtrl = new DashboardExecutivoController();
registrarControllerExecutivo(dashboardExecutivoCtrl);

// Rotas públicas
app.use('/api/auth', authRoutes);

app.get('/api/dashboard/executivo', authenticate, (req, res) => dashboardExecutivoCtrl.executivo(req, res));
app.post('/api/dashboard/executivo/pdf', authenticate, (req, res) => dashboardExecutivoCtrl.gerarPdf(req, res));

// ⭐ QUALIDADE — rotas ANTES do coletaRoutes
import qualidadeService from './services/QualidadeDadosService';
import { analisarQualidadePlanilha } from './services/QualidadePlanilhaPreviewService';
import multer from 'multer';
const qMulter = multer({ storage: multer.memoryStorage() });

// Rota por uploadId sem constraint (Express 5/path-to-regexp v8)
app.get('/api/coleta/qualidade/:uploadId', authenticate, async (req: any, res: any) => {
  const uploadId = parseInt(req.params.uploadId, 10);
  if (isNaN(uploadId)) { res.status(400).json({ error: 'ID inválido' }); return; }
  const relatorio = await qualidadeService.gerarRelatorio(uploadId);
  res.json(relatorio);
});

// Rota por servicoId
app.get('/api/coleta/qualidade/servico/:servicoId', authenticate, async (req: any, res: any) => {
  const relatorio = await qualidadeService.gerarRelatorioUltimoUpload(String(req.params.servicoId));
  if (!relatorio) { res.status(404).json({ error: 'Nenhum upload encontrado' }); return; }
  res.json(relatorio);
});

// Preview de qualidade
app.post('/api/qualidade-coleta/preview', authenticate, qMulter.single('planilha'), async (req: any, res: any) => {
  console.log('[QualidadePreview] Rota chamada!', req.file ? `Arquivo: ${req.file.originalname}` : 'Sem arquivo');
  if (!req.file) { res.status(400).json({ error: 'Nenhum arquivo' }); return; }
  try {
    const relatorio = analisarQualidadePlanilha(req.file.buffer, req.file.originalname);
    console.log('[QualidadePreview] Relatório gerado:', JSON.stringify(relatorio).substring(0, 200));
    res.json({ sucesso: true, ...relatorio });
  } catch (err: any) {
    console.error('[QualidadePreview] Erro:', err.message);
    res.status(500).json({ error: 'Erro ao analisar planilha: ' + err.message });
  }
});

// ─── ANÁLISE VIAGEM POR VIAGEM ───
// POST /api/qualidade-coleta/analisar-viagens
// Analisa cada linha da planilha identificando viagens completas vs incompletas
app.post('/api/qualidade-coleta/analisar-viagens', authenticate, qMulter.single('planilha'), async (req: any, res: any) => {
  if (!req.file) { res.status(400).json({ error: 'Nenhum arquivo' }); return; }
  try {
    const { analisarViagensPlanilha } = await import('./services/analisarViagensPlanilhaService');
    const { Contract } = await import('./entities/Contract');
    const contractId = typeof req.body?.contractId === 'string' ? req.body.contractId.trim() : '';
    let cadastroOperacional = null;
    if (contractId) {
      const contract = await AppDataSource.getRepository(Contract).findOne({ where: { id: contractId } });
      cadastroOperacional = contract?.configOperacional ?? null;
    }
    const resultado = analisarViagensPlanilha(req.file.buffer, req.file.originalname, cadastroOperacional);
    res.json(resultado);
  } catch (error: any) {
    console.error('[AnalisarViagens] Erro:', error?.message || error);
    res.status(500).json({ error: 'Erro ao analisar viagens: ' + (error?.message || '') });
  }
});

// ─── CORREÇÃO AUTOMÁTICA PRÉ-UPLOAD ───
// POST /api/qualidade-coleta/corrigir
// Recebe a planilha, aplica correções automáticas e retorna planilha corrigida + relatório
import * as XLSX from 'xlsx';
import { normalizarPlaca } from './utils/normalizarPlaca';
app.post('/api/qualidade-coleta/corrigir', authenticate, qMulter.single('planilha'), async (req: any, res: any) => {
  if (!req.file) { res.status(400).json({ error: 'Nenhum arquivo' }); return; }
  
  try {
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: false });
    const nomeAba = workbook.SheetNames[0];
    const sheet = workbook.Sheets[nomeAba];
    const dados: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, blankrows: true, raw: true });

    if (dados.length < 2) {
      res.json({ sucesso: true, mensagem: 'Planilha sem dados para corrigir.', alteracoes: { linhasRemovidas: 0, valoresNegativosCorrigidos: 0, linhasVaziasRemovidas: 0, duplicatasRemovidas: 0 } });
      return;
    }

    const cabecalho = dados[0] as string[];
    const linhas = dados.slice(1);
    const alteracoes = { linhasRemovidas: 0, valoresNegativosCorrigidos: 0, linhasVaziasRemovidas: 0, duplicatasRemovidas: 0 };

    // 1. Remover linhas totalmente vazias no final
    let ultimaLinhaComDados = -1;
    for (let i = linhas.length - 1; i >= 0; i--) {
      const temDado = linhas[i]?.some((v: any) => v !== null && v !== '' && v !== undefined);
      if (temDado) { ultimaLinhaComDados = i; break; }
    }
    const linhasFiltradas = linhas.slice(0, ultimaLinhaComDados + 1);
    alteracoes.linhasVaziasRemovidas = linhas.length - linhasFiltradas.length;

    // 2. Identificar colunas numéricas (KM, PESO, LITROS, VALOR)
    const colunasNumericas: number[] = [];
    cabecalho.forEach((h: string, idx: number) => {
      const hUpper = (h || '').toUpperCase();
      if (['KM SAIDA','KM SAÍDA','KM CHEGADA','KM TOTAL','PESO TOTAL','PESO','PESO 1','PESO 2','LITROS','VALOR'].some(p => hUpper.includes(p))) {
        colunasNumericas.push(idx);
      }
    });

    // 3. Corrigir valores negativos (transformar em zero)
    const linhasCorrigidas = linhasFiltradas.map((linha: any[]) => {
      const nova = [...linha];
      colunasNumericas.forEach(idx => {
        if (typeof nova[idx] === 'number' && nova[idx] < 0) {
          alteracoes.valoresNegativosCorrigidos++;
          nova[idx] = 0;
        }
      });
      return nova;
    });

    const cabecalhoUpper = cabecalho.map((h: string) => (h || '').toUpperCase());
    const idxPlaca = cabecalhoUpper.findIndex((h: string) => h.includes('PLACA') && !h.includes('BASE'));
    if (idxPlaca >= 0) {
      for (const linha of linhasCorrigidas) {
        const bruta = linha[idxPlaca];
        if (bruta !== null && bruta !== undefined && bruta !== '') {
          const norm = normalizarPlaca(String(bruta));
          if (norm) linha[idxPlaca] = norm;
        }
      }
    }

    // 4. Remover duplicatas (mesma placa + data)
    const idxData = cabecalhoUpper.findIndex((h: string) => h.includes('DATA'));
    
    let linhasFinais: any[][] = linhasCorrigidas;
    
    if (idxPlaca >= 0 && idxData >= 0) {
      const visto = new Set<string>();
      linhasFinais = linhasCorrigidas.filter((linha: any[]) => {
        const placa = linha[idxPlaca];
        const data = linha[idxData];
        if (placa && data) {
          const placaNorm = normalizarPlaca(String(placa)) || String(placa).trim().toUpperCase();
          const chave = `${placaNorm}|${data}`;
          if (visto.has(chave)) {
            alteracoes.duplicatasRemovidas++;
            return false;
          }
          visto.add(chave);
        }
        return true;
      });
    }
    
    alteracoes.linhasRemovidas = alteracoes.linhasVaziasRemovidas + alteracoes.duplicatasRemovidas;

    // Montar nova planilha
    const novaPlanilha = [cabecalho, ...linhasFinais];
    const novaWS = XLSX.utils.aoa_to_sheet(novaPlanilha);
    const novoWB = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(novoWB, novaWS, nomeAba);
    const bufferCorrigido = XLSX.write(novoWB, { type: 'buffer', bookType: 'xlsx' });

    // Gerar relatório de qualidade da planilha corrigida
    const relatorioCorrigido = analisarQualidadePlanilha(bufferCorrigido, req.file.originalname.replace('.xlsx', '_corrigido.xlsx'));

    // Retornar como base64
    const base64 = bufferCorrigido.toString('base64');

    res.json({
      sucesso: true,
      mensagem: `Correções aplicadas: ${alteracoes.valoresNegativosCorrigidos} valor(es) negativo(s) zerados, ${alteracoes.duplicatasRemovidas} duplicata(s) removidas, ${alteracoes.linhasVaziasRemovidas} linha(s) vazia(s) removidas.`,
      alteracoes,
      planilhaBase64: base64,
      nomeArquivo: req.file.originalname.replace('.xlsx', '_corrigido.xlsx'),
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      qualidadeApos: relatorioCorrigido,
    });
  } catch (error: any) {
    console.error('Erro ao corrigir planilha:', error);
    res.status(500).json({ error: 'Erro ao corrigir planilha: ' + (error?.message || '') });
  }
});

app.use('/api/coleta', coletaRoutes); // coleta já tem authenticate interno
app.use('/api/contracts', contractsRoutes); // contratos (requer autenticação)
app.use('/api/painel', painelRoutes);
app.use('/api/contracts/:contractId/servicos', servicosRoutes); // serviços aninhados

// Rotas de KPIs Universais
app.use('/api/kpis-universais', authenticate, kpiUniversalRoutes);

// Rotas de Gráficos Padrão (biblioteca gerenciável)
app.use('/api/graficos-padrao', authenticate, graficosPadraoRoutes);

// PDF unificado
app.use('/api/pdf', authenticate, pdfRoutes);

// WuzAPI — webhook (público) + mapeamento de grupos (autenticado)
app.use('/api/wuzapi', wuzapiRoutes);

// Sala técnica (RelatoriosColeta) — token X-Chatbot-Secret, PDF até 40 MB
app.use('/api/sala-tecnica', salaTecnicaRoutes);

// Rotas consolidadas para Dashboard Principal
app.get('/api/dashboard/kpis-consolidado', authenticate, (req, res) => servicoCtrl.getKpisConsolidado(req, res));
app.get('/api/dashboard/servicos-por-tipo', authenticate, (req, res) => servicoCtrl.listarServicosPorTipoGlobal(req, res));
app.get('/api/dashboard/comparar-por-tipo', authenticate, (req, res) => servicoCtrl.getCompararKpisGlobal(req, res));
app.get('/api/dashboard/qualidade-ideal-3d', authenticate, (req, res) => servicoCtrl.getQualidadeIdeal3d(req, res));
app.get('/api/dashboard/evolucao-operacional', authenticate, (req, res) => servicoCtrl.getEvolucaoOperacional(req, res));

// Middleware de erro global
app.use((err: Error & { status?: number; statusCode?: number; type?: string }, req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) return;
  const status = Number(err?.status || err?.statusCode || 0);
  const corpoGrande = status === 413 || err?.type === 'entity.too.large';
  if (corpoGrande) {
    console.error(`[HTTP] Corpo grande demais em ${req.method} ${req.path}: ${err?.message || err}`);
    res.status(413).json({
      sucesso: false,
      erro: 'Arquivo grande demais para o servidor receber. Reenvie a planilha como documento.',
    });
    return;
  }
  console.error('Erro não tratado:', err);
  const detalhe = !isProd && err.message ? err.message : 'Erro interno do servidor';
  res.status(500).json({ error: detalhe });
});

process.on('unhandledRejection', (motivo) => {
  console.error('[processo] Promessa sem tratamento (o chatbot continua no ar):', motivo);
});
process.on('uncaughtException', (erro) => {
  console.error('[processo] Exceção não tratada (o chatbot continua no ar):', erro);
});

iniciarAplicacao(app, PORT);
