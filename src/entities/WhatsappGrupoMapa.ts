import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn,
  Index, ManyToOne, JoinColumn,
} from 'typeorm';
import { Servico } from './Servico';

/**
 * Mapeia um grupo WhatsApp (JID @g.us) para um serviço do Sistemma.
 * Planilhas enviadas nesse grupo são importadas automaticamente nesse serviço.
 */
@Entity('whatsapp_grupo_mapa')
@Index(['grupoJid'], { unique: true })
export class WhatsappGrupoMapa {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** JID do grupo, ex.: 120363313346913103@g.us */
  @Column('varchar', { length: 80 })
  grupoJid!: string;

  @Column('varchar', { length: 200, nullable: true })
  nomeGrupo!: string | null;

  @Column('uuid')
  servicoId!: string;

  @ManyToOne(() => Servico, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'servicoId' })
  servico!: Servico;

  @Column('boolean', { default: true })
  ativo!: boolean;

  /**
   * Estratégia de importação para coleta:
   * atualizar_data | inserir_data | ignorar | substituir
   * Roçada ignora este campo (usa importar padrão).
   */
  @Column('varchar', { length: 30, default: 'atualizar_data' })
  estrategia!: string;

  /** Se true, responde no grupo com o PDF após importar */
  @Column('boolean', { default: false })
  responderPdf!: boolean;

  @CreateDateColumn()
  criadoEm!: Date;

  @UpdateDateColumn()
  atualizadoEm!: Date;
}
