# 🛡️ Guia de Segurança do Payment Service

Este guia documenta as medidas de segurança implementadas e como configurá-las corretamente em produção.

---

## 📋 Sumário

1. [Visão Geral de Segurança](#-visão-geral-de-segurança)
2. [Autenticação e Autorização](#-autenticação-e-autorização)
3. [Proteção de Chaves de API](#-proteção-de-chaves-de-api)
4. [Rate Limiting](#-rate-limiting)
5. [Headers de Segurança](#-headers-de-segurança)
6. [Logs de Segurança](#-logs-de-segurança)
7. [Configuração Docker](#-configuração-docker)
8. [Configuração Kubernetes](#-configuração-kubernetes)
9. [Rotina de Segurança](#-rotina-de-segurança)

---

## 🔐 Visão Geral de Segurança

O Payment Service implementa segurança em camadas (defense in depth):

| Camada | Proteção | Local |
|--------|----------|-------|
| Network | NetworkPolicy (K8s) | Cluster |
| Transport | HTTPS/TLS | Proxy/Ingress |
| Auth | JWT Validado | Middleware |
| Auth zação | RBAC + Ownership | Middleware |
| Inputs | Validação + Sanitização | Controllers |
| Outputs | Headers de Segurança | Middleware |
| Logs | Auditoria de Segurança | Console/File |

---

## 🔑 Autenticação e Autorização

### JWT (JSON Web Token)

O serviço valida tokens do Auth Service:

```javascript
// src/interfaces/http/middleware/auth.middleware.js
jwt.verify(token, config.jwtSecret, { algorithms: [config.jwtAlg] });
```

#### Configuração

```bash
# Gere uma chave forte para produção
openssl rand -base64 32
# Exemplo: a1b2c3d4e5f6...

# No .env (ou Secret do K8s)
JWT_SECRET=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2
JWT_ALG=HS256
```

### RBAC (Role-Based Access Control)

| Papel | Permissões |
|-------|------------|
| `CLIENTE` | Seus próprios pagamentos, histórico |
| `RESTAURANTE` | Seus restaurantes, extratos, repasses |
| `ADMIN` | Todo o sistema |

#### Exemplo de uso

```javascript
// Rotas de admin só podem ser acessadas por ADMIN
app.get('/api/v1/admin/dashboard', 
  authenticate(config), 
  requireRole('ADMIN'), 
  controller.adminDashboard
);

// Restaurantes só podem ver os próprios dados
app.get('/api/v1/restaurants/:id/splits',
  authenticate(config),
  requireOwnershipOrAdmin(getRestaurantOwnerId),
  controller.getRestaurantSplits
);
```

---

## 🔐 Proteção de Chaves de API

### Webhook do Gateway

Webhooks usam `X-Gateway-Key` para autenticação:

```javascript
// src/interfaces/http/middleware/idempotency.middleware.js
const isValid = crypto.timingSafeEqual(
  Buffer.from(webhookKey),
  Buffer.from(secret)
);
```

#### Configuração segura

```bash
# Gere segredo único para o gateway
openssl rand -base64 32

# No .env
GATEWAY_WEBHOOK_SECRET=abc123def456ghi789jkl012mno345pqr678stu901vwx234yz
```

### Boas Práticas

1. **NUNCA** deixe `GATEWAY_WEBHOOK_SECRET` vazio em produção
2. Chaves devem ter pelo menos 32 bytes
3. Roteie chaves a cada 90 dias
4. Use timing-safe comparison (já implementado)

---

## 🚦 Rate Limiting

Protege contra abuso e ataques DoS.

### Configuração padrão

```javascript
// security.middleware.js
const limiter = new RateLimiter({
  maxRequests: 100,  // limite por janela
  windowMs: 60000    // 1 minuto
});

app.use(limiter.middleware('api-public'));
```

### Ajustes por ambiente

**Desenvolvimento:**
- 100 req/min - permite testes com retries

**Produção:**
- Webhooks: 200 req/min (gateway faz muitos retries)
- Admin: 30 req/min (ações sensíveis)
- Public: 100 req/min

---

## 🔒 Headers de Segurança

### Headers automaticamente adicionados

| Header | Valor | Propósto |
|--------|-------|----------|
| `X-Frame-Options` | `DENY` | Evita clickjacking |
| `X-Content-Type-Options` | `nosniff` | Previne MIME sniffing |
| `X-XSS-Protection` | `1; mode=block` | Proteção XSS básica |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Controla referrer |
| `Permissions-Policy` | `geolocation=(), microphone=(), camera=()` | Desabilita APIs de navegador |
| `Cache-Control` | `no-store, no-cache` | Não cacheia dados sensíveis |

### CORS

Configuração restrita a origins específicos:

```javascript
const SECURITY_CONFIG = {
  cors: {
    allowedOrigins: ['https://app.seudominio.com'],
    credentials: false,
    maxAge: 86400
  }
};
```

---

## 📜 Logs de Segurança

### Eventos monitorados

- ✅ Tentativas de autenticação falhadas (401)
- ✅ Acessos negados (403)
- ✅ Rate limit excedido (429)
- ✅ Webhook com chave inválida

### Formato de log

```json
{
  "level": "warn",
  "service": "payment-service",
  "event": "security_event",
  "type": "auth_failure",
  "ip": "200.142.123.45",
  "path": "/api/v1/payments/charges",
  "method": "POST",
  "statusCode": 401,
  "timestamp": "2024-08-02T10:30:00.000Z"
}
```

### Envio para SIEM

Em produção, envie logs para:
- AWS CloudWatch
- ELK Stack
- Splunk
- Datadog

---

## 🐳 Configuração Docker

### Variáveis sensíveis em .env

```bash
# .env (nunca commit this!)
JWT_SECRET=...
POSTGRES_PASSWORD=...
GATEWAY_WEBHOOK_SECRET=...

# .env.example (commit this - sem valores reais!)
JWT_SECRET=seu_jwt_secret_aqui_gerado_aleatoriamente
```

### Docker Compose

```yaml
services:
  payment:
    build: .
    environment:
      # ⚠️ Referencie o .env, não valores hardcoded!
      JWT_SECRET: ${JWT_SECRET}
      DATABASE_URL: postgres://payment:${POSTGRES_PASSWORD}@db:5432/payment_service
```

---

## ☸️ Configuração Kubernetes

### Secrets (nunca no ConfigMap!)

```bash
# Criar secrets com valores aleatórios
kubectl create secret generic payment-service-secrets \
  --from-literal=JWT_SECRET=$(openssl rand -base64 32) \
  --from-literal=DB_PASSWORD=$(openssl rand -base64 24) \
  --from-literal=GATEWAY_WEBHOOK_SECRET=$(openssl rand -base64 32)
```

### NetworkPolicy

Restrinja tráfego entre serviços:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: payment-service-network-policy
spec:
  podSelector:
    matchLabels:
      app: payment-service
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: ingress-nginx
      ports:
        - protocol: TCP
          port: 80
```

---

## 🔄 Rotina de Segurança

### Checklist semanal

- [ ] Verificar logs de segurança
- [ ] Revisar tentativas de rate limit
- [ ] Verificar chaves vencendo (90 dias)

### Checklist mensal

- [ ] Rotacionar JWT_SECRET
- [ ] Rotacionar GATEWAY_WEBHOOK_SECRET
- [ ] Revisar permissões do banco

### Checklist trimestral

- [ ] Auditoria de acesso (quem acessou o quê)
- [ ] Revisão de NetworkPolicy
- [ ] Atualizar dependências (npm audit)

---

## 🚨 Quando algo der errado

### Token JWT inválido?

1. Verifique `JWT_SECRET` está correto
2. Verifique `JWT_ALG` está sendo enviado
3. O Auth Service está emitindo tokens com o algoritmo certo?

### Webhook rejeitado?

1. Verifique `GATEWAY_WEBHOOK_SECRET` está configurado
2. O gateway está enviando o header correto?
3. Não deixe o secret vazio em produção!

### Rate limit muito apertado?

Ajuste no `SECURITY_CONFIG`:

```javascript
rateLimit: {
  public: { maxRequests: 200, windowMs: 60000 }
}
```

---

## 📚 Recursos adicionais

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [JWT.io](https://jwt.io/) - Informações sobre JWT
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)

---

## 🔑 API Keys para Microsserviços

Outros microsserviços podem se conectar ao Payment Service usando API Keys.

### Como funciona

1. Crie uma API Key via script
2. O serviço usa `X-API-Key` header nas requisições
3. O middleware valida contra o hash no banco
4. Permissões são verificadas granularmente

### Criar uma API Key

```bash
# Criar para o Order Service
node scripts/setup-api-keys.js --service order-service --role order_service
```

### Resposta esperada

```
=== API Key Criada com Sucesso ===
Serviço: uuid-do-cliente
API Key: order-service-abc123def456...
Expires in: 90 dias
```

### Usar a API Key

```bash
curl -X GET http://localhost:3001/api/v1/payments/charges \
  -H "X-API-Key: order-service-abc123..."
```

### Permissões Disponíveis

| Permissão | Descrição |
|-----------|-----------|
| `read` | Ler dados (listar, buscar) |
| `write` | Criar/modificar dados |
| `webhooks` | Receber webhooks do gateway |
| `admin` | Acesso admin completo |

### Tabela de Permissões por Serviço

| Serviço | read | write | webhooks | admin |
|---------|------|-------|----------|-------|
| `gateway` | ✅ | ✅ | ✅ | ❌ |
| `order-service` | ✅ | ✅ | ❌ | ❌ |
| `auth-service` | ✅ | ❌ | ❌ | ❌ |
| `notification-service` | ✅ | ❌ | ❌ | ❌ |

### Configuração Kubernetes

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: payment-service-api-keys
type: Opaque
stringData:
  ORDER_SERVICE_API_KEY: <chave-gerada>
  GATEWAY_API_KEY: <chave-gerada>
```

### Rotina de Rotação

- API Keys expiram em 90 dias
- Roteie periodicamente: `node scripts/seed-api-keys.js`
- Monitorize expirations via cron/healthcheck