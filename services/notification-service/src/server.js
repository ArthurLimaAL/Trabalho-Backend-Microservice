import app from "./app.js";

const PORT = 3004;


app.listen (PORT, () => {
    console.log (`Notification Service rodando na porta ${PORT}`);
})