'use strict';

const { Payment } = require('../domain/payment');
const { SplitCalculator } = require('../domain/split');
const { PAYMENT_STATUS } = require('../domain/payment-status');
const { Money } = require('../domain/money');
const {
  IdempotencyKeyRequiredError,
  NotFoundError,
  InvalidTransitionError,
} = require('../domain/payment-errors');

// ============================================================
//  Casos de uso do domínio de pagamentos (application layer)
// ============================================================
// Orquestra agregados (Payment), serviços de domínio (SplitCalculator),
// repositórios e o gateway externo. Não conhece Express/HTTP.
// ============================================================
//
// PARA O JÚNIOR: esta é a "camada de aplicação" — o cérebro que liga o mundo
// externo (requisições HTTP) ao domínio puro (payment.js, split.js, money.js).
// As funções aqui NÃO têm regra de negócio escondida; elas coordenam:
// 1) pegam o input, 2) chamam o domínio para validar/decidir, 3) persistem,
// 4) emitem eventos. Se você precisar entender "o que acontece quando alguém
// cria uma cobrança?", este arquivo é o primeiro lugar para olhar.
//
// Repare no padrão de todas as funções: buscam o Payment, conferem estado,
// delegam a mudança de estado ao agregado (que valida a transição) e então
// gravam tudo numa ÚNICA transação de banco junto com o evento no outbox.
// Esse "tudo ou nada" é o que mantém o sistema consistente — se o banco cair
// no meio, nada é gravado pela metade.
class PaymentService {
  constructor({ db, payments, ledger, outbox, gateway, config }) {
    this.db = db;
    this.payments = payments;
    this.ledger = ledger;
    this.outbox = outbox;
    this.gateway = gateway;
    this.config = config;
  }

  // ----------------------------------------------------------
  // POST /charges — Idempotência Absoluta
  //  1) Busca rápida pela chave: se existir, REPLAY (não cobra de novo).
  //  2) Autoriza no gateway (que também é idempotente pela mesma chave).
  //  3) Insere payment + outbox na MESMA transação.
  //  4) Se der violação de unicidade (corrida), o vencedor é devolvido.
  // ----------------------------------------------------------
  //
  // O FLUXO DE IDEMPOTÊNCIA em detalhes (é o coração deste método):
  //   • O cliente envia um cabeçalho `Idempotency-Key` junto da cobrança.
  //     Essa chave representa "este pedido de cobrança" de forma única.
  //   • Se a rede derrubar a resposta e o cliente repetir a requisição com a
  //     MESMA chave, chegamos aqui de novo. Em vez de cobrar uma segunda vez,
  //     devolvemos o pagamento já criado marcado como `replayed: true` —
  //     ou seja, "você já tinha me pedido isso; aqui está o resultado".
  //   • O gateway também é idempotente por essa mesma chave, então mesmo se
  //     a corrida acontecer com ele, ele não autoriza duas cobranças.
  //   • A constraint UNIQUE no banco (na coluna de idempotency_key) é a
  //     última linha de defesa para o caso de duas requisições em paralelo.
  async createCharge(input, idempotencyKey) {
    // Sem chave não há como garantir "não cobrar de novo", então recusamos.
    if (!idempotencyKey) throw new IdempotencyKeyRequiredError();

    // Passo 1 — caminho "feliz" do replay: a chave já existe, então devolvemos
    // o estado atual sem tocar no gateway nem no banco de escrita.
    const existing = await this.payments.findByKey(idempotencyKey);
    if (existing) return { payment: existing.toJSON(), replayed: true };

    // Normalização de valores em centavos na fronteira (ver domain/money.js).
    // `deliveryFeeCents || 0` cobre pedidos sem taxa de entrega (retirada).
    const productAmountCents = Money.assertNonNegative(input.productAmountCents);
    const deliveryFeeCents = Money.assertNonNegative(input.deliveryFeeCents || 0);
    const amountCents = productAmountCents + deliveryFeeCents;

    // Timeout de expiração: por padrão o da configuração; o cliente pode
    // pedir um específico (dev/demo). `0` = sem expiração automática.
    const requestTimeoutMs = input.timeoutMs === undefined || input.timeoutMs === null
      ? this.config.paymentTimeoutMs
      : input.timeoutMs;

    // Construímos o agregado. Repare que o `status` default do construtor já
    // é PENDENTE — a cobrança nasce aguardando pagamento. O `expiresAt` é
    // calculado aqui para que o próprio Payment conheça seu prazo de validade.
    const payment = new Payment({
      orderId: input.orderId,
      clientId: input.clientId,
      restaurantId: input.restaurantId,
      method: input.method,
      productAmountCents,
      deliveryFeeCents,
      amountCents,
      idempotencyKey,
      expiresAt: requestTimeoutMs > 0 ? new Date(Date.now() + requestTimeoutMs) : null,
    });

    // Passo 2 — autoriza no gateway ANTES de gravar no banco. Se o gateway
    // rejeitar (cartão inválido, por exemplo), o erro se propaga e nada é
    // persistido — não criamos cobrança fantasma. O gateway retorna um id
    // (`gatewayId`) que gravamos no Payment para futura conciliação.
    const gatewayTxn = await this.gateway.charge({
      idempotencyKey,
      amountCents,
      method: payment.method,
    });
    payment.gatewayId = gatewayTxn.gatewayId;

    // Passo 3 — gravação atômica. `withTransaction` garante que OU o payment
    // E o evento do outbox são gravados, OU nenhum deles. Isso é crucial:
    // não podemos ter um pagamento no banco sem o evento `PaymentCreated` na
    // fila (outro serviço ficaria sem saber que o pedido foi cobrado), nem o
    // contrário (evento apontando para cobrança inexistente). O outbox é o
    // padrão "transactional outbox": gravamos o evento na MESMA transação do
    // dado e um worker o publica depois — assim nunca perdemos um evento.
    try {
      await this.db.withTransaction(async (tx) => {
        await this.payments.insert(payment, tx);
        await this.outbox.insert(tx, 'PaymentCreated', {
          paymentId: payment.id,
          orderId: payment.orderId,
          amountCents: payment.amountCents,
          method: payment.method,
        });
      });
    } catch (error) {
      // Passo 4 — corrida de idempotência. Código '23505' é a violação de
      // UNIQUE do Postgres. Duas requisições com a mesma chave chegaram ao
      // mesmo tempo, ambas passaram pelo `findByKey` (nenhuma achou a outra)
      // e a constraint fez UMA perder. A perdedora não precisa refazer nada:
      // busca a vencedora e devolve, como se fosse um replay comum. O cliente
      // vê a mesma resposta nos dois casos — comportamento idempotente.
      if (error.code === '23505') {
        // Duas requisições com a mesma chave chegaram ao mesmo tempo:
        // a constraint UNIQUE fez esta perder. Devolvemos o vencedor.
        const winner = await this.payments.findByKey(idempotencyKey);
        if (winner) return { payment: winner.toJSON(), replayed: true };
      }
      throw error;
    }

    // Criado de verdade desta vez (não foi replay). `replayed: false` diz ao
    // chamador "isto é uma cobrança nova".
    return { payment: payment.toJSON(), replayed: false };
  }

  // ----------------------------------------------------------
  // Webhook do gateway (Pix/cartão aprovado) → PENDENTE → CONCLUIDO
  //  - Grava o split no ledger e emite PaymentConfirmed na mesma tx.
  //  - Webhook duplicado é idempotente (devolve o estado atual).
  // ----------------------------------------------------------
  //
  // PARA O JÚNIOR: webhooks do gateway podem chegar DUPLICADOS (o provedor
  // reenvia em caso de falha de rede, por exemplo). Por isso este método tem
  // que ser idempotente: se o pagamento já está CONCLUIDO, não confirmamos de
  // novo — só recalculamos o split e devolvemos o estado atual.
  async confirmPayment(paymentId, { gatewayId = null, reason = 'webhook: pagamento aprovado no gateway' } = {}) {
    const payment = await this.payments.findById(paymentId);
    if (!payment) throw new NotFoundError('Cobrança');

    // Guarda do replay: já está CONCLUIDO? Devolve como está. Se não tivéssemos
    // esta guarda, a transação abaixo tentaria atualizar o split e estouraria
    // na máquina de estados (ou criaria split duplicado no ledger).
    if (payment.isConcluded()) {
      const split = await this.ledger.findByPayment(paymentId);
      return { payment: payment.toJSON(), split, replayed: true };
    }
    // Se não está pendente nem concluído (falhou/estornado), não dá para
    // confirmar — deixa a própria máquina de estados lançar o erro.
    if (!payment.isPending()) {
      throw new InvalidTransitionError(payment.status, PAYMENT_STATUS.CONCLUIDO);
    }

    // Atualizamos o gatewayId se o webhook trouxer um (o id usado na
    // autorização pode ser o mesmo; se veio outro, prevalece o novo).
    payment.gatewayId = gatewayId || payment.gatewayId;
    // A mudança de estado em si. O agregado valida a transição e marca o
    // paidAt — é aqui que o pagamento "passa a existir como pago".
    payment.confirm(reason);

    // Só agora, com o pagamento confirmado, calculamos o split. Faz sentido:
    // cobrança não confirmada não gera repasse para restaurante/entregador.
    // O split decide quanto vai para cada parte (ver domain/split.js).
    const split = SplitCalculator.calculate({
      productAmountCents: payment.productAmountCents,
      deliveryFeeCents: payment.deliveryFeeCents,
      commissionRate: this.config.commissionRate,
      serviceFeeCents: this.config.serviceFeeCents,
    });

    // TRANSAÇÃO ATÔMICA: atualizar status + gravar split no ledger + emitir
    // evento, tudo ou nada. Repare que `updateStatus(payment, PENDENTE, tx)`
    // recebe o estado ANTERIOR (`PENDENTE`) como expectativa — o repositório
    // usa isso no WHERE com o `version` (locking otimista). Se outro processo
    // confirmou o mesmo pagamento primeiro, o UPDATE não afeta nenhuma linha
    // e o banco nos avisa; aí sabemos que perdemos a corrida.
    await this.db.withTransaction(async (tx) => {
      await this.payments.updateStatus(payment, PAYMENT_STATUS.PENDENTE, tx);
      await this.ledger.insert({ split, paymentId: payment.id, restaurantId: payment.restaurantId }, tx);
      await this.outbox.insert(tx, 'PaymentConfirmed', {
        paymentId: payment.id,
        orderId: payment.orderId,
        split,
      });
    });

    return { payment: payment.toJSON(), split, replayed: false };
  }

  // ----------------------------------------------------------
  // Timeout: cobrança PENDENTE sem confirmação no prazo → FALHOU
  // e evento OrderCancelRequested para o Pedidos Service cancelar.
  // ----------------------------------------------------------
  //
  // PARA O JÚNIOR: quem dispara este método? Provavelmente um job agendado
  // (ex.: a cada minuto, busca cobranças `hasExpired()` e chama isso) ou o
  // próprio handler de erro de timeout do gateway. O importante: ao expirar,
  // avisamos o Pedidos Service para cancelar o pedido — o cliente não deve
  // ficar esperando um lanche que nunca vai ser confirmado.
  async expirePayment(paymentId, reason = 'timeout: confirmação não recebida no prazo') {
    const payment = await this.payments.findById(paymentId);
    if (!payment) throw new NotFoundError('Cobrança');
    // Replay: se já está FALHOU (dois jobs rodaram em paralelo), devolvemos
    // sem refazer — o evento OrderCancelRequested não pode ser emitido 2x.
    if (payment.isFailed()) return { payment: payment.toJSON(), replayed: true };
    if (!payment.isPending()) {
      throw new InvalidTransitionError(payment.status, PAYMENT_STATUS.FALHOU);
    }

    payment.expire(reason);
    // Uma transação, três coisas: marcar FALHOU, emitir PaymentExpired e
    // emitir OrderCancelRequested. O segundo evento é uma "intenção" que o
    // Pedidos Service consome — note que o emitimos só quando a expiração é
    // de fato gravada (tudo ou nada), evitando cancelar pedido sem a cobrança
    // ter sido realmente marcada como falha.
    await this.db.withTransaction(async (tx) => {
      await this.payments.updateStatus(payment, PAYMENT_STATUS.PENDENTE, tx);
      await this.outbox.insert(tx, 'PaymentExpired', {
        paymentId: payment.id,
        orderId: payment.orderId,
        reason,
      });
      await this.outbox.insert(tx, 'OrderCancelRequested', {
        orderId: payment.orderId,
        reason,
      });
    });

    return { payment: payment.toJSON(), replayed: false };
  }

  // ----------------------------------------------------------
  // Estorno: apenas CONCLUIDO → ESTORNADO (máquina de estados).
  // ----------------------------------------------------------
  //
  // PARA O JÚNIOR: o estorno NÃO é um "voltar atrás" qualquer — só existe para
  // pagamento CONCLUIDO (dinheiro já recebido). Um pagamento FALHOU, por
  // exemplo, nunca foi pago, então não há o que devolver. O motivo pode vir
  // de um chargeback do cartão, de um pedido cancelado depois do pagamento,
  // de um erro operacional etc.
  async refundPayment(paymentId, reason = 'estorno solicitado') {
    const payment = await this.payments.findById(paymentId);
    if (!payment) throw new NotFoundError('Cobrança');
    if (!payment.isConcluded()) {
      throw new InvalidTransitionError(payment.status, PAYMENT_STATUS.ESTORNADO);
    }

    payment.refund(reason);
    // Transação única: marca ESTORNADO + emite PaymentRefunded. Aqui não há
    // escrita no ledger — no nosso modelo o repasse do restaurante continua
    // registrado; quem observa os valores é quem subtrai o estorno nos
    // relatórios (ver `estornoCents` no adminDashboard). Isso é uma escolha
    // de modelagem, vale comentar no ledger se um dia mudarmos.
    await this.db.withTransaction(async (tx) => {
      await this.payments.updateStatus(payment, PAYMENT_STATUS.CONCLUIDO, tx);
      await this.outbox.insert(tx, 'PaymentRefunded', {
        paymentId: payment.id,
        orderId: payment.orderId,
        reason,
      });
    });

    return { payment: payment.toJSON(), replayed: false };
  }
}

module.exports = { PaymentService };
