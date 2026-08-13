const mongoose = require("mongoose");

const restaurantSchema = new mongoose.Schema(
  {
    nome: {
      type: String,
      required: true,
      trim: true,
    },

    categoria: {
      type: String,
      required: true,
      trim: true,
    },

    telefone: {
      type: String,
    },

    avaliacao: {
      type: Number,
      min: 0,
      max: 5,
    },

    aberto: {
      type: Boolean,
      default: true,
    },

    tempoEntrega: {
      type: String,
    },

    taxaEntrega: {
      type: Number,
      min: 0,
    },

    promocao: {
      temCupom: {
        type: Boolean,
        default: false,
      },

      codigo: {
        type: String,
        default: "",
      },

      descricao: {
        type: String,
        default: "",
      },

      valorDesconto: {
        type: Number,
        default: 0,
      },

      valorMinimo: {
        type: Number,
        default: 0,
      },
    },

    endereco: {
      rua: String,
      numero: String,
      bairro: String,
      cidade: String,
      estado: String,
    },

    cardapio: [
      {
        nome: String,
        categoria: String,
        imagem: String,
        origem: String,
      },
    ],
  },
  {
    timestamps: true,
  }
);

const Restaurant = mongoose.model("Restaurant", restaurantSchema);

module.exports = Restaurant;