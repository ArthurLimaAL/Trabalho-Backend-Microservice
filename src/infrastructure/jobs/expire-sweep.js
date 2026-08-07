'use strict';

// ============================================================
//  Expire Sweep — tratamento de timeout de cobranças
// ============================================================
// Requisito do enunciado: se a confirmação (webhook Pix/cartão) não
// chegar dentro do prazo, a transação expira e o pedido associado é
// cancelado.
//
// Este job varre periodicamente cobranças PENDENTE cujo expires_at já
// passou, marca como FALHOU e emite o evento OrderCancelRequested
// (consumido pelo Pedidos Service via outbox/barramento).
class ExpireSweep {
  constructor({ db, payments, paymentService, intervalMs, logger = console }) {
    this.db = db;
    this.payments = payments;
    this.paymentService = paymentService;
    this.intervalMs = intervalMs;
    this.logger = logger;
    this.timer = null; // referência ao setInterval p/ podermos parar no stop()
  }

  start() {
    // Guarda anti-dupla-inicialização: start() duas vezes não cria 2 loops.
    if (this.timer) return;
    this.timer = setInterval(() => this.run(), this.intervalMs);
    // unref() faz o timer NÃO segurar o processo Node aberto — se não
    // houver mais nada rodando, o app pode encerrar mesmo com o sweep ativo.
    this.timer.unref?.();
    this.logger.info('[expire] sweep iniciado');
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  async run(now = new Date()) {
    // 1. Lista todas as cobranças PENDENTE cujo expires_at já passou.
    //    O now é injetável p/ os testes controlarem o "relógio".
    const expired = await this.payments.listPendingExpired(now);
    for (const payment of expired) {
      try {
        // 2. Expira UMA cobrança por vez. ExpirePayment cuida de emitir
        //    PaymentExpired + OrderCancelRequested (via outbox) e do
        //    optimistic locking (409 se alguém pagou no meio-tempo).
        const result = await this.paymentService.expirePayment(payment.id);
        this.logger.warn(`[expire] cobrança ${payment.id} expirada; pedido ${result.payment.orderId} cancelado.`);
      } catch (error) {
        // 3. Erro NUNCA derruba o loop: logamos e seguimos para a próxima.
        //    Se um item falhar (ex.: 409 porque o pagamento acabou de ser
        //    confirmado), não queremos perder a varredura dos demais.
        this.logger.error(`[expire] falha ao expirar ${payment.id}: ${error.message}`);
      }
    }
    return expired.length; // útil para os testes conferirem quantos expiraram
  }
}

module.exports = { ExpireSweep };
