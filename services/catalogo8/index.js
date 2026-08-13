const connectDatabase = require("./src/config/database");
const app = require("./src/app");

const PORT = process.env.PORT || 3000;

async function startServer() {
    await connectDatabase();

    app.listen(PORT, () => {
        console.log(`🚀 Servidor rodando na porta ${PORT}`);
    });
}

startServer();