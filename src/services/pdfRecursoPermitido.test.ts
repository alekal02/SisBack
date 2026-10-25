import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { htmlPdfBloqueado, urlPermitidaNoPdf } from './pdfRecursoPermitido';

describe('PDF — recursos permitidos', () => {
  it('permite o HTML inline e o Chart.js do CDN usado nos relatórios', () => {
    assert.equal(urlPermitidaNoPdf('about:blank'), true);
    assert.equal(urlPermitidaNoPdf('data:image/png;base64,aaa'), true);
    assert.equal(urlPermitidaNoPdf('https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js'), true);
    assert.equal(htmlPdfBloqueado('<html><script src="https://cdn.jsdelivr.net/npm/chart.js"></script></html>'), null);
  });

  it('bloqueia arquivo local, javascript e rede interna', () => {
    assert.equal(urlPermitidaNoPdf('file:///etc/passwd'), false);
    assert.equal(urlPermitidaNoPdf('http://127.0.0.1:9000/minio'), false);
    assert.equal(urlPermitidaNoPdf('http://169.254.169.254/latest/meta-data'), false);
    assert.equal(urlPermitidaNoPdf('http://minio:9000/abastecimentos/a.xlsx'), false);
    assert.equal(urlPermitidaNoPdf('https://exemplo.interno/x'), false);
    assert.match(htmlPdfBloqueado('<iframe src="file:///etc/passwd"></iframe>') || '', /arquivo local/);
    assert.match(htmlPdfBloqueado('<a href="javascript:alert(1)">x</a>') || '', /javascript/);
  });
});
