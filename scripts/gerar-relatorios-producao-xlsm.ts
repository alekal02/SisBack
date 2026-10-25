/**
 * Gera PDF diário + PDF de ciclo por tipo de serviço da planilha padrão.
 * Uso: npx ts-node --transpile-only scripts/gerar-relatorios-producao-xlsm.ts [caminho.xlsm]
 */
import fs from 'fs';
import path from 'path';
import { parsearPlanilhaConsolidadoProducao, agruparLinhasPorServicoAba } from '../src/services/consolidadoProducaoPlanilhaParser';
import { montarPacoteConsolidado } from '../src/services/consolidadoProducaoRelatorio';
import {
  gerarHtmlRelatorioDiaServicoProducao,
  gerarHtmlRelatorioCicloServicoProducao,
} from '../src/services/relatorioDia/gerarHtmlRelatorioDiaConsolidado';
import {
  gerarNomePdfDiaServicoProducao,
  gerarNomePdfCicloServicoProducao,
} from '../src/services/relatorioDia/gerarNomePdf';
import { htmlToPdf } from '../src/services/PdfGeneratorService';

const DEFAULT_FILE = 'C:/Users/Sistemma/Downloads/PRODUÇÃO - APARECIDA - SET. 2026 (2).xlsm';
const OUT_DIR = 'C:/Users/Sistemma/Downloads/relatorios-producao-aparecida-set2026';

async function main() {
  const arquivo = process.argv[2] || DEFAULT_FILE;
  if (!fs.existsSync(arquivo)) {
    throw new Error(`Arquivo não encontrado: ${arquivo}`);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const buf = fs.readFileSync(arquivo);
  const parsed = parsearPlanilhaConsolidadoProducao(buf);
  const grupos = agruparLinhasPorServicoAba(parsed.linhas);

  const resumo = parsed.porAba.map((p) => `${p.nomeServico}: ${p.registros}`).join(' · ');
  console.log(parsed.avisos[0] || resumo);
  console.log(`Serviços: ${grupos.size}`);

  const gerados: string[] = [];
  for (const [, linhas] of grupos) {
    const meta = linhas[0];
    const pacote = montarPacoteConsolidado(linhas, parsed.avisos.filter((a) => /repetiu|Power Query/i.test(a)));
    if (!pacote) {
      console.warn(`Sem pacote para ${meta.nomeServico}`);
      continue;
    }
    const htmlDia = gerarHtmlRelatorioDiaServicoProducao({
      contratoNome: 'Aparecida',
      servicoNome: meta.nomeServico,
      pacote,
    });
    const htmlCiclo = gerarHtmlRelatorioCicloServicoProducao({
      contratoNome: 'Aparecida',
      servicoNome: meta.nomeServico,
      pacote,
    });
    const pdfDia = await htmlToPdf(htmlDia, {
      useCache: false,
      margin: { top: '10mm', bottom: '10mm', left: '8mm', right: '8mm' },
    });
    const pdfCiclo = await htmlToPdf(htmlCiclo, {
      useCache: false,
      margin: { top: '10mm', bottom: '10mm', left: '8mm', right: '8mm' },
    });
    const nomeDia = `${gerarNomePdfDiaServicoProducao({
      servicoNome: meta.nomeServico,
      dataIso: pacote.dia.dataIso,
    })}.pdf`;
    const nomeCiclo = `${gerarNomePdfCicloServicoProducao({
      servicoNome: meta.nomeServico,
      dataInicio: pacote.ciclo.dataInicio,
      dataFim: pacote.ciclo.dataFim,
    })}.pdf`;
    fs.writeFileSync(path.join(OUT_DIR, nomeDia), pdfDia);
    fs.writeFileSync(path.join(OUT_DIR, nomeCiclo), pdfCiclo);
    gerados.push(nomeDia, nomeCiclo);
    console.log(`OK ${meta.nomeServico} · dia ${pacote.dia.dataIso} · ciclo ${pacote.ciclo.dataInicio} a ${pacote.ciclo.dataFim}`);
  }

  fs.writeFileSync(
    path.join(OUT_DIR, 'validacao.json'),
    JSON.stringify({
      arquivo,
      fonte: parsed.abasUsadas,
      registros: parsed.linhas.length,
      porAba: parsed.porAba,
      porTipo: parsed.porTipo,
      avisos: parsed.avisos,
      pdfs: gerados,
    }, null, 2),
    'utf8',
  );
  console.log(`PDFs: ${gerados.length} em ${OUT_DIR}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
