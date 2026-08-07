import crypto from "node:crypto";

export const CHANNELS = ["EMAIL", "SMS", "PUSH"];
export const STATUS = ["PENDENTE", "ENVIADO", "FALHOU"];

export function criarNotificacao({ type, channel, recipientId, templateName, payload = {}, idempotencyKey }) {
  if (!idempotencyKey) {
    throw new Error("idempotencyKey obrigatória para evitar disparos duplicados");
  }

  if (!CHANNELS.includes(channel)) {
    throw new Error(`Canal inválido. Use: ${CHANNELS.join(", ")}`);
  }

  return {
    id: crypto.randomUUID(),
    type,
    channel,
    recipientId,
    templateName,
    payload,
    message: null,
    status: "PENDENTE",
    idempotencyKey,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
