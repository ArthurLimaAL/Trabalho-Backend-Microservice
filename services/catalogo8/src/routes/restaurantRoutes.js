// Importa o Express para criar as rotas
const express = require("express");

// Cria um roteador para as rotas de restaurantes
const router = express.Router();

// Importa a função responsável por buscar os restaurantes
const {
    getRestaurants
} = require("../controllers/restaurantController");

// Rota para buscar todos os restaurantes
router.get("/", getRestaurants);

// Exporta as rotas para serem utilizadas no index.js
module.exports = router;