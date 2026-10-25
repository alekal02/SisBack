import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index,
  ManyToOne, JoinColumn
} from 'typeorm';
import { Contract } from './Contract';
import { TipoServico } from '../enums/TipoServico';

@Entity('servicos')
@Index(['contract_id'])
export class Servico {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  contract_id!: string;

  @ManyToOne(() => Contract, (contract) => contract.servicos, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'contract_id' })
  contract!: Contract;

  @Column('varchar', { length: 200 })
  nome!: string;

  @Column('text', { nullable: true })
  descricao!: string | null;

  @Column('varchar', { length: 50, default: TipoServico.COLETA_CAMINHAO })
  tipo!: string;

  @Column('jsonb', { nullable: true })
  configDashboard!: any | null;

  @Column('jsonb', { nullable: true })
  padraoPlanilha!: any | null;

  @Column('jsonb', { nullable: true })
  configFaturamento!: any | null;

  @CreateDateColumn()
  criadoEm!: Date;

  @UpdateDateColumn()
  atualizadoEm!: Date;
}
