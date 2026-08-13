const stateMachine = require('./stateMachine');

stateMachine.validarTransicao('CRIADO', 'PAGO');
stateMachine.validarTransicao('PAGO', 'EM_PREPARO');

let bloqueouSalto = false;
try {
    stateMachine.validarTransicao('CRIADO', 'EM_PREPARO');
} catch (error) {
    bloqueouSalto = true;
}

if (!bloqueouSalto) {
    throw new Error('A máquina permitiu um salto de estado');
}

stateMachine.validarCancelamento('CRIADO', false);

let protegeuEstadoAvancado = false;
try {
    stateMachine.validarCancelamento('EM_PREPARO', false);
} catch (error) {
    protegeuEstadoAvancado = true;
}

if (!protegeuEstadoAvancado) {
    throw new Error('O cancelamento avançado não foi protegido');
}

stateMachine.validarCancelamento('EM_PREPARO', true, 'SUP-1');
console.log('Regras da máquina de estados OK');
