const mongoose = require("mongoose");

async function connectDatabase() {
  try {
    // Tenta conectar usando a variável de ambiente
    await mongoose.connect(process.env.MONGO_URI);
    console.log(" MongoDB Atlas conectado com sucesso!");
  } catch (error) {
    console.error(" Erro ao conectar no MongoDB:", error.message);
    // Encerra a aplicação caso a conexão inicial falhe
    process.exit(1); 
  }
}

// Exporta a função para que outros arquivos possam chamá-la
module.exports = connectDatabase;