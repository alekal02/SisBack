import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Abastecimento } from './Abastecimento';
import { User } from './User';

@Entity('abastecimento_logs')
export class AbastecimentoLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  abastecimentoId!: string;

  @ManyToOne(() => Abastecimento, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'abastecimentoId' })
  abastecimento!: Abastecimento;

  @Column('varchar', { length: 50 })
  campoAlterado!: string;

  @Column('text', { nullable: true })
  valorAntigo!: string | null;

  @Column('text', { nullable: true })
  valorNovo!: string | null;

  @Column('uuid', { nullable: true })
  alteradoPorId!: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'alteradoPorId' })
  alteradoPor!: User | null;

  @CreateDateColumn()
  criadoEm!: Date;
}
