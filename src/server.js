'use strict';

// Ponto de entrada (produção/docker): sobe o servidor e os jobs.
// Este arquivo é a "porta da frente" do processo: ele amarra as peças
// (config → container → app Express), inicia o HTTP e dispara os jobs
// em background. Em testes de integração NÃO passamos por aqui — o
// teste importa a fábrica de rotas e sobe um app próprio com supertest.
const { readEnv } = require('./config/env');
const { createContainer } = require('./infrastructure/container');
const { createApp } = require('./interfaces/http/app');

async function main() {
  // A ordem aqui importa: config primeiro (sem ela nada mais faz sentido),
  // depois o container (que resolve TODAS as dependências, DB, services,
  // jobs) e só então o app Express, que enxerga o mundo via container.
  const config = readEnv();
  const container = createContainer(config);
  const { app } = createApp(container);

  // Só agora começamos a aceitar requisições. Repare que o app não "sai"
  // do server.listen para a gente — por isso o container é passado como
  // parâmetro, e não importado por dentro do app (evita dependência circular).
  const server = app.listen(config.port, () => {
    // Este log é a primeira coisa que aparece num deploy; além da porta
    // mostramos o driver do banco (ex.: postgres ou sqlite) porque em
    // dev/docker é fácil subir com a configuração errada.
    console.log(`[payment-service] ouvindo em :${config.port} (driver: ${config.databaseDriver})`);
  });

  // Jobs que rodam "ao lado" do HTTP, no mesmo processo:
  // outboxRelay publica eventos pendentes (transações que falharam no meio)
  // e expireSweep caça cobranças que estouraram o timeout. São independentes
  // do tráfego HTTP — se o server cair, eles param junto com o processo.
  container.outboxRelay.start();
  container.expireSweep.start();

  // Desligamento gracioso: quando o container recebe SIGINT (Ctrl+C) ou
  // SIGTERM (kill do Docker/K8s), paramos os jobs e fechamos o server
  // ANTES de fechar o pool do banco. Se fechássemos o DB primeiro, uma
  // requisição em voo quebraria com conexão encerrada no meio do caminho.
  const shutdown = async () => {
    console.log('[payment-service] encerrando...');
    container.outboxRelay.stop();
    container.expireSweep.stop();
    server.close();
    await container.db.close();
    process.exit(0);
  };

  // Os dois sinais são tratados com a MESMA função porque, para o processo,
  // "Ctrl+C local" e "kill -TERM no orquestrador" significam a mesma coisa:
  // termine com calma. Sem esses handlers, o default do Node mataria o
  // processo sem deixar o pool do banco finalizar.
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Qualquer erro de boot (env inválida, banco fora do ar...) cai aqui e derruba
// o processo com exit code 1 — em produção o orquestrador reinicia. Melhor
// morrer rápido no start do que subir meio-quebrado e falhar a cada request.
main().catch((error) => {
  console.error('[payment-service] falha ao iniciar:', error.message);
  process.exit(1);
});
