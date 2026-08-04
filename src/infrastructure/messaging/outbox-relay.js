'use strict';

// ============================================================
//  Outbox Relay — Transactional Outbox Pattern
// ============================================================
// O serviço grava eventos na tabela outbox_events DENTRO da mesma
// transação do dado de negócio (nenhum evento se perde). Este relay
// roda em loop, "publica" no barramento os eventos ainda não enviados
// e só então os marca como published.
//
// Por que isso existe:
//   • Publicar evento direto na fila + gravar no banco não é atômico.
//   • Se o envio falhar, o evento continua no outbox e é retomado.
//   • Consistência eventual entre os microsserviços (enunciado).
class OutboxRelay {
  constructor({ db, outbox, bus, intervalMs, logger = console }) {
    this.db = db;
    this.outbox = outbox;
    this.bus = bus;
    this.intervalMs = intervalMs;
    this.logger = logger;
    this.timer = null;
    this.running = false; // trava para não processar 2 lotes ao mesmo tempo
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.flush(), this.intervalMs);
    // unref: o relay não segura o processo aberto por si só.
    this.timer.unref?.();
    this.logger.info('[outbox] relay iniciado');
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  async flush() {
    // Guarda importante: se um flush ainda está em andamento (o publish no
    // barramento é assíncrono), pulamos a rodada. Evita publicação duplicada
    // e sobrecarga quando o relay é mais lento que o intervalo.
    if (this.running) return;
    this.running = true;
    try {
      // Tudo acontece dentro de UMA transação:
      //   1. claim → seleciona (e trava) até N eventos não publicados;
      //   2. publish → envia para o barramento;
      //   3. markPublished → marca como publicados.
      // Se o publish falhar no meio, o ROLLBACK desfaz o markPublished e os
      // eventos continuam não-publicados no outbox — serão retomados na
      // próxima rodada. Nenhum evento se perde (é o coração do padrão).
      await this.db.withTransaction(async (tx) => {
        const events = await this.outbox.claimUnpublished(tx, 100);
        if (!events.length) return;
        for (const event of events) {
          await this.bus.publish({ id: event.id, type: event.type, payload: event.payload });
        }
        await this.outbox.markPublished(events.map((e) => e.id), tx);
      });
    } catch (error) {
      // Relays NUNCA morrem por um erro isolado: logamos e tentamos de novo
      // no próximo tick (padrão de resiliência de processos em background).
      this.logger.error('[outbox] flush falhou:', error.message);
    } finally {
      this.running = false;
    }
  }
}

module.exports = { OutboxRelay };
