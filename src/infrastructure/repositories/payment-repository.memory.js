'use strict';

const { Payment } = require('../../domain/payment');
const { PAYMENT_STATUS } = require('../../domain/payment-status');
const { InvalidTransitionError } = require('../../domain/payment-errors');

// Guarda uma CÓPIA do agregado, imitando o comportamento do SQL (o UPDATE
// com WHERE status = esperado protege contra mutações já aplicadas).
//
// Por que copiar em vez de guardar a referência? Porque se o chamador
// mutar o objeto que recebeu, a "linha" no repositório mudaria junto —
// como se outra transação tivesse alterado o dado sem a gente ver. A cópia
// reproduz o isolamento de um SELECT: quem lê ganha um snapshot independente.
function clone(payment) {
  return new Payment(payment.toJSON());
}

// Repositório em memória — mesma interface do SQL. Usado nos testes de
// integração (roda sem Postgres) e em demonstrações rápidas.
class MemoryPaymentRepository {
  constructor() {
    this.rows = [];
    this._seq = 0;
  }

  async insert(payment) {
    // Espelha a constraint UNIQUE (payments_idempotency_key_key) do Postgres.
    // Reproduzimos inclusive o código de erro '23505' e a mensagem original
    // para os testes/camadas superiores tratarem exatamente como tratariam
    // com o banco de verdade (mesma semântica de idempotência).
    if (this.rows.some((r) => r.idempotencyKey === payment.idempotencyKey)) {
      const err = new Error('duplicate key value violates unique constraint "payments_idempotency_key_key"');
      err.code = '23505';
      throw err;
    }
    const copy = clone(payment);
    this.rows.push(copy);
    return copy;
  }

  async findById(id) {
    const row = this.rows.find((r) => r.id === id);
    return row ? clone(row) : null;
  }

  async findByKey(idempotencyKey) {
    const row = this.rows.find((r) => r.idempotencyKey === idempotencyKey);
    return row ? clone(row) : null;
  }

  async updateStatus(payment, expectedStatus) {
    const index = this.rows.findIndex((r) => r.id === payment.id);
    // Nenhuma linha com esse id: devolve null (no SQL seria um UPDATE que
    // não afetou nada; aqui não há InvalidTransitionError porque nem existe).
    if (index === -1) return null;
    const current = this.rows[index];
    // Espelha o `UPDATE ... WHERE status = $esperado AND version = $v` do SQL:
    // se o status ou a versão carregados não corresponderem mais ao estado
    // atual (mudou entre a leitura e a escrita), a transição falha.
    if (current.status !== expectedStatus || current.version !== payment.version) {
      throw new InvalidTransitionError(current.status, payment.status);
    }
    // "Commit" simulado: incrementa a versão e grava a cópia atualizada.
    payment.version += 1;
    this.rows[index] = clone(payment);
    return this.rows[index];
  }

  async listByClient(clientId, { status, method } = {}) {
    return this.rows
      .filter((r) => r.clientId === clientId)
      .filter((r) => !status || r.status === status)
      .filter((r) => !method || r.method === method)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(clone);
  }

  async listByRestaurant(restaurantId) {
    return this.rows
      .filter((r) => r.restaurantId === restaurantId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(clone);
  }

  async listPendingExpired(now) {
    // Mesma semântica do SQL (PENDENTE com expiresAt vencido). Usamos <=
    // aqui e < lá: diferença sutil de boundary que não muda o comportamento
    // relevante nos testes (a data é praticamente nunca igual a now).
    return this.rows
      .filter((r) => r.status === PAYMENT_STATUS.PENDENTE && r.expiresAt && r.expiresAt <= now)
      .map(clone);
  }

  async listAll() {
    // slice() cria uma cópia do array antes de ordenar — se ordenássemos
    // this.rows direto, a ordem interna ficaria alterada para as próximas
    // chamadas (efeito colateral indesejado).
    return this.rows.slice().sort((a, b) => b.createdAt - a.createdAt).map(clone);
  }

  reset() {
    // Limpa o estado — usado entre testes para garantir isolamento.
    this.rows = [];
    this._seq = 0;
  }
}

module.exports = { MemoryPaymentRepository };
