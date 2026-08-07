'use strict';

const { InvalidTransitionError } = require('./payment-errors');

// Máquina de estados do pagamento (estrita e unidirecional):
//   PENDENTE → CONCLUIDO | FALHOU
//   CONCLUIDO → ESTORNADO
//   FALHOU / ESTORNADO → (terminal)
//
// PARA O JÚNIOR: pense nisso como as regras de um semáforo — o sinal só pode
// seguir caminhos permitidos, e "pular" de vermelho direto para apagado é
// proibido. Aqui o fluxo de vida de um pagamento é:
//
//   1. Cobrança criada → PENDENTE (aguardando pagamento do cliente)
//   2. Gateway confirma → CONCLUIDO (dinheiro chegou)
//   3. Tempo esgotou   → FALHOU (terminal: não dá mais para pagar)
//   4. Estorno/chargeback → ESTORNADO (só a partir de CONCLUIDO)
//
// Repare que NÃO existe caminho de volta: FALHOU não vira CONCLUIDO e
// ESTORNADO não volta a CONCLUIDO. Isso é de propósito — estados financeiros
// são irreversíveis, e permitir "voltas" abriria brecha para inconsistência
// no ledger (dinheiro que some ou aparece do nada).
const PAYMENT_STATUS = {
  PENDENTE: 'PENDENTE',
  CONCLUIDO: 'CONCLUIDO',
  FALHOU: 'FALHOU',
  ESTORNADO: 'ESTORNADO',
};

// Tabela de transições permitidas. O uso de `Set` deixa a consulta O(1) e o
// código bem legível: para cada estado de ORIGEM, o Set diz quais estados de
// DESTINO são válidos. `new Set()` vazio = estado terminal.
const ALLOWED_TRANSITIONS = {
  PENDENTE: new Set([PAYMENT_STATUS.CONCLUIDO, PAYMENT_STATUS.FALHOU]),
  CONCLUIDO: new Set([PAYMENT_STATUS.ESTORNADO]),
  FALHOU: new Set(),
  ESTORNADO: new Set(),
};

// Rótulos legíveis para humanos, usados em relatórios/notificações.
// Não confundir com o valor cru do status (ex.: 'PENDENTE' → 'Pendente').
const STATUS_LABEL = {
  PENDENTE: 'Pendente',
  CONCLUIDO: 'Concluído',
  FALHOU: 'Falhou',
  ESTORNADO: 'Estornado',
};

// Lança erro de domínio caso a transição viole a máquina de estados.
// É a ÚNICA porta de entrada para mudanças de status (as rotas e
// repositórios nunca fazem UPDATE direto de status no banco).
//
// Ou seja: se qualquer parte do sistema tentar mover um pagamento de
// PENDENTE para ESTORNADO (pular direto), aqui estoura um
// InvalidTransitionError com HTTP 409 (conflito). O 409 não é acidente:
// semanticamente é "o recurso está num estado que não permite essa ação",
// exatamente o que o HTTP define para conflitos de estado.
function assertValidTransition(from, to) {
  const allowed = ALLOWED_TRANSITIONS[from];
  // `!allowed` cobre estado desconhecido (bug de digitação de status) e
  // `!allowed.has(to)` cobre a transição proibida em si.
  if (!allowed || !allowed.has(to)) {
    throw new InvalidTransitionError(from, to);
  }
  return true;
}

module.exports = { PAYMENT_STATUS, ALLOWED_TRANSITIONS, STATUS_LABEL, assertValidTransition };
