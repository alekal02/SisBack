import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/**
 * Instância que o próprio Sistemma criou na WuzAPI.
 * O token não sai do banco: não vai para log, resposta da API nem tela.
 */
@Entity('whatsapp_instancia')
export class WhatsappInstancia {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('varchar', { name: 'nome_instancia', length: 80 })
  nomeInstancia!: string;

  @Column('varchar', { name: 'token', length: 80 })
  token!: string;

  @CreateDateColumn({ name: 'criado_em', type: 'timestamptz' })
  criadoEm!: Date;

  @Column('boolean', { name: 'ativo', default: true })
  ativo!: boolean;
}
