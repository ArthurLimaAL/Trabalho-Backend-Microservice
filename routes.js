const express = require('express');
const router = express.Router();
const db = require('./db');
const autenticacao = require('./authMiddleware');
const {validarTransicao} = require('./stateMachine');

router.post('/pedidos', autenticacao, async (req, res) => {
    const {itens, restauranteId, endereco} = req.body;
    const usuarioId = req.usuario.id;

    let conexao;

    try {
        conexao = await db.getConnection();
        await conexao.beginTransaction();
        
        for (const item of itens) {
            const [linhas] = await conexao.execute(
                'SELECT quantidade FROM produtos WHERE id = ? FOR UPDATE',
                [item.produtoId]
            );

            if (linhas.length === 0 || linhas[0].quantidade < item.quantidade) {
                throw new Error(`Produto ${item.produtoId} sem estoque suficiente`);
            }
        }

        const valorTotal = 100.00;
        const [resultadoPedido] = await conexao.execute(
            'INSERT INTO pedidos (user_id, restaurante_id, total, status) VALUES (?, ?, ?, ?)',
            [usuarioId, restauranteId, valorTotal, 'CRIADO']
        );

        const pedidoId = resultadoPedido.insertId;

        for (const item of itens) {
            await conexao.execute(
                'INSERT INTO pedidos_itens (order_id, produto_id, quantidade, preco) VALUES (?, ?, ?, ?)',
                [pedidoId, item.produtoId, item.quantidade, item.preco]
            );

        await conexao.execute(
            'UPDATE produtos SET quantidade = quantidade - ? WHERE id = ?',
            [item.quantidade, item.produtoId]
        );
    }

    await conexao.commit();

    res.status(201).json({ mensagem: 'Pedido criado com sucesso!', id: pedidoId });
    } catch (error) {
        if (conexao) await conexao.rollback();
        console.error(error);
        res.status(400).json({ erro: error.message });
    } finally {
        if (conexao) conexao.release();
    };
});

router.patch('/pedidos/:id/status', autenticacao, async (req, res) => {
    const pedidoId = req.params.id;
    const novoStatus = req.body.status;
    const conexao = await db.getConnection();

    try {
        const [linhas] = await conexao.execute(
            'SELECT status FROM pedidos WHERE id = ?',
            [pedidoId]
        );

        if (linhas.length === 0) {
            return res.status(404).json({ erro: 'Pedido não encontrado' });
        }

        const statusAtual = linhas[0].status;

        validarTransicao(statusAtual, novoStatus);

        await conexao.execute(
            'UPDATE pedidos SET status = ? WHERE id = ?',
            [novoStatus, pedidoId]
        );

        res.json({ mensagem: `Status atualizado para ${novoStatus}` });
    } catch (error) {
        console.error(error);
        res.status(400).json({ erro: error.message });
    } finally {
        conexao.release();
    }
});

module.exports = router;