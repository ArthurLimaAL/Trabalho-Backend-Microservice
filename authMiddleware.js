const jwt = require('jsonwebtoken');
require('dotenv').config();

function autenticacao(req, res, next) {
    const autorizacao = req.headers['authorization'];

    if (!autorizacao) {
        return res.status(401).json({erro: 'Token não fornecido'});
    }

    const token = autorizacao.split(' ')[1];

    try {
        const decodificador = jwt.verify(token, process.env.JWT_SECRET);

        req.usuario = {
            id: decodificador.id,
            role: decodificador.role
        };

        next();
    } catch (error) {
        return res.status(401).json({erro: 'Token inválido'});
    }
}

module.exports = autenticacao;