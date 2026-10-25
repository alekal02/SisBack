import 'reflect-metadata';
import AppDataSource from './data-source';
import { User } from '../entities/User';
import bcrypt from 'bcryptjs';

const EMAIL_ADMIN = 'admin@teste.com';
const EMAIL_USUARIO = 'usuario@teste.com';
const SENHA_INICIAL = '123456';

/** Cria admin e usuário de teste se ainda não existirem. Usa a conexão já aberta. */
export async function criarUsuariosIniciaisSeNecessario(): Promise<void> {
  const userRepo = AppDataSource.getRepository(User);
  const existe = await userRepo.findOne({ where: { email: EMAIL_ADMIN } });
  if (existe) {
    console.log(`ℹ️  Usuário ${EMAIL_ADMIN} já existe, pulando seed.`);
    return;
  }

  const senhaHash = await bcrypt.hash(SENHA_INICIAL, 10);
  const admin = userRepo.create({
    nome: 'Administrador',
    email: EMAIL_ADMIN,
    senha: senhaHash,
    role: 'admin',
    ativo: true,
  });
  await userRepo.save(admin);
  console.log(`✅ Usuário admin criado (${EMAIL_ADMIN}). Troque a senha padrão no primeiro acesso.`);

  const userComum = userRepo.create({
    nome: 'Usuário Teste',
    email: EMAIL_USUARIO,
    senha: senhaHash,
    role: 'user',
    ativo: true,
  });
  await userRepo.save(userComum);
  console.log(`✅ Usuário comum criado (${EMAIL_USUARIO}).`);
}

/**
 * Script avulso: npx ts-node src/database/seed.ts
 * No boot o bootstrap chama criarUsuariosIniciaisSeNecessario().
 */
async function seed(): Promise<void> {
  try {
    console.log('📦 Conectando ao banco de dados...');
    await AppDataSource.initialize();
    console.log('✅ Conectado!');
    await criarUsuariosIniciaisSeNecessario();
    await AppDataSource.destroy();
    console.log('🔒 Conexão encerrada. Seed concluído!');
  } catch (error) {
    console.error('❌ Erro durante o seed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  void seed();
}
