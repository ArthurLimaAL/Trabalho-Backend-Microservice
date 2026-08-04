'use strict';

// Ambiente de testes: sempre com driver em memória (não exige Postgres)
// e com segredos de teste definidos ANTES de carregar a config.
process.env.NODE_ENV = 'test';
process.env.PAYMENT_DB_DRIVER = 'memory';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ALG = 'HS256';
process.env.DATABASE_URL = 'postgres://payment:payment@localhost:5432/payment_service_test';
process.env.GATEWAY_WEBHOOK_SECRET = '';
