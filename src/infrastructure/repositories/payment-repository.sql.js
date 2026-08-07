'use strict';

const { Payment } = require('../../domain/payment');

const PAYMENT_COLUMNS = `
  id, order_id, client_id, restaurant_id, method,
  product_amount_cents, delivery_fee_cents, amount_cents, status,
  idempotency_key, gateway_id, reason, created_at,
  expires_at, paid_at, expired_at, refunded_at, version
`;

// Converte linha do banco (snake_case) para o agregado Payment (camelCase).
// Ter isso num único lugar evita espalhar mapeamentos pelos métodos abaixo.
function rowToPayment(row) {
  if (!row) return null;
  return new Payment({
    id: row.id,
    orderId: row.order_id,
    clientId: row.client_id,
    restaurantId: row.restaurant_id,
    method: row.method,
    productAmountCents: row.product_amount_cents,
    deliveryFeeCents: row.delivery_fee_cents,
    amountCents: row.amount_cents,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    gatewayId: row.gateway_id,
    reason: row.reason,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    paidAt: row.paid_at,
    expiredAt: row.expired_at,
    refundedAt: row.refunded_at,
    version: row.version,
  });
}

// ATENÇÃO à ordem: este array precisa seguir EXATAMENTE a ordem dos $n no
// INSERT abaixo ($1..$15). É uma das coisas mais fáceis de quebrar — se
// alguém reordenar um lado sem reordenar o outro, os valores trocam de lugar
// silenciosamente. (Idealmente isso viraria um mapeamento nomeado.)
const PARAMS = (payment) => [
  payment.id,
  payment.orderId,
  payment.clientId,
  payment.restaurantId,
  payment.method,
  payment.productAmountCents,
  payment.deliveryFeeCents,
  payment.amountCents,
  payment.status,
  payment.idempotencyKey,
  payment.gatewayId,
  payment.reason,
  payment.createdAt,
  payment.expiresAt,
  payment.version,
];

// Implementação SQL (PostgreSQL) do repositório de pagamentos.
// Concorrência (requisito do enunciado): updateStatus usa optimistic
// locking VIA VERSÃO — WHERE status = $esperado AND version = $versão.
// Se outra transação/webhook mudou a linha antes, 0 linhas são afetadas
// e a operação falha (409), ROLLBACK automático no withTransaction.
class SqlPaymentRepository {
  constructor(db) {
    this.pool = db.pool;
  }

  // O parâmetro `tx` é a mágica: quando passado, usamos ESSE client (a
  // conexão da transação) em vez do pool. Assim o INSERT participa da mesma
  // transação que o chamador abriu (ex.: pagamento + outbox juntos).
  async insert(payment, tx) {
    const client = tx || this.pool;
    const { rows } = await client.query(
      `INSERT INTO payments (id, order_id, client_id, restaurant_id, method,
                             product_amount_cents, delivery_fee_cents, amount_cents, status,
                             idempotency_key, gateway_id, reason, created_at, expires_at, version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING ${PAYMENT_COLUMNS}`,
      PARAMS(payment)
    );
    return rowToPayment(rows[0]);
  }

  async findById(id) {
    const { rows } = await this.pool.query(
      `SELECT ${PAYMENT_COLUMNS} FROM payments WHERE id = $1`,
      [id]
    );
    return rowToPayment(rows[0]);
  }

  async findByKey(idempotencyKey) {
    const { rows } = await this.pool.query(
      `SELECT ${PAYMENT_COLUMNS} FROM payments WHERE idempotency_key = $1`,
      [idempotencyKey]
    );
    return rowToPayment(rows[0]);
  }

  async updateStatus(payment, expectedStatus, tx) {
    const client = tx || this.pool;
    // O coração do optimistic locking está no WHERE:
    //   status = $8  → só atualiza se o status atual bate com o esperado;
    //   version = $9 → só atualiza se ninguém incrementou a versão desde a
    //                   leitura. E o SET incrementa version = version + 1.
    // Se 0 linhas foram afetadas, é porque houve corrida (dois webhooks ao
    // mesmo tempo, por exemplo) — e aí tratamos como transição inválida.
    const { rows, rowCount } = await client.query(
      `UPDATE payments
          SET status = $2, gateway_id = $3, reason = $4,
              paid_at = $5, expired_at = $6, refunded_at = $7,
              version = version + 1
        WHERE id = $1 AND status = $8 AND version = $9
        RETURNING ${PAYMENT_COLUMNS}`,
      [
        payment.id,
        payment.status,
        payment.gatewayId,
        payment.reason,
        payment.paidAt,
        payment.expiredAt,
        payment.refundedAt,
        expectedStatus,
        payment.version,
      ]
    );
    if (rowCount === 0) {
      // Derrotado na corrida: relê a linha atual para montar um erro rico
      // (status real no momento), em vez de um 409 genérico. Isso ajuda a
      // depurar e dá contexto para quem está logando o erro.
      const current = await this.findById(payment.id);
      const { InvalidTransitionError } = require('../../domain/payment-errors');
      throw new InvalidTransitionError(current ? current.status : 'DESCONHECIDO', payment.status);
    }
    return rowToPayment(rows[0]);
  }

  async listByClient(clientId, { status, method } = {}) {
    // WHERE montado dinamicamente: só adicionamos o filtro se vierem.
    // Os parâmetros são numerados na ordem em que entram ($${params.length})
    // para o pg resolver os placeholders corretamente.
    const where = ['client_id = $1'];
    const params = [clientId];
    if (status) { params.push(status); where.push(`status = $${params.length}`); }
    if (method) { params.push(method); where.push(`method = $${params.length}`); }
    const { rows } = await this.pool.query(
      `SELECT ${PAYMENT_COLUMNS} FROM payments WHERE ${where.join(' AND ')} ORDER BY created_at DESC`,
      params
    );
    return rows.map(rowToPayment);
  }

  async listByRestaurant(restaurantId) {
    const { rows } = await this.pool.query(
      `SELECT ${PAYMENT_COLUMNS} FROM payments WHERE restaurant_id = $1 ORDER BY created_at DESC`,
      [restaurantId]
    );
    return rows.map(rowToPayment);
  }

  async listPendingExpired(now) {
    // Candidatas à expiração: ainda PENDENTE, com expires_at preenchido e já
    // vencido (expires_at < now). Ordenadas pela data de expiração para o
    // sweep processar primeiro as mais antigas (justas e previsíveis).
    const { rows } = await this.pool.query(
      `SELECT ${PAYMENT_COLUMNS} FROM payments
        WHERE status = 'PENDENTE' AND expires_at IS NOT NULL AND expires_at < $1
        ORDER BY expires_at`,
      [now]
    );
    return rows.map(rowToPayment);
  }

  async listAll() {
    const { rows } = await this.pool.query(
      `SELECT ${PAYMENT_COLUMNS} FROM payments ORDER BY created_at DESC`
    );
    return rows.map(rowToPayment);
  }
}

module.exports = { SqlPaymentRepository, PAYMENT_COLUMNS };
