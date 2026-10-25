import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { Servico } from './Servico';

@Entity('contracts')
export class Contract {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('varchar', { length: 200, nullable: true })
  numeroContrato!: string | null;

  @Column('varchar', { length: 20, default: 'ativo' })
  status!: 'ativo' | 'encerrado';

  @Column('int', { default: 1 })
  diaInicioCiclo!: number;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  valorTonelada!: number | null;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  valorMini!: number | null;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  valorTruck!: number | null;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  valorToco!: number | null;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  valorBasculante!: number | null;

  @Column('jsonb', { nullable: true })
  kpisConfig!: any[] | null;

  @Column('jsonb', { nullable: true })
  configResumo!: any | null;

  /** Placas reserva, frota, motoristas, coletores e limites de peso/volume por tipo. */
  @Column('jsonb', { nullable: true })
  configOperacional!: {
    placasReserva?: string[];
    placasAtivas?: string[];
    motoristas?: string[];
    coletores?: string[];
    /** Peso máximo (kg) por tipo — override do padrão (Basculante default 14000). */
    pesoMaximoKg?: { MINI?: number; TOCO?: number; BASCULANTE?: number; TRUCK?: number };
    /** Volume útil da caixa (L) por tipo — usado na caixa média da frota. */
    volumeL?: { MINI?: number; TOCO?: number; BASCULANTE?: number; TRUCK?: number };
    /** Densidade do resíduo (kg/L) padrão do contrato — fallback quando o tipo não tem densidade própria. */
    densidadeResiduoKgL?: number | null;
    /** Densidade (kg/L) por tipo — peso ideal = volume (L) × densidade do tipo. */
    densidadeKgL?: { MINI?: number; TOCO?: number; BASCULANTE?: number; TRUCK?: number };
    /** Densidade (kg/L) por placa — override do tipo/global (só placas informadas). */
    densidadeKgLPorPlaca?: Record<string, number>;
    /** Pasta absoluta (vista pelo backend) para backup da planilha ao fechar o ciclo. */
    pastaBackupPlanilhas?: string | null;
  } | null;

  @OneToMany(() => Servico, (servico) => servico.contract)
  servicos!: Servico[];

  @CreateDateColumn()
  criadoEm!: Date;

  @UpdateDateColumn()
  atualizadoEm!: Date;
}
