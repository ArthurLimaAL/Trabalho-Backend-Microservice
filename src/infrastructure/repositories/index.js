'use strict';

// Fábrica de repositórios: escolhe implementação SQL (PostgreSQL) ou
// in-memory conforme o driver do banco. Os testes usam "memory" e,
// por isso, rodam em qualquer máquina sem exigir Postgres instalado.
//
// Ideia central: as camadas superiores NUNCA instanciam repositórios — elas
// recebem via injeção. Este é o único lugar que sabe do "if sql/memory".
// Repare que as implementações têm interfaces idênticas, ou seja, trocar o
// driver não exige mudança nenhuma nos services/rotas.
const { SqlPaymentRepository } = require('./payment-repository.sql');
const { MemoryPaymentRepository } = require('./payment-repository.memory');
const { SqlLedgerRepository } = require('./ledger-repository.sql');
const { MemoryLedgerRepository } = require('./ledger-repository.memory');
const { SqlPayoutRepository } = require('./payout-repository.sql');
const { MemoryPayoutRepository } = require('./payout-repository.memory');
const { SqlOutboxRepository } = require('./outbox-repository.sql');
const { MemoryOutboxRepository } = require('./outbox-repository.memory');

function createRepositories(db) {
  // db.kind é definido em createDatabase ('sql'|'memory'). Um único ternário
  // decide tudo: se for sql, usa os repositórios com pool; senão, in-memory.
  const isSql = db.kind === 'sql';
  const payments = isSql ? new SqlPaymentRepository(db) : new MemoryPaymentRepository();
  const ledger = isSql ? new SqlLedgerRepository(db) : new MemoryLedgerRepository();
  const payouts = isSql ? new SqlPayoutRepository(db) : new MemoryPayoutRepository();
  const outbox = isSql ? new SqlOutboxRepository(db) : new MemoryOutboxRepository();
  // Retorna um objeto com nome em minúsculo p/ os services consumirem
  // como repos.payments, repos.ledger etc. (API única, independente de driver).
  return { payments, ledger, payouts, outbox };
}

module.exports = { createRepositories };
