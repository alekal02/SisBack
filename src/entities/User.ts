import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  BeforeInsert,
  BeforeUpdate,
  Index,
} from 'typeorm';
import bcrypt from 'bcryptjs';

export type UserRole = 'superadmin' | 'admin' | 'user';

@Entity('users')
@Index(['email'], { unique: true })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('varchar', { length: 100 })
  nome!: string;

  @Column('varchar', { length: 150, unique: true })
  email!: string;

  @Column('varchar', { length: 255 })
  senha!: string;

  @Column('varchar', { length: 20, default: 'user' })
  role!: UserRole;

  /** Nulo = super-admin (vê todos). Preenchido = usuário só daquele contrato. */
  @Column('uuid', { nullable: true })
  contractId!: string | null;

  @Column('boolean', { default: true })
  ativo!: boolean;

  @CreateDateColumn()
  criadoEm!: Date;

  @UpdateDateColumn()
  atualizadoEm!: Date;

  @BeforeInsert()
  @BeforeUpdate()
  async hashSenha() {
    if (this.senha && this.senha.length < 60) {
      this.senha = await bcrypt.hash(this.senha, 10);
    }
  }

  async validarSenha(senha: string): Promise<boolean> {
    return bcrypt.compare(senha, this.senha);
  }

  toJSON() {
    const { senha, ...userSemSenha } = this;
    return userSemSenha;
  }
}
