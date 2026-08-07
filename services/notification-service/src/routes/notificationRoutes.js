import { Router } from "express";
import { criarNotificacao } from "../models/notification.js";
import { renderizar } from "../templates/renderer.js";
import { criar, listar, buscarPorIdempotencyKey } from "../data/notificationRepository.js";

const router = Router();

router.get("/", (req, res) => {
  res.json(listar());
});

router.post("/", (req, res) => {
  const { type, channel, recipientId, templateName, payload, idempotencyKey } = req.body;

  const jaExiste = buscarPorIdempotencyKey(idempotencyKey);
  if (jaExiste) {
    return res.status(200).json({ duplicada: true, notification: jaExiste });
  }

  const renderizada = renderizar(type, payload);

  const notificacao = criarNotificacao({
    type,
    channel,
    recipientId,
    templateName,
    payload,
    idempotencyKey,
  });

  notificacao.message = renderizada.message;
  notificacao.templateName = renderizada.templateName;

  criar(notificacao);

  notificacao.status = "ENVIADO";
  res.status(201).json(notificacao);
});

export default router;
