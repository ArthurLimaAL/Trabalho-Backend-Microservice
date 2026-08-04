'use strict';

// =================================================================
//  Testes de integração da API HTTP (camada interfaces)
// -----------------------------------------------------------------
//  Estes testes sobem o app Express de verdade (via buildTestApp do
//  helpers/bootstrap) e batem nas rotas com supertest, MAS usam o
//  driver em MEMÓRIA (sem Postgres) — então rodam em qualquer
//  máquina com `npm test`, rápido e sem dependência externa.
//
//  O que eles garantem, de ponta a ponta pela HTTP:
//    • criação de cobrança PENDENTE exigindo Idempotency-Key;
//    • replay da MESMA chave devolve a cobrança anterior (sem cobrar 2x);
//    • confirmação via serviço → status CONCLUIDO + split gravado;
//    • estorno (refund) só de CONCLUIDO;
//    • autorização RBAC (CLIENTE/RESTAURANTE/ADMIN) e propriedade.
//
//  Dica para quem for mexer aqui: cada `beforeEach` reconstrói o app
//  e reseta os repositórios (reset()), então os testes são isolados.
// =================================================================

const request = require('supertest');
const { buildTestApp } = require('../helpers/bootstrap');

describe('Integração — API de Pagamentos e Faturamento', () => {
  let ctx;

  beforeEach(() => {
    ctx = buildTestApp();
    ctx.reset();
  });

  afterEach(async () => {
    await ctx.container.db.close();
    ctx.stop();
  });

  const chargeBody = (overrides = {}) => ({
    orderId: 'ORD-1',
    restaurantId: 'res_01',
    method: 'PIX',
    productAmountCents: 10000,
    deliveryFeeCents: 500,
    ...overrides,
  });

  const createCharge = (key, body = chargeBody(), user = 'usr_cli_1') =>
    request(ctx.app)
      .post('/api/v1/payments/charges')
      .set('Authorization', `Bearer ${ctx.token('CLIENTE', user)}`)
      .set('Idempotency-Key', key)
      .send(body);

  test('cria cobrança PENDENTE com Idempotency-Key (CLIENTE)', async () => {
    const res = await createCharge('k-1');
    expect(res.status).toBe(201);
    expect(res.body.replayed).toBe(false);
    expect(res.body.payment.status).toBe('PENDENTE');
    expect(res.body.payment.amountCents).toBe(10500);
    expect(res.body.payment.clientId).toBe('usr_cli_1');
  });

  test('reenvio com a mesma chave retorna o mesmo pagamento (200, replayed)', async () => {
    const first = await createCharge('k-replay');
    const second = await createCharge('k-replay');
    expect(second.status).toBe(200);
    expect(second.body.replayed).toBe(true);
    expect(second.body.payment.id).toBe(first.body.payment.id);
    expect(await ctx.container.repos.payments.listAll()).toHaveLength(1);
  });

  test('requisição sem Idempotency-Key é rejeitada (422)', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/payments/charges')
      .set('Authorization', `Bearer ${ctx.token('CLIENTE', 'usr_cli_1')}`)
      .send(chargeBody());
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  test('sem token (401) e com perfil RESTAURANTE (403)', async () => {
    const noToken = await request(ctx.app)
      .post('/api/v1/payments/charges')
      .set('Idempotency-Key', 'x')
      .send(chargeBody());
    expect(noToken.status).toBe(401);

    const wrongRole = await request(ctx.app)
      .post('/api/v1/payments/charges')
      .set('Authorization', `Bearer ${ctx.token('RESTAURANTE', 'res_01')}`)
      .set('Idempotency-Key', 'x')
      .send(chargeBody());
    expect(wrongRole.status).toBe(403);
  });

  test('webhook confirma o pagamento e grava o split no ledger', async () => {
    const created = await createCharge('k-webhook');
    const paymentId = created.body.payment.id;

    const res = await request(ctx.app).post('/api/v1/webhooks/pix').send({ paymentId });
    expect(res.status).toBe(200);
    expect(res.body.payment.status).toBe('CONCLUIDO');
    expect(res.body.replayed).toBe(false);

    const split = res.body.split;
    expect(split.grossCents).toBe(10500);
    // comissão 12% de 10000 + taxa 1,50
    expect(split.platformCents).toBe(1350);
    expect(split.courierCents).toBe(500);
    expect(split.restaurantCents).toBe(8650);
    // invariante contábil
    expect(split.restaurantCents + split.platformCents + split.courierCents).toBe(split.grossCents);

    const types = ctx.container.repos.outbox.listAll().map((e) => e.type);
    expect(types).toContain('PaymentCreated');
    expect(types).toContain('PaymentConfirmed');
  });

  test('webhook duplicado é idempotente (replayed)', async () => {
    const created = await createCharge('k-dup-webhook');
    const paymentId = created.body.payment.id;
    const send = () => request(ctx.app).post('/api/v1/webhooks/pix').send({ paymentId });

    const first = await send();
    const second = await send();
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.replayed).toBe(true);
    // apenas uma linha de ledger
    expect(await ctx.container.repos.ledger.findByPayment(paymentId)).not.toBeNull();
  });

  test('timeout: cobrança PENDENTE vencida vira FALHOU e emite OrderCancelRequested', async () => {
    const created = await createCharge('k-timeout');
    const result = await ctx.container.paymentService.expirePayment(created.body.payment.id);
    expect(result.payment.status).toBe('FALHOU');
    expect(result.payment.reason).toContain('timeout');

    const types = ctx.container.repos.outbox.listAll().map((e) => e.type);
    expect(types).toContain('PaymentExpired');
    expect(types).toContain('OrderCancelRequested');
  });

  test('estorno apenas a partir de CONCLUIDO', async () => {
    const created = await createCharge('k-refund');

    // estornar um PENDENTE → 409
    const early = await request(ctx.app)
      .post(`/api/v1/payments/${created.body.payment.id}/refund`)
      .set('Authorization', `Bearer ${ctx.token('CLIENTE', 'usr_cli_1')}`);
    expect(early.status).toBe(409);

    // confirma e estorna
    await request(ctx.app).post('/api/v1/webhooks/pix').send({ paymentId: created.body.payment.id });
    const refund = await request(ctx.app)
      .post(`/api/v1/payments/${created.body.payment.id}/refund`)
      .set('Authorization', `Bearer ${ctx.token('CLIENTE', 'usr_cli_1')}`);
    expect(refund.status).toBe(200);
    expect(refund.body.payment.status).toBe('ESTORNADO');
  });

  test('cliente vê apenas as próprias cobranças', async () => {
    await createCharge('k-a1', chargeBody(), 'usr_cli_1');
    await createCharge('k-a2', chargeBody({ orderId: 'ORD-2' }), 'usr_cli_1');
    await createCharge('k-b1', chargeBody(), 'usr_cli_2');

    const res = await request(ctx.app)
      .get('/api/v1/payments')
      .set('Authorization', `Bearer ${ctx.token('CLIENTE', 'usr_cli_1')}`);
    expect(res.status).toBe(200);
    expect(res.body.payments).toHaveLength(2);
    expect(res.body.payments.every((p) => p.clientId === 'usr_cli_1')).toBe(true);
  });

  test('cliente não acessa cobrança de outro usuário (403)', async () => {
    const created = await createCharge('k-owner', chargeBody(), 'usr_cli_2');
    const res = await request(ctx.app)
      .get(`/api/v1/payments/${created.body.payment.id}`)
      .set('Authorization', `Bearer ${ctx.token('CLIENTE', 'usr_cli_1')}`);
    expect(res.status).toBe(403);
  });

  test('ADMIN enxerga o relatório consolidado (GMV e receita)', async () => {
    const created = await createCharge('k-admin');
    await request(ctx.app).post('/api/v1/webhooks/pix').send({ paymentId: created.body.payment.id });

    const res = await request(ctx.app)
      .get('/api/v1/admin/dashboard')
      .set('Authorization', `Bearer ${ctx.token('ADMIN')}`);
    expect(res.status).toBe(200);
    expect(res.body.gmvCents).toBe(10500);
    expect(res.body.pagamentosConcluidos).toBe(1);
    expect(res.body.receitaLiquidaCents).toBe(1350);
  });

  test('rotas de ADMIN bloqueiam CLIENTE (403)', async () => {
    const res = await request(ctx.app)
      .get('/api/v1/admin/dashboard')
      .set('Authorization', `Bearer ${ctx.token('CLIENTE', 'usr_cli_1')}`);
    expect(res.status).toBe(403);
  });

  test('painel do restaurante consolida o split por período', async () => {
    const created = await createCharge('k-rest', chargeBody(), 'usr_cli_1');
    await request(ctx.app).post('/api/v1/webhooks/pix').send({ paymentId: created.body.payment.id });

    const res = await request(ctx.app)
      .get('/api/v1/restaurants/res_01/dashboard')
      .set('Authorization', `Bearer ${ctx.token('RESTAURANTE', 'res_01')}`);
    expect(res.status).toBe(200);
    expect(res.body.brutoCents).toBe(10500);
    expect(res.body.quantidade).toBe(1);
    expect(res.body.repasseCents).toBe(8650);
    expect(res.body.comissaoCents).toBe(1200);
    expect(res.body.servicoCents).toBe(150);
    expect(res.body.entregadorCents).toBe(500);
    // repasse + comissão + serviço + entrega = bruto
    expect(
      res.body.repasseCents + res.body.comissaoCents + res.body.servicoCents + res.body.entregadorCents
    ).toBe(res.body.brutoCents);
  });

  test('restaurante não acessa painel de outro restaurante (403)', async () => {
    const res = await request(ctx.app)
      .get('/api/v1/restaurants/res_02/dashboard')
      .set('Authorization', `Bearer ${ctx.token('RESTAURANTE', 'res_01')}`);
    expect(res.status).toBe(403);
  });
});
