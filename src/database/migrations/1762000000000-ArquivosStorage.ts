import { MigrationInterface, QueryRunner } from 'typeorm';
import { SQL_CRIAR_ARQUIVOS_STORAGE, sqlAlterDefaultId } from '../uuidIdDefault';

export class ArquivosStorage1762000000000 implements MigrationInterface {
  name = 'ArquivosStorage1762000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(SQL_CRIAR_ARQUIVOS_STORAGE);
    await queryRunner.query(sqlAlterDefaultId('arquivos_storage'));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS arquivos_storage');
  }
}
