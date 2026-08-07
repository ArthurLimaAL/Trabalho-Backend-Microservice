import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { criarNotificacao } from "../src/models/notification.js";
import { renderizar } from "../src/templates/renderer.js";
import { criar, buscarPorIdempotencyKey } from "../src/data/notificationRepository.js";

describe("criarNotificacao (domínio)", () => {
  it("lança erro quando NÃO recebe idempotencyKey", () => {
    assert.throws(() => {
      criarNotificacao({
        type: "PagamentoAprovado",
        channel: "PUSH",
        recipientId: "cliente-1",
        templateName: "pagamento_aprovado",
        payload: {},
      });
    }, /idempotencyKey/);
  });

  it("lança erro quando o canal é inválido", () => {
    assert.throws(() => {
      criarNotificacao({
        type: "PagamentoAprovado",
        channel: "EMAIL_INVALIDO",
        recipientId: "cliente-1",
        templateName: "pagamento_aprovado",
        payload: {},
        idempotencyKey: "evt-123",
      });
    }, /Canal inválido/);
  });

  it("cria uma notificação válida com status PENDENTE", () => {
    const notif = criarNotificacao({
      type: "PagamentoAprovado",
      channel: "PUSH",
      recipientId: "cliente-1",
      templateName: "pagamento_aprovado",
      payload: { valor: "150,00", numeroPedido: "1234" },
      idempotencyKey: "evt-123",
    });

    assert.ok(notif.id, "deve ter um id gerado");
    assert.equal(notif.status, "PENDENTE");
    assert.equal(notif.idempotencyKey, "evt-123");
    assert.equal(notif.message, null);
  });
});

describe("renderizar (templates dinâmicos)", () => {
  it("preenche os placeholders do template com o payload", () => {
    const resultado = renderizar("PagamentoAprovado", {
      valor: "150,00",
      numeroPedido: "1234",
    });

    assert.equal(resultado.templateName, "pagamento_aprovado");
    assert.equal(
      resultado.message,
      "Seu pagamento de R$ 150,00 foi aprovado! Pedido #1234."
    );
  });

  it("lança erro para evento sem template cadastrado", () => {
    assert.throws(() => {
      renderizar("EventoDesconhecido", {});
    }, /Nenhum template/);
  });
});

describe("buscarPorIdempotencyKey (idempotência)", () => {
  it("retorna undefined quando o evento NUNCA foi processado", () => {
    const resultado = buscarPorIdempotencyKey("chave-que-nunca-existiu");
    assert.equal(resultado, undefined);
  });

  it("retorna a notificação quando o evento JÁ foi processado", () => {
    const notif = criarNotificacao({
      type: "PedidoCriado",
      channel: "PUSH",
      recipientId: "cliente-9",
      templateName: "pedido_criado",
      payload: { nomeCliente: "Maria", numeroPedido: "999" },
      idempotencyKey: "evt-dup",
    });

    criar(notif);

    const encontrada = buscarPorIdempotencyKey("evt-dup");
    assert.ok(encontrada, "deve encontrar a notificação já existente");
    assert.equal(encontrada.idempotencyKey, "evt-dup");
  });
});
