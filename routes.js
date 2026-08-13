const express = require('express');
const router = express.Router();
const db = require('./db');
const autenticacao = require('./authMiddleware');
const { validarTransicao, validarCancelamento } = require('./stateMachine');

function validarItens(itens) {
    if (!Array.isArray(itens) || itens.length === 0) {
        throw new Error('O pedido precisa ter pelo menos um item');
    }

    for (const item of itens) {
        if (!Number.isInteger(Number(item.produtoId)) || !Number.isInteger(Number(item.quantidade)) || Number(item.quantidade) <= 0) {
            throw new Error('Cada item precisa ter produtoId e quantidade positiva');
        }
    }
}

router.post('/pedidos', autenticacao, async (req, res) => {
    const { itens, restauranteId } = req.body;
    const usuarioId = req.usuario.id;
    let conexao;

    try {
        validarItens(itens);
        if (!Number.isInteger(Number(restauranteId))) {
            throw new Error('restauranteId inválido');
        }

        conexao = await db.getConnection();
        await conexao.beginTransaction();

        let valorTotal = 0;
        const itensConfirmados = [];

        for (const item of itens) {
            const [linhas] = await conexao.execute(
                'SELECT id, quantidade, preco FROM produtos WHERE id = ? FOR UPDATE',
                [item.produtoId]
            );

            if (linhas.length === 0) {
                throw new Error(`Produto ${item.produtoId} não encontrado`);
            }

            const produto = linhas[0];
            const quantidade = Number(item.quantidade);

            if (produto.quantidade < quantidade) {
                throw new Error(`Produto ${item.produtoId} sem estoque suficiente`);
            }

            valorTotal += Number(produto.preco) * quantidade;
            itensConfirmados.push({
                produtoId: produto.id,
                quantidade,
                preco: Number(produto.preco)
            });
        }

        const [resultadoPedido] = await conexao.execute(
            'INSERT INTO pedidos (user_id, restaurante_id, total, status) VALUES (?, ?, ?, ?)',
            [usuarioId, restauranteId, valorTotal.toFixed(2), 'CRIADO']
        );

        const pedidoId = resultadoPedido.insertId;

        await conexao.execute(
            'INSERT INTO historico_pedidos (pedido_id, status_anterior, status_novo) VALUES (?, ?, ?)',
            [pedidoId, null, 'CRIADO']
        );

        for (const item of itensConfirmados) {
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
        res.status(201).json({
            mensagem: 'Pedido criado com sucesso!',
            id: pedidoId,
            total: Number(valorTotal.toFixed(2)),
            status: 'CRIADO'
        });
    } catch (error) {
        if (conexao) await conexao.rollback();
        console.error(error);
        res.status(400).json({ erro: error.message });
    } finally {
        if (conexao) conexao.release();
    }
});

router.patch('/pedidos/:id/status', autenticacao, async (req, res) => {
    const pedidoId = Number(req.params.id);
    const novoStatus = req.body.status;
    let conexao;

    try {
        conexao = await db.getConnection();
        await conexao.beginTransaction();

        const [linhas] = await conexao.execute(
            'SELECT id, user_id, status FROM pedidos WHERE id = ? FOR UPDATE',
            [pedidoId]
        );

        if (linhas.length === 0) {
            throw new Error('Pedido não encontrado');
        }

        const pedido = linhas[0];
        if (Number(pedido.user_id) !== Number(req.usuario.id) && req.usuario.role !== 'SUPORTE') {
            await conexao.rollback();
            return res.status(403).json({ erro: 'Usuário sem permissão para alterar este pedido' });
        }

        validarTransicao(pedido.status, novoStatus);

        await conexao.execute(
            'UPDATE pedidos SET status = ? WHERE id = ?',
            [novoStatus, pedidoId]
        );

        await conexao.execute(
            'INSERT INTO historico_pedidos (pedido_id, status_anterior, status_novo) VALUES (?, ?, ?)',
            [pedidoId, pedido.status, novoStatus]
        );

        await conexao.commit();
        res.json({ mensagem: `Status atualizado para ${novoStatus}` });
    } catch (error) {
        if (conexao) await conexao.rollback();
        console.error(error);
        res.status(error.message === 'Pedido não encontrado' ? 404 : 400).json({ erro: error.message });
    } finally {
        if (conexao) conexao.release();
    }
});

router.patch('/pedidos/:id/cancelar', autenticacao, async (req, res) => {
    const pedidoId = Number(req.params.id);
    const { disputaId } = req.body;
    let conexao;

    try {
        conexao = await db.getConnection();
        await conexao.beginTransaction();

        const [linhas] = await conexao.execute(
            'SELECT id, user_id, status FROM pedidos WHERE id = ? FOR UPDATE',
            [pedidoId]
        );

        if (linhas.length === 0) {
            throw new Error('Pedido não encontrado');
        }

        const pedido = linhas[0];
        const ehDono = Number(pedido.user_id) === Number(req.usuario.id);
        const ehSuporte = req.usuario.role === 'SUPORTE';

        if (!ehDono && !ehSuporte) {
            await conexao.rollback();
            return res.status(403).json({ erro: 'Usuário sem permissão para cancelar este pedido' });
        }

        validarCancelamento(pedido.status, ehSuporte, disputaId);

        await conexao.execute(
            'UPDATE pedidos SET status = ? WHERE id = ?',
            ['CANCELADO', pedidoId]
        );

        await conexao.execute(
            'INSERT INTO historico_pedidos (pedido_id, status_anterior, status_novo) VALUES (?, ?, ?)',
            [pedidoId, pedido.status, 'CANCELADO']
        );

        await conexao.commit();
        res.json({ mensagem: 'Pedido cancelado com sucesso!' });
    } catch (error) {
        if (conexao) await conexao.rollback();
        console.error(error);
        res.status(error.message === 'Pedido não encontrado' ? 404 : 400).json({ erro: error.message });
    } finally {
        if (conexao) conexao.release();
    }
});

module.exports = router;
