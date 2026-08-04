'use strict';

require('dotenv').config();

const REQUIRED_VARS = ['JWT_SECRET', 'DATABASE_URL'];

// Centraliza a leitura do ambiente. Regras de segurança do enunciado:
//  - Nenhum segredo hardcoded no código-fonte.
//  - JWT_SECRET e DATABASE_URL são OBRIGATÓRIOS: se ausentes, o serviço não sobe.
//  - Em produção as chaves entram via variáveis de ambiente / Kubernetes Secrets.
//
// Ideia central: falhar cedo ("fail fast"). É muito melhor o processo
// derrubar na subida dizendo "falta variável X" do que subir e estourar
// lá na frente com um erro esquisito (ou, pior, subir com config errada).
function readEnv() {
  // Se qualquer variável obrigatória estiver vazia, já lançamos o erro aqui.
  const missing = REQUIRED_VARS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Variáveis de ambiente obrigatórias ausentes: ${missing.join(', ')}. ` +
        'Copie .env.example para .env e preencha (ou injete via Secrets).'
    );
  }

  // COMMISSION_RATE é percentual (0..1). Validamos além do Number() porque
  // "abc" vira NaN silenciosamente — sem essa checagem quebraria os cálculos.
  const commissionRate = Number(process.env.COMMISSION_RATE || '0.12');
  if (Number.isNaN(commissionRate) || commissionRate < 0 || commissionRate > 1) {
    throw new Error(`COMMISSION_RATE inválida: ${process.env.COMMISSION_RATE}`);
  }

  // Taxa de serviço em centavos. Exigimos inteiro não-negativo: a conversão
  // para centavos no restante do código assume esse formato.
  const serviceFeeCents = Number(process.env.SERVICE_FEE_CENTS || '150');
  if (!Number.isInteger(serviceFeeCents) || serviceFeeCents < 0) {
    throw new Error(`SERVICE_FEE_CENTS inválido: ${process.env.SERVICE_FEE_CENTS}`);
  }

  // Valores opcionais usam `|| default`, então tudo sempre tem um valor.
  // Repare que o retorno é um objeto "plano" — o resto da app lê config.X.
  return {
    port: Number(process.env.PORT || '3001'),
    databaseUrl: process.env.DATABASE_URL,
    databaseDriver: process.env.PAYMENT_DB_DRIVER || 'sql', // 'sql' | 'memory'
    jwtSecret: process.env.JWT_SECRET,
    jwtAlg: process.env.JWT_ALG || 'HS256',
    gatewayWebhookSecret: process.env.GATEWAY_WEBHOOK_SECRET || '',
    commissionRate,
    serviceFeeCents,
    paymentTimeoutMs: Number(process.env.PAYMENT_TIMEOUT_MS || '300000'),
    outboxRelayIntervalMs: Number(process.env.OUTBOX_RELAY_INTERVAL_MS || '1000'),
    expireSweepIntervalMs: Number(process.env.EXPIRE_SWEEP_INTERVAL_MS || '5000'),
    isProd: process.env.NODE_ENV === 'production', // flag de conveniência p/ log/erro
  };
}

module.exports = { readEnv };
