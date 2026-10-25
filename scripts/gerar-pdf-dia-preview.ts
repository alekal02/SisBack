/**
 * Gera o PDF de operação do dia (mesmo do chatbot) para conferência local.
 * Uso: npx ts-node --transpile-only scripts/gerar-pdf-dia-preview.ts [YYYY-MM-DD]
 */
import 'reflect-metadata';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

import AppDataSource from '../src/database/data-source';
import { Servico } from '../src/entities/Servico';
import { Contract } from '../src/entities/Contract';
import { PlanilhaUpload } from '../src/entities/PlanilhaUpload';
import { ColetaData } from '../src/entities/ColetaData';
import { TipoServico } from '../src/enums/TipoServico';
import { montarHtmlRelatorioDiaColeta } from '../src/services/relatorioDia/montarRelatorioDiaColeta';
import { htmlToPdf } from '../src/services/PdfGeneratorService';

function isoDate(v: Date | string | null): string | null {
  if (!v) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  return v.toISOString().slice(0, 10);
}

async function main() {
  const dataArg = process.argv[2];
  if (dataArg && !/^\d{4}-\d{2}-\d{2}$/.test(dataArg)) {
    throw new Error('Data inválida. Use YYYY-MM-DD.');
  }

  await AppDataSource.initialize();
  const repoS = AppDataSource.getRepository(Servico);
  const repoC = AppDataSource.getRepository(Contract);
  const repoU = AppDataSource.getRepository(PlanilhaUpload);
  const repoD = AppDataSource.getRepository(ColetaData);

  const servico =
    (await repoS.findOne({ where: { nome: 'Coleta', tipo: TipoServico.COLETA_CAMINHAO } }))
    || (await repoS.findOne({ where: { tipo: TipoServico.COLETA_CAMINHAO } }));
  if (!servico) throw new Error('Nenhum serviço de coleta encontrado.');

  const contrato = servico.contract_id
    ? await repoC.findOne({ where: { id: servico.contract_id } })
    : null;

  let dataIso = dataArg || '2026-08-19';
  const uploads = await repoU.find({ where: { servico_id: servico.id } as any, select: ['id'] });
  const uploadIds = uploads.map((u) => u.id);
  if (uploadIds.length) {
    const nDia = await repoD
      .createQueryBuilder('c')
      .where('c.planilhaUploadId IN (:...ids)', { ids: uploadIds })
      .andWhere('c.dataSaida = :d', { d: dataIso })
      .getCount();
    if (!nDia) {
      const ultimo = await repoD
        .createQueryBuilder('c')
        .select('MAX(c.dataSaida)', 'max')
        .where('c.planilhaUploadId IN (:...ids)', { ids: uploadIds })
        .getRawOne();
      const fallback = isoDate(ultimo?.max || null);
      if (fallback) {
        console.warn(`Sem dados em ${dataIso}. Usando o último dia com coleta: ${fallback}`);
        dataIso = fallback;
      }
    }
  }

  const { html, nomeArquivo } = await montarHtmlRelatorioDiaColeta({
    servico,
    contrato,
    dataIso,
  });
  const pdf = await htmlToPdf(html, {
    useCache: false,
    margin: { top: '10mm', bottom: '10mm', left: '8mm', right: '8mm' },
  });

  const outDir = path.resolve(__dirname, '../../dist');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, nomeArquivo.endsWith('.pdf') ? nomeArquivo : `${nomeArquivo}.pdf`);
  fs.writeFileSync(outFile, pdf);
  console.log(`OK ${servico.nome} · ${dataIso}`);
  console.log(outFile);
  await AppDataSource.destroy().catch(() => undefined);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
