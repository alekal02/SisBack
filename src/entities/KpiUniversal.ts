import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn
} from 'typeorm';

export interface PlaceholderKpi {
  nome: string;
  label: string;
  colunasCandidatas: string[];
  resolvido?: boolean;
}

@Entity('kpis_universais')
export class KpiUniversal {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('varchar', { length: 200 })
  nome!: string;

  @Column('varchar', { length: 200 })
  label!: string;

  @Column('text')
  formula!: string;

  @Column('varchar', { length: 50, default: 'sum' })
  agregacao!: string;

  @Column('varchar', { length: 50, default: 'numero' })
  formato!: string;

  @Column('varchar', { length: 50, nullable: true })
  unidade!: string | null;

  @Column('varchar', { length: 100 })
  categoria!: string;

  @Column('varchar', { length: 20, default: '#6366f1' })
  cor!: string;

  @Column('text', { nullable: true })
  descricao!: string | null;

  @Column('float', { nullable: true })
  metaSugerida!: number | null;

  @Column('varchar', { length: 50 })
  tipoServico!: string;

  @Column('jsonb', { nullable: true })
  placeholders!: PlaceholderKpi[] | null;

  @Column({ default: false })
  isPersonalizado!: boolean;

  @CreateDateColumn()
  criadoEm!: Date;

  @UpdateDateColumn()
  atualizadoEm!: Date;
}
