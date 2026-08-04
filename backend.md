# backend.md — Microsserviço de Pagamentos e Faturamento

Este arquivo explica, de forma detalhada e em português, como funciona o
servidor de pagamentos deste repositório. Ele é voltado para outros
desenvolvedores que vão dar manutenção ou evoluir o código.

O projeto é a entrega do trabalho prático de backend: um **microsserviço de
pagamentos e faturamento** de um ecossistema de delivery (estilo iFood),
escrito em **Node.js + Express + PostgreSQL**, seguindo princípios de
**DDD** (Domain-Driven Design), arquitetura em camadas e padrões de
resiliência (idempotência, transactional outbox, optimistic locking).

---

## 1. O que o serviço faz (requisitos do enunciado)

O enunciado (trabalho.md) pede um serviço que processe cobranças e gere
extratos para três perfis:

1. **Idempotência Absoluta** — toda cobrança exige um cabeçalho
   `Idempotency-Key`. Se a rede cair e o cliente reenviar a requisição com a
   mesma chave, o pagamento NÃO é cobrado duas vezes.
2. **Tratamento de Timeout** — se a confirmação do pagamento (Pix/cartão)
   não chegar no prazo, a cobrança **expira** e o pedido associado é
   cancelado.
3. **Motor de Split (divisão de valores)** — na liquidação de um pedido, o
   valor bruto é dividido em:
   - **Restaurante**: valor dos produtos menos a comissão da plataforma
   - **Entregador**: taxa de entrega
   - **Plataforma**: comissão do app + taxa de serviço
4. **Visões e Extratos Financeiros**:
   - **Cliente**: histórico de cobranças com status (PENDENTE, CONCLUIDO,
     FALHOU, ESTORNADO) e comprovantes.
   - **Restaurante**: painel financeiro com repasses, detalhe do split por
     pedido e repasses semanais/mensais.
   - **Administrador**: relatório consolidado (GMV, receita líquida da
     plataforma, valores pendentes de repasse, conciliação e chargebacks).

---

## 2. Arquitetura em camadas

O código está organizado em 4 camadas. A regra de ouro é: **as camadas
internas nunca dependem das externas**; a comunicação é sempre para dentro
(HTTP → application → domain) e a infraestrutura é "plugada" via injeção de
dependência (o `container.js`).

```
interfaces/http/   → Entrada: Express, rotas, controllers, middlewares (HTTP)
application/       → Casos de uso: orquestra domínio + repositórios + gateway
domain/            → Regras de negócio puras (sem Express, sem banco)
infrastructure/    → Banco (SQL/memory), gateway mock, outbox, jobs, container
```

### 2.1 Camada de Domínio (`src/domain/`)
É o "coração" e não conhece nada de HTTP nem de banco. Aqui moram:

- **`payment.js`** — o agregado `Payment`. Uma "caixa fechada" que representa
  uma cobrança e É DONA das regras de mudança de estado. Ninguém seta
  `payment.status` por fora; usa-se `confirm()`, `expire()`, `refund()`.
- **`payment-status.js`** — a máquina de estados (estrita e unidirecional):
  `PENDENTE → CONCLUIDO | FALHOU` e `CONCLUIDO → ESTORNADO`. FALHOU e
  ESTORNADO são estados terminais (irreversíveis, por segurança financeira).
- **`split.js`** — o `SplitCalculator`. Calcula a divisão do valor. Garante a
  invariante de que as três partes somam exatamente o bruto, em centavos.
- **`money.js`** — todo valor monetário é inteiro em **centavos** (evita erro
  de ponto flutuante). Centraliza conversão de/para reais.
- **`payment-errors.js`** — hierarquia de erros de domínio com `code` e
  `statusCode` (ex.: `NotFoundError` → 404, `InvalidTransitionError` → 409).

### 2.2 Camada de Aplicação (`src/application/`)
O "cérebro" que liga o mundo externo ao domínio. Os dois serviços:

- **`payment-service.js`** — casos de uso que ESCREVEM e mudam estado:
  `createCharge` (idempotência), `confirmPayment` (webhook → split),
  `expirePayment` (timeout), `refundPayment` (estorno).
- **`statement-service.js`** — o "lado de leitura": monta extratos e painéis
  (cliente, restaurante, admin) consultando repositórios. Nunca altera estado.

Toda operação de escrita grava o dado e o evento do outbox **na mesma
transação** (`db.withTransaction`), garantindo consistência.

### 2.3 Camada de Interface (`src/interfaces/http/`)
Traduz HTTP ⇄ domínio. É onde ficam as rotas, controllers e middlewares:

- **`app.js`** — fábrica do Express: monta CORS, rate limiting, headers de
  segurança, body parser, health check e registra as rotas.
- **`routes/`** — a "partitura" da API. Define método, path e ORDEM dos
  middlewares (autentica → autoriza → dono → controller).
- **`controllers/`** — handlers fininhos: pegam o input, chamam o serviço e
  devolvem JSON. Qualquer erro cai no `error-handler`.
- **`middleware/`**:
  - `auth.middleware.js` — JWT + RBAC (papéis CLIENTE/RESTAURANTE/ADMIN) e
    controle de propriedade (`requireOwnershipOrAdmin`).
  - `idempotency.middleware.js` — exige `Idempotency-Key` e valida a assinatura
    do webhook do gateway (`X-Gateway-Key`, com `timingSafeEqual`).
  - `error-handler.js` — converte qualquer erro num JSON uniforme
    `{ error: { code, message } }`.
  - `security.middleware.js` — CORS restrito, rate limit e headers.

### 2.4 Infraestrutura (`src/infrastructure/`)
Tudo que "pluga" tecnologia concreta:

- **`container.js`** — Composition Root. ÚNICO lugar que conhece as
  implementações concretas e faz a injeção de dependência.
- **`config/`** — leitura de ambiente (`env.js`) e criação do banco
  (`database.js`, com pool e `withTransaction`).
- **`repositories/`** — implementações SQL (PostgreSQL) e memory (testes),
  com a MESMA interface. O `index.js` escolhe conforme o driver.
- **`gateway/payment-gateway.js`** — mock do adquirente (Stripe/PagSeguro).
  Também idempotente pela mesma chave.
- **`messaging/`** — EventBus (stub pub/sub) e **OutboxRelay** (padrão
  transactional outbox).
- **`jobs/expire-sweep.js`** — varredura periódica que expira cobranças
  vencidas.

---

## 3. Banco de dados (PostgreSQL)

As migrations ficam em `src/infrastructure/db/migrations/`:

- **`001_init.sql`** — schema inicial. Tabelas:
  - `payments` — cobranças. `idempotency_key` é **UNIQUE** (idempotência).
  - `split_ledger` — ledger contábil **append-only** (uma linha por
    liquidação, imutável, para auditoria).
  - `payouts` — repasses reais para restaurantes/entregadores.
  - `outbox_events` — Transactional Outbox (eventos pendentes de publicação).
- **`002_add_payment_version.sql`** — adiciona `version` na tabela `payments`
  para **optimistic locking** e um índice UNIQUE em `split_ledger(payment_id)`
  que impede liquidação duplicada.

Valores monetários são sempre `INTEGER` em centavos. Nunca `FLOAT`.

---

## 4. Como funcionam os requisitos-chave

### 4.1 Idempotência Absoluta
1. O cliente manda `Idempotency-Key` no header. Sem ela → 422.
2. O `payment-service.createCharge` busca pela chave; se já existir, devolve o
   resultado anterior (`replayed: true`) sem cobrar de novo.
3. O gateway também é idempotente pela mesma chave.
4. Por último, a constraint UNIQUE no banco garante que duas requisições em
   paralelo com a mesma chave não criem duas cobranças (a perdedora lê a
   vencedora e devolve como replay).

### 4.2 Timeout / Expiração
- Cada cobrança nasce com `expiresAt`.
- O job `expireSweep` varre as `PENDENTE` vencidas, marca como `FALHOU` e emite
  `PaymentExpired` + `OrderCancelRequested` (via outbox) para o Pedidos Service
  cancelar o pedido.

### 4.3 Split (divisão de valores)
- `SplitCalculator.calculate()` em `domain/split.js`.
- Exemplo: R$ 100,00 em produtos + R$ 10,00 de entrega, comissão 15% e taxa de
  serviço R$ 2,00:
  - bruto = 11000
  - comissão = 1500, plataforma = 1700, entregador = 1000, restaurante = 8300
  - Confere: 1700 + 1000 + 8300 = 11000 ✓
- O restaurante "absorve" qualquer diferença de 1 centavo (arredondamento da
  comissão), fechando a conta sempre.

### 4.4 Consistência eventual (Transactional Outbox)
- Ao gravar um pagamento, gravamos junto o evento `PaymentCreated` na tabela
  `outbox_events` **na mesma transação** (`withTransaction`).
- O `OutboxRelay` roda em loop, publica os eventos pendentes no barramento e
  só então os marca como publicados. Se falhar, o evento continua pendente e é
  retomado — **nenhum evento se perde**.
- O relay usa `SELECT ... FOR UPDATE SKIP LOCKED`, então várias instâncias
  podem rodar em paralelo sem processar o mesmo evento.

### 4.5 Optimistic Locking
- `payments.version` é incrementado a cada UPDATE (`WHERE status = $esperado
  AND version = $v`).
- Se dois webhooks chegarem juntos, o segundo não afeta nenhuma linha → o
  banco avisa → tratamos como transição inválida (409). Evita liquidação
  duplicada.

---

## 5. Autenticação e Autorização

- **Usuários (cliente/restaurante/admin)**: JWT emitido pelo Auth Service
  (no demo, pela rota `POST /api/v1/dev/login`). O middleware `authenticate`
  valida assinatura + algoritmo (evita ataque `alg=none`).
- **RBAC**: `requireRole('CLIENTE'|'RESTAURANTE'|'ADMIN')` libera só o perfil
  certo.
- **Propriedade**: `requireOwnershipOrAdmin` garante que um cliente só veja
  seus próprios pagamentos e o restaurante só veja o próprio painel (ADMIN
  vê tudo).
- **Webhooks do gateway**: NÃO usam JWT; usam `X-Gateway-Key` validada com
  comparação timing-safe. Em produção exige `GATEWAY_WEBHOOK_SECRET` no `.env`.

---

## 6. Como rodar e testar

Pré-requisitos: Node >= 18 e (opcional) PostgreSQL 16.

### Variáveis de ambiente (veja `.env.example`)
Crie um `.env` a partir de `.env.example`. As obrigatórias:
- `DATABASE_URL` — string de conexão do Postgres
- `JWT_SECRET` — segredo da assinatura do JWT
- `PAYMENT_DB_DRIVER` — `sql` (Postgres) ou `memory` (sem banco, para testes)
- `COMMISSION_RATE`, `SERVICE_FEE_CENTS`, `GATEWAY_WEBHOOK_SECRET`, etc.

### Comandos
```bash
npm install                 # instala dependências
npm run migrate             # roda as migrations no Postgres (driver sql)
npm run seed                # popula dados de demonstração (driver sql)
npm run db:reset            # limpa os dados (mantém schema)
npm test                    # todos os testes (unit + integração)
npm run test:postgres       # suíte ACID/ROLLBACK no Postgres real
npm start                   # sobe o servidor (porta 3001)
```

Com Docker:
```bash
docker compose up --build   # sobe db + payment-service
```

### Frontend de testes
A pasta `frontend-pagamentos/` (fora deste servidor) é um frontend de demo que
conversa com este backend. Por padrão ele usa um mock, mas detecta sozinho o
backend em `http://localhost:3001` e troca para os dados reais (incluindo o
Postgres) automaticamente.

### O que os testes cobrem
- **Unit** (`tests/unit/`): money, split, idempotência, máquina de estados.
- **Integração** (`tests/integration/`): fluxo das rotas HTTP (cobrança,
  replay, estorno, painéis) com repositório em memória.
- **Postgres real** (`tests/integration/postgres/`): prova em banco de verdade
  os requisitos transacionais — ROLLBACK automático, locking otimista,
  unicidade do ledger e timeout.

---

## 7. Estrutura de pastas (servidor)

```
payment-service/
├── src/
│   ├── domain/           # regras de negócio puras (payment, split, money, status, errors)
│   ├── application/      # casos de uso (payment-service, statement-service)
│   ├── interfaces/http/  # Express: app, routes, controllers, middlewares
│   ├── infrastructure/    # banco, gateway, outbox, jobs, container, config
│   └── server.js         # ponto de entrada (sobe HTTP + jobs)
├── tests/                # unit, integration, helpers
├── scripts/              # seed, reset-db
├── docs/                 # documentação complementar (segurança, resumo, etc.)
├── k8s/                  # manifestos Kubernetes
├── docker-compose.yml    # Postgres + serviço
├── Dockerfile
└── package.json
```

---

## 8. Notas para quem vai manter

- **Nunca sete `status` direto no banco**: use os métodos do agregado
  `Payment` e o `updateStatus` do repositório (que faz optimistic locking).
- **Sempre passe o `tx`** (transação) para os repositórios dentro de um
  `withTransaction`, senão o dado e o outbox não ficam atômicos.
- **Idempotência é sagrada**: qualquer nova rota de cobrança PRECISA do
  `requireIdempotencyKey` e da constraint UNIQUE no banco.
- **`.env` e `.env.run` NUNCA vão para o git** (estão no `.gitignore`). Só
  `.env.example` é versionado.
- **Webhooks**: mantenha o `X-Gateway-Key` e nunca desligue a validação em
  produção (o `requireGatewaySecret` avisa se o segredo estiver vazio).
- **CORS**: a whitelist de origens está em `ALLOWED_ORIGINS` (`.env`). Em
  desenvolvimento, inclua `http://localhost:8090` (frontend de demo).
```
