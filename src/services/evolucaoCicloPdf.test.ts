import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { gerarHtmlEvolucaoDiariaWhatsapp, svgGraficoEvolucaoCiclo } from './WhatsappRelatorioHtml';
import { janelaEvolucaoDoChatbot } from './WhatsappComandoRelatorioService';

function dia(iso: string, viagens: number, otimo: number | null, label?: string): {
  data: string;
  label: string;
  viagens: number;
  otimo: number | null;
  ruim: number | null;
  pessimo: number | null;
  excedido: number | null;
} {
  const [, m, d] = iso.split('-');
  const eixo = label || `${d}/${m}`;
  if (otimo == null) {
    return { data: iso, label: eixo, viagens: 0, otimo: null, ruim: null, pessimo: null, excedido: null };
  }
  const ruim = Math.round((100 - otimo) * 0.45);
  const pessimo = Math.round((100 - otimo) * 0.3);
  const excedido = Math.max(0, 100 - otimo - ruim - pessimo);
  return { data: iso, label: eixo, viagens, otimo, ruim, pessimo, excedido };
}

describe('PDF de evolução por ciclo', () => {
  it('desenha a curva do relatório antigo, com ponto em cada dia', () => {
    const linhas = [
      dia('2026-10-01', 8, 68, 'qui 01/10'),
      dia('2026-10-02', 9, 82, 'sex 02/10'),
      dia('2026-10-03', 7, 74, 'sáb 03/10'),
      dia('2026-10-04', 0, null, 'dom 04/10'),
      dia('2026-10-05', 8, 41, 'seg 05/10'),
      dia('2026-10-06', 9, 70, 'ter 06/10'),
    ];
    const svg = svgGraficoEvolucaoCiclo(linhas);
    assert.match(svg, /<path d="M [^"]* C /);
    assert.match(svg, /<circle /);
    assert.match(svg, /#22c55e/);
    assert.match(svg, /#facc15/);
    assert.match(svg, /#ef4444/);
    assert.match(svg, /#a855f7/);
    assert.match(svg, /qui 01\/10/);
    assert.match(svg, /seg 05\/10/);
    assert.equal(svg.includes('class="barra"'), false);

    const html = gerarHtmlEvolucaoDiariaWhatsapp({
      tipoLabel: 'Coleta com Caminhão',
      periodoLabel: 'qui 01/10 a ter 13/10',
      janelaLabel: 'Por ciclo · 11 dias',
      geradoEm: '14/10/2026, 14:42:05',
      totalViagens: 96,
      pctGeral: { otimo: 56, ruim: 20, pessimo: 2, excedido: 22 },
      blocos: [{
        id: 'unai',
        nome: 'Unai · Coleta Unai',
        viagens: 96,
        pct: { otimo: 56, ruim: 20, pessimo: 2, excedido: 22 },
        linhas,
      }],
    });
    assert.match(html, /Evolução diária · qualidade vs peso ideal/);
    assert.match(html, /Por ciclo · 11 dias/);
    assert.match(html, /Unai · Coleta Unai/);
    assert.match(html, /96 viagens/);
    assert.match(html, /class="legenda"/);
    assert.match(html, /mesmas faixas do painel Evolução Diária/);
    assert.equal(html.includes('class="barra"'), false);
    assert.equal(html.includes('cdn.jsdelivr.net'), false);
  });

  it('o chatbot pede o ciclo completo na opção 3 e no atalho', () => {
    for (const texto of ['3', 'evolucao por ciclo', 'evolucao ciclo']) {
      const janela = janelaEvolucaoDoChatbot(texto);
      assert.equal(janela.dias, 0, texto);
      assert.equal(janela.cicloCompleto, true, texto);
      assert.match(janela.label, /ciclo/i);
    }
    assert.equal(janelaEvolucaoDoChatbot('evolucao').cicloCompleto, false);
    assert.equal(janelaEvolucaoDoChatbot('1').dias, 7);
    assert.equal(janelaEvolucaoDoChatbot('evolucao 15').dias, 15);
  });
});
