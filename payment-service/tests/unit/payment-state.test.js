'use strict';

const { Payment } = require('../../src/domain/payment');
const { PAYMENT_STATUS } = require('../../src/domain/payment-status');
const { InvalidTransitionError } = require('../../src/domain/payment-errors');

function makePayment(status = PAYMENT_STATUS.PENDENTE) {
  return new Payment({
    orderId: 'ORD-1',
    clientId: 'cli_1',
    restaurantId: 'res_1',
    method: 'PIX',
    productAmountCents: 10000,
    deliveryFeeCents: 500,
    amountCents: 10500,
    idempotencyKey: 'k-1',
    status,
  });
}

describe('Payment (máquina de estados estrita)', () => {
  test('PENDENTE → CONCLUIDO via confirmação', () => {
    const payment = makePayment();
    payment.confirm();
    expect(payment.isConcluded()).toBe(true);
    expect(payment.paidAt).toBeInstanceOf(Date);
  });

  test('PENDENTE → FALHOU via expiração (timeout)', () => {
    const payment = makePayment();
    payment.expire();
    expect(payment.isFailed()).toBe(true);
    expect(payment.expiredAt).toBeInstanceOf(Date);
  });

  test('CONCLUIDO → ESTORNADO via estorno', () => {
    const payment = makePayment(PAYMENT_STATUS.CONCLUIDO);
    payment.refund();
    expect(payment.status).toBe(PAYMENT_STATUS.ESTORNADO);
  });

  test('transições inválidas lançam InvalidTransitionError', () => {
    const concluded = makePayment(PAYMENT_STATUS.CONCLUIDO);
    expect(() => concluded.confirm()).toThrow(InvalidTransitionError);
    expect(() => concluded.expire()).toThrow(InvalidTransitionError);

    const failed = makePayment(PAYMENT_STATUS.FALHOU);
    expect(() => failed.confirm()).toThrow(InvalidTransitionError);
    expect(() => failed.refund()).toThrow(InvalidTransitionError);

    const refunded = makePayment(PAYMENT_STATUS.ESTORNADO);
    expect(() => refunded.confirm()).toThrow(InvalidTransitionError);
  });

  test('hasExpired considera apenas PENDENTE vencidas', () => {
    const expired = makePayment();
    expired.expiresAt = new Date(Date.now() - 1000);
    expect(expired.hasExpired()).toBe(true);

    const notExpired = makePayment();
    notExpired.expiresAt = new Date(Date.now() + 1000);
    expect(notExpired.hasExpired()).toBe(false);

    const concluded = makePayment(PAYMENT_STATUS.CONCLUIDO);
    concluded.expiresAt = new Date(Date.now() - 1000);
    expect(concluded.hasExpired()).toBe(false);
  });
});
