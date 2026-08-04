'use strict';

// Endpoints que o gateway externo chama para avisar a aprovação de um
// pagamento (Pix via webhook de confirmação; cartão via autorização).
// Em produção o payload traz o ID da transação no adquirente; aqui o
// mock envia o paymentId — comportamento documentado no README.
//
// Ponto importante: NÃO existe sessão de usuário aqui (não passa por
// `authenticate`). A "autenticação" deste endpoint é o header X-Gateway-Key,
// validado pelo middleware requireGatewaySecret na rota. Ou seja: a confiança
// vem da assinatura, e não de JWT — quem bater aqui sem a chave certa nem
// chega até estes handlers.
function createWebhooksController({ paymentService }) {
  return {
    // Webhook de confirmação do Pix. O gateway garante que o Pix foi
    // efetivamente pago (o código ainda está AGUARDANDO) e nós avançamos
    // o pagamento para CONCLUIDO. Payload mínimo: { paymentId, gatewayId }.
    async confirmPix(req, res, next) {
      try {
        // `gatewayId` é o identificador da transação no lado do adquirente;
        // salvamos para conciliação futura. O `reason` entra no histórico do
        // pagamento — ajuda MUITO na hora de debugar por que um pagamento
        // mudou de estado.
        const result = await paymentService.confirmPayment(req.body.paymentId, {
          gatewayId: req.body.gatewayId,
          reason: 'webhook: Pix aprovado no gateway',
        });
        // `replayed` aparece aqui também: se o gateway reenviar o mesmo
        // webhook (redelivery é comum em fila), a confirmação é idempotente
        // e o resultado retorna igual, sem corromper o estado do pagamento.
        res.json({ payment: result.payment, split: result.split, replayed: result.replayed });
      } catch (error) {
        next(error);
      }
    },

    // O mesmo fluxo, mas para cartão — neste mock, o "desconto" do cartão
    // já veio autorizado e aqui confirmamos o pagamento e efetivamos o split.
    // A lógica é idêntica à do Pix; a diferença está só no motivo registrado.
    async confirmCard(req, res, next) {
      try {
        const result = await paymentService.confirmPayment(req.body.paymentId, {
          gatewayId: req.body.gatewayId,
          reason: 'webhook: cartão aprovado no gateway',
        });
        res.json({ payment: result.payment, split: result.split, replayed: result.replayed });
      } catch (error) {
        next(error);
      }
    },
  };
}

module.exports = { createWebhooksController };
