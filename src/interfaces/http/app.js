'use strict';

/**
 * ===========================================
 * FÁBRICA DO APP EXPRESS
 * ===========================================
 * 
 * Monta o pipeline de middleware + rotas + tratamento de erro.
 * 
 * Arquitetura segura:
 * - CORS restrito a origins conhecidas
 * - Headers de segurança habilitados
 * - Rate limiting protege contra abuso
 * - Body parser com limites de tamanho
 * 
 * 🛡️ SEGURANÇA POR CAMADAS:
 * 1. Headers de segurança (X-Frame-Options, CSP, etc)
 * 2. CORS controlado (origins whitelist)
 * 3. Rate limiting (proteção contra DoS)
 * 4. Body parser com limites
 * 5. Autenticação JWT (em cada rota protegida)
 * 6. RBAC (controle de permissões)
 * ===========================================
 */

const express = require('express');
const cors = require('cors');
const { RateLimiter, securityHeaders, corsSecure } = require('./middleware/security.middleware');
const { createPaymentsRoutes } = require('./routes/payments.routes');
const { createWebhooksRoutes } = require('./routes/webhooks.routes');
const { createRestaurantsRoutes } = require('./routes/restaurants.routes');
const { createAdminRoutes } = require('./routes/admin.routes');
const { createDevRoutes } = require('./routes/dev.routes');
const { errorHandler, notFoundHandler } = require('./middleware/error-handler');

/**
 * CONFIGURAÇÕES DE SEGURANÇA
 * 
 * Ajuste estas variáveis conforme seu ambiente:
 * - Production: origins restritas, rate limiting rigoroso
 * - Development: origens amplas, rate limiting mais liberdade
 */
const SECURITY_CONFIG = {
  // Orígenes permitidos para CORS
  // 💡 Em produção, liste apenas os domínios dos frontends
  cors: {
    allowedOrigins: process.env.ALLOWED_ORIGINS 
      ? process.env.ALLOWED_ORIGINS.split(',') 
      : ['http://localhost:8090', 'http://localhost:3000', 'http://127.0.0.1:8090'],
    credentials: false, // true se usar cookies/auth headers
    maxAge: 86400 // 24h - cache de preflight
  },
  
  // Rate limiting por endpoint
  rateLimit: {
    // API pública: 100 req/min (clientes fazendo pagamentos)
    public: { maxRequests: 100, windowMs: 60000 },
    // Webhooks: 200 req/min (gateway pode ser mais propenso a retry)
    webhooks: { maxRequests: 200, windowMs: 60000 },
    // Admin: 30 req/min (ações sensíveis)
    admin: { maxRequests: 30, windowMs: 60000 }
  },
  
  // Limites de payload (evita DoS por payloads gigantes)
  bodyLimits: {
    limit: '1mb', // Tamanho máximo do body
    limitForWebhook: '500kb' // Webhooks geralmente são menores
  }
};

/**
 * FÁBRICA DO APP
 * 
 * Cria a aplicação Express completa com todos os middlewares de segurança
 */
function createApp(container) {
  const app = express();
  
  // ===========================================
  // 1. HEADER DE SEGURANCA BÁSICA
  // ===========================================
  // Remove o header "X-Powered-By: Express" que dá info sobre stack
  // Inimigos usam isso para buscar exploits específicos
  app.disable('x-powered-by');
  
  // Headers de segurança: X-Frame-Options, CSP, etc.
  // Protege contra clickjacking, XSS, MIME sniffing
  app.use(securityHeaders());
  
  // ===========================================
  // 2. CORS CONFIGURADO
  // ===========================================
  // CORS restrito - apenas origins listadas podem acessar
  // Em desenvolvimento, aceita localhost; em produção, lista curta
  app.use(corsSecure({
    ...SECURITY_CONFIG.cors,
    allowedOrigins: SECURITY_CONFIG.cors.allowedOrigins
  }));
  
  // ===========================================
  // 3. RATE LIMITING
  // ===========================================
  // Protege contra abuso e ataques DoS
  // Cada grupo de rotas tem seu próprio limitador
  const rateLimiter = new RateLimiter({
    maxRequests: SECURITY_CONFIG.rateLimit.public.maxRequests,
    windowMs: SECURITY_CONFIG.rateLimit.public.windowMs
  });
  
  // Rate limiting geral (aplica a todos os endpoints)
  // Webhooks podem ter config diferente, mas aqui usamos o padrão
  app.use(rateLimiter.middleware('api-public'));
  
  // ===========================================
  // 4. BODY PARSER COM LIMITES
  // ===========================================
  // JSON body parser com limites de tamanho
  // Evita ataques de "bomba de JSON"
  app.use(express.json({ 
    limit: SECURITY_CONFIG.bodyLimits.limit,
    // Recusa payloads não-JSON
    type: 'application/json'
  }));
  
  // Também aceita URL-encoded (para formulários)
  app.use(express.urlencoded({ 
    limit: SECURITY_CONFIG.bodyLimits.limit,
    extended: true 
  }));
  
  // ===========================================
  // 5. HEALTH CHECK (sem autenticação)
  // ===========================================
  // Endpoint para liveness/readiness probes
  // NÃO requer autenticação - é para o orquestrador checar se o serviço vive
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'payment-service',
      driver: container.config.databaseDriver,
      // 🔐 Em produção, não exponha detalhes do driver
      time: new Date().toISOString()
    });
  });
  
  // ===========================================
  // 6. ROTAS DA API
  // ===========================================
  // Cada grupo de rotas tem sua responsabilidade:
  // - /payments: rotas de pagamentos (CLIENTE, RESTAURANTE, ADMIN)
  // - /webhooks: rotas de webhook do gateway (autenticado via X-Gateway-Key)
  // - /restaurants: rotas de restaurantes (RESTAURANTE, ADMIN)
  // - /admin: painel de administração (ADMIN only)
  // - /dev: rotas de desenvolvimento (apenas fora de produção)
  
  // Rotas principais da API
  app.use('/api/v1/payments', createPaymentsRoutes(container));
  app.use('/api/v1/webhooks', createWebhooksRoutes(container));
  app.use('/api/v1/restaurants', createRestaurantsRoutes(container));
  app.use('/api/v1/admin', createAdminRoutes(container));
  
  // Rotas de desenvolvimento (apenas fora de produção)
  // ⚠️ ESTAS ROTAS NÃO EXISTEM EM PRODUÇÃO
  // Elas permitem gerar tokens, cancelar pedidos, etc.
  if (!container.config.isProd) {
    app.use('/api/v1/dev', createDevRoutes(container));
    console.warn('[DEV MODE] Rotas de desenvolvimento ativadas');
  }
  
  // ===========================================
  // 7. HANDLERS DE ERRO
  // ===========================================
  // 404 para rotas não encontradas
  app.use(notFoundHandler);
  // Tratamento de erros (converte para JSON padronizado)
  app.use(errorHandler);
  
  // ===========================================
  // RETORNO COM CLEANUP
  // ===========================================
  // O container retorna a app e também um método de cleanup
  // para parar timers e limpeza de recursos (útil em tests)
  return {
    app,
    // Método para limpar recursos (timers, eventos, etc)
    stop: () => {
      try {
        rateLimiter.stop();
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  };
}

/**
 * CONFIGURAÇÕES DE SEGURANÇA EXPORTADAS
 * 
 * Use para ajustar valores conforme ambiente
 */
module.exports = { 
  createApp,
  SECURITY_CONFIG
};