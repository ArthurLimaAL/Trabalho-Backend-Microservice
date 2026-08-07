# 📨 Notification Service

Microsserviço de **Notificações** do sistema de delivery.

## 🎯 Responsabilidade

Disparo **assíncrono** de alertas, mensagens e pushes informativos para **Clientes**, **Restaurantes** e **Entregadores**, de forma **desacoplada** do fluxo de pedidos/pagamentos.

## 📁 Estrutura

```
src/
├── app.js                    # App Express (healthcheck + rotas)
├── server.js                 # Bootstrap: sobe o barramento + consumidor + HTTP
├── routes/
│   └── notificationRoutes.js # Rotas HTTP (listar + criar)
├── controllers/              # (se houver) lógica das rotas
├── models/
│   └── notification.js       # Domínio: criarNotificacao + enums
├── data/
│   └── notificationRepository.js # Persistência em memória (mock)
├── templates/
│   ├── registry.js           # Registro de templates por evento
│   └── renderer.js           # Preenche {placeholders} com o payload
└── events/
    ├── eventBus.js           # Barramento pub/sub (ESM)
    └── notificationListener.js # Consumidor de eventos
```

## 🧱 Decisões Arquiteturais

### 1. Processamento assíncrono desacoplado (non-blocking)
O serviço **escuta eventos** (ex: `PedidoCriado`, `PagamentoAprovado`, `SaiuParaEntrega`) via barramento pub/sub. Ele **nunca** é chamado de forma síncrona dentro da transação de outro serviço — a falha do envio de uma notificação **nunca** trava nem reverte um pedido/pagamento.

```javascript
// server.js (conceito)
const bus = new EventBus();
registrarConsumidor(bus); 
```

### 2. Idempotência de disparo
Cada evento carrega um `id` único. O listener usa esse `id` como `idempotencyKey` e consulta o repositório antes de disparar. Se o mesmo evento for reprocessado pelo barramento, o disparo **não é duplicado**.

```javascript
// notificationListener.js (conceito)
const jaExiste = buscarPorIdempotencyKey(event.id);
if (jaExiste) return; // evento já processado → ignora
```

### 3. Isolamento de falhas
O envio real (SMS/Push/e-mail) é isolado em `try/catch`. Uma falha marca a notificação como `FALHOU`, mas **não** derruba o processo nem afeta o evento de origem.

### 4. Templates dinâmicos
Mensagens são preenchidas a partir do payload do evento:

| Evento | Template |
|---|---|
| `PedidoCriado` | `Olá {nome}, seu pedido #{numero} foi recebido!` |
| `PagamentoAprovado` | `Olá {nome}, seu pagamento de R$ {valor} foi aprovado.` |
| `SaiuParaEntrega` | `Olá {nome}, seu pedido #{numero} saiu para entrega!` |

### 5. Persistência
Listas **mockadas em memória/JSON** (permitido pelo enunciado para serviços não obrigatórios). Database-per-Service **não se aplica** pois não há banco próprio.

## 🔌 Rotas da API

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/health` | Healthcheck |
| `GET` | `/notifications` | Lista notificações |
| `POST` | `/notifications` | Cria notificação |

## 🚀 Como rodar

### Local (sem Docker)
```bash
npm install
npm start
# http://localhost:3004
```

### Com Docker
```bash
docker build -t notification-service .
docker run -p 3004:3004 notification-service
```

### Docker Compose (ecossistema)
```bash
docker compose up --build notification
```

### Kubernetes
```bash
kubectl apply -f k8s/notification-service.yaml
```

## 🧪 Testes
```bash
npm test
# 7 testes unitários (domínio, templates, idempotência)
```

## ✅ Requisitos do enunciado atendidos
- [x] Isolamento de falhas (non-blocking)
- [x] Processamento assíncrono baseado em eventos
- [x] Idempotência de disparo
- [x] Histórico e templates dinâmicos
- [x] Docker (multistage build, não-root, sem segredos)
- [x] Kubernetes (Deployment, Service, ConfigMap, NetworkPolicy)
- [x] Testes unitários
