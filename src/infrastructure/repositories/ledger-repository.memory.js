'use strict';

const crypto = require('crypto');

// Ledger em memória (testes/demo) — mesma interface do SQL.
// Guarda restaurantId de forma denormalizada para permitir os mesmos
// filtros do SQL sem JOIN (o SQL obtém via join com payments).
//
// Ou seja: aqui guardamos junto à linha a informação que no Postgres viria
// de outra tabela. Trade-off aceitável para um mock — simplifica o filtro
// e mantém o comportamento visível ao chamador idêntico ao do SQL.
class MemoryLedgerRepository {
  constructor() {
    this.rows = [];
  }

  async insert({ split, paymentId, restaurantId }) {
    const row = {
      id: crypto.randomUUID(),
      paymentId,
      restaurantId,
      grossCents: split.grossCents,
      productAmountCents: split.productAmountCents,
      deliveryFeeCents: split.deliveryFeeCents,
      commissionCents: split.commissionCents,
      serviceFeeCents: split.serviceFeeCents,
      platformCents: split.platformCents,
      courierCents: split.courierCents,
      restaurantCents: split.restaurantCents,
      recordedAt: new Date(),
    };
    this.rows.push(row);
    return row;
  }

  async findByPayment(paymentId) {
    // `|| null` garante o mesmo contrato do SQL: null quando não acha
    // (não undefined), para o chamador tratar de forma uniforme.
    return this.rows.find((r) => r.paymentId === paymentId) || null;
  }

  async listByRestaurant(restaurantId, from, to) {
    return this.rows
      .filter((r) => r.restaurantId === restaurantId)
      // Filtros de período convertidos com new Date(...) — no SQL o banco
      // compara TIMESTAMPTZ; aqui reproduzimos comparando os instantes.
      .filter((r) => !from || r.recordedAt >= new Date(from))
      .filter((r) => !to || r.recordedAt <= new Date(to))
      .slice()
      .reverse(); // slice antes de reverter para não alterar a ordem interna
  }

  async sumsByRestaurant(restaurantId, from, to) {
    const rows = await this.listByRestaurant(restaurantId, from, to);
    // Reduz por coluna com a mesma lógica do SQL; como filtramos antes,
    // os totais batem com o período pedido.
    const sum = (fn) => rows.reduce((s, r) => s + fn(r), 0);
    return {
      quantidade: rows.length,
      bruto_cents: sum((r) => r.grossCents),
      repasse_cents: sum((r) => r.restaurantCents),
      comissao_cents: sum((r) => r.commissionCents),
      servico_cents: sum((r) => r.serviceFeeCents),
      entregador_cents: sum((r) => r.courierCents),
      plataforma_cents: sum((r) => r.platformCents),
    };
  }

  async globalSums() {
    // Reduz do array inteiro (sem filtro de período) — espelha o SQL que
    // soma todas as linhas de split_ledger. Em array vazio, reduce com valor
    // inicial 0 devolve 0 (não NaN como seria sem o argumento inicial).
    return {
      gmv_cents: this.rows.reduce((s, r) => s + r.grossCents, 0),
      receita_liquida_cents: this.rows.reduce((s, r) => s + r.platformCents, 0),
      entregador_cents: this.rows.reduce((s, r) => s + r.courierCents, 0),
    };
  }

  reset() {
    this.rows = [];
  }
}

module.exports = { MemoryLedgerRepository };
