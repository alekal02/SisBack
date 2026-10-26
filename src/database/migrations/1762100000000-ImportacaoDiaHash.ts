import { MigrationInterface, QueryRunner } from 'typeorm';

export class ImportacaoDiaHash1762100000000 implements MigrationInterface {
  name = 'ImportacaoDiaHash1762100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS importacao_dia_hash (
        servico_id uuid NOT NULL REFERENCES servicos(id) ON DELETE CASCADE,
        data date NOT NULL,
        hash varchar(64) NOT NULL,
        atualizado_em timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (servico_id, data)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS importacao_dia_hash');
  }
}
