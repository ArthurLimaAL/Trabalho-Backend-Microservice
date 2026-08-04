'use strict';

const jwt = require('jsonwebtoken');
const { readEnv } = require('../../src/config/env');
const { createContainer } = require('../../src/infrastructure/container');
const { createApp } = require('../../src/interfaces/http/app');

// Monta app + container completos para testes de integração.
function buildTestApp() {
  const config = readEnv();
  const container = createContainer(config);
  const { app, stop } = createApp(container);

  function token(role, userId = 'usr_001') {
    return jwt.sign({ user_id: userId, role, email: 'test@test.com' }, config.jwtSecret, {
      algorithm: config.jwtAlg,
    });
  }

  function reset() {
    container.repos.payments.reset();
    container.repos.ledger.reset();
    container.repos.payouts.reset();
    container.repos.outbox.reset();
    container.gateway.store.clear();
    container.gateway.failures = 0;
  }

  // Cleanup function to stop timers (used in afterAll hooks)
  function cleanup() {
    stop();
    return container.db.close();
  }

  return { app, container, token, reset, config, stop: cleanup };
}

module.exports = { buildTestApp };