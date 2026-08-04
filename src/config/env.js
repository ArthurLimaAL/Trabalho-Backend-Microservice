import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve o caminho da raiz do projeto (src/config -> raiz)
const projectRoot = path.resolve(__dirname, '..', '..');

// Carrega o .env da raiz do projeto, independente do diretório de trabalho
dotenv.config({ path: path.join(projectRoot, '.env') });

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT) || 3000,
  jwtSecret: requireEnv('JWT_SECRET'),
  jwtRefreshSecret: requireEnv('JWT_REFRESH_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '15m',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  maxLoginAttempts: Number(process.env.MAX_LOGIN_ATTEMPTS) || 5,
  loginLockoutMinutes: Number(process.env.LOGIN_LOCKOUT_MINUTES) || 15,
};
