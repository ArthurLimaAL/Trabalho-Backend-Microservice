'use strict';

// Barramento de eventos (stub). Em produção o relay do outbox
// publicaria em Kafka/RabbitMQ/Redis e o Notification Service
// consumiria. Aqui entregamos para listeners registrados (testes)
// e para o log.
class EventBus {
  constructor(logger = console) {
    this.logger = logger;
    this.listeners = []; // lista de funções assinantes (pub/sub simples)
  }

  // Registra um listener e devolve uma função de cancelamento (unsubscribe).
  // Retornar o "desinscrever" é um padrão prático: o chamador guarda a
  // função e, quando quiser parar de escutar, é só chamá-la.
  subscribe(fn) {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((f) => f !== fn);
    };
  }

  async publish(event) {
    // Sempre logamos o evento — em dev/testes é assim que "vemos" o que
    // foi publicado, já que o barramento é um stub (sem fila de verdade).
    this.logger.info(`[bus] publicado: ${event.type}`, event.payload);
    for (const fn of this.listeners) {
      try {
        // Usamos `await` para respeitar listeners assíncronos; se um deles
        // for mais lento, esperamos terminar antes de chamar o próximo.
        await fn(event);
      } catch (error) {
        // Um listener que lança NÃO pode derrubar a publicação nem impedir
        // que os demais recebam o evento — por isso isolamos com try/catch.
        this.logger.error(`[bus] listener falhou para ${event.type}: ${error.message}`);
      }
    }
  }
}

module.exports = { EventBus };
