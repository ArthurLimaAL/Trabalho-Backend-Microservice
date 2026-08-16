# <span style="color: #2563eb;"><strong>Trabalho Backend Microservice</strong></span>

<span style="color: #1d4ed8;">projeto feito para a cadeira de Back end do grupo de desenvolvimento de software (DSI-12M).</span>

## <span style="color: #2563eb;"><strong>Visão geral</strong></span>

O sistema reúne diferentes módulos com responsabilidades específicas, como:

- <span style="color: #1d4ed8;"><strong>Autenticação</strong></span>: login, JWT e integração com OAuth do Google;
- <span style="color: #1d4ed8;"><strong>Pagamentos</strong></span>: fluxo de processamento e gerenciamento financeiro;
- <span style="color: #1d4ed8;"><strong>Notificações</strong></span>: envio de eventos e mensagens para usuários ou sistemas;
- <span style="color: #1d4ed8;"><strong>Frontend</strong></span>: interface para interação com os serviços;
- <span style="color: #1d4ed8;"><strong>Infraestrutura</strong></span>: uso de Docker e Kubernetes para executar e orquestrar os serviços.

A estrutura do repositório está organizada em módulos que representam diferentes partes do sistema, permitindo escalabilidade e manutenção mais simples.

## <span style="color: #2563eb;"><strong>Stack principal</strong></span>

- Node.js
- Express
- PostgreSQL
- JWT
- React + Vite
- Docker
- Kubernetes
- Git/GitHub

## <span style="color: #2563eb;"><strong>Estrutura do projeto</strong></span>

```bash
.
├── docker-compose.yml
├── Dockerfile
├── package.json
├── README.md
├── frontend/
├── services/
├── food/
├── src/
├── tests/
├── k8s/
├── scripts/
└── docs/
```

## <span style="color: #2563eb;"><strong>Principais serviços</strong></span>

- <span style="color: #1d4ed8;"><strong>Auth Service</strong></span>: responsável pela autenticação e emissão de tokens;
- <span style="color: #1d4ed8;"><strong>Notification Service</strong></span>: gerencia eventos e notificações;
- <span style="color: #1d4ed8;"><strong>Frontend</strong></span>: interface para consumo dos serviços;
- <span style="color: #1d4ed8;"><strong>Payment / Core service</strong></span>: lógica central relacionada a pagamentos e regras de negócio.

## <span style="color: #2563eb;"><strong>Como rodar o projeto</strong></span>

### 1) Clone o repositório

```bash
git clone https://github.com/ArthurLimaAL/Trabalho-Backend-Microservice.git
cd Trabalho-Backend-Microservice
```

### 2) Instale as dependências do projeto principal

```bash
npm install
```

### 3) Suba os containers com Docker

```bash
docker compose up --build
```

Isso inicializa os serviços principais definidos no arquivo de configuração do Docker.

### 4) Rode o backend de autenticação

```bash
cd services/auth-service
npm install
npm run dev
```

### 5) Rode o frontend

```bash
cd frontend
npm install
npm run dev
```

O frontend geralmente fica disponível em:

```bash
http://localhost:5173
```

## <span style="color: #2563eb;"><strong>Observações importantes</strong></span>

- <span style="color: #1d4ed8;">O projeto foi pensado para ser executado em ambiente local com Docker e serviços separados.</span>
- <span style="color: #1d4ed8;">As variáveis de ambiente e configurações sensíveis devem ser mantidas em arquivos locais ou variáveis do ambiente.</span>
- <span style="color: #1d4ed8;">Para produção, é recomendado revisar a configuração de segurança, rede e orquestração com Kubernetes.</span>

## <span style="color: #2563eb;"><strong>Equipe</strong></span>

- Arthur Lima
- Evelyn Karina
- Gabriel Martins
- Arthur Vinícius
- Esmael Victor
- Maria Eduarda
- Karollayne Correia

## <span style="color: #2563eb;"><strong>Resumo</strong></span>

<span style="color: #1d4ed8;">Este repositório representa um projeto acadêmico/experimental de microsserviços com foco em backend, autenticação, pagamentos e integração entre sistemas, com uma interface web para facilitar a interação e a demonstração do funcionamento.</span>
