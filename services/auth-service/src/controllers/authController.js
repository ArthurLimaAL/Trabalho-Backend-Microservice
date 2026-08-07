const bcrypt = require('bcrypt');
const db = require('../config/db');

exports.register = async (req, res) => {
  const { email, password, role } = req.body;

  // 1. Validações de campos obrigatórios
  if (!email || !password || !role) {
    return res.status(400).json({ error: 'Email, senha e role são obrigatórios.' });
  }

  const validRoles = ['CLIENTE', 'RESTAURANTE', 'ENTREGADOR', 'ADMIN'];
  if (!validRoles.includes(role.toUpperCase())) {
    return res.status(400).json({ error: 'Role inválida.' });
  }

  try {
    // 2. Verificar se usuário já existe
    const userExists = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (userExists.rows.length > 0) {
      return res.status(409).json({ error: 'E-mail já cadastrado.' });
    }

    // 3. Hash da senha
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // 4. Inserir no banco
    const newUser = await db.query(
      'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id, email, role, created_at',
      [email, passwordHash, role.toUpperCase()]
    );

    return res.status(201).json(newUser.rows[0]);

  } catch (error) {
    console.error('Erro no registro:', error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
};