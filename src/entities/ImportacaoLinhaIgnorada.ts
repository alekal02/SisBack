import { Entity, PrimaryGeneratedColumn, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { PlanilhaUpload } from './PlanilhaUpload';

@Entity('importacao_linha_ignorada')
@Index(['planilhaUploadId'])
export class ImportacaoLinhaIgnorada {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column('int')
  planilhaUploadId!: number;

  @ManyToOne(() => PlanilhaUpload, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'planilhaUploadId' })
  upload!: PlanilhaUpload;

  /** Número da linha no Excel (1 = primeira linha da aba). */
  @Column('int')
  linhaExcel!: number;

  @Column('varchar', { length: 80 })
  motivo!: string;
}
