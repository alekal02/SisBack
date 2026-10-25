import { MigrationInterface, QueryRunner } from 'typeorm';

export class ArquivosStorage1762000000000 implements MigrationInterface {
  name = 'ArquivosStorage1762000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS arquivos_storage (
        id uuid PRIMARY KEY,
        caminho varchar(1024) NOT NULL,
        content_type varchar(200),
        tamanho integer NOT NULL,
        conteudo bytea NOT NULL,
        criado_em timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT arquivos_storage_caminho_uk UNIQUE (caminho)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS arquivos_storage');
  }
}
