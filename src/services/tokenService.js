import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { env } from '../config/env.js';

const revokedRefreshTokens = new Set();

function buildPayload(user) {
  return {
    user_id: user.user_id,
    email: user.email,
    role: user.role,
  };
}

export function generateAccessToken(user) {
  return jwt.sign(buildPayload(user), env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  });
}

export function generateRefreshToken(user) {
  const tokenId = uuidv4();

  const token = jwt.sign(
    { ...buildPayload(user), jti: tokenId },
    env.jwtRefreshSecret,
    { expiresIn: env.jwtRefreshExpiresIn }
  );

  return { token, tokenId };
}

export function verifyAccessToken(token) {
  return jwt.verify(token, env.jwtSecret);
}

export function verifyRefreshToken(token) {
  const payload = jwt.verify(token, env.jwtRefreshSecret);

  if (revokedRefreshTokens.has(payload.jti)) {
    throw new Error('Refresh token revoked');
  }

  return payload;
}

export function revokeRefreshToken(token) {
  try {
    const payload = jwt.verify(token, env.jwtRefreshSecret);
    if (payload.jti) {
      revokedRefreshTokens.add(payload.jti);
    }
  } catch {
    // Ignore invalid tokens on logout
  }
}
