-- ============================================================
-- 002_add_payment_version.sql
-- Concorrência (requisito do enunciado): optimistic locking
-- "via versão" nas transições de status do pagamento.
--
--   • payments.version  → cada UPDATE só afeta a linha se a versão
--     carregada ainda for a atual (WHERE version = $v). Se outra
--     transação/webhook mudou o status antes, 0 linhas são afetadas
--     e a operação falha → ROLLBACK. Bump automático version+1.
--
--   • UNIQUE em split_ledger(payment_id) → defesa em profundidade:
--     uma cobrança só pode ser liquidada UMA vez no ledger. Se um
--     código (ou uma corrida) tentar gravar a segunda liquidação,
--     o próprio banco rejeita e a transação faz ROLLBACK.
-- ============================================================

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_split_ledger_payment
  ON split_ledger (payment_id);
