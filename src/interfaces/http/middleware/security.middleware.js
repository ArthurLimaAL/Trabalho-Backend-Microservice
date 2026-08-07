'use strict';

const { ForbiddenError, BadRequestError } = require('../../../domain/payment-errors');

/**
 * ===========================================
 * MIDDLEWARE DE SEGURANÇA
 * ===========================================
 * 
 * Este middleware implementa camadas de defesa para APIs
 * que recebem conexões de outros microsserviços. 
 * 
 * Principais proteções:
 * - Rate limiting para prevenir abuso
 * - Headers de segurança (XSS, clickjacking, etc)
 * - Validação rigorosa de API Keys
 * - Controle de CORS seguro
 * ===========================================
 */

/**
 * Rate LIMITER - Protege contra abuso e DoS
 * 
 * Como funciona:
 * - Mantém um contador em memória (para produção, use Redis)
 * - Cada IP/Chave API tem seu próprio contador
 * - Quando o limite é ultrapassado, retorna 429 (Too Many Requests)
 * 
 * 💡 DICA: Em produção, substitua o Store em memória por Redis
 * para contagem distribuída e sobrevivência a reinícios
 */
class RateLimiter {
  constructor(opts = {}) {
    // Configurações com valores seguros por padrão
    this.windowMs = opts.windowMs || 60000; // 1 minuto
    this.maxRequests = opts.maxRequests || 100; // 100 req/min
    this.blockDurationMs = opts.blockDurationMs || 300000; // 5 minutos bloqueado
    
    // Armazenamento em memória (use Redis em produção)
    this.store = new Map();
    
    // Handle para o intervalo (necessário para limpar em tests)
    this._interval = setInterval(() => this._cleanup(), this.windowMs * 2);
  }

  /**
   * Limpa entradas expiradas do store
   * ⚠️ Em produção com Redis, use TTL do próprio Redis
   */
  _cleanup() {
    const now = Date.now();
    for (const [key, data] of this.store.entries()) {
      if (data.expiry < now) {
        this.store.delete(key);
      }
    }
  }

  /**
   * Para o rate limiter (útil para tests)
   * Chame this para limpar o intervalo
   */
  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }

  /**
   * Middleware Express: verifica rate limit
   * 
   * Usa a combinação de IP + API Key (se presente) como identificador
   * Isso permite que microsserviços diferentes mantenham limites separados
   */
  middleware(context = 'api') {
    return (req, res, next) => {
      const key = this._getClientKey(req, context);
      const now = Date.now();
      
      const record = this.store.get(key) || { 
        count: 0, 
        firstRequest: now, 
        blockedUntil: 0 
      };

      // Se está bloqueado, rejeita imediatamente
      if (record.blockedUntil > now) {
        const remaining = Math.ceil((record.blockedUntil - now) / 1000);
        res.set({
          'Retry-After': String(Math.floor(record.blockedUntil / 1000)),
          'X-RateLimit-Limit': String(this.maxRequests),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.floor(record.blockedUntil / 1000))
        });
        return res.status(429).json({
          error: 'TooManyRequests',
          message: `Rate limit excedido. Tente novamente em ${remaining} segundos.`,
          retryAfter: remaining
        });
      }

      // Reinicia contador se a janela passou
      if (now - record.firstRequest > this.windowMs) {
        record.count = 0;
        record.firstRequest = now;
      }

      record.count++;

      // Se ultrapassou o limite, bloqueia por um tempo
      if (record.count > this.maxRequests) {
        record.blockedUntil = now + this.blockDurationMs;
      }

      this.store.set(key, record);

      // Headers de rate limit para debugging/clientes
      const resetTime = Math.floor((record.firstRequest + this.windowMs) / 1000);
      res.set({
        'X-RateLimit-Limit': String(this.maxRequests),
        'X-RateLimit-Remaining': String(Math.max(0, this.maxRequests - record.count)),
        'X-RateLimit-Reset': String(resetTime)
      });

      return next();
    };
  }

  /**
   * Gera uma chave única baseada no cliente
   * Prioriza API Key se presente, senão usa IP
   */
  _getClientKey(req, context) {
    // Para webhooks/integrations, usa a chave do gateway
    const apiKey = req.get('X-API-Key') || req.get('X-Gateway-Key');
    if (apiKey) {
      return `${context}:${apiKey}`;
    }
    
    // Fallback: IP do cliente (para endpoints de usuário)
    const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
    return `${context}:${clientIp}`;
  }
}

/**
 * HEADERS DE SEGURANÇA
 * 
 * Adiciona headers que protegem contra:
 * - XSS (Content-Security-Policy)
 * - Clickjacking (X-Frame-Options)
 * - MIME sniffing (X-Content-Type-Options)
 * - Referrer policy
 * - Permissions Policy (exclusivo APIs)
 */
function securityHeaders(config = {}) {
  return (req, res, next) => {
    // Previne clickjacking - ninguém embute seu site em iframe
    res.set('X-Frame-Options', 'DENY');
    
    // Previne navegadores de "adivinhar" tipo de conteúdo
    res.set('X-Content-Type-Options', 'nosniff');
    
    // Previne XSS básico
    res.set('X-XSS-Protection', '1; mode=block');
    
    // Política de referrer - só envia origem, nunca path completo
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    
    // Permissions Policy - restringe APIs de navegador
    // Para APIs backend, isso é mais restritivo por padrão
    res.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    
    // Content Security Policy - apenas para JSON responses
    if (res.get('Content-Type')?.includes('application/json')) {
      res.set('Content-Security-Policy', "default-src 'none'");
    }

    // Cache control - evita cache de respostas sensíveis
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    
    return next();
  };
}

/**
 * CORS SEGURO
 * 
 * Permite apenas origens explícitas listadas.
 * Para microsserviços, geralmente os frontends são de confiança.
 * 
 * Configuração:
 * - allowedOrigins: lista de Origins permitidas
 * - allowedMethods: métodos HTTP permitidos
 * - allowedHeaders: headers que podem ser enviados
 * - credentials: se Cookies/ auth headers são permitidos
 */
function corsSecure(opts = {}) {
  const {
    allowedOrigins = [],
    allowedMethods = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders = ['Content-Type', 'Authorization', 'Idempotency-Key'],
    credentials = false,
    maxAge = 86400 // 24 horas
  } = opts;

  return (req, res, next) => {
    const origin = req.get('Origin');
    
    // Se não tem Origin, é uma requisição "não-cross-origin", segue normalmente
    if (!origin) return next();
    
    // Se a origem está na lista branca, permite
    if (allowedOrigins.includes(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Access-Control-Allow-Methods', allowedMethods.join(', '));
      res.set('Access-Control-Allow-Headers', allowedHeaders.join(', '));
      res.set('Access-Control-Max-Age', String(maxAge));
      
      if (credentials) {
        res.set('Access-Control-Allow-Credentials', 'true');
      }
      
      // Preflight (OPTIONS) responde aqui mesmo
      if (req.method === 'OPTIONS') {
        return res.status(204).send('');
      }
      
      return next();
    }
    
    // Origem não permitida - bloqueia
    return next(new ForbiddenError('Origem não permitida pela política CORS'));
  };
}

/**
 * VALIDADOR DE API KEY ROTATÓRIA
 * 
 * Para microsserviços que se comunicam, use API Keys rotacionadas.
 * Esta função valida contra uma lista de chaves válidas (pode ser
 * um cache de chaves do banco ou sistema externo).
 */
function requireApiKey(validKeys = new Set()) {
  return (req, res, next) => {
    const apiKey = req.get('X-API-Key');
    
    if (!apiKey) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'API Key é obrigatória. Envie em header X-API-Key'
      });
      return;
    }
    
    // Validação segura contra timing attack
    // Usa comparison constante quando possível
    const isValid = [...validKeys].some(key => {
      if (Buffer.isBuffer(key) && Buffer.isBuffer(apiKey)) {
        return require('crypto').timingSafeEqual(key, apiKey);
      }
      return key === apiKey;
    });
    
    if (!isValid) {
      // Log de tentativa suspeita (sem expor a chave)
      console.warn('[SECURITY] Tentativa de acesso com API Key inválida', {
        ip: req.ip,
        endpoint: req.path,
        userAgent: req.get('User-Agent'),
        timestamp: new Date().toISOString()
      });
      
      res.status(401).json({
        error: 'Unauthorized',
        message: 'API Key inválida'
      });
      return;
    }
    
    // Adiciona a chave validada ao request para uso posterior
    req.apiKey = apiKey;
    return next();
  };
}

/**
 * LOGGER DE SEGURANÇA
 * 
 * Registra eventos de segurança importantes:
 * - Tentativas de autenticação falhadas
 * - Rate limit excedido
 * - Attempts suspeitas
 * 
 * Em produção, envie para um sistema de log centralizado
 * (SIEM, ELK, Splunk, etc.) para análise forense
 */
function securityLogger(opts = {}) {
  const { level = 'warn', service = 'payment-service' } = opts;
  
  return (req, res, next) => {
    // Intercepta a resposta para logar quando houver error de segurança
    const originalSend = res.send;
    res.send = function(body) {
      // Se for um error 401/403/429, loga
      const statusCode = res.statusCode;
      if ([401, 403, 429].includes(statusCode)) {
        console.log(JSON.stringify({
          level,
          service,
          event: 'security_event',
          type: statusCode === 401 ? 'auth_failure' : 
                statusCode === 403 ? 'forbidden' : 'rate_limit',
          ip: req.ip,
          method: req.method,
          path: req.path,
          userAgent: req.get('User-Agent'),
          statusCode,
          timestamp: new Date().toISOString()
        }));
      }
      return originalSend.call(this, body);
    };
    
    return next();
  };
}

/**
 * MIDDLEWARE COMPLETO DE SEGURANÇA
 * 
 * Combina todos os middlewares acima em ordem apropriada.
 * Use em produção para proteger endpoints sensíveis.
 */
function securityMiddleware(opts = {}) {
  const {
    rateLimit = true,
    securityHeaders = true,
    cors = false,
    corsOptions = {},
    apiKeys = new Set(),
    logSecurity = true
  } = opts;
  
  const middlewares = [];
  
  // Headers de segurança primeiro (não afeta performance)
  if (securityHeaders) {
    middlewares.push(securityHeaders(corsOptions));
  }
  
  // CORS (se habilitado)
  if (cors) {
    middlewares.push(corsSecure(corsOptions));
  }
  
  // Rate limiting
  if (rateLimit) {
    const limiter = new RateLimiter(opts.rateLimit || {});
    middlewares.push(limiter.middleware('api'));
  }
  
  // API Key (se fornecido)
  if (apiKeys.size > 0) {
    middlewares.push(requireApiKey(apiKeys));
  }
  
  // Logger de segurança
  if (logSecurity) {
    middlewares.push(securityLogger(opts.logger || {}));
  }
  
  // Retorna o middleware ou array de middlewares
  if (middlewares.length === 1) {
    return middlewares[0];
  }
  return middlewares;
}

module.exports = {
  RateLimiter,
  securityHeaders,
  corsSecure,
  requireApiKey,
  securityLogger,
  securityMiddleware
};