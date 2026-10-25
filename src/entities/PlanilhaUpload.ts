import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index,
  ManyToOne, JoinColumn
} from 'typeorm';
import { User } from './User';

@Entity('planilha_uploads')
@Index(['servico_id'])
export class PlanilhaUpload {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column('varchar', { length: 255 })
  nomeArquivo!: string;

  @Column('int')
  totalLinhas!: number;

  @Column('int', { default: 0 })
  linhasImportadas!: number;

  @Column('int', { default: 0 })
  linhasComErro!: number;

  // ── Campos de deduplicação ──
  @Column('int', { default: 0 })
  linhasIgnoradas!: number; // duplicatas idênticas ignoradas

  @Column('int', { default: 0 })
  linhasSubstituidas!: number; // conflitos onde a planilha substituiu o banco

  @Column('int', { default: 0 })
  linhasConflitantes!: number; // conflitos que exigiram decisão

  @Column('varchar', { length: 30, default: 'ignorar' })
  estrategia!: 'ignorar' | 'substituir' | 'cancelar' | 'atualizar_data' | 'inserir_data';

  @Column('jsonb', { nullable: true })
  resumo!: {
    novos: number;
    duplicadosIgnorados: number;
    conflitantes: number;
    substituidos: number;
    detalhes?: { data: string; placa: string; motivo: string }[];
    viagensInconsistentes?: number;
    viagensValidasDashboard?: number;
    linhasDescartadasSemDados?: number;
    viagensCorrigidas?: number;
    /** Ex.: servicos_unificados, rocada, coleta */
    modelo?: string;
    /** De onde veio o arquivo original (chatbot WhatsApp vs tela). */
    origem?: 'whatsapp' | 'web';
    consolidacao?: {
      registrosRemovidosAusentes: number;
      uploadsRemovidos: number;
      diasRemovidosAusentes: string[];
    };
  } | null;

  @Column('text', { nullable: true })
  erro!: string | null;

  @Column('text', { nullable: true })
  urlDownload!: string | null;

  @Column('uuid', { nullable: true })
  servico_id!: string | null;

  /** Ciclo de faturamento ao qual este upload pertence */
  @Column('int', { nullable: true })
  cicloMesReferencia!: number | null;

  @Column('int', { nullable: true })
  cicloAnoReferencia!: number | null;

  /** Quando preenchido, os dados deste upload não são alterados por novas importações */
  @Column('timestamptz', { nullable: true })
  cicloFechadoEm!: Date | null;

  @Column('uuid', { nullable: true })
  usuarioId!: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'usuarioId' })
  usuario!: User | null;

  @CreateDateColumn()
  criadoEm!: Date;
}
