'use strict';

// ============================================================
//  Composition Root (container)
// ============================================================
// Único lugar que conhece as implementações concretas. As camadas
// internas dependem de abstrações (interfaces de repositório),
// permitindo trocar PostgreSQL por in-memory sem tocar no domínio.
// ============================================================
//
// Ou seja: aqui é onde a aplicação "monta" todas as peças. Se um dia
// trocarmos o MockGateway por um StripeGateway, é só mudar AQUI — o
// restante do código nem percebe, porque depende da mesma interface.
// Repare também que este arquivo não tem nenhuma regra de negócio;
// ele só faz a injeção de dependências (fiação/wiring).
const { createDatabase } = require('../config/database');
const { createRepositories } = require('./repositories');
const { MockGateway } = require('./gateway/payment-gateway');
const { EventBus } = require('./messaging/event-bus');
const { OutboxRelay } = require('./messaging/outbox-relay');
const { ExpireSweep } = require('./jobs/expire-sweep');
const { PaymentService } = require('../application/payment-service');
const { StatementService } = require('../application/statement-service');

function createContainer(config) {
  // Primeiro criamos o "banco" (pool/transações) porque os repositórios
  // dependem dele — ou seja, a ordem aqui importa: db → repos → serviços.
  const db = createDatabase(config);
  // A fábrica lê db.kind ('sql'|'memory') e devolve a implementação certa.
  const repos = createRepositories(db);
  // Em produção trocaríamos o MockGateway por um cliente real do adquirente.
  const gateway = new MockGateway();
  const bus = new EventBus();

  // Serviço de pagamento: recebe tudo que precisa via DI, nada de globals.
  const paymentService = new PaymentService({
    db,
    gateway,
    config,
    payments: repos.payments,
    ledger: repos.ledger,
    outbox: repos.outbox,
  });

  // Só precisa dos repositórios (ler para montar extratos/relatórios).
  const statementService = new StatementService(repos);

  // Relay do outbox e sweep de expiração rodam em loop (timers próprios).
  // Os intervalos vêm do config para facilitar ajuste em produção/testes.
  const outboxRelay = new OutboxRelay({
    db,
    outbox: repos.outbox,
    bus,
    intervalMs: config.outboxRelayIntervalMs,
  });

  const expireSweep = new ExpireSweep({
    db,
    payments: repos.payments,
    paymentService,
    intervalMs: config.expireSweepIntervalMs,
  });

  // Tudo exposto no objeto final: o server/interface pega só o que precisa
  // (ex.: app.listen usa config.port, as rotas usam paymentService).
  return { config, db, gateway, bus, repos, paymentService, statementService, outboxRelay, expireSweep };
}

module.exports = { createContainer };
