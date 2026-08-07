'use strict';

const crypto = require('crypto');
const { PAYMENT_STATUS } = require('./payment-status');
const { assertValidTransition } = require('./payment-status');

// ============================================================
//  Agregado Payment — Ciclo de vida do pagamento
// ============================================================
// Encapsula a máquina de estados (domain/payment-status.js).
// Toda mudança de status passa por métodos do agregado; o banco
// nunca é atualizado diretamente pelas camadas externas.
// ============================================================
//
// PARA O JÚNIOR: o que é um "agregado"?
// Pense no agregado como uma "caixa fechada" que representa um conceito do
// negócio (o pagamento) e que é DONA das regras sobre esse conceito. O resto
// do sistema conversa com o pagamento apenas através dos métodos públicos
// (confirm, expire, refund...) e nunca mexe nos campos por fora.
//
// Por que isso importa? Porque se cada controller saísse setando `payment.status`
// direto, uma regra do negócio (ex.: só pode estornar pagamento CONCLUIDO)
// viveria em vários lugares e alguém um dia ia esquecer dela. Centralizando,
// garantimos que QUALQUER mudança de status passa pela validação da máquina
// de estados — é impossível chegar num estado inválido.
//
// Repare também que este agregado é "rico", ou seja, ele guarda comportamento
// (métodos que mudam o estado) e não só dados. Isso é o coração do DDD:
// comportamento e dados do mesmo conceito moram juntos.
class Payment {
  constructor({
    id,
    orderId,
    clientId,
    restaurantId,
    method,
    productAmountCents,
    deliveryFeeCents,
    amountCents,
    status = PAYMENT_STATUS.PENDENTE,
    idempotencyKey,
    gatewayId = null,
    createdAt = new Date(),
    expiresAt = null,
    paidAt = null,
    expiredAt = null,
    refundedAt = null,
    reason = null,
    version = 1,
  }) {
    // Campos de identificação e de contexto do pedido. `orderId` liga o
    // pagamento ao pedido correspondente no outro microsserviço (não temos
    // FK aqui de propósito: cada serviço cuida do próprio banco).
    this.id = id || crypto.randomUUID();
    this.orderId = orderId;
    this.clientId = clientId;
    this.restaurantId = restaurantId;
    this.method = method;
    // Valores SEMPRE em centavos inteiros — ver domain/money.js. Não se
    // assuste com a divisão em "produtos" e "entrega": o SplitCalculator
    // (domain/split.js) precisa separá-los para calcular a comissão certa.
    this.productAmountCents = productAmountCents;
    this.deliveryFeeCents = deliveryFeeCents;
    this.amountCents = amountCents;
    // Estado atual. NUNCA setar direto: use os métodos abaixo (confirm,
    // expire, refund), que validam a transição antes.
    this.status = status;
    // Chave de idempotência: o mesmo pagamento pode chegar aqui por requisição
    // duplicada (retry de rede, usuário clicando duas vezes) e a chave garante
    // que só uma cobrança real aconteça. Ver payment-service.createCharge.
    this.idempotencyKey = idempotencyKey;
    // Id do pagamento no gateway externo (Stripe/PagSeguro e cia), para
    // conciliação e consulta de status no provedor.
    this.gatewayId = gatewayId;
    this.createdAt = createdAt;
    // Prazo para o cliente pagar. Quando vence e segue PENDENTE, o serviço
    // manda expirar. `null` = sem expiração automática.
    this.expiresAt = expiresAt;
    // Timestamps que marcam O QUÊ aconteceu, para auditoria e para o comprovante.
    // Ex.: num estorno, `paidAt` continua guardando quando pagou e `refundedAt`
    // guarda quando devolvemos — nenhuma informação se perde.
    this.paidAt = paidAt;
    this.expiredAt = expiredAt;
    this.refundedAt = refundedAt;
    // Motivo da última transição (ex.: "webhook: pagamento aprovado" ou
    // "chargeback do cartão"). Ajuda demais na hora de investigar um caso
    // e alimenta o relatório de chargebacks do admin.
    this.reason = reason;
    // Versionamento otimista: toda atualização confere o `version` e o
    // incrementa (ver repositório). Se dois processos lerem a versão 3 e
    // os dois tentarem gravar, o banco rejeita o segundo. Isso evita corridas
    // tipo "webhook duplicado confirmando duas vezes".
    this.version = version;
  }

  // Métodos de estado: predicados que respondem "em que fase o pagamento está?".
  // Leia-os como perguntas: isPending() → "o pagamento ainda está pendente?".
  // Eles existem porque comparar `status === 'CONCLUIDO'` espalhado pelo código
  // quebraria fácil se um dia renomearmos um estado — aqui centralizamos tudo.
  isPending() {
    return this.status === PAYMENT_STATUS.PENDENTE;
  }

  isConcluded() {
    return this.status === PAYMENT_STATUS.CONCLUIDO;
  }

  isFailed() {
    return this.status === PAYMENT_STATUS.FALHOU;
  }

  hasExpired(now = new Date()) {
    // Só faz sentido expirar cobrança ainda PENDENTE (a guarda `isPending()`
    // evita "expirar" um pagamento já pago, o que seria um bug financeiro).
    return this.isPending() && this.expiresAt && now >= this.expiresAt;
  }

  confirm(reason = 'webhook: pagamento aprovado no gateway') {
    // Transição PENDENTE → CONCLUIDO. Se o estado atual não permitir (ex.:
    // tentar confirmar algo já estornado), `assertValidTransition` lança erro
    // e nenhum campo muda — o objeto fica íntegro.
    assertValidTransition(this.status, PAYMENT_STATUS.CONCLUIDO);
    this.status = PAYMENT_STATUS.CONCLUIDO;
    this.paidAt = new Date();
    this.reason = reason;
    // Retornamos `this` (fluent): permite encadear como `payment.confirm().toJSON()`.
    return this;
  }

  expire(reason = 'timeout: confirmação não recebida no prazo') {
    // Transição PENDENTE → FALHOU (pagamento venceu sem confirmação).
    assertValidTransition(this.status, PAYMENT_STATUS.FALHOU);
    this.status = PAYMENT_STATUS.FALHOU;
    this.expiredAt = new Date();
    this.reason = reason;
    return this;
  }

  refund(reason = 'estorno solicitado') {
    // Transição CONCLUIDO → ESTORNADO (devolução de dinheiro). Repare que o
    // pagamento NUNCA "volta" para PENDENTE: depois de estornado, ele é
    // terminal — não existe "desfazer o estorno" na nossa máquina de estados.
    assertValidTransition(this.status, PAYMENT_STATUS.ESTORNADO);
    this.status = PAYMENT_STATUS.ESTORNADO;
    this.refundedAt = new Date();
    this.reason = reason;
    return this;
  }

  toJSON() {
    // Projeção de leitura: é isso que vai para a resposta da API / comprovante.
    // Repare que é um objeto NOVO (não expõe o agregado), então o chamador não
    // consegue alterar o estado do pagamento de fora mexendo na resposta.
    return {
      id: this.id,
      orderId: this.orderId,
      clientId: this.clientId,
      restaurantId: this.restaurantId,
      method: this.method,
      productAmountCents: this.productAmountCents,
      deliveryFeeCents: this.deliveryFeeCents,
      amountCents: this.amountCents,
      status: this.status,
      idempotencyKey: this.idempotencyKey,
      gatewayId: this.gatewayId,
      createdAt: this.createdAt,
      expiresAt: this.expiresAt,
      paidAt: this.paidAt,
      expiredAt: this.expiredAt,
      refundedAt: this.refundedAt,
      reason: this.reason,
      version: this.version,
    };
  }
}

module.exports = { Payment };
