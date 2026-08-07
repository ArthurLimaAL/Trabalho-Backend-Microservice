import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { users, ROLES } from '../data/users.js';

const loginAttempts = new Map();

export function findByEmail(email) {
  return users.find((user) => user.email === email);
}

export function findById(userId) {
  return users.find((user) => user.user_id === userId);
}

export async function registerUser({ email, password, role }) {
  if (!email || !password || !role) {
    throw new Error('email, password and role are required');
  }

  if (!ROLES.includes(role)) {
    throw new Error(`Invalid role. Allowed: ${ROLES.join(', ')}`);
  }

  if (findByEmail(email)) {
    throw new Error('Email already registered');
  }

  const user = {
    user_id: uuidv4(),
    email,
    passwordHash: await bcrypt.hash(password, 10),
    role,
  };

  users.push(user);

  return {
    user_id: user.user_id,
    email: user.email,
    role: user.role,
  };
}

export async function validateCredentials(email, password) {
  const user = findByEmail(email);
  if (!user) {
    return null;
  }

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) {
    return null;
  }

  return {
    user_id: user.user_id,
    email: user.email,
    role: user.role,
  };
}

export function isAccountLocked(email) {
  const record = loginAttempts.get(email);
  if (!record?.lockedUntil) {
    return false;
  }

  if (Date.now() >= record.lockedUntil) {
    loginAttempts.delete(email);
    return false;
  }

  return true;
}

export function registerFailedLogin(email, maxAttempts, lockoutMinutes) {
  const record = loginAttempts.get(email) ?? { count: 0, lockedUntil: null };
  record.count += 1;

  if (record.count >= maxAttempts) {
    record.lockedUntil = Date.now() + lockoutMinutes * 60 * 1000;
    record.count = 0;
  }

  loginAttempts.set(email, record);
}

export function clearLoginAttempts(email) {
  loginAttempts.delete(email);
}
