import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index,
} from 'typeorm';

/**
 * Catálogo no banco de controle: grupo WhatsApp → banco do contrato.
 * Sem FK para servicos (o serviço vive no banco do tenant).
 */
@Entity('whatsapp_grupo_roteamento')
@Index(['grupoJid'], { unique: true })
export class WhatsappGrupoRoteamento {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('varchar', { length: 80 })
  grupoJid!: string;

  @Column('varchar', { length: 200, nullable: true })
  nomeGrupo!: string | null;

  @Column('uuid')
  servicoId!: string;

  @Column('varchar', { length: 63 })
  tenantDb!: string;

  @Column('uuid', { nullable: true })
  contractId!: string | null;

  @Column('boolean', { default: true })
  ativo!: boolean;

  @Column('varchar', { length: 30, default: 'atualizar_data' })
  estrategia!: string;

  @Column('boolean', { default: false })
  responderPdf!: boolean;

  @CreateDateColumn()
  criadoEm!: Date;

  @UpdateDateColumn()
  atualizadoEm!: Date;
}
