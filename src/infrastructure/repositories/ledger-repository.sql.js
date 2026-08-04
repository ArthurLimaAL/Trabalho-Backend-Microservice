'use strict';

const crypto = require('crypto');

const LEDGER_COLUMNS = `
  id, payment_id, gross_cents, product_amount_cents, delivery_fee_cents,
  commission_cents, service_fee_cents, platform_cents, courier_cents,
  restaurant_cents, recorded_at
`;

function rowToLedger(row) {
  return {
    id: row.id,
    paymentId: row.payment_id,
    grossCents: row.gross_cents,
    productAmountCents: row.product_amount_cents,
    deliveryFeeCents: row.delivery_fee_cents,
    commissionCents: row.commission_cents,
    serviceFeeCents: row.service_fee_cents,
    platformCents: row.platform_cents,
    courierCents: row.courier_cents,
    restaurantCents: row.restaurant_cents,
    recordedAt: row.recorded_at,
  };
}

// Ledger contábil (append-only) em PostgreSQL.
// "Append-only" = só escrevemos linhas novas, nunca atualizamos/apagamos
// existentes. Isso transforma o split_ledger em um histórico imutável de
// cada repasse — ideal para auditoria e para somar totais com segurança.
class SqlLedgerRepository {
  constructor(db) {
    this.pool = db.pool;
  }

  // Registra um lançamento do split. O `tx` opcional faz a escrita participar
  // da transação do pagamento — ou seja, se o pagamento der rollback, o
  // lançamento contábil some junto (atomicidade entre pagamento e ledger).
  async insert({ split, paymentId, restaurantId }, tx) {
    const client = tx || this.pool;
    const { rows } = await client.query(
      `INSERT INTO split_ledger (id, payment_id, gross_cents, product_amount_cents,
                                 delivery_fee_cents, commission_cents, service_fee_cents,
                                 platform_cents, courier_cents, restaurant_cents)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING ${LEDGER_COLUMNS}`,
      [
        crypto.randomUUID(),
        paymentId,
        split.grossCents,
        split.productAmountCents,
        split.deliveryFeeCents,
        split.commissionCents,
        split.serviceFeeCents,
        split.platformCents,
        split.courierCents,
        split.restaurantCents,
      ]
    );
    return rowToLedger(rows[0]);
  }

  async findByPayment(paymentId) {
    const { rows } = await this.pool.query(
      `SELECT ${LEDGER_COLUMNS} FROM split_ledger WHERE payment_id = $1`,
      [paymentId]
    );
    // Repare no retorno explícito de null quando não existe lançamento:
    // o chamador consegue distinguir "não há split" de "split zerado",
    // em vez de receber undefined e quebrar em `rows[0].algumaCoisa`.
    if (!rows[0]) return null;
    return rowToLedger(rows[0]);
  }

  // Extrato financeiro por restaurante: join com payments p/ filtrar período.
  // O filtro de período cai sobre p.created_at (data do pagamento), não no
  // recorded_at do ledger — semanticamente é o que o restaurante espera ver.
  async listByRestaurant(restaurantId, from, to) {
    const params = [restaurantId];
    // Montagem dinâmica do período: os placeholders ($2, $3...) são
    // numerados na ordem em que os parâmetros entram no array.
    let extra = '';
    if (from) { params.push(from); extra += ` AND p.created_at >= $${params.length}`; }
    if (to) { params.push(to); extra += ` AND p.created_at <= $${params.length}`; }
    // O replace troca o alias da coluna id: como há join com payments, `id`
    // seria ambíguo — então SELECT sl.id para preservar os mesmos nomes.
    const { rows } = await this.pool.query(
      `SELECT ${LEDGER_COLUMNS.replace('id, ', 'sl.id, ')}
         FROM split_ledger sl
         JOIN payments p ON p.id = sl.payment_id
        WHERE p.restaurant_id = $1${extra}
        ORDER BY sl.recorded_at DESC`,
      params
    );
    return rows.map(rowToLedger);
  }

  // Totais consolidados por restaurante (painel financeiro).
  // COALESCE(SUM(...), 0) garante que, sem nenhuma linha no período, o
  // resultado seja 0 e não NULL — sem isso o JSON devolveria null e quebraria
  // o front. COUNT(*)::int força inteiro nativo (o pg devolve bigint).
  async sumsByRestaurant(restaurantId, from, to) {
    const params = [restaurantId];
    let extra = '';
    if (from) { params.push(from); extra += ` AND p.created_at >= $${params.length}`; }
    if (to) { params.push(to); extra += ` AND p.created_at <= $${params.length}`; }
    const { rows } = await this.pool.query(
      `SELECT COUNT(*)::int            AS quantidade,
              COALESCE(SUM(sl.gross_cents), 0)          AS bruto_cents,
              COALESCE(SUM(sl.restaurant_cents), 0)     AS repasse_cents,
              COALESCE(SUM(sl.commission_cents), 0)     AS comissao_cents,
              COALESCE(SUM(sl.service_fee_cents), 0)    AS servico_cents,
              COALESCE(SUM(sl.courier_cents), 0)        AS entregador_cents,
              COALESCE(SUM(sl.platform_cents), 0)       AS plataforma_cents
         FROM split_ledger sl
         JOIN payments p ON p.id = sl.payment_id
        WHERE p.restaurant_id = $1${extra}`,
      params
    );
    return rows[0];
  }

  // Visão global ADM — apenas números derivados do ledger (GMV, receita).
  // Estornos/chargebacks são somados pela StatementService a partir do
  // repositório de payments (dados de status).
  async globalSums() {
    const { rows } = await this.pool.query(
      `SELECT
         COALESCE(SUM(sl.gross_cents), 0)         AS gmv_cents,
         COALESCE(SUM(sl.platform_cents), 0)      AS receita_liquida_cents,
         COALESCE(SUM(sl.courier_cents), 0)       AS entregador_cents
        FROM split_ledger sl`
    );
    return rows[0];
  }
}

module.exports = { SqlLedgerRepository, LEDGER_COLUMNS };
