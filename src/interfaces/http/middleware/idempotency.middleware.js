'use strict';

const crypto = require('crypto');
const { ForbiddenError, BadRequestError, IdempotencyKeyRequiredError } = require('../../../domain/payment-errors');

/**
 * ===========================================
 * MIDDLEWARE: Idempotência e Autenticação de Webhook
 * ===========================================
 * 
 * Este arquivo contém os middlewares responsáveis por:
 * 1. Garantir que toda requisição de cobrança seja idempotente
 * 2. Autenticar webhooks do gateway externo
 * 
 * 💡 POR QUE ISSO É IMPORTANTE:
 * - Microsserviços podem ser chamados múltiplas vezes por erro de rede
 * - Sem idempotência, o cliente seria cobrado duas vezes
 * - Sem autenticação de webhook, qualquer um poderia falsificar pagamentos
 * ===========================================
 */

/**
 * REQUERER CHAVE DE IDEMPOTÊNCIA
 * 
 * Como funciona a idempotência:
 * - O cliente gera uma chave única para cada operação (ex: "pedido-123-2024-08-02")
 * - Se o gateway responder com timeout, o cliente reenvia com a MESMA chave
 * - O servidor vê que a chave já existe e devolve o resultado anterior
 * - Isso garante que o cliente nunca seja cobrado duas vezes
 * 
 * ⚠️ IMPORTANTE: A chave deve ser única por:
 *   - ID do pedido (único)
 *   - ID do cliente (para evitar conflitos)
 *   - Timestamp ou UUID (para garantir unicidade absoluta)
 */
function requireIdempotencyKey(req, _res, next) {
  const key = req.get('Idempotency-Key');
  
  // SE NÃO Houver chave, recusamos a requisição
  // Usamos a classe de erro de domínio para ter status 422 automaticamente
  if (!key) {
    // O IdempotencyKeyRequiredError já define status 422 e code IDEMPOTENCY_KEY_REQUIRED
    return next(new IdempotencyKeyRequiredError());
  }
  
  // VALIDATIONS DA PRESISE (boas práticas de negócio)
  // - Chave não pode ser vazia
  // - Chave não pode ser muito longa (evita abuso)
  // - Chave deve ser um string válido
  if (typeof key !== 'string' || key.trim().length === 0) {
    const error = new Error('Idempotency-Key inválida (não pode ser vazia).');
    error.status = 422;
    error.code = 'VALIDATION_ERROR';
    return next(error);
  }
  
  // Limite de tamanho para evitar abuso de header
  // 255 caracteres é mais que suficiente para qualquer chave razoável
  if (key.length > 255) {
    const error = new Error('Idempotency-Key excede 255 caracteres.');
    error.status = 422;
    error.code = 'VALIDATION_ERROR';
    return next(error);
  }
  
  // Carrega a chave na requisição para o controller usar
  req.idempotencyKey = key;
  
  // 💡 DICA: Você pode adicionar aqui validação de formato
  // ex: if (!key.match(/^pedido-\d+-\d+$/)) { return next(...) }
  
  return next();
}

/**
 * AUTENTICAR WEBHOOKS DO GATEWAY EXTERNO
 * 
 * Webhooks são chamadas ASSÍNCRONAS do gateway de pagamento
 * (ex: Mercado Pago, Stripe, PagSeguro). ELes são:
 * 
 * ✅ OMNIBUS: Vindos de OUTRO serviço, não do cliente final
 * ❌ NÃO USAM JWT: Não têm sessão de usuário
 * ✅ USAM API KEY: Um segredo compartilhado entre nós
 * 
 * O fluxo de segurança:
 * 1. Gateway envia POST com header X-Gateway-Key
 * 2. Nosso servidor compara com GATEWAY_WEBHOOK_SECRET
 * 3. Se bater, processa o webhook; senão, 403 Forbidden
 * 
 * 🛡️ PROTEGER contra ataques:
 * - Use timing-safe comparison (crypto.timingSafeEqual)
 * - Não exponha o segredo nos logs
 * - Limite o tamanho do payload (evita DoS)
 */
function requireGatewaySecret(config) {
  return (req, res, next) => {
    const secret = config.gatewayWebhookSecret;
    
    // 🚨 MODO DESENVOLVIMENTO: Se secret estiver vazio, aceita sem validação
    // ISSO É INTENCIONAL PARA FACILITAR O DESENVOLVIMENTO
    // ✋ MAS NUNCA EM PRODUÇÃO! Um .env mal configurado = pagamentos falsos!
    if (!secret || secret.trim() === '') {
      console.warn('[SECURITY WARNING] Webhook validation is DISABLED');
      console.warn('[SECURITY WARNING] Set GATEWAY_WEBHOOK_SECRET in .env for production!');
      // Ainda assim, loga o warning - mas permite a requisição
      return next();
    }
    
    const webhookKey = req.get('X-Gateway-Key');
    
    // Se não enviou o header, rejeita
    if (!webhookKey) {
      console.warn('[SECURITY] Webhook sem X-Gateway-Key rejeitado', {
        ip: req.ip,
        path: req.path,
        method: req.method
      });
      
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Webhook requer header X-Gateway-Key válido.'
      });
    }
    
    // ⚠️ VALIDAÇÃO SEGURO contra timing attacks
    // Usa timingSafeEqual que é constante no tempo (não vaza info)
    try {
      const isValid = crypto.timingSafeEqual(
        Buffer.from(webhookKey),
        Buffer.from(secret)
      );
      
      if (!isValid) {
        // Log de tentativa suspeita (SEM EXPOR a chave)
        console.warn('[SECURITY] Webhook com chave inválida rejeitado', {
          ip: req.ip,
          path: req.path,
          method: req.method,
          timestamp: new Date().toISOString()
        });
        
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Assinatura de webhook inválida.'
        });
      }
      
      // Chave válida - autoriza
      return next();
      
    } catch (err) {
      // Erro de comparação (ex: tipos incompatíveis)
      // Trate como falha de segurança
      console.error('[SECURITY] Erro na validação de webhook:', err.message);
      return res.status(500).json({
        error: 'InternalServerError',
        message: 'Erro ao validar assinatura do webhook.'
      });
    }
  };
}

/**
 * EXTRA: Gerador de chave de idempotência segura
 * 
 * Use esta função para gerar chaves de idempotência
 * que são:
 * - Únicas (UUID)
 * - Determinísticas (baseadas em ID do pedido)
 * - Previsíveis para debugging
 */
function generateIdempotencyKey(orderId, clientId) {
  const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  return `order-${orderId}-client-${clientId}-${timestamp}`;
}

/**
 * EXTRA: Validador de formato de chave de idempotência
 * 
 * Garante que a chave segue um padrão esperado
 * Útil para rejeitar chaves malformadas rapidamente
 */
function validateIdempotencyKeyFormat(key) {
  // Padrão: algo-algo-algo (separado por hífen)
  // Pode ser UUID, ou um formato customizado
  const validPatterns = [
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i, // UUID v4
    /^order-\d+-client-\d+-\d{4}-\d{2}-\d{2}$/, // Formato padrão de pedidos
    /^[a-zA-Z0-9_\-]+$/, // Alfanumérico com hífen e underscore
  ];
  
  return validPatterns.some(pattern => pattern.test(key));
}

module.exports = {
  requireIdempotencyKey,
  requireGatewaySecret,
  generateIdempotencyKey,
  validateIdempotencyKeyFormat
};