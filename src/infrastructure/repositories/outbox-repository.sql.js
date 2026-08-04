'use strict';

// Transactional Outbox — eventos gravados na MESMA transação do dado
// de negócio e publicados depois por um relay (consistência eventual).
class SqlOutboxRepository {
  constructor(db) {
    this.pool = db.pool;
  }

  // `tx` é OBRIGATÓRIO aqui do ponto de vista de uso real: a inserção no
  // outbox só faz sentido dentro da transação do dado de negócio (senão
  // perderíamos a garantia do padrão). O payload vira JSON.stringify para
  // caber em uma coluna JSONB/texto.
  async insert(tx, type, payload) {
    const client = tx || this.pool;
    await client.query(
      `INSERT INTO outbox_events (type, payload) VALUES ($1, $2)`,
      [type, JSON.stringify(payload)]
    );
  }

  // SELECT ... FOR UPDATE SKIP LOCKED: várias instâncias do relay podem
  // rodar em paralelo sem processar o mesmo evento (leaderless-safe).
  //
  // Detalhe de ouro: SKIP LOCKED pula as linhas que outra transação JÁ
  // travou (FOR UPDATE), em vez de ficar esperando. Ou seja, cada relay
  // pega um subconjunto diferente de eventos e ninguém fica bloqueado —
  // exatamente o que precisamos para escalar horizontalmente o relay.
  // A transação mantém o lock até o commit, quando markPublished roda.
  async claimUnpublished(tx, limit = 50) {
    const client = tx || this.pool;
    const { rows } = await client.query(
      `SELECT id, type, payload
         FROM outbox_events
        WHERE published_at IS NULL
        ORDER BY id
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [limit]
    );
    return rows.map((r) => ({ id: r.id, type: r.type, payload: r.payload }));
  }

  // Marca os ids como publicados. PRECISA receber o MESMO `tx` do claim:
  // assim o "publiquei" e o "marquei como publicado" acontecem na mesma
  // transação do relay — se o publish falhar, nada é marcado e tudo é
  // reprocessado na próxima rodada (nenhum evento perdido ou duplicado).
  async markPublished(ids, tx) {
    if (!ids.length) return;
    const client = tx || this.pool;
    // ANY($1) aceita um array como parâmetro — um único UPDATE para todos.
    await client.query(`UPDATE outbox_events SET published_at = now() WHERE id = ANY($1)`, [ids]);
  }
}

module.exports = { SqlOutboxRepository };
