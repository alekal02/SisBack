import {
  Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn, Index,
} from 'typeorm';
import { dateUtcColumnTransformer } from '../utils/dateColumnTransformer';

/**
 * Resumo de um dia de coleta, isolado no banco do contrato (multi-tenant).
 * Mesmo nome de tabela em todos os bancos — os dados nunca se misturam.
 */
@Entity('coleta_totais_dia')
@Index(['servicoId', 'data'], { unique: true })
@Index(['contractId', 'data'])
export class ColetaTotaisDia {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column('uuid')
  contractId!: string;

  @Column('uuid')
  servicoId!: string;

  @Column('date', { transformer: dateUtcColumnTransformer })
  data!: Date;

  @Column('int', { default: 0 })
  registros!: number;

  @Column('int', { default: 0 })
  viagens!: number;

  /** Viagens cuja linha tem KM > 0. Entra no km/viagem e na ton/km. */
  @Column('int', { default: 0 })
  viagensComKm!: number;

  /** Peso (kg) só das linhas com KM > 0. */
  @Column('float', { default: 0 })
  pesoKgComKm!: number;

  @Column('float', { default: 0 })
  pesoKg!: number;

  @Column('float', { default: 0 })
  kmTotal!: number;

  @Column('float', { default: 0 })
  horasProdutivas!: number;

  @Column('int', { default: 0 })
  placas!: number;

  @Column('int', { default: 0 })
  motoristas!: number;

  @Column('int', { default: 0 })
  regionais!: number;

  @Column('int', { default: 0 })
  distritos!: number;

  @Column('float', { default: 0 })
  somaColetores!: number;

  @Column('float', { default: 0 })
  faturamento!: number;

  @Column('jsonb', { nullable: true })
  fatPorTipo!: Record<string, number> | null;

  @UpdateDateColumn()
  atualizadoEm!: Date;
}
