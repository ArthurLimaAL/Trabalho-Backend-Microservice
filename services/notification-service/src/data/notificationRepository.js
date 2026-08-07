const notificacoes = [];

export function criar(notification) {
  notificacoes.push(notification);
  return notification;
}

export function listar() {
  return notificacoes;
}

export function remover(id) {
  const index = notificacoes.findIndex((notif) => notif.id === id);

  if (index !== -1) {
    notificacoes.splice(index, 1);
    return true;
  }
  return false;
}

export function buscarPorIdempotencyKey(idempotencyKey) {
  return notificacoes.find((notif) => notif.idempotencyKey === idempotencyKey);
}

export function atualizarStatus(id, status) {
  const notif = notificacoes.find((notif) => notif.id === id);
  if (!notif) return false;
  notif.status = status;
  notif.updatedAt = new Date().toISOString();
  return true;
}
