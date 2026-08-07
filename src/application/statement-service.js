'use strict';

const { NotFoundError } = require('../domain/payment-errors');

// ============================================================
//  Visões e Extratos Financeiros (queries de leitura)
// ============================================================
// Requisito 4 do enunciado:
//   • Histórico do Cliente (cobranças + comprovantes)
//   • Painel financeiro do Restaurante (split por pedido, repasses)
//   • Visão consolidada do Administrador (GMV, receita, chargebacks)
// ============================================================
//
// PARA O JÚNIOR: diferente do payment-service.js (que ESCREVE e muda estado),
// este serviço é o "lado de leitura" (read side): ele NUNCA altera nada, só
// consulta e monta respostas. Por isso não usa transações nem eventos.
//
// Uma boa intuição: enquanto o payment-service é o "caixa" que registra as
// movimentações, este é o "relatório" que a contabilidade e os clientes
// consultam. Ambos leem o mesmo banco, mas com responsabilidades opostas.
//
// Repare também no padrão comum de "enriquecer": buscamos a lista de
// pagamentos e, para cada um, buscamos o split no ledger. Poderíamos fazer
// um JOIN na mão no SQL, mas como o repositório já expõe `findByPayment`,
// montamos o resultado no código — simples e reutilizável.
class StatementService {
  constructor({ payments, ledger, payouts }) {
    this.payments = payments;
    this.ledger = ledger;
    this.payouts = payouts;
  }

  // GET /payments (cliente) — histórico com comprovante + split
  //
  // PARA O JÚNIOR: repare na chamada `listByClient` — ela já recebe os filtros
  // `status` e `method` (ambos opcionais), então a responsabilidade de
  // montar o WHERE fica no repositório, não aqui. Aqui só orquestramos.
  async clientStatement(clientId, { status, method } = {}) {
    const list = await this.payments.listByClient(clientId, { status, method });
    const result = [];
    // O loop é N+1 (uma query de split por pagamento), mas é aceitável para
    // o volume de um extrato individual. Se um dia ficar lento, trocamos por
    // um JOIN em batch — a estrutura do resultado não mudaria.
    for (const payment of list) {
      const split = await this.ledger.findByPayment(payment.id);
      // Espalhamos o split junto ao payment no mesmo objeto: o comprovante
      // do cliente já vem completo, sem precisar de segunda requisição.
      result.push({ ...payment.toJSON(), split });
    }
    return result;
  }

  // GET /payments/:id — comprovante completo (dono ou admin)
  //
  // PARA O JÚNIOR: o "comprovante" de um pagamento. Usado tanto pelo cliente
  // (ver seu próprio pagamento) quanto pelo admin. A checagem de quem tem
  // permissão acontece na CAMADA HTTP (middleware), não aqui — este serviço
  // só entrega o dado; a autorização é responsabilidade de outra camada.
  async getWithSplit(id) {
    const payment = await this.payments.findById(id);
    if (!payment) throw new NotFoundError('Cobrança');
    const split = await this.ledger.findByPayment(payment.id);
    return { ...payment.toJSON(), split };
  }

  // GET /restaurants/:id/dashboard — resumo por período
  //
  // PARA O JÚNIOR: note como o SQL pesado mora no repositório (`sumsByRestaurant`
  // faz os SUM/COUNT com GROUP BY no Postgres) e aqui só remapeamos os campos
  // para nomes mais amigáveis (snake_case do banco → camelCase da API).
  // `from`/`to` podem ser `null` (sem filtro de período) — então devolvemos
  // null também na resposta, para o front saber que o período é "todo".
  async restaurantDashboard(restaurantId, from, to) {
    const sums = await this.ledger.sumsByRestaurant(restaurantId, from, to);
    return {
      restaurantId,
      from: from || null,
      to: to || null,
      quantidade: sums.quantidade,
      brutoCents: sums.bruto_cents,
      repasseCents: sums.repasse_cents,
      comissaoCents: sums.comissao_cents,
      servicoCents: sums.servico_cents,
      entregadorCents: sums.entregador_cents,
      plataformaCents: sums.plataforma_cents,
    };
  }

  // GET /restaurants/:id/splits — detalhe do split por pedido
  //
  // PARA O JÚNIOR: a "discriminação" de cada pedido — quanto do bruto foi para
  // a plataforma, quanto para o entregador e quanto ficou com o restaurante,
  // pedido por pedido. Mesma estrutura do clientStatement, mas agora filtrada
  // por restaurante. É o relatório que o dono do restaurante olha para conferir
  // se "bateu" com o que ele esperava receber.
  async restaurantSplits(restaurantId) {
    const list = await this.payments.listByRestaurant(restaurantId);
    const result = [];
    for (const payment of list) {
      const split = await this.ledger.findByPayment(payment.id);
      result.push({ ...payment.toJSON(), split });
    }
    return result;
  }

  // GET /restaurants/:id/payouts — repasses semanais/mensais
  //
  // PARA O JÚNIOR: os "repasses" são as transferências reais para o restaurante
  // (o dinheiro de fato saindo da plataforma). Diferente do split (que é a
  // matemática de quanto cada um TEM direito), o payout é a liquidação em si.
  // Aqui só repassamos o que o repositório de payouts já calcula.
  async restaurantPayouts(restaurantId) {
    return this.payouts.listByRestaurant(restaurantId);
  }

  // GET /admin/dashboard — relatório consolidado do ecossistema
  //
  // PARA O JÚNIOR: a visão de quem manda na plataforma (GMV = volume total de
  // vendas, receita líquida da plataforma, chargebacks etc.).
  //
  // Repare no `Promise.all`: as três consultas são INDEPENDENTES (não dependem
  // uma da outra), então rodamos em paralelo em vez de sequencial — economia
  // de latência. Se uma falhar, o Promise.all rejeita como um todo e vira um
  // erro 500 no handler; não faz sentido devolver um relatório pela metade.
  async adminDashboard() {
    const [ledgerSums, allPayments, pendenteRepasseCents] = await Promise.all([
      this.ledger.globalSums(),
      this.payments.listAll(),
      this.payouts.sumPending(),
    ]);

    // Chargeback detection: pegamos as cobranças estornadas e contamos quantas
    // têm "chargeback" no motivo. Heurística simples, mas suficiente para o
    // relatório. Os pagamentos FALHOU não entram aqui: se nunca foram pagos,
    // não há o que "estornar de volta".
    const estornadas = allPayments.filter((p) => p.status === 'ESTORNADO');
    const chargebacks = estornadas.filter((p) => (p.reason || '').toLowerCase().includes('chargeback')).length;

    return {
      gmvCents: ledgerSums.gmv_cents,
      receitaLiquidaCents: ledgerSums.receita_liquida_cents,
      entregadorCents: ledgerSums.entregador_cents,
      // Valor ainda NÃO transferido aos restaurantes (payouts pendentes).
      // Importante para controle de caixa: o que já está comprometido mas
      // ainda não saiu da conta.
      pendenteRepasseCents,
      // Soma dos valores estornados. Note que somamos do objeto Payment
      // (`amountCents`), não do ledger — o ledger não registra o estorno em
      // si (ver refundPayment), então este cálculo compensa isso no relatório.
      estornoCents: estornadas.reduce((sum, p) => sum + p.amountCents, 0),
      chargebacks,
      pagamentosConcluidos: allPayments.filter((p) => p.isConcluded()).length,
      totalCobrancas: allPayments.length,
    };
  }

  // GET /admin/monthly — série mensal (GMV e receita da plataforma)
  //
  // PARA O JÚNIOR: a série temporal para o gráfico de barras do admin. A chave
  // do Map é "YYYY-MM" (ex.: "2026-07"), o que ordena corretamente ao fazer
  // `localeCompare` no fim (ordem lexicográfica = ordem cronológica aqui).
  // Para cada mês acumulamos GMV e receita da plataforma (platformCents).
  async adminMonthlySeries() {
    const allPayments = await this.payments.listAll();
    const months = new Map();
    for (const payment of allPayments) {
      // Só entram pagamentos CONCLUIDOS na série: GMV é o que FOI de fato
      // cobrado, e FALHOU nunca gerou receita para ninguém.
      if (!payment.isConcluded()) continue;
      // Usamos o paidAt (quando pagou) para agrupar no mês correto; se por
      // algum motivo não houver (dado antigo), cai no createdAt como fallback.
      const date = payment.paidAt || payment.createdAt;
      const key = date.toISOString().slice(0, 7); // YYYY-MM
      if (!months.has(key)) months.set(key, { mes: key, gmvCents: 0, receitaCents: 0 });
      const row = months.get(key);
      row.gmvCents += payment.amountCents;
      // Receita da plataforma = o split (platformCents). Se o split não
      // existir (consistência de dados), tratamos como 0 em vez de estourar.
      const split = await this.ledger.findByPayment(payment.id);
      row.receitaCents += split ? split.platformCents : 0;
    }
    return [...months.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, v]) => v);
  }

  // GET /admin/reconciliation — conciliação com o gateway
  //
  // PARA O JÚNIOR: a "conferência do caixa" — lista todos os pagamentos com
  // o `gatewayId` para comparar com o que o provedor diz que processou. É a
  // ferramenta do time financeiro para achar divergências tipo "cobramos mas
  // o gateway não registrou" ou o contrário. Nada é agregado aqui: a ideia é
  // justamente expor a linha a linha para bater contra o extrato do gateway.
  async adminReconciliation() {
    const allPayments = await this.payments.listAll();
    return allPayments.map((payment) => ({
      paymentId: payment.id,
      orderId: payment.orderId,
      gatewayId: payment.gatewayId,
      amountCents: payment.amountCents,
      status: payment.status,
    }));
  }
}

module.exports = { StatementService };
