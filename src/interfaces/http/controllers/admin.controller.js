'use strict';

// Visão consolidada do Administrador (relatório contábil do ecossistema).
//
// Diferente do controller de restaurante, aqui NÃO há checagem de
// propriedade: só existe o perfil ADMIN por baixo destas rotas (o middleware
// requireRole na rota já bloqueou qualquer outro perfil). Por isso os
// handlers são quase transparentes — pegam o dado do serviço e devolvem.
function createAdminController({ statementService }) {
  return {
    // GET /admin/dashboard — números gerais do ecossistema hoje.
    async dashboard(req, res, next) {
      try {
        // Direto `res.json(await ...)`: como não há id de recurso nem body
        // para montar, o retorno do serviço já É a resposta final.
        res.json(await statementService.adminDashboard());
      } catch (error) {
        next(error);
      }
    },

    // GET /admin/monthly — série mensal para o gráfico de evolução.
    // O array vem encapsulado em `{ series }` para deixar o shape explícito
    // no JSON (quem consome não precisa adivinhar a chave raiz).
    async monthly(req, res, next) {
      try {
        res.json({ series: await statementService.adminMonthlySeries() });
      } catch (error) {
        next(error);
      }
    },

    // GET /admin/reconciliation — itens de conciliação (comparativo entre
    // o que registramos e o que o gateway reportou). Uso típico: conferir
    // se bateu a contabilidade no fim do dia.
    async reconciliation(req, res, next) {
      try {
        res.json({ items: await statementService.adminReconciliation() });
      } catch (error) {
        next(error);
      }
    },
  };
}

module.exports = { createAdminController };
