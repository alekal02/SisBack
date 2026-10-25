import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import * as XLSX from 'xlsx';
import {
  detectarPlanilhaConsolidadoProducao,
  parsearPlanilhaConsolidadoProducao,
  mapearTipoServicoConsolidado,
  agruparLinhasPorServicoAba,
} from './consolidadoProducaoPlanilhaParser';
import { montarPacoteConsolidado } from './consolidadoProducaoRelatorio';
import {
  gerarHtmlRelatorioDiaServicoProducao,
  gerarHtmlRelatorioCicloServicoProducao,
} from './relatorioDia/gerarHtmlRelatorioDiaConsolidado';
import { detectarPlanilhaServicosUnificados } from './servicosUnificadosPlanilhaParser';
import { converterKpisParaConfig } from './TipoServicoTemplateService';

const ARQUIVO_UNAI = 'C:/Users/Sistemma/Downloads/PRODUÇÃO - UNAÍ - OUT. 2026.xlsx';

const ARQUIVO_APARECIDA =
  'C:/Users/Sistemma/Downloads/PRODUÇÃO - APARECIDA - SET. 2026 (2).xlsm';

function bufferAbas(sheets: Array<{ name: string; rows: unknown[][] }>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.rows), s.name);
  }
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

const CAB = ['SERVIÇO', 'DATA', 'LOCAL', 'TIPO DE EQUIPAMENTO', 'UNIDADE', 'QUANTIDADE', 'OBSERVAÇÃO'];

describe('consolidadoProducaoPlanilhaParser', () => {
  it('mapeia SERVIÇO da CONSOLIDADO para o tipo do sistema', () => {
    assert.equal(mapearTipoServicoConsolidado('VARRIÇÃO MANUAL'), 'varricao');
    assert.equal(mapearTipoServicoConsolidado('VARREÇÃO MECANIZADA'), 'varricao');
    assert.equal(mapearTipoServicoConsolidado('ROÇADA MANUAL'), 'rocadeira');
    assert.equal(mapearTipoServicoConsolidado('ROÇADA MECANIZADA'), 'rocadeira');
    assert.equal(mapearTipoServicoConsolidado('PODA DE ÁRVORE'), 'poda');
    assert.equal(mapearTipoServicoConsolidado('REMOÇÃO DE ENTULHO'), 'remocao');
    assert.equal(mapearTipoServicoConsolidado('LIMPEZA DE FEIRAS'), 'geral');
    assert.equal(mapearTipoServicoConsolidado('CAPINA'), 'capina');
    assert.equal(mapearTipoServicoConsolidado('ATERRO'), 'aterro');
    assert.equal(mapearTipoServicoConsolidado('COLETA SELETIVA'), 'coleta_seletiva');
    assert.equal(mapearTipoServicoConsolidado('XYZ'), null);
  });

  it('não detecta o layout unificado legado como CONSOLIDADO Power Query', () => {
    const wb = XLSX.utils.book_new();
    const rows = [
      ['DATA', 'BAIRRO', 'UND', 'QUANTITATIVO', 'TIPO DE SERVIÇO'],
      [new Date(2026, 8, 1), 'Centro', 'km', 10, 'CAPINA'],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'CONSOLIDADO');
    const buf = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
    assert.equal(detectarPlanilhaConsolidadoProducao(buf), false);
    assert.equal(detectarPlanilhaServicosUnificados(buf), true);
  });

  it('lê a CONSOLIDADO uma vez e não soma as Tabela*', () => {
    const buf = bufferAbas([
      {
        name: 'CONSOLIDADO',
        rows: [
          CAB,
          ['VARRIÇÃO MANUAL', '25/08/2026', '1', 'LUTOCAR', 'KM', 6.05, '2 vezes'],
          ['PODA DE ÁRVORE', '25/08/2026', 'Bairro X', 'CAMINHÃO CESTO', 'EQUIPE', '', 'Poda'],
        ],
      },
      {
        name: 'TabelaVarriçãoManual',
        rows: [
          CAB,
          ['VARRIÇÃO MANUAL', '25/08/2026', '1', 'LUTOCAR', 'KM', 6.05, '2 vezes'],
          ['VARRIÇÃO MANUAL', '26/08/2026', '1', 'LUTOCAR', 'KM', 6.05, '2 vezes'],
        ],
      },
      {
        name: 'TabelaPodaÁrvore',
        rows: [
          CAB,
          ['PODA DE ÁRVORE', '25/08/2026', 'Bairro X', 'CAMINHÃO CESTO', 'EQUIPE', '', 'Poda'],
        ],
      },
    ]);
    assert.equal(detectarPlanilhaConsolidadoProducao(buf), true);
    const r = parsearPlanilhaConsolidadoProducao(buf);
    assert.equal(r.modelo, 'consolidado_producao');
    assert.deepEqual(r.abasUsadas, ['CONSOLIDADO']);
    assert.equal(r.linhas.length, 2);
    const poda = r.linhas.find((l) => l.tipoSistema === 'poda');
    assert.ok(poda);
    assert.equal(poda!.nomeServico, 'Poda');
    assert.equal(poda!.quantitativo, 1);
    const vm = r.linhas.find((l) => l.tipoSistema === 'varricao');
    assert.equal(vm!.nomeServico, 'Varrição Manual');
    assert.equal(vm!.tipoExecucao, 'manual');
    assert.equal(vm!.quantitativo, 6.05);
  });

  it('separa cada aba em um serviço e gera PDF só daquela aba', () => {
    const mec: unknown[][] = [CAB];
    for (let d = 1; d <= 5; d++) {
      const dia = `${String(24 + d).padStart(2, '0')}/08/2026`;
      mec.push(['VARREÇÃO MECANIZADA', dia, 'SETOR 10', 'VARREDEIRA', 'KM', 497.61, '']);
      mec.push(['VARREÇÃO MECANIZADA', dia, 'SETOR 3', 'VARREDEIRA', 'KM', 528.69, '']);
    }
    const r = parsearPlanilhaConsolidadoProducao(bufferAbas([
      { name: 'TabelaVarreçãoMec', rows: mec },
      { name: 'TabelaEntulho', rows: [CAB, ['REMOÇÃO DE ENTULHO', '25/08/2026', 'Rua A', 'CAÇAMBA', 'EQUIPE', '', '']] },
      { name: 'TabelaFeira', rows: [CAB, ['LIMPEZA DE FEIRAS', '25/08/2026', 'Feira 1', 'PIPA', 'EQUIPE', '', '']] },
      { name: 'TabelaRoçadaManual', rows: [CAB, ['ROÇADA MANUAL', '25/08/2026', 'Setor Y', '', 'M²', 1200, '']] },
    ]));
    assert.equal(r.linhas.filter((l) => l.chaveServico === 'varricao_mecanizada').length, 10);
    assert.equal(r.linhas.filter((l) => l.chaveServico === 'remocao').length, 1);
    assert.equal(r.linhas.filter((l) => l.chaveServico === 'feiras').length, 1);
    assert.equal(r.linhas.filter((l) => l.chaveServico === 'rocada_manual')[0]?.tipoExecucao, 'manual');
    assert.ok(r.avisos.some((a) => /repetiu/i.test(a)));
    const grupos = agruparLinhasPorServicoAba(r.linhas);
    assert.equal(grupos.size, 4);
    const rem = r.linhas.find((l) => l.tipoSistema === 'remocao');
    assert.equal(rem?.dataSaida?.toISOString().slice(0, 10), '2026-08-25');
    const pacote = montarPacoteConsolidado(grupos.get('varricao_mecanizada') || [], r.avisos);
    assert.ok(pacote);
    assert.equal(pacote!.ciclo.serie.length, 5);
    assert.equal(pacote!.dia.dataIso, '2026-08-29');
    const htmlDia = gerarHtmlRelatorioDiaServicoProducao({
      contratoNome: 'Aparecida',
      servicoNome: 'Varrição Mecanizada',
      pacote: pacote!,
    });
    const htmlCiclo = gerarHtmlRelatorioCicloServicoProducao({
      contratoNome: 'Aparecida',
      servicoNome: 'Varrição Mecanizada',
      pacote: pacote!,
    });
    assert.match(htmlDia, /Varrição Mecanizada/);
    assert.match(htmlDia, /operação do dia/i);
    assert.doesNotMatch(htmlDia, /Série diária/);
    assert.match(htmlCiclo, /ciclo/i);
    assert.match(htmlCiclo, /Série diária/);
    assert.doesNotMatch(htmlDia, /CONSOLIDADO — dia/);
  });

  it('não detecta buffer inválido', () => {
    assert.equal(detectarPlanilhaConsolidadoProducao(Buffer.from('not-an-xlsx')), false);
  });

  it('lê cada serviço da planilha padrão Aparecida SET/2026 (xlsm)', function () {
    if (!fs.existsSync(ARQUIVO_APARECIDA)) return;
    const buf = fs.readFileSync(ARQUIVO_APARECIDA);
    assert.equal(detectarPlanilhaConsolidadoProducao(buf), true);
    const r = parsearPlanilhaConsolidadoProducao(buf);
    assert.deepEqual(r.abasUsadas, ['CONSOLIDADO']);
    const porAba = Object.fromEntries(r.porAba.map((p) => [p.chaveServico, p]));
    assert.equal(porAba.varricao_mecanizada?.registros, 110);
    assert.equal(porAba.varricao_manual?.registros, 1407);
    assert.equal(porAba.poda?.registros, 36);
    assert.equal(porAba.rocada_manual?.registros, 885);
    assert.equal(porAba.rocada_mecanizada?.registros, 3591);
    assert.equal(porAba.remocao?.registros, 161);
    assert.equal(porAba.feiras, undefined);
    const grupos = agruparLinhasPorServicoAba(r.linhas);
    assert.equal(grupos.size, 6);
    const poda = montarPacoteConsolidado(grupos.get('poda') || [], []);
    assert.ok(poda);
    const htmlDia = gerarHtmlRelatorioDiaServicoProducao({
      contratoNome: 'Aparecida',
      servicoNome: 'Poda',
      pacote: poda!,
    });
    const htmlCiclo = gerarHtmlRelatorioCicloServicoProducao({
      contratoNome: 'Aparecida',
      servicoNome: 'Poda',
      pacote: poda!,
    });
    assert.match(htmlDia, /Poda — operação do dia/);
    assert.match(htmlCiclo, /Poda — ciclo/);
    assert.doesNotMatch(htmlDia, /todos os serviços/);
  });

  it('Unaí: Aterro e Coleta Seletiva viram serviço com KPI, sem cair no tipo genérico', function () {
    if (!fs.existsSync(ARQUIVO_UNAI)) return;
    const buf = fs.readFileSync(ARQUIVO_UNAI);
    const r = parsearPlanilhaConsolidadoProducao(buf);
    const porAba = Object.fromEntries(r.porAba.map((p) => [p.chaveServico, p]));
    assert.ok((porAba.aterro?.registros || 0) > 0);
    assert.ok((porAba.coleta_seletiva?.registros || 0) > 0);
    assert.ok((porAba.capina?.registros || 0) > 0);
    assert.ok((porAba.poda?.registros || 0) > 0);
    assert.equal(porAba.aterro?.tipoSistema, 'aterro');
    assert.equal(porAba.coleta_seletiva?.tipoSistema, 'coleta_seletiva');
    assert.ok(converterKpisParaConfig('aterro').length >= 2);
    assert.ok(converterKpisParaConfig('coleta_seletiva').some((k) => k.nome === 'Toneladas'));
    assert.equal(r.porAba.some((p) => p.tipoSistema === 'geral'), false);
  });
});
