'use strict';

const jwt = require('jsonwebtoken');
const { UnauthorizedError, ForbiddenError } = require('../../../domain/payment-errors');

/**
 * ===========================================
 * MIDDLEWARE: Autenticação JWT e RBAC
 * ===========================================
 * 
 * Authentication + Authorization para APIs do Payment Service
 * 
 * Fluxo de segurança:
 * 1. Usuário autenticado no Auth Service (externo)
 * 2. Auth Service emite JWT com claims padronizados
 * 3. Payment Service VALIDA o token (não apenas decodifica!)
 * 4. RBAC controla acesso baseado no papel do usuário
 * ===========================================
 */

/**
 * AUTENTICAÇÃO JWT
 * 
 * Valida o token JWT emitido pelo Auth Service.
 * 
 * 🔐 POR QUE ASSINATURA É CRUCIAL:
 * - Não confie no header Authorization sozinho
 * - Sem verificação, qualquer um forge um token válido
 * - JWT_SECRET é o bloco de construção da segurança
 * 
 * 💡 BOAS PRÁTICAS AQUI:
 * - Verifica ALGORITMO explicitamente (evita "alg=none")
 * - Não expõe detalhes do erro ao cliente
 * - Usa claims padrão: user_id, role, email
 */
function authenticate(config) {
  return (req, _res, next) => {
    // Extrai o token do header Authorization
    // Formato esperado: "Bearer <token>"
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    
    if (!token) {
      // Sem token = não autenticado
      return next(new UnauthorizedError('Token de acesso é obrigatório'));
    }
    
    try {
      /**
       * VERIFICAÇÃO DUPLA - NUNCA confie só numa delas!
       * 
       * 1. algorithms: [config.jwtAlg]
       *    - ESPECIFICA o algoritmo permitido
       *    - Evita ataque "alg=none" onde o atacante muda o algoritmo
       *    - Sempre liste ALGORITMOS permitidos como array
       * 
       * 2. jwtSecret: config.jwtSecret
       *    - Verifica a assinatura com o segredo compartilhado
       *    - Se o segredo estiver errado, o token é rejeitado
       *    - Em produção, o segredo vem de ENV/Vault/Secrets Manager
       * 
       * ✅ ISSO é seguro: falha em qualquer ponto = 401 Unauthorized
       */
      req.auth = jwt.verify(token, config.jwtSecret, { 
        algorithms: [config.jwtAlg] // IMPORTANTE: nunca deixe vazio!
      });
      
      // Token é válido, mas cadê os claims?
      // Os claims são: user_id, role, email (padronizados)
      if (!req.auth.user_id) {
        return next(new UnauthorizedError('Token inválido: user_id ausente'));
      }
      
      // Carrega os dados de auth na requisição para uso posterior
      // Controllers acessam: req.auth.user_id, req.auth.role, req.auth.email
      return next();
      
    } catch (error) {
      /**
       * NÃO exponha o motivo exato do erro!
       * 
       * Erros comuns:
       * - Token expirado (TokenExpiredError)
       * - Assinatura inválida (JsonWebTokenError)
       * - Token malformado
       * - Algoritmo não permitido
       * 
       * 🚫 ERRADO: return next(error)
       * 🚫 ERRADO: return next(error.message)
       * 
       * CERTOR: Sempre 401 com mensagem genérica
       * 301 diz "quem é você?" mas não "que é que está errado"
       */
      return next(new UnauthorizedError('Token inválido ou expirado'));
    }
  };
}

/**
 * AUTORIZAÇÃO RBAC (Role-Based Access Control)
 * 
 * Controla quais papeis podem acessar quais recursos.
 * 
 * 📋 PAPEIS no sistema:
 * - CLIENTE: pode acessar seus próprios pagamentos
 * - RESTAURANTE: pode ver relatórios do seu restaurante
 * - ADMIN: tem acesso a TODOS os recursos
 * 
 * 🔐 POR QUE ISso é importante:
 * - Mesmo sendo autenticado, o usuário não deve ter acesso a tudo
 * - Cliente não deve ver pagamentos de outros clientes
 * - Restaurante não deve ver dados de outro restaurante
 */
function requireRole(...roles) {
  return (req, _res, next) => {
    // Primeiro, verifica se está autenticado
    if (!req.auth) {
      // Este middleware deve vir DEPOIS do authenticate
      // Mas se alguém esquecer, tratamos como 403
      return next(new ForbiddenError('Usuário não autenticado'));
    }
    
    // Verifica se o papel do usuário está na lista permitida
    if (!roles.includes(req.auth.role)) {
      // ✋ Acesso negado - mas deixe o cliente saber
      // 403 = "você é quem você diz ser, mas não pode fazer isso"
      return next(new ForbiddenError(
        `Acesso negado. Papel '${req.auth.role}' não tem permissão para esta ação.`
      ));
    }
    
    // ✅ Usuário tem permissão - segue adiante
    return next();
  };
}

/**
 * CONTROLE DE PROPRIEDADE OU ADMIN
 * 
 * Garante que o usuário só acesse recursos que ele "dona".
 * 
 * 📐 COMO funciona:
 * 1. Recebe uma função que descobre o owner do recurso
 * 2. Se o usuário for ADMIN → acesso total (atalho)
 * 3. Se o dono = user_id → acesso permitido
 * 4. Senão → 403 Forbidden
 * 
 * 💡 EXEMPLO de uso:
 * - GET /payments/:id → getOwnerId = carrega payment e retorna client_id
 * - GET /restaurants/:id/dashboard → getOwnerId = retorna restaurant_id
 * 
 * ✅ Isso previne:
 * - Acessos indevidos a pagamentos de outros clientes
 * - Visualização de dados de outros restaurantes
 * - Vazamento de informações financeiras
 */
function requireOwnershipOrAdmin(getOwnerId) {
  return async (req, _res, next) => {
    try {
      // Primeiro: verifica autenticação
      if (!req.auth) {
        return next(new ForbiddenError('Usuário não autenticado'));
      }
      
      // ADMIN é especial: tem acesso a TUDO
      // Ativa isso com EXTREMA CAUTELA - só para painéis de admin
      if (req.auth.role === 'ADMIN') {
        // Log de acesso admin (para auditoria)
        console.info('[AUDIT] Acesso ADMIN a recurso', {
          userId: req.auth.user_id,
          resource: req.path,
          method: req.method
        });
        return next();
      }
      
      // Para outros papéis: descobre quem é o dono do recurso
      const ownerId = await getOwnerId(req);
      
      // Comparação SEGURA: converte para string
      // Porque o DB pode devolver number e o JWT number... mas são tipos diferentes!
      if (String(req.auth.user_id) === String(ownerId)) {
        // ✅ Dono do recurso ou colaborador autorizado
        return next();
      }
      
      // ❌ Usuario não é dono - nega acesso
      console.warn('[SECURITY] Tentativa de acesso indevido', {
        userId: req.auth.user_id,
        role: req.auth.role,
        path: req.path,
        ownerId,
        ip: req.ip
      });
      
      return next(new ForbiddenError('Acesso negado ao recurso'));
      
    } catch (error) {
      /**
       * SE o getOwnerId LANÇAR um erro (ex: recurso não existe),
       * passamos o erro adiante para o error-handler tratar.
       * 
       * Isso é importante porque:
       * - 404 Not Found é diferente de 403 Forbidden
       * - O cliente precisa saber a diferença
       * - Manteremos o comportamento original do código
       */
      return next(error);
    }
  };
}

/**
 * MIDDLEWARE DE HEADERS DE SEGURANÇA PARA ENDPOINTS DE USUÁRIO
 * 
 * Protege endpoints que requerem autenticação contra:
 * - CSRF (se for browser-based)
 * - Ataques de cache (evita vazamento de dados)
 */
function securityHeadersForAuthEndpoints(req, res, next) {
  // Não permita caching de respostas autenticadas
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  
  // Evite que proxies armazenem respostas
  res.set('Vary', 'Authorization');
  
  return next();
}

module.exports = {
  authenticate,
  requireRole,
  requireOwnershipOrAdmin,
  securityHeadersForAuthEndpoints
};