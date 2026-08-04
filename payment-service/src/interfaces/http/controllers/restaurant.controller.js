'use strict';

// Painel financeiro do restaurante: resumo por período, detalhe do
// split por pedido e histórico de repasses.
//
// Estes handlers NÃO têm `req.params.id` confiável por si só: a rota passa
// primeiro pelo middleware requireOwnershipOrAdmin, que compara o id do
// recurso com o user_id do JWT. Ou seja, quando o controller roda, já
// sabemos que aquele restaurante pode (ou é ADMIN). O controller assume
// a autorização e só cuida de buscar os dados e devolver JSON.
function createRestaurantController({ statementService }) {
  return {
    // GET /restaurants/:id/dashboard?de=&ate= — resumo do período.
    // `de` e `ate` são datas opcionais; quando ausentes, o serviço usa o
    // padrão dele (ex.: últimos 30 dias). Repare que passamos direto o que
    // veio da query — sem validação aqui; o serviço é quem trata o formato.
    async dashboard(req, res, next) {
      try {
        const { de, ate } = req.query;
        const data = await statementService.restaurantDashboard(req.params.id, de, ate);
        res.json(data);
      } catch (error) {
        next(error);
      }
    },

    // GET /restaurants/:id/splits — todos os splits (pedaço que coube ao
    // restaurante) de cada pagamento. O array vem dentro de `{ payments }`
    // para padronizar o formato de resposta com o resto da API.
    async splits(req, res, next) {
      try {
        const data = await statementService.restaurantSplits(req.params.id);
        res.json({ payments: data });
      } catch (error) {
        next(error);
      }
    },

    // GET /restaurants/:id/payouts — histórico de repasses do restaurante.
    async payouts(req, res, next) {
      try {
        const data = await statementService.restaurantPayouts(req.params.id);
        res.json({ payouts: data });
      } catch (error) {
        next(error);
      }
    },
  };
}

module.exports = { createRestaurantController };
