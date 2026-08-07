import { EventBus } from "./src/events/eventBus.js";
import { registrarConsumidor } from "./src/events/notificationListener.js";
import { listar } from "./src/data/notificationRepository.js";

const bus = new EventBus();
registrarConsumidor(bus);

console.log("=== Simulando eventos do ecossistema ===\n");

await bus.publish({
  id: "evt-001",
  type: "PedidoCriado",
  payload: { nomeCliente: "Maria", numeroPedido: "1234", recipientId: "cliente-1" },
});

await bus.publish({
  id: "evt-002",
  type: "PagamentoAprovado",
  payload: { valor: "150,00", numeroPedido: "1234", recipientId: "cliente-1" },
});

await bus.publish({
  id: "evt-003",
  type: "SaiuParaEntrega",
  payload: { numeroPedido: "1234", previsao: "30 min", recipientId: "cliente-1" },
});

console.log("\n=== Reprocessando o mesmo evento (idempotência) ===\n");
await bus.publish({
  id: "evt-002",
  type: "PagamentoAprovado",
  payload: { valor: "150,00", numeroPedido: "1234", recipientId: "cliente-1" },
});

console.log("\n=== Notificações registradas ===\n");
console.log(JSON.stringify(listar(), null, 2));
console.log(`\nTotal de notificações: ${listar().length} (esperado 3, sem duplicata)`);
