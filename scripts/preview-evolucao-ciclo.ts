import fs from 'fs';
import path from 'path';
import { gerarHtmlEvolucaoDiariaWhatsapp } from '../src/services/WhatsappRelatorioHtml';
import { htmlToPdf } from '../src/services/PdfGeneratorService';

function dia(iso: string, viagens: number, otimo: number | null) {
  const [, m, d] = iso.split('-');
  const label = `${d}/${m}`;
  if (!viagens || otimo == null) {
    return { data: iso, label, viagens: 0, otimo: null, ruim: null, pessimo: null, excedido: null };
  }
  const ruim = Math.round((100 - otimo) * 0.45);
  const pessimo = Math.round((100 - otimo) * 0.3);
  const excedido = Math.max(0, 100 - otimo - ruim - pessimo);
  return { data: iso, label, viagens, otimo, ruim, pessimo, excedido };
}

const linhas = [];
let viagens = 0;
for (let d = 1; d <= 30; d += 1) {
  const iso = `2026-09-${String(d).padStart(2, '0')}`;
  const semana = new Date(2026, 8, d, 12).getDay();
  if (semana === 0) {
    linhas.push(dia(iso, 0, null));
    continue;
  }
  const qtd = d % 5 === 0 ? 2 : 1;
  viagens += qtd;
  const onda = 62 + Math.round(18 * Math.sin(d / 3.2) + 6 * Math.sin(d / 1.4));
  const otimo = Math.max(28, Math.min(88, onda));
  linhas.push(dia(iso, qtd, otimo));
}

const html = gerarHtmlEvolucaoDiariaWhatsapp({
  tipoLabel: 'Coleta',
  periodoLabel: '01/09 a 30/09',
  janelaLabel: 'Por ciclo · 30 dias',
  geradoEm: new Date().toLocaleString('pt-BR'),
  totalViagens: viagens,
  pctGeral: { otimo: 48, ruim: 22, pessimo: 15, excedido: 15 },
  blocos: [{
    id: 'bh',
    nome: 'bh · Coleta',
    viagens,
    pct: { otimo: 48, ruim: 22, pessimo: 15, excedido: 15 },
    linhas,
  }],
});

const destino = path.resolve(__dirname, '../../preview-evolucao-ciclo');
fs.mkdirSync(destino, { recursive: true });
const htmlPath = path.join(destino, 'evolucao-por-ciclo.html');
const pdfPath = path.join(destino, 'evolucao-por-ciclo.pdf');
fs.writeFileSync(htmlPath, html);

htmlToPdf(html, { useCache: false, waitMs: 0 }).then((pdf) => {
  fs.writeFileSync(pdfPath, pdf);
  console.log(htmlPath);
  console.log(pdfPath);
  process.exit(0);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
