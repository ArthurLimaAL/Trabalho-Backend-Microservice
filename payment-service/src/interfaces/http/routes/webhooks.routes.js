'use strict';

const { Router } = require('express');
const { requireGatewaySecret } = require('../middleware/idempotency.middleware');
const { createWebhooksController } = require('../controllers/webhooks.controller');

// Webhooks do gateway externo (sem JWT de usuário; assinatura própria).
//
// Repare que aqui NÃO há `authenticate`: quem chama não é um usuário
// logado, e sim o servidor do gateway. A autenticação é a chave
// compartilhada X-Gateway-Key, aplicada via router.use() — ou seja, vale
// para TODAS as rotas deste router sem precisar repetir middleware por rota.
function createWebhooksRoutes(container) {
  const router = Router();
  const controller = createWebhooksController(container);

  // Middleware aplicado a TODO o grupo (router-level). Qualquer request que
  // chegue a /webhooks sem a chave correta morre aqui, antes do controller.
  router.use(requireGatewaySecret(container.config));

  router.post('/pix', controller.confirmPix);
  router.post('/card', controller.confirmCard);

  return router;
}

module.exports = { createWebhooksRoutes };
