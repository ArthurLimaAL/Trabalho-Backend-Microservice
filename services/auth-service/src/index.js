const express = require('express');
const cors = require('cors');
require('dotenv').config();

const authRoutes = require('./routes/authRoutes');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Rotas
app.use('/auth', authRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: 'Auth Service' });
});

// Esta linha DEVE ficar fora de funções assíncronas para manter o processo ativo
app.listen(PORT, () => {
  console.log(`Servidor Auth Service rodando na porta ${PORT}`);
});