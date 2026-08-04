'use strict';

const { Router } = require('express');
const { authenticate, requireOwnershipOrAdmin } = require('../middleware/auth.middleware');
const { createRestaurantController } = require('../controllers/restaurant.controller');

// Painel financeiro do restaurante.
// A propriedade é validada por: usuário RESTAURANTE cujo user_id
// corresponde ao restaurantId do recurso, ou ADMIN.
//
// Diferente das rotas de pagamentos, aqui o guard usa o PRÓPRIO id da URL
// como dono do recurso — `(req) => req.params.id`. Ou seja, o middleware
// compara o user_id do JWT com o restaurantId do path; não precisa buscar
// nada no banco para descobrir o dono (é o id do próprio recurso).
function createRestaurantsRoutes(container) {
  const router = Router();
  const controller = createRestaurantController(container);
  // Guard compartilhado pelas três rotas: como o getOwnerId é o mesmo
  // (req.params.id), definimos UMA vez e reutilizamos — menos repetição
  // e mudança futura num lugar só.
  const guard = requireOwnershipOrAdmin((req) => req.params.id);

  // Nota: não há requireRole aqui — a proteção de perfil vem embutida no
  // guard (RESTAURANTE só é dono se user_id bater; ADMIN passa direto).
  router.get('/:id/dashboard', authenticate(container.config), guard, controller.dashboard);
  router.get('/:id/splits', authenticate(container.config), guard, controller.splits);
  router.get('/:id/payouts', authenticate(container.config), guard, controller.payouts);

  return router;
}

module.exports = { createRestaurantsRoutes };
