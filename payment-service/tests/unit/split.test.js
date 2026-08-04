'use strict';

const { SplitCalculator } = require('../../src/domain/split');

describe('SplitCalculator (motor de divisão de valores)', () => {
  test('divide corretamente com comissão de 12% e taxa de serviço', () => {
    const split = SplitCalculator.calculate({
      productAmountCents: 10000, // R$ 100,00
      deliveryFeeCents: 500,     // R$ 5,00
      commissionRate: 0.12,
      serviceFeeCents: 150,      // R$ 1,50
    });
    expect(split.grossCents).toBe(10500);
    expect(split.commissionCents).toBe(1200);
    expect(split.platformCents).toBe(1350);
    expect(split.courierCents).toBe(500);
    expect(split.restaurantCents).toBe(8650);
  });

  test('invariante: restaurante + plataforma + entregador === bruto', () => {
    const cases = [
      { p: 10000, d: 0 },
      { p: 123456, d: 999 },
      { p: 8990, d: 690 },
      { p: 5000, d: 5000 },
      { p: 200, d: 3 },
    ];
    for (const { p, d } of cases) {
      const split = SplitCalculator.calculate({
        productAmountCents: p,
        deliveryFeeCents: d,
        commissionRate: 0.12,
        serviceFeeCents: 150,
      });
      expect(split.restaurantCents + split.platformCents + split.courierCents).toBe(split.grossCents);
    }
  });

  test('comissão é arredondada em centavos (sem perda)', () => {
    const split = SplitCalculator.calculate({
      productAmountCents: 3333,
      deliveryFeeCents: 0,
      commissionRate: 0.12,
      serviceFeeCents: 150,
    });
    // 3333 * 0.12 = 399.96 → 400
    expect(split.commissionCents).toBe(400);
  });

  test('lança erro quando a taxa torna o repasse do restaurante negativo', () => {
    expect(() =>
      SplitCalculator.calculate({
        productAmountCents: 10000,
        deliveryFeeCents: 0,
        commissionRate: 1,
        serviceFeeCents: 100,
      })
    ).toThrow();
  });

  test('lança erro para taxa fora do intervalo [0,1] e valores negativos', () => {
    expect(() =>
      SplitCalculator.calculate({ productAmountCents: 100, deliveryFeeCents: 0, commissionRate: 1.5, serviceFeeCents: 0 })
    ).toThrow();
    expect(() =>
      SplitCalculator.calculate({ productAmountCents: -1, deliveryFeeCents: 0, commissionRate: 0.1, serviceFeeCents: 0 })
    ).toThrow();
  });

  test('entrega grátis: entregador recebe 0 e o bruto vai para restaurante + plataforma', () => {
    const split = SplitCalculator.calculate({
      productAmountCents: 10000,
      deliveryFeeCents: 0,
      commissionRate: 0.1,
      serviceFeeCents: 0,
    });
    expect(split.courierCents).toBe(0);
    expect(split.restaurantCents).toBe(9000);
    expect(split.platformCents).toBe(1000);
  });
});
