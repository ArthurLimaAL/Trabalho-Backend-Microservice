'use strict';

const { Router } = require('express');
const jwt = require('jsonwebtoken');

// ============================================================
// Rotas DEV-only (nunca habilitadas em produção)
// ------------------------------------------------------------
// Servem exclusivamente para o frontend de demonstração emitir
// seus próprios JWTs (mesma assinatura usada pelo Auth Service)
// e forçar a expiração de uma cobrança — sem expor o segredo
// ao navegador. Em NODE_ENV=production estas rotas NÃO existem.
// ============================================================
//
// Lembrando: quem monta (ou não) este router é o app.js, dentro do
// `if (!container.config.isProd)`. Ou seja, o bloqueio não é "retornar
// 404" — em produção o caminho simplesmente não foi registrado.

const ROLES = ['CLIENTE', 'RESTAURANTE', 'ADMIN'];

function createDevRoutes(container) {
  const router = Router();
  const { config, paymentService } = container;

  // POST /api/v1/dev/login  { user_id, role } → { token }
  // Emula o login: em vez de bater no Auth Service, assina o JWT aqui
  // mesmo com o MESMO segredo/alg que o authenticate espera. Assim o
  // token emitido passa na validação das rotas de verdade.
  router.post('/login', (req, res) => {
    const { user_id: userId, role } = req.body || {};
    // `req.body || {}` protege contra body ausente; a validação seguinte
    // cobre role inválido/ausente. Erro com shape padrão da API ({ error }).
    if (!userId || !ROLES.includes(role)) {
      return res.status(400).json({
        error: { code: 'INVALID_LOGIN', message: 'Informe user_id e um role válido (CLIENTE, RESTAURANTE ou ADMIN).' },
      });
    }
    // String(userId) na assinatura: o claim fica SEMPRE como string, igual
    // ao que o Auth Service produz em produção — evita comparação "1" !== 1
    // nos middlewares de ownership (que usam String() dos dois lados).
    const token = jwt.sign({ user_id: String(userId), role }, config.jwtSecret, {
      algorithm: config.jwtAlg,
      expiresIn: '2h',
    });
    // Devolvemos o token E os campos úteis (user_id normalizado, role,
    // expires_in em segundos) para o frontend não precisar decodificar.
    return res.json({ token, user_id: String(userId), role, expires_in: 7200 });
  });

  // POST /api/v1/dev/payments/:id/expire — força o timeout/reprovação (demo)
  // Atalho para a demo: sem esperar o job expireSweep, força uma cobrança
  // a EXPIRAR agora. O `reason` opcional fica registrado no histórico —
  // útil para testar o fluxo de timeout no frontend sem esperar minutos.
  router.post('/payments/:id/expire', async (req, res, next) => {
    try {
      const { reason } = req.body || {};
      const { payment } = await paymentService.expirePayment(req.params.id, reason);
      res.json({ payment });
    } catch (error) {
      // Não há guard de autenticação aqui (é rota dev); erros de domínio
      // (ex.: cobrança não existe ou já está CONCLUIDO) vão para o
      // error-handler central normalmente.
      next(error);
    }
  });

  return router;
}

module.exports = { createDevRoutes };
