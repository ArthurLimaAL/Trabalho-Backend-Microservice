'use strict';

// Outbox em memória (testes/demo).
class MemoryOutboxRepository {
  constructor() {
    this.rows = [];
    this._seq = 0; // gerador de ids incrementais (o SQL usa serial)
  }

  // O `_tx` é ignorado: em memória não existe transação de verdade. Manter o
  // parâmetro na assinatura garante a MESMA interface do SQL (o chamador não
  // precisa saber com qual implementação está falando).
  async insert(_tx, type, payload) {
    this.rows.push({ id: ++this._seq, type, payload, publishedAt: null });
  }

  async claimUnpublished(_tx, limit = 50) {
    return this.rows
      .filter((r) => r.publishedAt === null)
      .slice(0, limit) // mesmo limite do SQL: processa lotes, não tudo
      .map((r) => ({ id: r.id, type: r.type, payload: r.payload }));
  }

  async markPublished(ids) {
    for (const row of this.rows) {
      if (ids.includes(row.id)) row.publishedAt = new Date();
    }
  }

  listAll() {
    return this.rows.slice();
  }

  reset() {
    // Limpa o estado entre testes para garantir isolamento.
    this.rows = [];
    this._seq = 0;
  }
}

module.exports = { MemoryOutboxRepository };
