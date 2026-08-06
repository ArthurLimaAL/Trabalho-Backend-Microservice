import express from "express"; // Importa o Express que é a ferramenta que cria servidores web, a base.
import cors from "cors"; // Importa o Cors que é a ferramenta que deixa os outros sistemas acessarem.

const app = express (); // const cria a aplicação

app.use (cors ()); // responsável por ativar o cors, sem ele, os outros sistemas não respondem.
app.use (express.json ()); // Responsável por ativar a leitura do json.

// É uma rota de testes, no caso, se vc acessar o site http://localhost:3004, ele responderá com um OK.
app.get ("/", (req, res) => {
    res.json ({ status: "ok", servico: "notification-service" });
});

export default app; // Ele é responsável por entregar o app para os outros arquivos e o server.js importa ele.


// o app.js disponibiliza o app para o server.js usar.
