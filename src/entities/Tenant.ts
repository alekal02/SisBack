import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index,
} from 'typeorm';

@Entity('tenants')
@Index(['slug'], { unique: true })
@Index(['databaseName'], { unique: true })
@Index(['contractId'], { unique: true })
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  contractId!: string;

  @Column('varchar', { length: 200 })
  numeroContrato!: string;

  @Column('varchar', { length: 50 })
  slug!: string;

  @Column('varchar', { length: 63 })
  databaseName!: string;

  @Column('varchar', { length: 20, default: 'ativo' })
  status!: 'ativo' | 'encerrado';

  @CreateDateColumn()
  criadoEm!: Date;

  @UpdateDateColumn()
  atualizadoEm!: Date;
}
