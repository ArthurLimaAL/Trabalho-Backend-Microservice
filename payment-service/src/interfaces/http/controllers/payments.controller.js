'use strict';

const { NotFoundError } = require('../../../domain/payment-errors');

// Controller de cobranças. A regra aqui é simples: pega o que veio do
// Express (req), chama o serviço de domínio e devolve JSON. Toda a lógica
// de negócio (regras de estado, persistência, transação) fica no serviço —
// este arquivo só traduz HTTP ⇄ domínio. Por isso os handlers são fininhos
// e qualquer erro cai no `next(error)`, que o error-handler transforma em
// status HTTP apropriado.
function createPaymentsController({ paymentService, statementService }) {
  return {
    // POST /charges — cria cobrança (exige Idempotency-Key)
    async createCharge(req, res, next) {
      try {
        // Desestruturação do body: cada campo vira argumento do serviço.
        // O `clientId` NÃO vem do body — vem do JWT (req.auth.user_id),
        // ou seja, o cliente não escolhe em nome de quem cobra; quem
        // garante isso é o middleware `requireRole('CLIENTE')` na rota.
        const { orderId, restaurantId, method, productAmountCents, deliveryFeeCents, timeoutMs } = req.body;
        const result = await paymentService.createCharge(
          {
            orderId,
            clientId: req.auth.user_id,
            restaurantId,
            method,
            productAmountCents,
            deliveryFeeCents,
            timeoutMs,
          },
          req.idempotencyKey
        );
        // O serviço devolve `replayed`: quando a mesma Idempotency-Key já
        // foi usada, ele reapresenta o resultado ANTIGO em vez de cobrar de
        // novo. Repare que o status muda (200 = replay, 201 = criada de
        // verdade) — o cliente usa isso para saber se o POST foi efetivado.
        res.status(result.replayed ? 200 : 201).json({ payment: result.payment, replayed: result.replayed });
      } catch (error) {
        // Nada de `res.status(500).json(...)` aqui: deixamos o Express
        // encaminhar para o error-handler central, que decide o status.
        next(error);
      }
    },

    // GET / — histórico de cobranças do cliente autenticado
    async listMine(req, res, next) {
      try {
        // Filtros OPCIONAIS vêm do query string (ex.: /payments?status=CONCLUIDO).
        // O service ignora os que vêm vazios, então o mesmo endpoint serve
        // tanto para listar tudo quanto para filtrar.
        const { status, method } = req.query;
        // "Mine" = do próprio cliente: o user_id sai do JWT, nunca da URL.
        // É assim que um cliente não consegue ler o histórico de outro.
        const payments = await statementService.clientStatement(req.auth.user_id, { status, method });
        res.json({ payments });
      } catch (error) {
        next(error);
      }
    },

    // GET /:id — comprovante completo (dono ou admin)
    async getById(req, res, next) {
      try {
        // getWithSplit traz o pagamento JUNTO com o split para o restaurante
        // (o "comprovante completo" de que o cliente precisa). Não fazemos
        // duas queries e montamos aqui — o serviço já entrega o pacote.
        const payment = await statementService.getWithSplit(req.params.id);
        res.json({ payment });
      } catch (error) {
        next(error);
      }
    },

    // POST /:id/refund — estorno (apenas cobranças CONCLUIDO)
    async refund(req, res, next) {
      try {
        // `req.body?.reason` usa optional chaining: se o body não vier ou
        // não tiver `reason`, passa `undefined` — o serviço aceita estorno
        // sem motivo, mas registra o motivo quando informado.
        const result = await paymentService.refundPayment(req.params.id, req.body?.reason);
        res.json({ payment: result.payment });
      } catch (error) {
        next(error);
      }
    },

    // Auxiliar p/ RBAC de propriedade
    // O middleware requireOwnershipOrAdmin chama esta função para descobrir
    // QUEM é dono do recurso. Ela devolve o clientId da cobrança e o
    // middleware compara com o user_id do JWT (ou libera se for ADMIN).
    async ownerOf(req) {
      const payment = await statementService.getWithSplit(req.params.id);
      // Sem payment não existe dono; lançamos o erro de domínio para o
      // error-handler virar 404 — não dá pra falar em "forbidden" de algo
      // que nem existe (evita vazar a existência do recurso).
      if (!payment) throw new NotFoundError('Cobrança');
      return payment.clientId;
    },
  };
}

module.exports = { createPaymentsController };
