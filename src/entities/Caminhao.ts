import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('caminhoes')
@Index(['placa'], { unique: true })
export class Caminhao {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('varchar', { length: 100 })
  modelo!: string;

  @Column('int')
  ano!: number;

  @Column('varchar', { length: 10, unique: true })
  placa!: string;

  @Column('varchar', { length: 50, unique: true })
  codigo!: string;

  @CreateDateColumn()
  criadoEm!: Date;

  @UpdateDateColumn()
  atualizadoEm!: Date;
}
