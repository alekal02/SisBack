import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Índices para escala ~600k registros/mês (coleta + roçada).
 * Idempotente: só cria se ainda não existir.
 */
export class ColetaDadosIndexes600k1752000000000 implements MigrationInterface {
  name = 'ColetaDadosIndexes600k1752000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes WHERE indexname = 'IDX_coleta_dados_motorista'
        ) THEN
          CREATE INDEX "IDX_coleta_dados_motorista" ON coleta_dados ("motorista");
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes WHERE indexname = 'IDX_coleta_dados_tipoCaminhao'
        ) THEN
          CREATE INDEX "IDX_coleta_dados_tipoCaminhao" ON coleta_dados ("tipoCaminhao");
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes WHERE indexname = 'IDX_coleta_dados_upload_valido_data'
        ) THEN
          CREATE INDEX "IDX_coleta_dados_upload_valido_data"
            ON coleta_dados ("planilhaUploadId", "validoDashboard", "dataSaida");
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes WHERE indexname = 'IDX_planilha_uploads_servico_id'
        ) THEN
          CREATE INDEX "IDX_planilha_uploads_servico_id" ON planilha_uploads (servico_id);
        END IF;
      END $$;
    `);

    // GIN em JSONB — acelera expressões dados->>'Area m²' (roçada)
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes WHERE indexname = 'IDX_coleta_dados_dados_gin'
        ) THEN
          CREATE INDEX "IDX_coleta_dados_dados_gin" ON coleta_dados USING GIN (dados);
        END IF;
      END $$;
    `);

    console.log('✅ Índices 600k (coleta_dados / planilha_uploads) aplicados');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_coleta_dados_dados_gin"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_planilha_uploads_servico_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_coleta_dados_upload_valido_data"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_coleta_dados_tipoCaminhao"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_coleta_dados_motorista"`);
  }
}
