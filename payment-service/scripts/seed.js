'use strict';

// Popula dados de demonstração no PostgreSQL (via os próprios casos de
// uso, exercitando idempotência/split/outbox de verdade).
// Uso: npm run seed   (com Postgres rodando e PAYMENT_DB_DRIVER=sql)
require('dotenv').config();
const { readEnv } = require('../src/config/env');
const { createContainer } = require('../src/infrastructure/container');

async function main() {
  const config = readEnv();
  if (config.databaseDriver === 'memory') {
    console.error('[seed] use PAYMENT_DB_DRIVER=sql com o PostgreSQL rodando.');
    process.exit(1);
  }

  const container = createContainer(config);
  const { paymentService, repos } = container;

  const demo = [
    { orderId: 'ORD-1102', clientId: 'usr_cli_1', restaurantId: 'res_01', method: 'PIX', productAmountCents: 8990, deliveryFeeCents: 690 },
    { orderId: 'ORD-1098', clientId: 'usr_cli_1', restaurantId: 'res_02', method: 'CARD', productAmountCents: 5450, deliveryFeeCents: 750 },
    { orderId: 'ORD-1090', clientId: 'usr_cli_2', restaurantId: 'res_01', method: 'PIX', productAmountCents: 12000, deliveryFeeCents: 0 },
    { orderId: 'ORD-1081', clientId: 'usr_cli_2', restaurantId: 'res_03', method: 'CARD', productAmountCents: 7800, deliveryFeeCents: 800 },
  ];

  for (const item of demo) {
    const { payment } = await paymentService.createCharge(item, `seed_${item.orderId}`);
    const { payment: confirmed, split } = await paymentService.confirmPayment(payment.id, { reason: 'seed: pagamento aprovado' });
    console.log(
      `[seed] ${confirmed.orderId}: ${confirmed.status} · bruto=${split.grossCents} · ` +
        `restaurante=${split.restaurantCents} · plataforma=${split.platformCents} · entregador=${split.courierCents}`
    );
  }

  await repos.payouts.insert({
    restaurantId: 'res_01',
    periodLabel: 'Semana 20-26/07',
    periodStart: new Date('2026-07-20'),
    periodEnd: new Date('2026-07-26'),
    type: 'SEMANAL',
    status: 'PAGO',
    amountCents: 284050,
  });
  await repos.payouts.insert({
    restaurantId: 'res_01',
    periodLabel: 'Semana 27/07-02/08',
    periodStart: new Date('2026-07-27'),
    periodEnd: new Date('2026-08-02'),
    type: 'SEMANAL',
    status: 'AGENDADO',
    amountCents: 196230,
  });

  console.log('[seed] OK');
  await container.db.close();
}

main().catch((error) => {
  console.error('[seed] falha:', error.message);
  process.exit(1);
});
