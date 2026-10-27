import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  escolherUploadDoDia,
  linhasVisiveisNoRelatorio,
  somarLinhasVisiveis,
  sqlSomenteUploadVigenteDoDia,
  type LinhaRelatorioProducao,
} from './uploadVisivelRelatorio';

const SETORES = [
  { local: 'SETOR 10', valor: 398.088 },
  { local: 'SETOR 3', valor: 370.083 },
  { local: 'SETOR 5', valor: 369.677 },
  { local: 'SETOR 7', valor: 376.292 },
  { local: 'SETOR 8', valor: 417.736 },
];

describe('relatório de varrição com vários uploads', () => {
  it('não agrupa nem descarta linha pelo local de 50 caracteres', () => {
    const sql = sqlSomenteUploadVigenteDoDia('c');
    assert.equal(sql, 'TRUE');
    assert.equal(/distrito|regional|ROW_NUMBER|50/i.test(sql), false);
  });

  it('prefere o upload aberto mais recente', () => {
    const id = escolherUploadDoDia([
      { uploadId: 1, criadoEm: 10, fechado: false },
      { uploadId: 2, criadoEm: 20, fechado: false },
    ]);
    assert.equal(id, 2);
  });

  it('não deixa um reenvio aberto substituir ciclo fechado', () => {
    const id = escolherUploadDoDia([
      { uploadId: 1, criadoEm: 10, fechado: true },
      { uploadId: 2, criadoEm: 30, fechado: false },
    ]);
    assert.equal(id, 1);
  });

  it('completa os 5 setores quando o envio novo gravou só 2', () => {
    const diasParciais = [
      '2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30',
      '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06',
      '2026-10-07', '2026-10-08', '2026-10-09',
    ];
    const diasCheios = ['2026-10-10', '2026-10-11', '2026-10-13'];
    const linhas: LinhaRelatorioProducao[] = [];
    for (const dia of [...diasParciais, ...diasCheios]) {
      for (const setor of SETORES) {
        linhas.push({ dia, uploadId: 1, criadoEm: 1, fechado: false, ...setor });
      }
      linhas.push({
        dia, uploadId: 1, criadoEm: 1, fechado: false, local: 'RUA ANTIGA', valor: 900,
      });
    }
    for (const dia of diasParciais) {
      for (const setor of [SETORES[0], SETORES[4]]) {
        linhas.push({ dia, uploadId: 2, criadoEm: 2, fechado: false, ...setor });
      }
    }
    for (const dia of diasCheios) {
      for (const setor of SETORES) {
        linhas.push({ dia, uploadId: 2, criadoEm: 2, fechado: false, ...setor });
      }
    }

    const visiveis = linhasVisiveisNoRelatorio(linhas);
    assert.equal(visiveis.length, linhas.length);
    assert.equal(visiveis.some((linha) => linha.local === 'RUA ANTIGA'), true);
    assert.equal(somarLinhasVisiveis(linhas), Math.round(linhas.reduce((s, l) => s + l.valor, 0) * 1000) / 1000);
  });

  it('soma várias linhas do mesmo local e do mesmo dia', () => {
    const linhas: LinhaRelatorioProducao[] = [
      { dia: '2026-09-01', uploadId: 1, criadoEm: 1, fechado: false, local: 'RUA DAS FLORES', valor: 120.5 },
      { dia: '2026-09-01', uploadId: 1, criadoEm: 1, fechado: false, local: 'RUA DAS FLORES', valor: 80.25 },
      { dia: '2026-09-01', uploadId: 1, criadoEm: 1, fechado: false, local: 'RUA DAS FLORES', valor: 40 },
    ];
    assert.equal(linhasVisiveisNoRelatorio(linhas).length, 3);
    assert.equal(somarLinhasVisiveis(linhas), 240.75);
  });
});
