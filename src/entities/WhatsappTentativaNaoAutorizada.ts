import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('whatsapp_tentativa_nao_autorizada')
@Index(['criadoEm'])
export class WhatsappTentativaNaoAutorizada {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('varchar', { length: 32 })
  telefone!: string;

  @Column('varchar', { name: 'nome_perfil', length: 160, nullable: true })
  nomePerfil!: string | null;

  @Column('varchar', { length: 20 })
  tipo!: 'planilha' | 'relatorio';

  @CreateDateColumn({ name: 'criado_em' })
  criadoEm!: Date;
}
