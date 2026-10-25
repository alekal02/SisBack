import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  ManyToOne, JoinColumn, Index
} from 'typeorm';
import { PlanilhaUpload } from './PlanilhaUpload';
import { dateUtcColumnTransformer } from '../utils/dateColumnTransformer';

@Entity('coleta_dados')
@Index(['dataSaida'])
@Index(['placa'])
@Index(['regional'])
@Index(['distrito'])
@Index(['turno'])
@Index(['motorista'])
@Index(['tipoCaminhao'])
@Index(['planilhaUploadId'])
@Index(['planilhaUploadId', 'dataSaida'])
@Index(['regional', 'dataSaida'])
@Index(['placa', 'dataSaida'])
@Index(['planilhaUploadId', 'validoDashboard', 'dataSaida'])
export class ColetaData {
  @PrimaryGeneratedColumn()
  id!: number;

  // ── Referência ao upload ──
  @Column('int', { nullable: true })
  planilhaUploadId!: number | null;

  @ManyToOne(() => PlanilhaUpload, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'planilhaUploadId' })
  planilhaUpload!: PlanilhaUpload | null;

  // ── Dados da planilha ──
  @Column('date', { nullable: true, transformer: dateUtcColumnTransformer })
  dataSaida!: Date | null;

  @Column('varchar', { length: 20, nullable: true })
  turno!: string | null;

  @Column('varchar', { length: 50, nullable: true })
  regional!: string | null;

  @Column('varchar', { length: 50, nullable: true })
  distrito!: string | null;

  @Column('varchar', { length: 10, nullable: true })
  placa!: string | null;

  @Column('varchar', { length: 100, nullable: true })
  motorista!: string | null;

  @Column('int', { nullable: true })
  numeroColetores!: number | null;

  @Column('float', { nullable: true })
  kmSaida!: number | null;

  @Column('float', { nullable: true })
  horaSaida!: number | null;

  @Column('float', { nullable: true })
  kmChegada!: number | null;

  @Column('float', { nullable: true })
  horaChegada!: number | null;

  @Column('float', { nullable: true })
  horaUltimoTerminoCarregamento!: number | null;

  @Column('float', { nullable: true })
  peso1!: number | null;

  @Column('float', { nullable: true })
  peso2!: number | null;

  @Column('float', { nullable: true })
  peso3!: number | null;

  @Column('float', { nullable: true })
  peso4!: number | null;

  @Column('float', { nullable: true })
  peso5!: number | null;

  @Column('float', { nullable: true })
  pesoTotal!: number | null;

  @Column('float', { nullable: true })
  tempoForaUnidade!: number | null;

  @Column('float', { nullable: true })
  horasForaUnidade!: number | null;

  @Column('varchar', { length: 30, nullable: true })
  tipoCaminhao!: string | null;

  @Column('float', { nullable: true })
  kmTotal!: number | null;

  @Column('int', { nullable: true })
  numeroViagens!: number | null;

  /** Viagens efetivas na rota (linha): CONTADOR DE VIAGENS ou PESO 1–4 preenchidos (máx. 4) */
  @Column('int', { nullable: true, default: 0 })
  viagensPorRota!: number | null;

  // ── Hodômetro/hora legado por slot ROTA 01–04 (KPIs de tempo/KM) ──
  @Column('float', { nullable: true })
  kmRota1!: number | null;

  @Column('float', { nullable: true })
  horaRota1!: number | null;

  @Column('float', { nullable: true })
  kmRota2!: number | null;

  @Column('float', { nullable: true })
  horaRota2!: number | null;

  @Column('float', { nullable: true })
  kmRota3!: number | null;

  @Column('float', { nullable: true })
  horaRota3!: number | null;

  @Column('float', { nullable: true })
  kmRota4!: number | null;

  @Column('float', { nullable: true })
  horaRota4!: number | null;

  @Column('int', { nullable: true })
  diaSemana!: number | null;

  // ── Dados brutos (para planilhas de formato livre) ──
  @Column('jsonb', { nullable: true })
  dados!: Record<string, any> | null;

  /** false = viagem excluída dos cálculos do dashboard (KM/peso/rota incompletos) */
  @Column('boolean', { default: false })
  validoDashboard!: boolean;

  /** Motivos pelos quais a viagem não entra no dashboard */
  @Column('jsonb', { nullable: true })
  motivosInconsistencia!: string[] | null;

  @CreateDateColumn()
  criadoEm!: Date;

  /** Converte serial Excel para data */
  static fromExcelDate(serial: number): Date | null {
    if (!serial || serial < 1) return null;
    const utcDays = Math.floor(serial - 25569);
    const utcValue = utcDays * 86400;
    return new Date(utcValue * 1000);
  }

  /** Converte serial Excel de hora (0.0 a 1.0) para string HH:MM */
  static excelTimeToString(serial: number): string {
    if (!serial && serial !== 0) return '';
    const totalMinutes = Math.round(serial * 24 * 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }
}
