import app from "./app.js";
import { EventBus } from "./events/eventBus.js";
import { registrarConsumidor } from "./events/notificationListener.js";

const PORT = process.env.PORT || 3004;
const bus = new EventBus();

registrarConsumidor(bus);

app.listen(PORT, () => {
  console.log(`Notification Service rodando na porta ${PORT}`);
});
