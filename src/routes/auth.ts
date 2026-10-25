import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import AuthController from '../controllers/AuthController';
import { authenticate, authorize } from '../middlewares/authMiddleware';

const router = Router();

/** 10 falhas em 15 min, por IP. Login e refresh têm contadores separados. */
function limiteAuth() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: 'Muitas tentativas. Tente novamente em 15 minutos.' },
  });
}

// Registro: admin por padrão; em dev pode liberar com ALLOW_PUBLIC_REGISTER=true
const allowPublicRegister = process.env.ALLOW_PUBLIC_REGISTER === 'true';
if (allowPublicRegister) {
  router.post('/register', AuthController.register.bind(AuthController));
} else {
  router.post('/register', authenticate, authorize('admin'), AuthController.register.bind(AuthController));
}
router.post('/login', limiteAuth(), AuthController.login.bind(AuthController));
router.post('/acesso-direto', AuthController.acessoDireto.bind(AuthController));
router.post('/refresh', limiteAuth(), AuthController.refresh.bind(AuthController));
router.post('/entrar-contrato', authenticate, AuthController.entrarContrato.bind(AuthController));
router.post('/sair-contrato', authenticate, AuthController.sairContrato.bind(AuthController));

// Rotas protegidas (qualquer usuário autenticado)
router.get('/me', authenticate, AuthController.me.bind(AuthController));

export default router;
