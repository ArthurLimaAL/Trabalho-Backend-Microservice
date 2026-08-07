import { criarNotificacao } from "../models/notification.js";
import { renderizar } from "../templates/renderer.js";
import { criar, buscarPorIdempotencyKey, atualizarStatus } from "../data/notificationRepository.js";

const CANAL_PADRAO = "PUSH";

async function processarEvento(event) {
  const { type, payload } = event;

  const jaExiste = buscarPorIdempotencyKey(event.id);
  if (jaExiste) {
    return;
  }

  const renderizada = renderizar(type, payload);

  const notificacao = criarNotificacao({
    type,
    channel: CANAL_PADRAO,
    recipientId: payload.recipientId,
    templateName: renderizada.templateName,
    payload,
    idempotencyKey: event.id,
  });

  notificacao.message = renderizada.message;

  criar(notificacao);

  try {
    notificacao.status = "ENVIADO";
    console.log(`[notificação] ${notificacao.channel} → ${notificacao.recipientId}: ${notificacao.message}`);
  } catch (erro) {
    atualizarStatus(notificacao.id, "FALHOU");
  }
}

export function registrarConsumidor(bus) {
  bus.subscribe(async (event) => {
    try {
      await processarEvento(event);
    } catch (erro) {
      console.error(`[listener] erro ao processar ${event.type}:`, erro.message);
    }
  });
  console.log("[notification-service] consumidor de eventos registrado.");
}
