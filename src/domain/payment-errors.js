'use strict';

// Erros de domínio com código e status HTTP associado,
// mapeados pelo error-handler para respostas JSON consistentes.
//
// PARA O JÚNIOR: porque criar erros próprios em vez de `new Error(...)`?
// Três motivos práticos:
//   1. Cada erro carrega um `code` estável (ex.: 'NOT_FOUND') que o front
//      consegue interpretar sem depender de texto de mensagem.
//   2. O `statusCode` já vem embutido, então o error-handler só precisa
//      ler o campo e montar a resposta HTTP — sem um monte de `if` solto.
//   3. Conseguimos diferenciar no catch (ex.: `error instanceof NotFoundError`)
//      sem checar string solta, o que quebraria fácil numa tradução.
//
// Tudo herda de `DomainError`, então o handler trata num único lugar e o
// que não for `DomainError` é tratado como erro inesperado (500) — isso
// separa "erro esperado do negócio" de "bug".
class DomainError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

class InvalidTransitionError extends DomainError {
  // Transição proibida pela máquina de estados (domain/payment-status.js).
  // Usa 409 (Conflict) porque semanticamente é isso mesmo: o recurso existe,
  // mas o estado atual dele não permite a operação pedida. Ex.: tentar
  // confirmar um pagamento já estornado.
  constructor(from, to) {
    super(
      'INVALID_TRANSITION',
      `Transição de status inválida: ${from} -> ${to}. A máquina de estados é estrita e unidirecional.`,
      409
    );
  }
}

class IdempotencyKeyRequiredError extends DomainError {
  // Toda cobrança é idempotente (ver payment-service.createCharge). Sem a
  // chave não conseguimos garantir "não cobrar duas vezes" num retry, então
  // recusamos antes mesmo de consultar o banco. 422 = Unprocessable Entity:
  // o pedido está bem formado, mas falta uma informação obrigatória.
  constructor() {
    super(
      'IDEMPOTENCY_KEY_REQUIRED',
      'O cabeçalho Idempotency-Key é obrigatório em requisições de cobrança.',
      422
    );
  }
}

class NotFoundError extends DomainError {
  // Recurso não existe (ex.: cobrança com id inexistente). 404 = clássico.
  // O parâmetro `resource` permite mensagem contextualizada tipo
  // "Cobrança não encontrado." sem precisar de subclasses por recurso.
  constructor(resource = 'Recurso') {
    super('NOT_FOUND', `${resource} não encontrado.`, 404);
  }
}

class ForbiddenError extends DomainError {
  // 403: autenticado, mas sem permissão para aquela ação. Ex.: restaurante
  // tentando ver o extrato de outro restaurante.
  constructor(message = 'Acesso negado.') {
    super('FORBIDDEN', message, 403);
  }
}

class UnauthorizedError extends DomainError {
  // 401: não autenticado (token ausente/vencido). Diferença sutil do 403:
  // aqui "quem é você?" não foi respondido; no 403 a identidade até existe,
  // mas não autoriza aquilo.
  constructor() {
    super('UNAUTHORIZED', 'Token JWT ausente ou inválido.', 401);
  }
}

class GatewayTimeoutError extends DomainError {
  // Cobrança ficou PENDENTE além do prazo e o gateway nunca confirmou.
  // 408 (Request Timeout) é bem expressivo: "o tempo esperando esgotou".
  // É a exceção que dispara o fluxo de expiração → evento OrderCancelRequested.
  constructor() {
    super('GATEWAY_TIMEOUT', 'Confirmação de pagamento não recebida no prazo; transação expirada.', 408);
  }
}

module.exports = {
  DomainError,
  InvalidTransitionError,
  IdempotencyKeyRequiredError,
  NotFoundError,
  ForbiddenError,
  UnauthorizedError,
  GatewayTimeoutError,
};
