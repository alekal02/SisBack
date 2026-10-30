import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * Pessoa autorizada a falar com o chatbot em conversa privada, por contrato.
 * O mesmo telefone pode existir em vários contratos.
 */
@Entity('whatsapp_autorizado')
@Index(['contractId', 'telefone'], { unique: true })
@Index(['telefone'])
export class WhatsappAutorizado {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid', { name: 'contract_id' })
  contractId!: string;

  @Column('varchar', { length: 160 })
  nome!: string;

  /** Só dígitos, com DDI. Ex.: 5562999998888 */
  @Column('varchar', { length: 20 })
  telefone!: string;

  @Column('varchar', { name: 'lid', length: 80, nullable: true })
  lid!: string | null;

  @Column('boolean', { name: 'pode_enviar_planilha', default: false })
  podeEnviarPlanilha!: boolean;

  @Column('boolean', { name: 'pode_pedir_relatorio', default: false })
  podePedirRelatorio!: boolean;

  @Column('boolean', { default: true })
  ativo!: boolean;

  @CreateDateColumn({ name: 'criado_em' })
  criadoEm!: Date;
}
