export class EventBus {
  constructor (logger = console) {
    this.logger = logger;
    this.listeners = [];
  }

  subscribe (fn) {
    this.listeners.push (fn);
    return () => {
      this.listeners = this.listeners.filter ((f) => f !== fn);
    };
  }

  async publish (event) {
    this.logger.info (`[bus] publicado: ${event.type}`, event.payload);
    for (const fn of this.listeners) {
      try {
        await fn (event);
      } catch (erro) {
        this.logger.error (`[bus] listener falhou para ${event.type}: ${erro.message}`);
      }
    }
  }
}
