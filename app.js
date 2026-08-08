const express = require('express');
const routes = require('./routes');
require('dotenv').config();

const app = express();

app.use(express.json());
app.use('/api', routes);

app.get('/', (req, res) => {
    res.send('Microsserviço de Pedidos rodando');
});

const PORT = process.env.PORT || 3003;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});