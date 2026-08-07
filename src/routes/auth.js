import { Router } from 'express';
import { env } from '../config/env.js';
import { authenticate, authorize } from '../middleware/auth.js';
import {
  clearLoginAttempts,
  findById,
  isAccountLocked,
  registerFailedLogin,
  registerUser,
  validateCredentials,
} from '../services/userService.js';
import {
  generateAccessToken,
  generateRefreshToken,
  revokeRefreshToken,
  verifyRefreshToken,
} from '../services/tokenService.js';

const router = Router();

router.post('/register', async (req, res) => {
  try {
    const user = await registerUser(req.body);
    return res.status(201).json({ message: 'User registered', user });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  if (isAccountLocked(email)) {
    return res.status(429).json({
      error: 'Account temporarily locked due to failed login attempts',
    });
  }

  const user = await validateCredentials(email, password);

  if (!user) {
    registerFailedLogin(email, env.maxLoginAttempts, env.loginLockoutMinutes);
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  clearLoginAttempts(email);

  const accessToken = generateAccessToken(user);
  const { token: refreshToken } = generateRefreshToken(user);

  return res.json({
    message: 'Login successful',
    accessToken,
    refreshToken,
    user,
  });
});

router.post('/refresh', (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ error: 'refreshToken is required' });
  }

  try {
    const payload = verifyRefreshToken(refreshToken);
    const user = findById(payload.user_id);

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    const accessToken = generateAccessToken(user);
    const { token: newRefreshToken } = generateRefreshToken(user);

    revokeRefreshToken(refreshToken);

    return res.json({
      accessToken,
      refreshToken: newRefreshToken,
    });
  } catch {
    return res.status(401).json({ error: 'Invalid or revoked refresh token' });
  }
});

router.post('/logout', (req, res) => {
  const { refreshToken } = req.body;

  if (refreshToken) {
    revokeRefreshToken(refreshToken);
  }

  return res.json({ message: 'Logout successful' });
});

router.get('/me', authenticate, (req, res) => {
  return res.json({ user: req.user });
});

router.get('/profile', authenticate, (req, res) => {
  const user = findById(req.user.user_id);

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  return res.json({
    user_id: user.user_id,
    email: user.email,
    role: user.role,
  });
});

router.get(
  '/admin/dashboard',
  authenticate,
  authorize('ADMIN'),
  (_req, res) => {
    return res.json({ message: 'Admin dashboard access granted' });
  }
);

router.post(
  '/restaurante/catalogo',
  authenticate,
  authorize('RESTAURANTE'),
  (_req, res) => {
    return res.json({ message: 'Catalog update allowed for RESTAURANTE role' });
  }
);

router.post(
  '/cliente/pedidos',
  authenticate,
  authorize('CLIENTE'),
  (_req, res) => {
    return res.json({ message: 'Order creation allowed for CLIENTE role' });
  }
);

export default router;
