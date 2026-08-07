// server.js é responsável pela inicialização do serviço

import app from "./app.js"; // import significa importar (buscar) o arquivo app.js

const PORT = 3004; // Const (constante, um valor que não muda), Port (porta) que é o número onde o serviço vai chamar

// Responável por ligar o servidor na porta (PORT) 3004 e o console.log mostrar o resultado
app.listen (PORT, () => {
    console.log (`Notification Service rodando na porta ${PORT}`);
});



// Ou seja, o server é responsável por buscar a aplicação (app), conectar na porta (3004),
// e fica esperando a mensagem mostrar se está funcionando ou não no terminal.