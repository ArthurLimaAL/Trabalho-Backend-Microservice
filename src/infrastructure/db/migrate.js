'use strict';

// Migrador minimalista (sem dependências externas):
// executa os arquivos de src/infrastructure/db/migrations em ordem
// e registra o histórico na tabela schema_migrations.
// Uso: npm run migrate
//
// Resumo do fluxo: para cada arquivo .sql (em ordem alfabética = ordem de
// criação), conferimos se já está registrado na schema_migrations; se não,
// rodamos o arquivo e gravamos o nome. Assim rodar `npm run migrate` várias
// vezes é seguro — as migrações já aplicadas são puladas (idempotente).

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { readEnv } = require('../../config/env');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// Executa as migrações pendentes em um pool/conexão já aberto.
// Exposto para que os testes de integração PostgreSQL possam preparar
// o banco com o MESMO código do `npm run migrate` (sem duplicar lógica).
async function runMigrations(pool, { dir = MIGRATIONS_DIR, logger = console } = {}) {
  // A tabela de controle nasce junto. filename é a PK, ou seja, um mesmo
  // arquivo nunca entra duas vezes (proteção extra contra reexecução).
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`
  );

  // Ordenar por nome (alfabético) é o que garante a ordem certa: usamos
  // prefixos numéricos nos arquivos justamente para isso (001_, 002_...).
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    // Se já consta no histórico, nada a fazer — segue para o próximo.
    const { rowCount } = await pool.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [file]);
    if (rowCount > 0) {
      logger.log(`[migrate] skip    ${file} (já aplicada)`);
      continue;
    }
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    // Cada migração roda dentro da PRÓPRIA transação: se o arquivo falhar
    // no meio, o ROLLBACK desfaz tudo e não sujamos o schema_migrations —
    // o arquivo continua "pendente" e pode ser corrigido e reexecutado.
    await pool.query('BEGIN');
    try {
      await pool.query(sql);
      await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await pool.query('COMMIT');
      logger.log(`[migrate] applied ${file}`);
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }

  logger.log('[migrate] OK');
}

async function main() {
  const config = readEnv();
  // Com driver memory não existe schema para migrar (rodamos em memória).
  if (config.databaseDriver === 'memory') {
    console.log('[migrate] Driver "memory" — nada a migrar.');
    return;
  }

  const pool = new Pool({ connectionString: config.databaseUrl });
  await runMigrations(pool);
  // Sempre encerrar o pool no final — senão o processo não termina
  // (o pool manteria conexões abertas impedindo o exit do Node).
  await pool.end();
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[migrate] Falha:', error.message);
    process.exit(1);
  });
}

module.exports = { runMigrations };
