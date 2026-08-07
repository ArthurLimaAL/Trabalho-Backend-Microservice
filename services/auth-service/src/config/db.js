const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: String(process.env.DB_USER || 'postgres'),
  host: String(process.env.DB_HOST || 'localhost'),
  database: String(process.env.DB_NAME || 'auth_db'),
  password: String(process.env.DB_PASSWORD || 'sua_senha_aqui'),
  port: Number(process.env.DB_PORT) || 5432,
});

pool.connect()
  .then(client => {
    console.log('Conectado ao PostgreSQL com sucesso!');
    client.release();
  })
  .catch(err => {
    console.error('Erro ao conectar no banco de dados:', err.message);
  });

module.exports = {
  query: (text, params) => pool.query(text, params),
};