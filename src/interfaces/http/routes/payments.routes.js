'use strict';

const { Router } = require('express');
const {
  authenticate,
  requireRole,
  requireOwnershipOrAdmin,
} = require('../middleware/auth.middleware');
const { requireIdempotencyKey } = require('../middleware/idempotency.middleware');
const { createPaymentsController } = require('../controllers/payments.controller');

// Rotas do cliente: cobrança idempotente, histórico e estorno.
//
// Este arquivo é a "partitura" da API: define o método, o path e a ORDEM
// dos middlewares. A ordem importa MUITO — cada middleware valida algo e
// pode derrubar a requisição antes que o próximo rode (ou que o controller
// execute). Leia cada rota como uma sequência de portões:
//   1) autentica (quem é?)
//   2) valida perfil (pode usar este endpoint?)
//   3) valida propriedade/chave (é dono do recurso?)
//   4) controller (faz o trabalho)
function createPaymentsRoutes(container) {
  const router = Router();
  const controller = createPaymentsController(container);

  // Criação de cobrança: só CLIENTE pode cobrar, e a Idempotency-Key é
  // obrigatória (regra de negócio). A ordem dos dois middlewares não é
  // arbitrária — autenticar primeiro evita que um cliente não-logado
  // "gaste" uma key ou ocupe o banco antes de saber quem é.
  router.post('/charges', authenticate(container.config), requireRole('CLIENTE'), requireIdempotencyKey, controller.createCharge);

  // Histórico: sem id na URL, então não há o que "verificar propriedade" —
  // a lista SEMPRE é a do próprio usuário (req.auth.user_id no controller).
  router.get('/', authenticate(container.config), requireRole('CLIENTE'), controller.listMine);

  // Comprovante por id: aqui a propriedade PRECISA ser checada. O guard
  // recebe uma função que descobre o dono da cobrança (controller.ownerOf)
  // e só libera se for o próprio cliente ou um ADMIN. O callback é passado
  // em forma de arrow para o middleware chamar quando precisar (lazy).
  router.get(
    '/:id',
    authenticate(container.config),
    requireOwnershipOrAdmin((req) => controller.ownerOf(req)),
    controller.getById
  );

  // Estorno: mesmo padrão de autorização do GET /:id — quem pode VER o
  // comprovante pode ESTORNAR a cobrança (dono ou admin). A regra "só
  // cobranças CONCLUIDO" fica no serviço refundPayment, não na rota.
  router.post(
    '/:id/refund',
    authenticate(container.config),
    requireOwnershipOrAdmin((req) => controller.ownerOf(req)),
    controller.refund
  );

  return router;
}

module.exports = { createPaymentsRoutes };
