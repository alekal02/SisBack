import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddTipoToServico1700000000000 implements MigrationInterface {
  name = 'AddTipoToServico1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Verifica se a coluna já existe
    const table = await queryRunner.getTable('servicos');
    const columnExists = table?.findColumnByName('tipo');

    if (!columnExists) {
      await queryRunner.addColumn(
        'servicos',
        new TableColumn({
          name: 'tipo',
          type: 'varchar',
          length: '50',
          isNullable: false,
          default: "'consultoria'",
        }),
      );
      console.log('✅ Coluna "tipo" adicionada à tabela "servicos"');
    } else {
      console.log('ℹ️ Coluna "tipo" já existe na tabela "servicos"');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('servicos');
    const columnExists = table?.findColumnByName('tipo');

    if (columnExists) {
      await queryRunner.dropColumn('servicos', 'tipo');
      console.log('✅ Coluna "tipo" removida da tabela "servicos"');
    }
  }
}
