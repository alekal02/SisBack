import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, ManyToOne, JoinColumn } from 'typeorm';
import { User } from './User';

@Entity('abastecimentos')
@Index(['placa'])
@Index(['dataAbastecimento'])
// O dashboard executivo filtra sempre por contrato dentro de um período.
@Index(['contract_id', 'dataAbastecimento'])
export class Abastecimento {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('varchar', { length: 10 })
  placa!: string;

  @Column('decimal', { precision: 10, scale: 2 })
  litragem!: number;

  @Column('decimal', { precision: 10, scale: 2 })
  valor!: number;

  @Column('timestamp')
  dataAbastecimento!: Date;

  // Relacionamento com projeto e contrato (opcional)
  @Column('uuid', { nullable: true })
  project_id!: string | null;

  @Column('uuid', { nullable: true })
  contract_id!: string | null;

  @Column('text', { nullable: true })
  imagemUrl!: string | null;

  @Column('varchar', { length: 20, default: 'pendente' })
  statusExtracao!: 'pendente' | 'sucesso' | 'erro';

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  litragemExtraida!: number | null;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  valorExtraido!: number | null;

  @Column('text', { nullable: true })
  observacoes!: string | null;

  @Column('decimal', { precision: 3, scale: 2, nullable: true })
  confiancaOCR!: number | null; // 0.0 a 1.0

  @Column('text', { nullable: true })
  erroExtracao!: string | null;

  @Column('uuid', { nullable: true })
  usuarioCriadorId!: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'usuarioCriadorId' })
  usuarioCriador!: User | null;

  @CreateDateColumn()
  criadoEm!: Date;

  @UpdateDateColumn()
  atualizadoEm!: Date;
}
