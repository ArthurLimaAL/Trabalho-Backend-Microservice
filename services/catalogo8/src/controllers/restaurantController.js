// Importa o Model de Restaurante para acessar os dados no MongoDB
const Restaurant = require("../models/restaurant");

// Busca todos os restaurantes cadastrados
const getRestaurants = async (req, res) => {
    try {
        // Busca todos os restaurantes no banco de dados
        const restaurants = await Restaurant.find();

        // Retorna os restaurantes encontrados em formato JSON
        res.json(restaurants);
    } catch (error) {
        // Retorna erro caso aconteça algum problema na consulta
        res.status(500).json({
            mensagem: "Erro ao buscar restaurantes"
        });
    }
};

// Exporta a função para ser utilizada nas rotas
module.exports = {
    getRestaurants
};