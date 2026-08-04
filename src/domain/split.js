'use strict';

const { Money } = require('./money');

// ============================================================
//  Motor de Divisão de Valores (Split Payment)
// ============================================================
// Regra de negócio (enunciado, Microsserviço 4):
//
//   bruto       = valorProdutos + taxaEntrega
//   comissao    = valorProdutos × taxaComissao          → plataforma
//   plataforma  = comissao + taxaServico                → plataforma
//   entregador  = taxaEntrega                           → entregador
//   restaurante = bruto − plataforma − entregador       → restaurante
//
// Invariante garantida (e testada): as três partes SOMAM exatamente
// o valor bruto, em centavos inteiros. Nenhuma divisão pode "perder"
// ou "criar" dinheiro no ledger.
// ============================================================
//
// EXEMPLO REAL para entender a conta:
// Pedido de R$ 100,00 em produtos + R$ 10,00 de entrega, comissão de 15%
// e taxa de serviço fixa de R$ 2,00:
//
//   bruto       = 10000 + 1000              = 11000 centavos (R$ 110,00)
//   comissao    = 10000 × 0,15              =  1500 (R$ 15,00)
//   plataforma  = 1500 + 200                =  1700 (R$ 17,00)
//   entregador  = 1000                      =  1000 (R$ 10,00)
//   restaurante = 11000 − 1700 − 1000       =  8300 (R$ 83,00)
//
//   Confere: 1700 + 1000 + 8300 = 11000 ✓ (nada sobra, nada falta)
//
// Repare no papel do "restaurante = bruto − o resto": ele é o valor que sobra
// por construção, ou seja, a invariante da soma NUNCA pode falhar por causa
// de arredondamento. O `Math.round` na comissão (que multiplica por um %,
// e isso sim pode gerar quebrado) é onde o centavo se perderia — por isso o
// restaurante absorve qualquer diferença de 1 centavo. Esperto e justo.
//
// POR QUE O CÁLCULO É EM CENTAVOS? Porque comissão é percentual (ex.: 15% de
// R$ 33,33 = R$ 4,9995). Em float isso viraria um número quebrado impossível
// de guardar com exatidão. Multiplicando centavos e arredondando para inteiro,
// garantimos que o ledger só conhece valores exatos.
class SplitCalculator {
  static calculate({ productAmountCents, deliveryFeeCents, commissionRate, serviceFeeCents }) {
    // Validação de entrada na fronteira: rejeitamos cedo valores inválidos
    // (negativos ou não inteiros) para não propagar lixo para dentro da conta.
    const products = Money.assertNonNegative(productAmountCents);
    const delivery = Money.assertNonNegative(deliveryFeeCents);
    const service = Money.assertNonNegative(serviceFeeCents);

    // Comissão é percentual entre 0 e 1 (0.15 = 15%). Fora dessa faixa é
    // erro de configuração — melhor quebrar na hora do que cobrar comissão
    // negativa (plataforma devolvendo dinheiro?) ou acima de 100% (restaurante
    // sempre "no prejuízo").
    if (typeof commissionRate !== 'number' || commissionRate < 0 || commissionRate > 1) {
      throw new Error(`Taxa de comissão inválida: ${commissionRate}`);
    }

    const gross = products + delivery;
    const commission = Math.round(products * commissionRate);
    const platform = commission + service;
    const courier = delivery;
    // O restaurante recebe o que sobra. É o "ajuste final" que fecha a conta.
    const restaurant = gross - platform - courier;

    // Guarda de sanidade: se comissão + taxas juntas ultrapassarem o bruto,
    // o restaurante ficaria "devendo" (negativo). Isso nunca deveria ocorrer,
    // mas se a config de comissão mudar para um valor abusivo, queremos saber
    // agora — não quando o restaurante reclamar do repasse.
    if (restaurant < 0) {
      throw new Error('Split inválido: comissão + taxas excedem o valor bruto cobrado.');
    }

    // Confere a invariante de ponta a ponta, mesmo sabendo que por construção
    // ela deveria valer. É uma "apólice de seguro" contra regressões futuras:
    // se alguém mexer na fórmula, o teste quebra na hora. Incluir no
    // agregado é o mesmo princípio do teste unitário, mas vivo em produção.
    if (restaurant + courier + platform !== gross) {
      throw new Error('Split inválido: a soma das partes difere do valor bruto (invariante quebrada).');
    }

    return {
      grossCents: gross,
      productAmountCents: products,
      deliveryFeeCents: delivery,
      commissionCents: commission,
      serviceFeeCents: service,
      platformCents: platform,
      courierCents: courier,
      restaurantCents: restaurant,
    };
  }
}

module.exports = { SplitCalculator };
