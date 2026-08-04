# Microsserviço 4 — Pagamentos e Faturamento

Serviço de **Pagamentos & Faturamento** para um ecossistema de delivery (estilo iFood), implementado em **Node.js + Express + PostgreSQL** seguindo **Clean Architecture / Domain-Driven Design**.

> O frontend de testes iFood-style (`frontend-pagamentos/`) consome este contrato REST — ver [Frontend de testes](#frontend-de-testes).

---

## 1. O que este serviço faz

| Requisito (enunciado) | Implementação |
|---|---|
| **Idempotência absoluta** em cobranças | `idempotency_key` `UNIQUE` no banco + checagem rápida por chave; corridas resolvidas pela constraint (`INSERT … ON CONFLICT`). Gateway mock também idempotente pela mesma chave. |
| **Timeout de transações** | Cobranças `PENDENTE` expiram em `expires_at`; o sweep marca `FALHOU` e emite `OrderCancelRequested` para o Pedidos Service cancelar. |
| **Split Payment** | Na liquidação o valor é dividido automaticamente em **Restaurante / Plataforma (comissão + taxa) / Entregador** e gravado no ledger contábil. |
| **Extratos** | Cliente (histórico + comprovante), Restaurante (fatura, split por pedido, repasses), Admin (GMV, receita líquida, pendências, chargebacks, conciliação). |
| **Autenticação / RBAC** | JWTs do Auth Service validados; papéis `CLIENTE`, `RESTAURANTE`, `ADMIN`; controle de propriedade de recursos. |

---

## 2. Arquitetura

```
                  ┌────────────────────────────────────────────┐
                  │            Auth Service (externo)          │
                  └──────────────────▲─────────────────────────┘
                                     │ emite JWT (HS256)
┌──────────────┐   POST /charges     │   GET /payments          ┌─────────────────────┐
│   Frontend   │ ────────────────────┼─────────────────────────▶│   Payment Service   │
│ (teste/iFood)│                     │                          │  Node + Express     │
└──────────────┘                     │                          │  DDD/Clean Arch     │
                                     │                          └──────────┬──────────┘
┌──────────────┐  POST /webhooks      │                                     │
│ Gateway (mock│ ─────────────────────┴────────────────────────────────────▶│   PostgreSQL
│  externo)    │      (X-Gateway-Key)                                       │  (database-per-
└──────────────┘                                                            │   service)
                                                                            └──────────┬──────────
┌──────────────┐                                                                        │
│ Pedidos      │ ◀── Transactional Outbox: PaymentCreated / PaymentConfirmed /          │
│ Service      │     PaymentExpired / OrderCancelRequested / PaymentRefunded            │
└──────────────┘                                                                        ▼
```

**Padrões aplicados**

- **Transactional Outbox** — eventos de negócio são gravados na **mesma transação** do dado (`outbox_events`). O `OutboxRelay` publica depois (consistência eventual sem dupla escrita).
- **Database-per-Service** — este banco pertence exclusivamente a este microsserviço (nenhum outro serviço acessa as tabelas diretamente).
- **Composition Root** (`src/infrastructure/container.js`) — injeta repositórios `sql` ou `memory`, gateway, jobs e configuração. A camada HTTP só depende de interfaces.

---

## 3. Estrutura (Clean Architecture / DDD)

```
payment-service/
├── src/
│   ├── domain/                      # NÚCLEO: regras puras, zero dependências externas
│   │   ├── money.js                 #   dinheiro em centavos inteiros (nunca float)
│   │   ├── payment.js               #   agregado Payment (factory + métodos de estado)
│   │   ├── payment-status.js        #   máquina de estados estrita
│   │   ├── payment-errors.js        #   erros de domínio tipados
│   │   └── split.js                 #   calculadora de divisão de valores
│   ├── application/                 # CASOS DE USO
│   │   ├── payment-service.js       #   cobrança idempotente, confirmação, expiração, estorno
│   │   └── statement-service.js     #   extratos cliente/restaurante/admin
│   ├── infrastructure/              # ADAPTERS (tudo que muda: DB, I/O, mensageria)
│   │   ├── container.js             #   composição de dependências
│   │   ├── config/                  #   env + pool pg
│   │   ├── db/migrate.js            #   migrador simples (fila de arquivos .sql)
│   │   ├── db/migrations/001_init.sql
│   │   ├── gateway/payment-gateway.js      # gateway externo (mock idempotente)
│   │   ├── messaging/event-bus.js          # pub/sub local para testes
│   │   ├── messaging/outbox-relay.js       # publica eventos do outbox
│   │   ├── jobs/expire-sweep.js            # expira PENDENTES vencidas
│   │   └── repositories/                   # SQL + variantes em memória (factory)
│   └── interfaces/http/             # ENTRADA
│       ├── app.js                   #   fábrica Express (testável via supertest)
│       ├── server.js                #   boot
│       ├── middleware/              #   auth (JWT/RBAC/propriedade), idempotency, errors
│       ├── routes/                  #   /payments /webhooks /restaurants /admin
│       └── controllers/
├── tests/
│   ├── unit/                        # money, split, máquina de estados, idempotência
│   └── integration/                 # rotas completas (supertest)
├── scripts/seed.js                  # dados de demonstração
├── Dockerfile · docker-compose.yml · k8s/manifests.yaml
└── package.json
```

---

## 4. Regras de domínio

### 4.1 Dinheiro em centavos

Nenhum valor é manipulado como `float`. Todo dinheiro é `INTEGER` em centavos (`Money`). O PostgreSQL também guarda em `*_cents INTEGER`. Isso elimina erro de arredondamento de ponto flutuante (fundamental em faturamento).

### 4.2 Split Payment

```
bruto       = valorProdutos + taxaEntrega
comissao    = round(valorProdutos × taxaComissao)          → plataforma
plataforma  = comissao + taxaServico                       → plataforma
entregador  = taxaEntrega                                  → entregador
restaurante = bruto − plataforma − entregador              → restaurante
```

**Invariante:** `restaurante + entregador + plataforma === bruto` (verificada em `split.js` e testada). Nenhuma divisão pode criar ou perder dinheiro no ledger.

Exemplo: pedido R$ 100,00 de produtos + R$ 6,90 de entrega, comissão 12% e taxa de serviço R$ 1,50:

| Parte | Valor |
|---|---|
| Bruto | R$ 106,90 |
| Comissão (12%) | R$ 12,00 |
| Taxa de serviço | R$ 1,50 |
| **Plataforma** | **R$ 13,50** |
| **Entregador** | **R$ 6,90** |
| **Restaurante** | **R$ 86,50** |

### 4.3 Máquina de estados

```
PENDENTE ──▶ CONCLUIDO ──▶ ESTORNADO
   │
   └──▶ FALHOU   (terminal)
```

- **PENDENTE** → cobrança criada, aguardando confirmação do gateway (Pix/cartão).
- **CONCLUIDO** → gateway confirmou; o split é gravado no ledger; `PaymentConfirmed` emitido.
- **FALHOU** → expirou por timeout; `PaymentExpired` + `OrderCancelRequested` emitidos.
- **ESTORNADO** → reembolso de uma cobrança concluída.

Transições ilegais lançam `InvalidTransitionError`. O estado nunca é alterado via `UPDATE` direto: toda mudança passa por `assertValidTransition` (payment-status.js).

---

## 5. Decisões técnicas e o porquê

| Decisão | Por quê |
|---|---|
| `idempotency_key TEXT UNIQUE` | É a garantia **de verdade** de idempotência. A checagem "se existir, devolve" cobre o caso comum; a constraint cobre a **corrida** (duas requisições simultâneas com a mesma chave): a perdedora captura erro `23505` e devolve o vencedor. |
| Gateway também idempotente pela mesma chave | Evita cobrar o cliente duas vezes se a resposta do gateway se perder e houver retry. |
| `INSERT` + `ON CONFLICT` no repositório SQL | Sem locks explícitos; escalável e livre de deadlock. |
| **Optimistic Locking via `version`** | `UPDATE … WHERE status = esperado AND version = v` + `version = version + 1`. Duas transações/webhooks simultâneos na mesma cobrança: só a primeira afeta linha; a segunda recebe 0 linhas → erro `409` → `ROLLBACK`. A coluna `version` foi adicionada na migração `002`. |
| `UNIQUE INDEX` em `split_ledger(payment_id)` | Defesa em profundidade: mesmo que um bug/corrida tente liquidar a mesma cobrança duas vezes, o banco rejeita e a transação é desfeita. |
| Timeout via `expires_at` + sweep (`ExpireSweep`) | Não depende de timers em memória (perdidos em restart). Qualquer instância do serviço pode expirar cobranças órfãs. |
| `OrderCancelRequested` no mesmo evento | Fecha o ciclo: pagamento expirado ⇒ pedido cancelado (o Pedidos Service consome). |
| **Transactional Outbox** | Publicar evento dentro da mesma transação do dado é impossível; o outbox torna o envio **atômico com o estado**, com relé desacoplado (eventual). |
| Database-per-service | Microsserviços com banco compartilhado acoplam esquemas e criam corridas de deploy; cada serviço é dono do seu dado. |
| `UPDATE … WHERE status = esperado` (repositório SQL) | Proteção otimista contra duplo processamento de webhook/estorno em concorrência. |
| JWT com claims padronizados (`user_id`, `role`) | Um único padrão de claims em todas as rotas (Auth Service emite, Payment só valida a assinatura com `JWT_SECRET`). |
| **RBAC** + `requireOwnershipOrAdmin` | Cliente só vê/estorna as próprias cobranças; restaurante só o próprio painel; admin tudo. |

---

## 6. API REST

Base: `http://localhost:3001` · Prefixo: `/api/v1`

### Autenticação
- Rotas de usuário: `Authorization: Bearer <JWT>` (assinado com `JWT_SECRET`, HS256).
- Rotas de webhook: `X-Gateway-Key: <GATEWAY_WEBHOOK_SECRET>`.

> **Atenção (lição do enunciado):** o serviço **valida** o JWT com `jwt.verify` — não faz `jwt.decode` nem aceita tokens sem verificação. Se o segredo estiver errado, todas as rotas respondem `401`.

### Resumo de endpoints

| Método | Rota | Papel | Descrição |
|---|---|---|---|
| `POST` | `/api/v1/payments/charges` | CLIENTE | Cria cobrança. **Exige** `Idempotency-Key`. `201` (nova) / `200` (replay). |
| `GET` | `/api/v1/payments` | CLIENTE | Histórico do cliente autenticado (`?status=&method=`). |
| `GET` | `/api/v1/payments/:id` | dono ou ADMIN | Comprovante com split. |
| `POST` | `/api/v1/payments/:id/refund` | dono ou ADMIN | Estorno (só `CONCLUIDO`). |
| `POST` | `/api/v1/webhooks/pix` | gateway | Confirma Pix → `CONCLUIDO`. |
| `POST` | `/api/v1/webhooks/card` | gateway | Confirma cartão → `CONCLUIDO`. |
| `GET` | `/api/v1/restaurants/:id/dashboard` | dono ou ADMIN | Fatura/resumo do período (`?de=&ate=`). |
| `GET` | `/api/v1/restaurants/:id/splits` | dono ou ADMIN | Split por pedido. |
| `GET` | `/api/v1/restaurants/:id/payouts` | dono ou ADMIN | Histórico de repasses. |
| `GET` | `/api/v1/admin/dashboard` | ADMIN | GMV, receita líquida, pendências, estornos. |
| `GET` | `/api/v1/admin/monthly` | ADMIN | Série mensal GMV × receita. |
| `GET` | `/api/v1/admin/reconciliation` | ADMIN | Conciliação com o gateway + divergências. |
| `GET` | `/health` | — | Healthcheck (exibe driver ativo). |

### Exemplos

**1. Criar cobrança (idempotente)**
```bash
curl -X POST http://localhost:3001/api/v1/payments/charges \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: ordem-2026-08-02-001" \
  -d '{
    "orderId": "ORD-1102",
    "restaurantId": "res_01",
    "method": "PIX",
    "productAmountCents": 8990,
    "deliveryFeeCents": 690
  }'
```
Reenviar **exatamente a mesma chave** devolve `200` com o mesmo `payment.id` e `"replayed": true` — nunca cobra duas vezes.

**2. Confirmar via webhook**
```bash
curl -X POST http://localhost:3001/api/v1/webhooks/pix \
  -H "X-Gateway-Key: $WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"paymentId": "<uuid>", "gatewayId": "gw_abc123"}'
```
Resposta inclui o `split` calculado:
```json
{
  "payment": { "id": "…", "status": "CONCLUIDO", "amountCents": 10690 },
  "split": {
    "restaurantCents": 8650,
    "platformCents": 1350,
    "courierCents": 690
  },
  "replayed": false
}
```

**3. Estornar**
```bash
curl -X POST http://localhost:3001/api/v1/payments/<uuid>/refund \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason":"solicitação do cliente"}'
```

**Erros:** `400` validação · `401` token ausente/inválido · `403` perfil ou propriedade insuficientes · `404` não encontrado · `409` transição inválida · `422` idempotency key ausente.

---

## 7. Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3001` | Porta HTTP |
| `DATABASE_URL` | — | Conexão PostgreSQL (**obrigatória** em modo sql) |
| `PAYMENT_DB_DRIVER` | `sql` | `sql` (PostgreSQL) ou `memory` (testes/demo) |
| `JWT_SECRET` | — | Segredo do Auth Service (**obrigatório**; `env.js` lança erro se ausente) |
| `JWT_ALG` | `HS256` | Algoritmo de validação |
| `GATEWAY_WEBHOOK_SECRET` | vazio | Chave `X-Gateway-Key` dos webhooks |
| `COMMISSION_RATE` | `0.12` | Taxa de comissão da plataforma |
| `SERVICE_FEE_CENTS` | `150` | Taxa de serviço fixa (centavos) |
| `PAYMENT_TIMEOUT_MS` | `300000` | Prazo de expiração de `PENDENTE` |
| `OUTBOX_RELAY_INTERVAL_MS` | `1000` | Intervalo do relé de eventos |
| `EXPIRE_SWEEP_INTERVAL_MS` | `5000` | Intervalo do sweep de expiração |

**Nenhum segredo no código.** `src/config/env.js` lança erro em boot se `JWT_SECRET`/`DATABASE_URL` faltarem. Use `.env` (gitignored) ou secrets do orquestrador.

---

## 8. Como rodar

Requisitos: **Node ≥ 18**, **Docker** (para PostgreSQL) — ou um Postgres local.

### Local (com Postgres via Docker)
```bash
# 1) suba o banco
docker compose up -d db

# 2) configure o ambiente
cp .env.example .env

# 3) instale e rode
npm install
npm run migrate        # aplica src/infrastructure/db/migrations/*.sql
npm run seed           # dados de demonstração (opcional)
npm start              # http://localhost:3001
```

### Tudo em containers
```bash
docker compose up --build
```
O `payment` aguarda o healthcheck do `db` e roda `migrate` antes de subir.

> **Atenção (aprendizado do enunciado):** dentro da rede Docker o serviço conecta usando o **nome do serviço** `db` (`DATABASE_URL=…@db:5432/…`), **nunca** `localhost` — `localhost` apontaria para o próprio container e a conexão falharia.

### Kubernetes
Manifestos prontos em `k8s/manifests.yaml` (Deployment, Service, Secret de exemplo). Injete `JWT_SECRET` via Secret real.

### Testes
```bash
npm test                 # jest --runInBand (unit + integração) — 34 testes
npm run test:unit
npm run test:integration
npm run test:postgres    # SÓ a suíte PostgreSQL real (pula se o banco estiver fora)
npm run test:coverage    # ~81% statements / 85% lines
```

Os testes de integração padrão usam o driver `memory` + supertest (sem banco). O que é coberto:

- **unit/money** — centavos, rejeição de negativos/não-inteiros.
- **unit/split** — fórmula, invariante `soma === bruto`, exceção quando comissão excede o bruto.
- **unit/payment-state** — todas as transições válidas/inválidas da máquina de estados.
- **unit/idempotency** — replay devolve o mesmo resultado; corrida simulada não duplica.
- **integration/payments.routes** — cobrança, replay, confirmação com split, timeout + `OrderCancelRequested`, estorno, **RBAC 401/403**, painéis admin e propriedade de restaurante.

#### Suíte PostgreSQL (ACID / ROLLBACK / Locking) — `tests/integration/postgres/`

Prova em banco **real** as garantias transacionais do enunciado. Se o Postgres não estiver acessível, a suíte é **pulada** e `npm test` continua verde.

```bash
# 1) suba o banco
docker compose up -d db

# 2) (opcional) crie o banco de teste — o próprio teste tenta criar se não existir
docker compose exec db createdb -U payment payment_service_test

# 3) rode (TEST_DATABASE_URL aponta para o banco de teste por padrão)
npm run test:postgres
```

Cada teste comprova um requisito:

| Teste | Prova |
|---|---|
| **A** | **ROLLBACK** — falha no outbox no meio do fluxo apaga o `payment` parcial; retry com a mesma chave é idempotente e não duplica no gateway. |
| **B** | **ROLLBACK** — falha no ledger na confirmação mantém `PENDENTE`, sem `split_ledger` nem `PaymentConfirmed`. |
| **C** | **Locking otimista via versão** — escrita com `version` obsoleta é rejeitada (0 linhas → erro → rollback). |
| **C2** | **Concorrência real** — dois webhooks simultâneos: exatamente 1 linha de ledger; partes do split somam o bruto. |
| **D** | **Timeout** — cobrança vencida → `FALHOU` + `PaymentExpired` + `OrderCancelRequested` (sweep). |
| **E** | **Unicidade do ledger** — segunda liquidação da mesma cobrança é rejeitada pelo `UNIQUE INDEX`. |

---

## 9. Frontend de testes

Em `frontend-pagamentos/` (HTML/CSS/JS puro, sem build) há um frontend **estilo iFood** com duas experiências:

### Experiência de compra (visual iFood)

- **Home** — busca, categorias e cards de restaurantes (nota, tempo, distância, "entrega grátis").
- **Menu** — itens agrupados por categoria com preço e adição/remoção na sacola.
- **Sacola / Checkout** — resumo, dados de entrega, Pix ou cartão.
- **Pagamento** — cobrança real criada no motor (`POST /charges` com `Idempotency-Key`), **countdown real** e código Pix copia-e-cola; confirmar dispara o webhook do gateway.
- **Confirmado / Expirado** — sucesso com split do pedido, ou **timeout → `FALHOU` + pedido cancelado** (`OrderCancelRequested`).

### Painel de testes (4 visões técnicas)

- **Cliente** — histórico, filtros e **comprovante** com split bar e idempotency key.
- **Restaurante** — cards financeiros, detalhe de split por pedido e histórico de repasses.
- **Admin** — GMV, receita líquida, gráfico mensal, conciliação/chargebacks.
- **Simulador** — cria cobranças com `Idempotency-Key`, reenviar a mesma chave, confirmar webhook, forçar timeout (vê o `OrderCancelRequested`) e estornar, com log de API em tempo real.

**Como rodar:** abra `frontend-pagamentos/index.html` direto no navegador, ou sirva com
`python3 -m http.server -d frontend-pagamentos 8090` e acesse `http://localhost:8090/`.

### Teste automatizado do frontend (jsdom)

```bash
cd frontend-pagamentos
npm install        # instala jsdom (devDependency)
npm test           # smoke test: home → menu → sacola → checkout → pagamento → confirmado
                   # e timeout → FALHOU, idempotência, split e as 4 visões
```

O `test/smoke.test.js` carrega `index.html` + `mock-api.js` + `app.js` num DOM real (jsdom) e percorre a jornada inteira, validando: busca/categorias, sacola, cobrança `PENDENTE` com countdown, confirmação via webhook, split exato (`restaurante + plataforma + entregador === bruto`), código Pix, **replay idempotente da mesma chave**, timeout → `FALHOU` + cancelamento, e render das 4 visões técnicas.

O frontend usa o **mock** (`js/mock-api.js`) que replica fielmente as regras deste serviço (idempotência, split, timeout, estados) e trabalha com **valores em centavos inteiros**, igual ao domínio real. Para ligar ao backend real, substitua os métodos do mock por chamadas `fetch()` aos endpoints da seção [6. API REST](#6-api-rest), enviando o JWT em `Authorization` e a chave em `Idempotency-Key`.

---

## 10. Automação: `test-everything.sh`

Script único na raiz do projeto (`/Projeto/test-everything.sh`) que valida o ecossistema inteiro:

```bash
./test-everything.sh            # backend + frontend + postgres (auto-skip) + sintaxe
./test-everything.sh --no-pg    # pula o PostgreSQL
./test-everything.sh --open     # sobe o frontend e abre no navegador ao final
```

Etapas:

1. **Backend** — `npm test` (34 testes: money, split, máquina de estados, idempotência, rotas).
2. **Frontend** — `npm test` (smoke jsdom da jornada iFood); instala `node_modules` se faltar.
3. **PostgreSQL real** — `npm run test:postgres` (suíte ACID/ROLLBACK/locking; **auto-skip** se o banco estiver offline).
4. **Sintaxe** — `node --check` nos JS do frontend.

Usa o Node global se existir; caso contrário, cai para `/tmp/opencode/node-v22.23.2-darwin-x64/bin`.

---

## 11. Notas de segurança (conscientes dos riscos do enunciado)

- O JWT é **validado** (assinatura + algoritmo), nunca apenas decodificado.
- Um único padrão de claims (`user_id`, `role`) é usado em todas as rotas.
- RBAC por perfil + verificação de **propriedade** do recurso (dono ou admin).
- Idempotência garantida por **constraint de banco** (não por lock de aplicação).
- Pagamentos não podem ser confirmados duas vezes (estado + `UPDATE … WHERE status`).
- Nenhuma chave/segredo hardcoded.

---

## 12. Como o código funciona (com trechos comentados)

Os arquivos do `src/` estão comentados em português (tom senior-dev) explicando o *porquê* de cada decisão. Os trechos abaixo são os mais pedagógicos — leia-os junto com o código real.

### 12.1 Máquina de estados (`src/domain/payment-status.js`)

```js
// PARA O JÚNIOR: pense nisso como as regras de um semáforo — o sinal só pode
// seguir caminhos permitidos, e "pular" de vermelho direto para apagado é
// proibido. Aqui o fluxo de vida de um pagamento é:
//   1. Cobrança criada → PENDENTE (aguardando pagamento do cliente)
//   2. Gateway confirma → CONCLUIDO (dinheiro chegou)
//   3. Tempo esgotou   → FALHOU (terminal: não dá mais para pagar)
//   4. Estorno/chargeback → ESTORNADO (só a partir de CONCLUIDO)
//
// Repare que NÃO existe caminho de volta: FALHOU não vira CONCLUIDO e
// ESTORNADO não volta a CONCLUIDO. Isso é de propósito — estados financeiros
// são irreversíveis, e permitir "voltas" abriria brecha para inconsistência
// no ledger (dinheiro que some ou aparece do nada).
const ALLOWED_TRANSITIONS = {
  PENDENTE: new Set([PAYMENT_STATUS.CONCLUIDO, PAYMENT_STATUS.FALHOU]),
  CONCLUIDO: new Set([PAYMENT_STATUS.ESTORNADO]),
  FALHOU: new Set(),
  ESTORNADO: new Set(),
};

function assertValidTransition(from, to) {
  // ...lança InvalidTransitionError (HTTP 409) se `to` não estiver
  // no Set de estados permitidos para `from`.
}
```

### 12.2 Split payment (`src/domain/split.js`)

```js
// EXEMPLO REAL: pedido de R$ 100,00 em produtos + R$ 10,00 de entrega,
// comissão de 15% e taxa de serviço fixa de R$ 2,00:
//   bruto       = 10000 + 1000              = 11000 centavos (R$ 110,00)
//   comissao    = 10000 × 0,15              =  1500 (R$ 15,00)
//   plataforma  = 1500 + 200                =  1700 (R$ 17,00)
//   entregador  = 1000                      =  1000 (R$ 10,00)
//   restaurante = 11000 − 1700 − 1000       =  8300 (R$ 83,00)
//   Confere: 1700 + 1000 + 8300 = 11000 ✓ (nada sobra, nada falta)
//
// Repare no papel do "restaurante = bruto − o resto": ele é o valor que sobra
// por construção, ou seja, a invariante da soma NUNCA pode falhar por causa
// de arredondamento. O Math.round na comissão é onde o centavo se perderia —
// por isso o restaurante absorve qualquer diferença de 1 centavo.
class SplitCalculator {
  static calculate({ productAmountCents, deliveryFeeCents, commissionRate, serviceFeeCents }) {
    const products = Money.assertNonNegative(productAmountCents);
    const delivery = Money.assertNonNegative(deliveryFeeCents);
    const service = Money.assertNonNegative(serviceFeeCents);

    const gross = products + delivery;
    const commission = Math.round(products * commissionRate);
    const platform = commission + service;
    const courier = delivery;
    // O restaurante recebe o que sobra. É o "ajuste final" que fecha a conta.
    const restaurant = gross - platform - courier;

    // Guarda de sanidade: se comissão + taxas juntas ultrapassarem o bruto,
    // o restaurante ficaria "devendo" (negativo). Isso nunca deveria ocorrer,
    // mas se a config de comissão mudar para um valor abusivo, queremos saber
    // agora — não quando o restaurante reclamar do repasse.
    if (restaurant < 0) {
      throw new Error('Split inválido: comissão + taxas excedem o valor bruto cobrado.');
    }

    // Confere a invariante de ponta a ponta... É uma "apólice de seguro":
    // se alguém mexer na fórmula, o teste quebra na hora.
    if (restaurant + courier + platform !== gross) {
      throw new Error('Split inválido: a soma das partes difere do valor bruto (invariante quebrada).');
    }
  }
}
```

> **Por que centavos?** Comissão é percentual: 15% de R$ 33,33 = R$ 4,9995. Em `float` isso vira um número quebrado impossível de guardar com exatidão. Multiplicando centavos e arredondando para inteiro, o ledger só conhece valores exatos.

### 12.3 Cobrança idempotente (`src/application/payment-service.js`)

```js
async createCharge(input, idempotencyKey) {
  // Sem chave não há como garantir "não cobrar de novo", então recusamos.
  if (!idempotencyKey) throw new IdempotencyKeyRequiredError();

  // Passo 1 — caminho "feliz" do replay: a chave já existe, então devolvemos
  // o estado atual sem tocar no gateway nem no banco de escrita.
  const existing = await this.payments.findByKey(idempotencyKey);
  if (existing) return { payment: existing.toJSON(), replayed: true };

  // ...normaliza centavos, chama o agregado Payment e:
  //   1. autoriza no gateway (também idempotente pela mesma chave);
  //   2. INSERT payment + outbox_events na MESMA transação;
  //   3. se a constraint UNIQUE explodir (corrida de duas requisições
  //      simultâneas com a mesma chave), devolve o vencedor com 200.
}
```

O **poder da idempotência** está em três camadas: a checagem por chave (cobre o caso comum), o gateway idempotente (cobre retry) e a `idempotency_key TEXT UNIQUE` no banco (cobre a corrida). A perdedora captura erro `23505` e devolve o vencedor — nunca cobra duas vezes.

### 12.4 Optimistic locking (`src/infrastructure/repositories/payment-repository.sql.js`)

```js
// O coração do optimistic locking está no WHERE:
//   status = $8  → só atualiza se o status atual bate com o esperado;
//   version = $9 → só atualiza se ninguém incrementou a versão desde a
//                   leitura. E o SET incrementa version = version + 1.
// Se 0 linhas foram afetadas, é porque houve corrida (dois webhooks ao
// mesmo tempo, por exemplo) — e aí tratamos como transição inválida.
const { rows, rowCount } = await client.query(
  `UPDATE payments
      SET status = $2, gateway_id = $3, reason = $4,
          paid_at = $5, expired_at = $6, refunded_at = $7,
          version = version + 1
    WHERE id = $1 AND status = $8 AND version = $9
    RETURNING ${PAYMENT_COLUMNS}`,
  [ /* … */ ]);
if (rowCount === 0) { /* → InvalidTransitionError (409) */ }
```

Repare no parâmetro `tx`: quando passado, o repositório usa **essa conexão de transação** em vez do pool. É assim que o `INSERT` do pagamento e o do outbox participam da **mesma transação** aberta pelo serviço — o "tudo ou nada".

### 12.5 Transactional Outbox (`src/infrastructure/messaging/outbox-relay.js`)

```js
// Tudo acontece dentro de UMA transação:
//   1. claim → seleciona (e trava) até N eventos não publicados;
//   2. publish → envia para o barramento;
//   3. markPublished → marca como publicados.
// Se o publish falhar no meio, o ROLLBACK desfaz o markPublished e os
// eventos continuam não-publicados no outbox — serão retomados na
// próxima rodada. Nenhum evento se perde (é o coração do padrão).
await this.db.withTransaction(async (tx) => {
  const events = await this.outbox.claimUnpublished(tx, 100);
  if (!events.length) return;
  for (const event of events) {
    await this.bus.publish({ id: event.id, type: event.type, payload: event.payload });
  }
  await this.outbox.markPublished(events.map((e) => e.id), tx);
});
```

### 12.6 Rotas dev (só demonstração — `src/interfaces/http/routes/dev.routes.js`)

```js
// ROTAS SOMENTE PARA DEMO/TESTES — nunca em produção!
// POST /dev/login  → emite um JWT "fake" para o papel pedido (o Auth
//                    Service real é quem faz isso). O frontend de testes
//                    usa para simular CLIENTE/RESTAURANTE/ADMIN.
// POST /dev/payments/:id/expire → força o timeout de uma cobrança,
//                    disparando PaymentExpired + OrderCancelRequested.
```

Isso permite o `frontend-pagamentos/` operar o backend real sem depender do Auth Service de verdade.

---

## 13. 🔐 Segurança

### Visão geral

O Payment Service implementa **segurança em camadas (defense in depth)** para proteger contra:
- Acesso não autorizado a dados financeiros
- Vazamento de chaves de API
- Ataques de abuso (DoS, brute force)
- Vazamento de informações sensíveis

### Autenticação

| Métrica | Detalhes |
|---------|----------|
| JWT | HS256 assinado com `JWT_SECRET` |
| Validação | ✅ Sempre verifica assinatura (não apenas decodifica) |
| Claims | `user_id`, `role`, `email` |
| Algoritmo | Lista explícita: `algorithms: [config.jwtAlg]` |

**Importante:** O middleware `authenticate()` sempre verifica a assinatura com o segredo. Tokens inválidos retornam `401 Unauthorized`.

### Autorização (RBAC)

| Papel | Permissões |
|-------|------------|
| `CLIENTE` | Seus próprios pagamentos |
| `RESTAURANTE` | Seus restaurantes e repasses |
| `ADMIN` | Todo o sistema |

**Middleware:** `requireRole('CLIENTE')` ou `requireOwnershipOrAdmin(getOwnerId)`

### Proteção de Webhooks

Webhooks usam `X-Gateway-Key` com comparação timing-safe:

```javascript
// src/interfaces/http/middleware/idempotency.middleware.js
const isValid = crypto.timingSafeEqual(
  Buffer.from(webhookKey),
  Buffer.from(secret)
);
```

**❌ NEVER em produção:** Deixe `GATEWAY_WEBHOOK_SECRET` vazio

### Rate Limiting

Proteção contra abuso:
- Default: 100 requisições por minuto
- Webhooks: 200 req/min
- Admin: 30 req/min

### Headers de Segurança

| Header | Valor | Propósito |
|--------|-------|-----------|
| `X-Frame-Options` | `DENY` | Evita clickjacking |
| `X-Content-Type-Options` | `nosniff` | Previne MIME sniffing |
| `X-XSS-Protection` | `1; mode=block` | Proteção XSS básica |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Controla referrer |
| `Permissions-Policy` | `geolocation=(), microphone=(), camera=()` | Desabilita APIs |
| `Cache-Control` | `no-store, no-cache` | Dados sensíveis não são cacheados |

### CORS

Origins restritas a lista branca:
```javascript
allowedOrigins: ['http://localhost:8090', 'https://seusite.com']
```

### Diferença entre 401 e 403

| Status | Significado | Exemplo |
|--------|-------------|---------|
| 401 | "Quem é você?" - Token ausente ou inválido | `Authorization: Bearer **` faltando |
| 403 | "Você é quem você diz ser, mas não pode fazer isso" | Usuário `CLIENTE` tentando acessar `/admin/` |

### Variáveis sensíveis (os "segredos")

| Variável | Onde usar | Como gerar |
|----------|-----------|------------|
| `JWT_SECRET` | Assinatura de tokens | `openssl rand -base64 32` |
| `DATABASE_URL` | Conexão PostgreSQL | Formato: `postgres://user:pass@host:5432/db` |
| `GATEWAY_WEBHOOK_SECRET` | Validação de webhook | `openssl rand -base64 32` |

### Como configurar em produção

#### Docker Compose

```bash
# Crie .env com segredos fortes
cp .env.example .env
echo "JWT_SECRET=$(openssl rand -base64 32)" >> .env
echo "GATEWAY_WEBHOOK_SECRET=$(openssl rand -base64 32)" >> .env
```

#### Kubernetes

```bash
kubectl create secret generic payment-service-secrets \
  --from-literal=JWT_SECRET=$(openssl rand -base64 32) \
  --from-literal=GATEWAY_WEBHOOK_SECRET=$(openssl rand -base64 32)
```

### Roteiro de segurança

1. **Semanal:** Verificar logs de segurança
2. **Mensal:** Rotacionar JWT_SECRET e GATEWAY_WEBHOOK_SECRET
3. **Trimestral:** Auditoria de acesso

### Logs de segurança

Eventos monitorados:
- Tentativas de autenticação falhadas (401)
- Acessos negados (403)
- Rate limit excedido (429)
- Webhook com chave inválida

Ver detalhes em: `docs/SEGURANCA.md`

---

## 14. Referências

- [OWASP Top 10](https://owasp.org/standards/)
- [JWT.io](https://jwt.io/)
- [Node.js Security Best Practices](https://github.com/goldbergyoni/nodebestpractices#1-project-structure-practices)

---

## 🔄 Autenticação de Microsserviços

Outros microsserviços (Order Service, Gateway, Notification Service) podem precisar se conectar ao Payment Service. Para isso, use **API Keys de serviço**.

### Como usar API Keys

#### 1. Criar uma API Key

```bash
# Criar API key para o Order Service
node scripts/setup-api-keys.js --service order-service --role order_service
```

#### 2. Usar a API Key nas requisições

```bash
# Header obrigatório
curl -X GET http://localhost:3001/api/v1/payments \
  -H "X-API-Key: order-service-abc123..."
```

### Permissões por Microsserviço

| Serviço | Read | Write | Webhooks | Admin |
|---------|------|-------|----------|-------|
| `gateway` | ✅ | ✅ | ✅ | ❌ |
| `order-service` | ✅ | ✅ | ❌ | ❌ |
| `auth-service` | ✅ | ❌ | ❌ | ❌ |
| `notification-service` | ✅ | ❌ | ❌ | ❌ |

### Configuração Kubernetes

```yaml
# Crie o Secret com as API keys
apiVersion: v1
kind: Secret
metadata:
  name: payment-service-api-keys
type: Opaque
stringData:
  ORDER_SERVICE_API_KEY: <chave-gerada>
  GATEWAY_API_KEY: <chave-gerada>

# No pod do Order Service
env:
  - name: PAYMENT_SERVICE_API_KEY
    valueFrom:
      secretKeyRef:
        name: payment-service-api-keys
        key: ORDER_SERVICE_API_KEY
```

### Timeout

- API Keys expiram em 90 dias (configurável)
- Roteine periodicamente: `node scripts/seed-api-keys.js`

---

Projeto acadêmico — implementação do **Microsserviço 4: Pagamentos e Faturamento** (idempotência absoluta, split payment, timeout/expiração e extratos/relatórios).
