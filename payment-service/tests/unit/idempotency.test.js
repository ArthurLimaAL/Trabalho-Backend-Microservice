'use strict';

const { readEnv } = require('../../src/config/env');
const { createContainer } = require('../../src/infrastructure/container');
const { IdempotencyKeyRequiredError } = require('../../src/domain/payment-errors');

describe('Idempotência Absoluta (application layer)', () => {
  let container;

  beforeEach(() => {
    container = createContainer(readEnv());
    container.repos.payments.reset();
    container.repos.outbox.reset();
    container.gateway.store.clear();
  });

  afterEach(async () => {
    await container.db.close();
  });

  const input = {
    orderId: 'ORD-100',
    clientId: 'usr_cli_1',
    restaurantId: 'res_01',
    method: 'PIX',
    productAmountCents: 10000,
    deliveryFeeCents: 500,
  };

  test('mesma chave → mesmo pagamento, sem duplicar no gateway', async () => {
    const first = await container.paymentService.createCharge(input, 'idem-1');
    const second = await container.paymentService.createCharge(input, 'idem-1');

    expect(first.payment.id).toBe(second.payment.id);
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    // O gateway (mock) recebeu apenas UMA autorização para esta chave
    expect(container.gateway.store.size).toBe(1);
    // Nenhuma cobrança duplicada no repositório
    expect(await container.repos.payments.listAll()).toHaveLength(1);
  });

  test('chave ausente → erro de domínio 422', async () => {
    await expect(container.paymentService.createCharge(input, undefined)).rejects.toBeInstanceOf(
      IdempotencyKeyRequiredError
    );
  });

  test('chaves diferentes → cobranças diferentes', async () => {
    const a = await container.paymentService.createCharge(input, 'idem-a');
    const b = await container.paymentService.createCharge(input, 'idem-b');
    expect(a.payment.id).not.toBe(b.payment.id);
    expect(await container.repos.payments.listAll()).toHaveLength(2);
  });

  test('corrida de duas requisições com a mesma chave nunca duplica', async () => {
    // Ambas "passam" pelo findByKey ao mesmo tempo; a constraint de
    // unicidade (simulada no repo de memória) resolve a disputa.
    const [a, b] = await Promise.all([
      container.paymentService.createCharge(input, 'idem-race'),
      container.paymentService.createCharge(input, 'idem-race'),
    ]);
    expect(a.payment.id).toBe(b.payment.id);
    expect(await container.repos.payments.listAll()).toHaveLength(1);
    expect(container.gateway.store.size).toBe(1);
  });
});
