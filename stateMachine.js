const transicoes = {
    'CRIADO': ['PAGO', 'CANCELADO'],
    'PAGO': ['EM_PREPARO', 'CANCELADO'],
    'EM_PREPARO': ['SAIU_PARA_ENTREGA'],
    'SAIU_PARA_ENTREGA': ['CONCLUIDO']
};

function validarTransicao(statusAtual, novoStatus) {
    if (!transicoes[statusAtual] || !transicoes[statusAtual].includes(novoStatus)) {
        throw new Error(`Transição inválida de ${statusAtual} para ${novoStatus}`);
    }
    return true;
}

module.exports = {validarTransicao};