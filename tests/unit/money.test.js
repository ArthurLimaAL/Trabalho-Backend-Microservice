'use strict';

const { Money } = require('../../src/domain/money');

describe('Money (centavos inteiros)', () => {
  test('fromDecimal converte string decimal para centavos', () => {
    expect(Money.fromDecimal('10.50')).toBe(1050);
    expect(Money.fromDecimal('0.01')).toBe(1);
  });

  test('fromDecimal aceita número e formato BR', () => {
    expect(Money.fromDecimal(10.5)).toBe(1050);
    expect(Money.fromDecimal('R$ 1.234,56')).toBe(123456);
    expect(Money.fromDecimal('R$ 10,50')).toBe(1050);
  });

  test('fromDecimal rejeita valores inválidos', () => {
    expect(() => Money.fromDecimal('abc')).toThrow();
    expect(() => Money.fromDecimal('-5')).toThrow();
  });

  test('toDecimal e toBRL produzem saídas corretas', () => {
    expect(Money.toDecimal(1050)).toBe(10.5);
    expect(Money.toBRL(1050)).toContain('10,50');
    expect(Money.toBRL(123456)).toContain('1.234,56');
  });

  test('assertNonNegative aceita inteiros >= 0 e rejeita demais', () => {
    expect(Money.assertNonNegative(0)).toBe(0);
    expect(Money.assertNonNegative(150)).toBe(150);
    expect(() => Money.assertNonNegative(-1)).toThrow();
    expect(() => Money.assertNonNegative(1.5)).toThrow();
    expect(() => Money.assertNonNegative('10')).toThrow();
  });
});
