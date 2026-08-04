'use strict';

const { Router } = require('express');
const { authenticate, requireRole } = require('../middleware/auth.middleware');
const { createAdminController } = require('../controllers/admin.controller');

// Rotas administrativas: restritas ao perfil ADMIN.
function createAdminRoutes(container) {
  const router = Router();
  const controller = createAdminController(container);
  // Array de middlewares compartilhado: o Express aceita um array na
  // posição de middleware e o aplica em ordem. Definimos UMA vez aqui e
  // usamos nas três rotas — consistência garantida (se mudar o padrão,
  // muda em todas). Não há checagem de propriedade porque admin é dono
  // de tudo; o requireRole('ADMIN') já basta.
  const adminOnly = [authenticate(container.config), requireRole('ADMIN')];

  router.get('/dashboard', adminOnly, controller.dashboard);
  router.get('/monthly', adminOnly, controller.monthly);
  router.get('/reconciliation', adminOnly, controller.reconciliation);

  return router;
}

module.exports = { createAdminRoutes };
