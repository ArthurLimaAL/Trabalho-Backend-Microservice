'use strict';

// Dinheiro é SEMPRE tratado em centavos (inteiros).
// Motivo: evitar erros de ponto flutuante típicos de Double/Float
// em sistemas financeiros (ex.: 0.1 + 0.2 !== 0.3).
//
// Ou seja: neste projeto nunca guardamos nem somamos "reais com vírgula".
// R$ 12,90 é sempre o inteiro 1290. Toda conversão de/para reais acontece
// aqui, neste único lugar — assim não existe risco de cada parte do sistema
// interpretar a moeda de um jeito diferente e o total divergir por centavos.
//
// Repare que `fromDecimal` faz o arredondamento com Math.round. Preferimos
// "arredondar para o centavo mais próximo" em vez de truncar, o que evita
// perda de centavos quando o cliente manda um valor com mais de duas casas
// decimais (ex.: 10.005 vira 1001 em vez de 1000).
const Money = {
  fromDecimal(value) {
    if (typeof value === 'number') {
      return Math.round(value * 100);
    }
    if (typeof value === 'string') {
      let normalized = value.replace(/R\$\s?/i, '').trim();
      // Formato BR (ex.: "1.234,56"): ponto = milhar, vírgula = decimal.
      // Formato decimal (ex.: "10.50"): ponto = decimal.
      //
      // Heurística simples mas prática: se tem vírgula, assumimos que veio
      // no formato brasileiro e trocamos os pontos de milhar por nada e a
      // vírgula decimal por ponto, deixando o texto pronto para o `Number()`.
      // Isso cobre o caso típico de um usuário digitando "R$ 1.234,56".
      if (normalized.includes(',')) {
        normalized = normalized.replace(/\./g, '').replace(',', '.');
      }
      const number = Number(normalized);
      // Guarda de segurança: string que não virou número (ou virou negativo)
      // jamais pode virar uma cobrança — melhor quebrar cedo do que criar um
      // pagamento com valor absurdo no banco.
      if (Number.isNaN(number) || number < 0) {
        throw new Error(`Valor monetário inválido: ${value}`);
      }
      return Math.round(number * 100);
    }
    // Tipo não suportado (objeto, array, undefined...). Lançamos erro para
    // que o chamador perceba o problema na hora, em vez de receber `NaN`
    // silenciosamente lá na frente.
    throw new Error(`Valor monetário inválido: ${value}`);
  },

  toDecimal(cents) {
    // O inverso do `fromDecimal`: converte centavos de volta em reais.
    // Usado, por exemplo, quando vamos exibir algo em um relatório ou enviar
    // um valor "legível" para o gateway que trabalha com decimal.
    if (!Number.isInteger(cents)) throw new Error(`Centavos devem ser inteiros: ${cents}`);
    return cents / 100;
  },

  toBRL(cents) {
    // Formatação amigável para exibição: "R$ 12,90". Como o `toLocaleString`
    // já cuida do símbolo e da vírgula, não precisamos concatenar nada na mão
    // (e, claro, nunca confiamos em strings no resto do código — isso aqui é
    // só fachada para a UI/reports).
    return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  },

  assertNonNegative(cents) {
    // Validação de fronteira: qualquer valor que entra no domínio deve ser um
    // inteiro >= 0 (ninguém paga "menos 5 reais"). Como o sistema financeiro
    // inteiro assume essa premissa, validamos num único ponto e confiamos nela
    // em todo o resto — validação em uma única porta de entrada é muito mais
    // fácil de manter do que espalhada por cada caso de uso.
    if (!Number.isInteger(cents) || cents < 0) {
      throw new Error(`Valor inválido em centavos (esperado inteiro >= 0): ${cents}`);
    }
    return cents;
  },
};

module.exports = { Money };
