import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { objectPathDeUrl } from './FileStorageService';

describe('objectPathDeUrl', () => {
  const bucket = 'sistemma';

  it('ignora host e o bucket antigo abastecimentos', () => {
    assert.equal(
      objectPathDeUrl(
        'http://localhost:9002/abastecimentos/contratos/londrina/ciclo-2026-10-01_2026-10-31/diario/2026-10-22.xlsx',
        bucket,
      ),
      'contratos/londrina/ciclo-2026-10-01_2026-10-31/diario/2026-10-22.xlsx',
    );
    assert.equal(
      objectPathDeUrl('http://localhost:9000/abastecimentos/planilhas/1327f805-91c4-4aea-b2f0-b51694032179.xlsx', bucket),
      'planilhas/1327f805-91c4-4aea-b2f0-b51694032179.xlsx',
    );
  });

  it('ignora o bucket atual quando a URL nova o inclui', () => {
    assert.equal(
      objectPathDeUrl('https://arquivos.exemplo/sistemma/planilhas/a.xlsx', bucket),
      'planilhas/a.xlsx',
    );
  });

  it('mantém o caminho quando a URL pública não traz o bucket', () => {
    assert.equal(
      objectPathDeUrl('https://pub.exemplo.r2.dev/planilhas/a.xlsx', bucket),
      'planilhas/a.xlsx',
    );
  });

  it('lê o caminho de uma URL gravada no banco', () => {
    assert.equal(
      objectPathDeUrl('db://arquivos/planilhas/a.xlsx', bucket),
      'planilhas/a.xlsx',
    );
    assert.equal(
      objectPathDeUrl('db://arquivos/planilhas-ciclo/contrato/folha.xlsx', bucket),
      'planilhas-ciclo/contrato/folha.xlsx',
    );
  });

  it('rejeita URL sem caminho', () => {
    assert.equal(objectPathDeUrl('http://localhost:9002/abastecimentos', bucket), null);
    assert.equal(objectPathDeUrl('nao-e-url', bucket), null);
  });
});
