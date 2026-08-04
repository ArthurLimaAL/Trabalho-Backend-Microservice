# 📋 Checklist de Implementação - Payment Service

Baseado no enunciado: `[BACKEND] Enunciado do Trabalho Prático (1).md`

## ✅ JÁ IMPLEMENTADO

### 1. Idempotência Absoluta
- ✅ `Idempotency-Key` obrigatório em `requireIdempotencyKey` middleware
- ✅ Índice `UNIQUE` no banco
- ✅ Validação no repository

### 2. Timeout de Transações
- ✅ Campo `expires_at` nas migrations
- ✅ `ExpireSweep` job rodando periodicamente
- ✅ Eventos `PaymentExpired` + `OrderCancelRequested`

### 3. Split Payment
- ✅ Calculadora em `src/domain/split.js`
- ✅ Ledger contábil atualizado
- ✅ Invariante guardada: `restaurant + courier + platform = gross`

### 4. Autenticação/JWT
- ✅ Validação de assinatura com `jwt.verify()`
- ✅ NUNCA apenas decode
- ✅ Algoritmo explícito: `algorithms: [config.jwtAlg]`

### 5. Proteção de Chaves
- ✅ Nenhum segredo no código
- ✅ `.env` no `.gitignore`
- ✅ Variáveis via Kubernetes Secrets

### 6. Segurança das Conexões
- ✅ Rate limiting implementado
- ✅ Timing-safe comparison para API Keys
- ✅ Headers de segurança (X-Frame-Options, etc)
- ✅ CORS restrito a origins whitelist

---

## 🔄 Implementação de Microsserviços - O QUE FALTARIA

### Para que outros microsserviços se conectem ao Payment Service:

#### 1. **API Keys para microsserviços**
```sql
-- Tabela criada: api_clients
-- Migrations: 002_api_clients.sql
```

**Para usar:**
```bash
# Criar API key para order-service
node scripts/setup-api-keys.js --service order-service --role order_service
```

**No microsserviço client:**
```javascript
// Header obrigatório
fetch('/api/v1/payments', {
  headers: {
    'X-API-Key': process.env.ORDER_SERVICE_API_KEY
  }
})
```

#### 2. **Database-per-Service (já implementado)**
- ✅ Cada microsserviço tem seu próprio banco
- ✅ Nenhum acesso direto entre bancos

#### 3. **Transactional Outbox (já implementado)**
```javascript
// O pagamento e os eventos são gravados na MESMA transação
await db.withTransaction(async (tx) => {
  await payments.insert(payment, tx);
  await outbox.insert(event, tx);
});
```

#### 4. **Eventos de Negócio**
- ✅ PaymentCreated
- ✅ PaymentConfirmed
- ✅ PaymentExpired
- ✅ OrderCancelRequested
- ✅ PaymentRefunded

---

## 🔧 O que fazer para Deploy Completo

### 1. Subir o banco
```bash
docker compose up -d db
```

### 2. Criar variáveis de ambiente
```bash
cp .env.example .env
# Editar .env com valores reais
```

### 3. Criar API Keys para microsserviços
```bash
# Criar chave para o Gateway
node scripts/setup-api-keys.js --service gateway --role gateway

# Criar chave para o Order Service  
node scripts/setup-api-keys.js --service order-service --role order_service
```

### 4. Executar migrações
```bash
npm run migrate
```

### 5. Seed de dados
```bash
npm run seed
```

### 6. Iniciar o serviço
```bash
npm start
# ou
docker compose up payment
```

### 7. Verificar health
```bash
curl http://localhost:3001/health
```

---

## 🚨 Avisos de Segurança

| Item | Status | Aviso |
|------|--------|-------|
| JWT_SECRET | ⚠️ Não configurado | Gere com `openssl rand -base64 32` |
| GATEWAY_WEBHOOK_SECRET | ⚠️ Vazio | **NUNCA** em produção! |
| DATABASE_URL | ✅ Correto | Usa `db` (nome do serviço Docker) |
| API Keys | ✅ Criadas | Salve em Kubernetes Secrets |

---

## 📊 Testes

```bash
# Unitários
npm run test:unit

# Integração (sem PostgreSQL real)
npm run test:integration

# Cobertura
npm run test:coverage
```

---

## 📚 Documentação

- `README.md` - Guia principal
- `docs/SEGURANCA.md` - Guia de segurança detalhado
- `docs/MIDDLEWARES_SEGURANCA.md` - Como usar os middlewares
- `k8s/manifests.yaml` - Manifesto Kubernetes completo