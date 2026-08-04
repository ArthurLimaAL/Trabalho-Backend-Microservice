import express from 'express';
import { env } from './config/env.js';
import authRoutes from './routes/auth.js';

const app = express();

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'auth-service' });
});

app.use('/auth', authRoutes);

app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.listen(env.port, () => {
  console.log(`Auth service running on http://localhost:${env.port}`);
});
