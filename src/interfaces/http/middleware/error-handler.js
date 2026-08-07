'use strict';

const { DomainError } = require('../../../domain/payment-errors');

// Traduz erros de domínio e inesperados em respostas JSON consistentes.
//
// TODA resposta de erro sai com o mesmo shape: { error: { code, message } }.
// Isso é um contrato de API: o frontend consegue tratar erros de forma
// uniforme (ex.: mapear `code` para i18n) sem depender de texto solto.
// eslint-disable-next-line no-unused-vars
function errorHandler(error, _req, res, _next) {
  // Erros de domínio já carregam statusCode e code (ex.: PaymentNotFound
  // → 404, PaymentNotRefundable → 409). Aqui só "empacotamos" no JSON.
  // O `instanceof` funciona porque todos estendem a mesma base DomainError.
  if (error instanceof DomainError) {
    return res.status(error.statusCode).json({ error: { code: error.code, message: error.message } });
  }
  // Código 23505 é o código de violação de UNIQUE do PostgreSQL. Apesar de
  // ser um erro "de banco", é o caso mais comum de conflito (ex.: a mesma
  // Idempotency-Key e um pedido duplicado), então tratamos aqui ANTES do
  // catch-all — vira um 409 amigável em vez de um 500 genérico.
  if (error.code === '23505') {
    return res.status(409).json({
      error: { code: 'DUPLICATE_RESOURCE', message: 'Recurso duplicado (conflito de unicidade).' },
    });
  }
  // Qualquer outra coisa (bug, exceção inesperada, banco fora do ar) cai
  // aqui. Logamos o erro COMPLETO (stack incluída) só no servidor para
  // debug, e devolvemos um 500 enxuto para o cliente — nunca vazamos
  // detalhes internos (mensagem de query, path de arquivo etc.).
  console.error('[error]', error);
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno do servidor.' } });
}

// Cata-ratos do Express: qualquer request que não bateu em NENHUMA rota
// (path ou método errado) acaba aqui. Em vez de responder direto, lançamos
// o NotFoundError de volta no pipeline para o errorHandler tratar — assim
// a resposta de 404 mantém o MESMO shape de erro do resto da API.
// eslint-disable-next-line no-unused-vars
function notFoundHandler(_req, _res, next) {
  const { NotFoundError } = require('../../../domain/payment-errors');
  next(new NotFoundError('Rota'));
}

module.exports = { errorHandler, notFoundHandler };
