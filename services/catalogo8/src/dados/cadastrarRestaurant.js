// Carrega as variáveis de ambiente do .env
require("dotenv").config();

const mongoose = require("mongoose");
const connectDatabase = require("../config/database");
const Restaurant = require("../models/restaurant");

// Importa a lista de 20 restaurantes do arquivo separado
const RESTAURANTES_BASE = require("./restaurantBase");

async function cadastrarCascaRestaurantes() {
  try {
    // Importa o Faker em português para gerar dados de teste reais e consistentes.
    // A importação dinâmica evita problema com CommonJS no Node.
    const { fakerPT_BR: faker } = await import("@faker-js/faker");

    // Conecta ao MongoDB usando a configuração do arquivo database.js.
    await connectDatabase();

    // Limpa a coleção de restaurantes antes de inserir os dados de teste.
    // Isso garante que o banco fique com uma base consistente e sem duplicidade.
    await Restaurant.deleteMany({});
    console.log("🧹 Banco de dados limpo com sucesso!\n");

    console.log("⏳ Cadastrando os 20 restaurantes no banco...\n");

    // Percorre cada restaurante da lista base e cria os dados no formato do schema.
    for (const item of RESTAURANTES_BASE) {
      // Define uma cidade aleatória, porém sempre pertencente a Pernambuco.
      // Isso garante que os restaurantes fiquem no estado correto.
      const cidadePE = faker.helpers.arrayElement([
        "Recife",
        "Olinda",
        "Jaboatão dos Guararapes",
        "Caruaru",
        "Paulista",
        "Petrolina",
        "Garanhuns",
        "Cabo de Santo Agostinho",
        "Vitória de Santo Antão",
        "Igarassu",
      ]);

      // Gera um telefone fixando o DDD de Pernambuco (81), mas mantendo o restante aleatório.
      const telefonePE = `+55 (81) ${faker.number.int({ min: 90000, max: 99999 })}-${faker.number.int({ min: 1000, max: 9999 })}`;

      // Monta o objeto que será salvo no banco, seguindo o schema do Restaurant.
      const dadosRestaurante = {
        nome: item.nome,
        categoria: item.categoria,
        telefone: telefonePE,
        avaliacao: parseFloat(
          faker.number.float({ min: 3.8, max: 5.0, fractionDigits: 1 })
        ),
        aberto: faker.datatype.boolean({ probability: 0.8 }),
        tempoEntrega: `${faker.helpers.arrayElement([
          "20-30",
          "30-40",
          "40-50",
        ])} min`,
        taxaEntrega: parseFloat(
          faker.number.float({ min: 0, max: 12, fractionDigits: 2 })
        ),

        // Promoção inicial vazia para todos os restaurantes, pois o professor pediu dados básicos.
        promocao: {
          temCupom: false,
          codigo: "",
          descricao: "",
          valorDesconto: 0,
          valorMinimo: 0,
        },

        // Endereço gerado com estado fixo em PE e cidade escolhida entre as cidades pernambucanas.
        endereco: {
          rua: faker.location.street(),
          numero: faker.location.buildingNumber(),
          bairro: faker.location.county(),
          cidade: cidadePE,
          estado: "PE",
        },

        // Cardápio inicial vazio para ser preenchido posteriormente.
        cardapio: [],
      };

      // Salva um restaurante por vez no banco MongoDB.
      await Restaurant.create(dadosRestaurante);
      console.log(`✅ Cadastrado: ${dadosRestaurante.nome}`);
    }

    console.log("\n🎉 Os 20 restaurantes foram criados com sucesso!");

    // Fecha a conexão com o banco para evitar conexão pendente.
    mongoose.connection.close();
  } catch (error) {
    // Caso aconteça algum problema, exibe a mensagem do erro e encerra a conexão.
    console.error("❌ Erro ao cadastrar restaurantes:", error);
    mongoose.connection.close();
  }
}

// Executa a função principal ao rodar o script.
cadastrarCascaRestaurantes();