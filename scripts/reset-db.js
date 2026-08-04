'use strict';

// Limpa os dados de demonstração (pedidos/cobranças antigas, extratos,
// repasses e eventos da outbox) mantendo o SCHEMA e o histórico de
// migrações intactos. O ecossistema volta a zero para uma demonstração.
// Uso: npm run db:reset   (com Postgres rodando e PAYMENT_DB_DRIVER=sql)
require('dotenv').config();
const { Pool } = require('pg');
const { readEnv } = require('../src/config/env');

async function main() {
  const config = readEnv();
  if (config.databaseDriver === 'memory') {
    console.error('[reset] use PAYMENT_DB_DRIVER=sql com o PostgreSQL rodando.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: config.databaseUrl });

  await pool.query(`
    TRUNCATE TABLE outbox_events, split_ledger, payouts, payments RESTART IDENTITY CASCADE
  `);

  const { rows } = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM payments)           AS payments,
      (SELECT COUNT(*) FROM split_ledger)       AS ledger,
      (SELECT COUNT(*) FROM payouts)            AS payouts,
      (SELECT COUNT(*) FROM outbox_events)      AS outbox
  `);

  console.log(
    `[reset] OK — payments=${rows[0].payments} · ledger=${rows[0].ledger} · ` +
      `payouts=${rows[0].payouts} · outbox=${rows[0].outbox}`
  );

  await pool.end();
}

main().catch((error) => {
  console.error('[reset] falha:', error.message);
  process.exit(1);
});
