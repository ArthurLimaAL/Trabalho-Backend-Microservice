const transicoes = {
    CRIADO: ['PAGO'],
    PAGO: ['EM_PREPARO'],
    EM_PREPARO: ['SAIU_PARA_ENTREGA'],
    SAIU_PARA_ENTREGA: ['CONCLUIDO']
};

function validarTransicao(statusAtual, novoStatus) {
    if (!transicoes[statusAtual] || !transicoes[statusAtual].includes(novoStatus)) {
        throw new Error(`Transição inválida de ${statusAtual} para ${novoStatus}`);
    }
    return true;
}

function validarCancelamento(statusAtual, ehSuporte, disputaId) {
    const estadosCancelaveisPeloCliente = ['CRIADO', 'PAGO'];
    const estadosAvancados = ['EM_PREPARO', 'SAIU_PARA_ENTREGA', 'CONCLUIDO'];

    if (estadosCancelaveisPeloCliente.includes(statusAtual)) {
        return true;
    }

    if (estadosAvancados.includes(statusAtual) && ehSuporte && disputaId) {
        return true;
    }

    if (estadosAvancados.includes(statusAtual)) {
        throw new Error('Cancelamento de pedido avançado exige intervenção do suporte e uma disputa');
    }

    throw new Error(`Não é possível cancelar um pedido no status ${statusAtual}`);
}

module.exports = { validarTransicao, validarCancelamento };
