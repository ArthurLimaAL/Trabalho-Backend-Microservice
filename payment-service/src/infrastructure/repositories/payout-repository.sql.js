'use strict';

const crypto = require('crypto');

const PAYOUT_COLUMNS = `
  id, restaurant_id, period_label, period_start, period_end,
  type, status, amount_cents, created_at
`;

function rowToPayout(row) {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    periodLabel: row.period_label,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    type: row.type,
    status: row.status,
    amountCents: row.amount_cents,
    createdAt: row.created_at,
  };
}

class SqlPayoutRepository {
  constructor(db) {
    this.pool = db.pool;
  }

  // Cria um repasse (payout) para o restaurante. Se o chamador não mandar
  // um id, geramos um UUID aqui mesmo — repare que é um fallback, quem tem
  // id próprio (ex.: reencaminhar um pagamento) pode preservá-lo.
  async insert(payout, tx) {
    const client = tx || this.pool;
    const { rows } = await client.query(
      `INSERT INTO payouts (id, restaurant_id, period_label, period_start, period_end,
                            type, status, amount_cents)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${PAYOUT_COLUMNS}`,
      [
        payout.id || crypto.randomUUID(),
        payout.restaurantId,
        payout.periodLabel,
        payout.periodStart,
        payout.periodEnd,
        payout.type,
        payout.status,
        payout.amountCents,
      ]
    );
    return rowToPayout(rows[0]);
  }

  async listByRestaurant(restaurantId) {
    const { rows } = await this.pool.query(
      `SELECT ${PAYOUT_COLUMNS} FROM payouts WHERE restaurant_id = $1 ORDER BY created_at DESC`,
      [restaurantId]
    );
    return rows.map(rowToPayout);
  }

  async listAll() {
    const { rows } = await this.pool.query(`SELECT ${PAYOUT_COLUMNS} FROM payouts ORDER BY created_at DESC`);
    return rows.map(rowToPayout);
  }

  // Valores pendentes de repasse a parceiros (visão ADM).
  // Consideramos "pendente" todo payout ainda AGENDADO (não foi pago).
  // COALESCE garante 0 (não null) quando não há nenhum payout agendado.
  async sumPending() {
    const { rows } = await this.pool.query(
      `SELECT COALESCE(SUM(amount_cents), 0) AS pendente_cents FROM payouts WHERE status = 'AGENDADO'`
    );
    // Number(...) normaliza o bigint que o pg devolve para um JS number.
    return Number(rows[0].pendente_cents);
  }
}

module.exports = { SqlPayoutRepository };
