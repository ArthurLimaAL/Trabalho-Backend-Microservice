export const TEMPLATES = {
  PedidoCriado: {
    templateName: "pedido_criado",
    message: "Olá {nomeCliente}, seu pedido #{numeroPedido} foi criado com sucesso!",
  },

  PagamentoAprovado: {
    templateName: "pagamento_aprovado",
    message: "Seu pagamento de R$ {valor} foi aprovado! Pedido #{numeroPedido}.",
  },

  SaiuParaEntrega: {
    templateName: "saiu_para_entrega",
    message: "Seu pedido #{numeroPedido} saiu para entrega! Previsão: {previsao}.",
  },
};

export function obterTemplate(tipoEvento) {
  return TEMPLATES[tipoEvento];
}
