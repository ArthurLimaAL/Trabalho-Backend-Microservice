'use strict';

const crypto = require('crypto');

// Repasses em memória (testes/demo).
class MemoryPayoutRepository {
  constructor() {
    this.rows = [];
  }

  async insert(payout) {
    // Mesmo fallback de id do SQL: preserva id fornecido ou gera UUID.
    const row = {
      id: payout.id || crypto.randomUUID(),
      restaurantId: payout.restaurantId,
      periodLabel: payout.periodLabel,
      periodStart: payout.periodStart,
      periodEnd: payout.periodEnd,
      type: payout.type,
      status: payout.status,
      amountCents: payout.amountCents,
      createdAt: payout.createdAt || new Date(),
    };
    this.rows.push(row);
    return row;
  }

  async listByRestaurant(restaurantId) {
    return this.rows.filter((r) => r.restaurantId === restaurantId);
  }

  async listAll() {
    return this.rows.slice();
  }

  async sumPending() {
    // Espelha o SQL: só status 'AGENDADO' conta; reduce sem linhas = 0.
    return this.rows.filter((r) => r.status === 'AGENDADO').reduce((s, r) => s + r.amountCents, 0);
  }

  reset() {
    // Limpa o estado entre testes para garantir isolamento.
    this.rows = [];
  }
}

module.exports = { MemoryPayoutRepository };
