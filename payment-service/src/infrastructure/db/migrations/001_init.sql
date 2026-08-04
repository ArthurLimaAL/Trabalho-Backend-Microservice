-- ============================================================
-- 001_init.sql — Schema do Microsserviço de Pagamentos
-- Database-per-Service: este banco pertence exclusivamente a
-- este serviço (proibido compartilhar com outros microsserviços).
--
-- Decisões importantes:
--   • Valores monetários em INTEGER (centavos) — nunca FLOAT.
--   • idempotency_key UNIQUE → garante idempotência absoluta
--     sob concorrência (INSERT ... ON CONFLICT DO NOTHING).
--   • split_ledger é o ledger contábil imutável (append-only).
--   • outbox_events implementa o Transactional Outbox Pattern
--     para eventos distribuídos (consistência eventual).
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Cobranças / transações
CREATE TABLE payments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id             TEXT NOT NULL,
  client_id            TEXT NOT NULL,
  restaurant_id        TEXT NOT NULL,
  method               TEXT NOT NULL CHECK (method IN ('PIX', 'CARD')),
  product_amount_cents INTEGER NOT NULL CHECK (product_amount_cents >= 0),
  delivery_fee_cents   INTEGER NOT NULL CHECK (delivery_fee_cents >= 0),
  amount_cents         INTEGER NOT NULL CHECK (amount_cents > 0),
  status               TEXT NOT NULL DEFAULT 'PENDENTE'
                       CHECK (status IN ('PENDENTE', 'CONCLUIDO', 'FALHOU', 'ESTORNADO')),
  idempotency_key      TEXT NOT NULL UNIQUE,
  gateway_id           TEXT,
  reason               TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at           TIMESTAMPTZ,
  paid_at              TIMESTAMPTZ,
  expired_at           TIMESTAMPTZ,
  refunded_at          TIMESTAMPTZ
);

-- Ledger contábil: uma linha por liquidação (append-only)
CREATE TABLE split_ledger (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id           UUID NOT NULL REFERENCES payments(id),
  gross_cents          INTEGER NOT NULL,
  product_amount_cents INTEGER NOT NULL,
  delivery_fee_cents   INTEGER NOT NULL,
  commission_cents     INTEGER NOT NULL,
  service_fee_cents    INTEGER NOT NULL,
  platform_cents       INTEGER NOT NULL,
  courier_cents        INTEGER NOT NULL,
  restaurant_cents     INTEGER NOT NULL,
  recorded_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Repasses periódicos para restaurantes/entregadores
CREATE TABLE payouts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id TEXT NOT NULL,
  period_label  TEXT NOT NULL,
  period_start  DATE NOT NULL,
  period_end    DATE NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('SEMANAL', 'MENSAL')),
  status        TEXT NOT NULL DEFAULT 'AGENDADO' CHECK (status IN ('AGENDADO', 'PAGO')),
  amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Transactional Outbox: eventos pendentes de publicação
CREATE TABLE outbox_events (
  id           BIGSERIAL PRIMARY KEY,
  type         TEXT NOT NULL,
  payload      JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);

CREATE INDEX idx_payments_client      ON payments (client_id, created_at DESC);
CREATE INDEX idx_payments_restaurant  ON payments (restaurant_id, created_at DESC);
CREATE INDEX idx_payments_status_time ON payments (status, expires_at);
CREATE INDEX idx_ledger_payment       ON split_ledger (payment_id);
CREATE INDEX idx_payouts_restaurant   ON payouts (restaurant_id, created_at DESC);
CREATE INDEX idx_outbox_pending       ON outbox_events (published_at) WHERE published_at IS NULL;
