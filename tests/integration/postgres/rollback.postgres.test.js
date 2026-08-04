'use strict';

/* ============================================================
 * Integração — PostgreSQL real: ACID / ROLLBACK / Locking
 * ------------------------------------------------------------
 * Prova em banco REAL (PostgreSQL) os requisitos de segurança
 * transacional do enunciado:
 *
 *   A) ROLLBACK automático: falha no MEIO do fluxo (outbox) anula
 *      o payment parcial — nenhuma linha sobra no banco.
 *   B) ROLLBACK automático: falha no ledger durante a confirmação
 *      mantém o status PENDENTE e não grava PaymentConfirmed.
 *   C) Locking otimista VIA VERSÃO: escrita com versão obsoleta é
 *      rejeitada (0 linhas afetadas → exceção → ROLLBACK).
 *   C2) Webhooks simultâneos não duplicam a liquidação (ledger
 *      permanece com exatamente 1 linha e o split soma o bruto).
 *   D) Rotina de TIMEOUT: cobrança vencida → FALHOU +
 *      OrderCancelRequested (sweep).
 *   E) Unicidade do ledger: segunda liquidação da MESMA cobrança é
 *      rejeitada pelo banco (índice UNIQUE de defesa em profundidade).
 *
 * Banco: TEST_DATABASE_URL (padrão aponta para o serviço `db` do
 * docker-compose). Se o Postgres não estiver acessível, esta suíte
 * é PULADA silenciosamente (describe.skip) e `npm test` continua
 * verde — rodando de verdade onde o banco existir.
 * ============================================================ */

const { execSync } = require('child_process');
const { Pool } = require('pg');
const { createContainer } = require('../../../src/infrastructure/container');
const { runMigrations } = require('../../../src/infrastructure/db/migrate');

const TEST_URL = process.env.TEST_DATABASE_URL || 'postgres://payment:payment_dev_password@localhost:5432/payment_service_test';

// Prova de alcance SÍNCRONA em tempo de carga do módulo (Jest precisa
// decidir entre describe/describe.skip antes de rodar any beforeAll).
function probeReachable() {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const script = `
    const { Pool } = require(${JSON.stringify(require.resolve('pg'))});
    const p = new Pool({ connectionString: ${JSON.stringify(TEST_URL)}, connectionTimeoutMillis: 2000, max: 1 });
    p.query('SELECT 1')
      .then(() => p.end())
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  `;
  // Gravamos num arquivo temporário: passar o código por `-e "<json>"`
  // passa pelo shell, que manda os \n como texto literal e quebra o parse.
  const tmpFile = path.join(os.tmpdir(), `pg-probe-${process.pid}-${Date.now()}.js`);
  fs.writeFileSync(tmpFile, script);
  try {
    execSync(`${JSON.stringify(process.execPath)} ${JSON.stringify(tmpFile)}`, {
      timeout: 8000,
      stdio: 'ignore',
    });
    return true;
  } catch (_error) {
    return false;
  } finally {
    fs.unlinkSync(tmpFile);
  }
}

const REACHABLE = probeReachable();
if (!REACHABLE) {
  console.warn(`\n⚠️  PostgreSQL indisponível em ${TEST_URL} — suíte ACID/ROLLBACK PULADA.\n` +
    'Para executá-la: `docker compose up -d db` e crie o banco payment_service_test.\n');
}

// Garante que o banco de teste exista (cria se não existir).
async function ensureDatabase() {
  const direct = new Pool({ connectionString: TEST_URL, connectionTimeoutMillis: 2000 });
  try {
    await direct.query('SELECT 1');
    return direct;
  } catch (_error) {
    await direct.end().catch(() => {});
  }

  // Banco não existe: conecta no maintenance "postgres" e tenta criar.
  const u = new URL(TEST_URL);
  u.pathname = '/postgres';
  const maintenance = new Pool({ connectionString: u.toString(), connectionTimeoutMillis: 2000 });
  try {
    await maintenance.query('SELECT 1');
    const name = new URL(TEST_URL).pathname.replace(/^\//, '');
    const quoted = `"${name.replace(/"/g, '""')}"`;
    await maintenance.query(`CREATE DATABASE ${quoted}`);
    await maintenance.end();
    const retry = new Pool({ connectionString: TEST_URL, connectionTimeoutMillis: 2000 });
    await retry.query('SELECT 1');
    return retry;
  } catch (_error) {
    await maintenance.end().catch(() => {});
    return null;
  }
}

const describePostgres = REACHABLE ? describe : describe.skip;

const charge = (overrides = {}) => ({
  orderId: `ORD-${Math.floor(1000 + Math.random() * 9000)}`,
  clientId: 'usr_cli_1',
  restaurantId: 'res_01',
  method: 'PIX',
  productAmountCents: 10000,
  deliveryFeeCents: 500,
  ...overrides,
});

describePostgres('Integração PostgreSQL — ACID / ROLLBACK / Locking', () => {
  let container;

  beforeAll(async () => {
    jest.setTimeout(30000);
    const probe = await ensureDatabase();
    if (probe) await probe.end().catch(() => {});

    container = createContainer({
      databaseUrl: TEST_URL,
      databaseDriver: 'sql',
      jwtSecret: 'test-jwt-secret',
      jwtAlg: 'HS256',
      gatewayWebhookSecret: '',
      commissionRate: 0.12,
      serviceFeeCents: 150,
      paymentTimeoutMs: 300000,
      outboxRelayIntervalMs: 1000,
      expireSweepIntervalMs: 1000,
      isProd: false,
    });

    // Banco limpo do zero, migrações reais (001 + 002).
    await container.db.pool.query(
      'DROP TABLE IF EXISTS outbox_events, split_ledger, payouts, payments, schema_migrations CASCADE;'
    );
    await runMigrations(container.db.pool, { logger: { log: () => {} } });
  });

  afterEach(async () => {
    await container.db.pool.query(
      'TRUNCATE outbox_events, split_ledger, payouts, payments RESTART IDENTITY CASCADE;'
    );
    container.gateway.store.clear();
  });

  afterAll(async () => {
    await container.db.close();
  });

  const count = async (table) => {
    const { rows } = await container.db.pool.query(`SELECT COUNT(*)::int AS c FROM ${table}`);
    return rows[0].c;
  };

  const eventTypes = async () => {
    const { rows } = await container.db.pool.query('SELECT type FROM outbox_events ORDER BY id');
    return rows.map((r) => r.type);
  };

  test('A) ROLLBACK: falha no outbox apaga o payment parcial e o retry é idempotente', async () => {
    const original = container.repos.outbox.insert;
    container.repos.outbox.insert = async () => {
      throw new Error('fila indisponível (falha simulada no meio do fluxo)');
    };

    try {
      await expect(
        container.paymentService.createCharge(charge(), 'idem-rollback-a')
      ).rejects.toThrow(/fila indisponível/);
    } finally {
      container.repos.outbox.insert = original;
    }

    // Nenhuma sujeira persistida — o ROLLBACK anulou o INSERT do payment.
    expect(await count('payments')).toBe(0);
    expect(await count('outbox_events')).toBe(0);
    expect(await count('split_ledger')).toBe(0);

    // Retry com a MESMA Idempotency-Key funciona e o gateway (idempotente)
    // não gerou uma segunda cobrança no adquirente.
    const retry = await container.paymentService.createCharge(charge(), 'idem-rollback-a');
    expect(retry.replayed).toBe(false);
    expect(retry.payment.status).toBe('PENDENTE');
    expect(await count('payments')).toBe(1);
    expect([...container.gateway.store.keys()].filter((k) => k === 'idem-rollback-a')).toHaveLength(1);
  });

  test('B) ROLLBACK: falha no ledger na confirmação mantém status PENDENTE', async () => {
    const created = await container.paymentService.createCharge(charge(), 'idem-rollback-b');
    const paymentId = created.payment.id;

    const original = container.repos.ledger.insert;
    container.repos.ledger.insert = async () => {
      throw new Error('ledger indisponível (falha simulada no meio do fluxo)');
    };

    try {
      await expect(container.paymentService.confirmPayment(paymentId)).rejects.toThrow(/ledger indisponível/);
    } finally {
      container.repos.ledger.insert = original;
    }

    // O UPDATE de status e o INSERT do evento foram desfeitos juntos.
    const { rows } = await container.db.pool.query('SELECT status FROM payments WHERE id = $1', [paymentId]);
    expect(rows[0].status).toBe('PENDENTE');
    expect(await count('split_ledger')).toBe(0);
    expect(await eventTypes()).not.toContain('PaymentConfirmed');
  });

  test('C) Locking otimista via VERSÃO: escrita com versão obsoleta é rejeitada', async () => {
    const created = await container.paymentService.createCharge(charge(), 'idem-lock');
    const paymentId = created.payment.id;

    // Duas leituras simultâneas veem a mesma versão (1) e o mesmo status.
    const a = await container.repos.payments.findById(paymentId);
    const b = await container.repos.payments.findById(paymentId);

    a.confirm('webhook A');
    await container.db.withTransaction(async (tx) => {
      await container.repos.payments.updateStatus(a, 'PENDENTE', tx); // version 1 → 2
    });

    // B ainda carrega version 1: o UPDATE não afeta nenhuma linha → erro → ROLLBACK.
    b.confirm('webhook B');
    await expect(
      container.db.withTransaction(async (tx) => {
        await container.repos.payments.updateStatus(b, 'PENDENTE', tx);
      })
    ).rejects.toThrow();

    const { rows } = await container.db.pool.query(
      'SELECT status, version FROM payments WHERE id = $1',
      [paymentId]
    );
    expect(rows[0]).toMatchObject({ status: 'CONCLUIDO', version: 2 });
    expect(await count('split_ledger')).toBe(0); // B fez ROLLBACK antes de gravar o ledger
  });

  test('C2) Webhooks simultâneos não duplicam a liquidação (1 linha de ledger, split soma o bruto)', async () => {
    const created = await container.paymentService.createCharge(charge(), 'idem-conc');
    const paymentId = created.payment.id;

    const results = await Promise.allSettled([
      container.paymentService.confirmPayment(paymentId, { gatewayId: 'gw_1' }),
      container.paymentService.confirmPayment(paymentId, { gatewayId: 'gw_2' }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled').length).toBeGreaterThan(0);
    const { rows } = await container.db.pool.query('SELECT status FROM payments WHERE id = $1', [paymentId]);
    expect(rows[0].status).toBe('CONCLUIDO');

    // Defesa em profundidade: exatamente uma liquidação no ledger.
    expect(await count('split_ledger')).toBe(1);
    const { rows: events } = await container.db.pool.query('SELECT type FROM outbox_events');
    expect(events.filter((e) => e.type === 'PaymentConfirmed')).toHaveLength(1);

    // Invariante contábil no banco real: partes SOMAM o bruto.
    const { rows: [ledger] } = await container.db.pool.query('SELECT * FROM split_ledger');
    expect(ledger.restaurant_cents + ledger.platform_cents + ledger.courier_cents).toBe(ledger.gross_cents);
  });

  test('D) Timeout: cobrança PENDENTE vencida → FALHOU + OrderCancelRequested (sweep)', async () => {
    const created = await container.paymentService.createCharge(charge(), 'idem-timeout');
    const paymentId = created.payment.id;

    // Simula o tempo passando: a cobrança venceu dentro do prazo.
    await container.db.pool.query(
      `UPDATE payments SET expires_at = now() - interval '1 minute' WHERE id = $1`,
      [paymentId]
    );

    const expired = await container.expireSweep.run();
    expect(expired).toBe(1);

    const { rows } = await container.db.pool.query('SELECT status FROM payments WHERE id = $1', [paymentId]);
    expect(rows[0].status).toBe('FALHOU');

    const types = await eventTypes();
    expect(types).toContain('PaymentExpired');
    expect(types).toContain('OrderCancelRequested'); // pedido cancelado defensivamente
  });

  test('E) Unicidade do ledger: segunda liquidação da MESMA cobrança é rejeitada no banco', async () => {
    const created = await container.paymentService.createCharge(charge(), 'idem-ledger');
    const payment = await container.repos.payments.findById(created.payment.id);

    const split = {
      grossCents: 100,
      productAmountCents: 80,
      deliveryFeeCents: 20,
      commissionCents: 10,
      serviceFeeCents: 5,
      platformCents: 15,
      courierCents: 20,
      restaurantCents: 65,
    };
    const write = () =>
      container.db.withTransaction(async (tx) => {
        await container.repos.ledger.insert({ split, paymentId: payment.id, restaurantId: payment.restaurantId }, tx);
      });

    await write();
    await expect(write()).rejects.toThrow();
    expect(await count('split_ledger')).toBe(1);
  });
});
