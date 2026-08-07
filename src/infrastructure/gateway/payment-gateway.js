'use strict';

const crypto = require('crypto');

// ============================================================
//  Gateway de Pagamento (mock do adquirente externo)
// ============================================================
// Em produção seria Stripe / Cielo / PagSeguro / Banco (Pix).
// Pontos que o mock preserva para fidelidade com a realidade:
//   • Também é IDEMPOTENTE: a mesma Idempotency-Key devolve a mesma
//     transação, sem criar cobrança duplicada no adquirente.
//   • A confirmação acontece por WEBHOOK (Pix/cartão), nunca por
//     chamada síncrona do cliente.
//   • Pode ser configurado para "falhar" (simulação de rede).
class MockGateway {
  constructor() {
    // Map de idempotência: chave = Idempotency-Key, valor = transação.
    // Um Map é ideal aqui porque oferece O(1) em has/get e preserva a
    // identidade entre chave e resposta (sem repositório, sem banco).
    this.store = new Map();
    // Contador de falhas simuladas (usado pelos testes p/ forçar erro).
    this.failures = 0;
  }

  async charge({ idempotencyKey, amountCents, method }) {
    // Se um teste configurou falhas (failNext), "derrubamos" o adquirente.
    // Decrementamos 1 por chamada, ou seja, a falha é pontual e depois
    // o gateway volta a funcionar — simula uma instabilidade de rede.
    if (this.failures > 0) {
      this.failures -= 1;
      const err = new Error('timeout ao contactar o adquirente');
      err.code = 'GATEWAY_UNAVAILABLE';
      throw err;
    }
    // IDEMPOTÊNCIA: se a mesma chave já foi usada, devolvemos EXATAMENTE a
    // mesma transação (a mesma gatewayId). Isso evita cobrança duplicada
    // quando o cliente reenvia a requisição — é o contrato de idempotência.
    if (this.store.has(idempotencyKey)) {
      return this.store.get(idempotencyKey);
    }
    // Primeira chamada com essa chave: criamos a transação no "adquirente"
    // e a guardamos. Em produção aqui seria uma chamada HTTP ao adquirente.
    const transaction = {
      gatewayId: `gw_${crypto.randomUUID()}`,
      amountCents,
      method,
      status: 'AUTHORIZED', // pré-autorizado; confirmação real viria por webhook
      createdAt: new Date(),
    };
    // Só gravamos DEPOIS de construir a transação — assim reenvios de uma
    // chave falha não "vazam" dados parciais para quem pergunta de novo.
    this.store.set(idempotencyKey, transaction);
    return transaction;
  }

  // Simula uma falha na próxima chamada ao gateway.
  failNext(n = 1) {
    this.failures = n;
  }
}

module.exports = { MockGateway };
