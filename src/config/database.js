'use strict';

const { Pool } = require('pg');

// Abstração de persistência usada por toda a aplicação.
//  - 'sql'    → pool real do PostgreSQL (runtime)
//  - 'memory' → transações "no-op" (usada pelos repositórios in-memory nos testes)
// As regras de negócio não conhecem o driver; só o container decide qual injetar.
//
// Por que UM pool único? O pg já faz pool de conexões por baixo e o reuso
// de conexões é caro de abrir (handshake TCP + auth). Ter um pool central
// significa que todos os queries da aplicação compartilham a mesma cota de
// conexões em vez de cada módulo abrir a sua. O pool gerencia fila,
// timeouts e reconexão automaticamente.
function createDatabase(config) {
  // Driver 'memory': nada de banco de verdade. O withTransaction vira no-op
  // (passa null como "cliente") porque os repositórios in-memory não
  // precisam de transação — os testes rodam rápido e sem Postgres.
  if (config.databaseDriver === 'memory') {
    return {
      kind: 'memory',
      async withTransaction(fn) {
        return fn(null);
      },
      async close() {},
    };
  }

  const pool = new Pool({ connectionString: config.databaseUrl });
  return {
    kind: 'sql',
    pool,
    // withTransaction isola a semântica de transação em um único lugar.
    // O que ele faz:
    //   1. Pega UMA conexão do pool (client) e inicia o BEGIN;
    //   2. Executa a função do chamador passando esse client — daí os
    //      repositórios conseguem usar a MESMA conexão (mesmo contexto tx);
    //   3. COMMIT em caso de sucesso, ROLLBACK em qualquer erro;
    //   4. SEMPRE devolve a conexão ao pool no finally (senão vaza conexão).
    // Repare que o retorno da fn é propagado: quem chama pode fazer
    // `return await db.withTransaction(...)` e obter o resultado do meio.
    async withTransaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        // Se qualquer coisa lançar, desfazemos TUDO (rollback) — assim nunca
        // ficamos com metade de uma operação gravada (ex.: pagamento sem outbox).
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      // Encerra todas as conexões do pool (usado no shutdown do processo).
      await pool.end();
    },
  };
}

module.exports = { createDatabase };
