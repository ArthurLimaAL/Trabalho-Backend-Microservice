import bcrypt from 'bcrypt';

const ROLES = ['CLIENTE', 'RESTAURANTE', 'ENTREGADOR', 'ADMIN'];

export { ROLES };

export const users = [
  {
    user_id: '1',
    email: 'cliente@delivery.com',
    passwordHash: bcrypt.hashSync('cliente123', 10),
    role: 'CLIENTE',
  },
  {
    user_id: '2',
    email: 'restaurante@delivery.com',
    passwordHash: bcrypt.hashSync('restaurante123', 10),
    role: 'RESTAURANTE',
  },
  {
    user_id: '3',
    email: 'entregador@delivery.com',
    passwordHash: bcrypt.hashSync('entregador123', 10),
    role: 'ENTREGADOR',
  },
  {
    user_id: '4',
    email: 'admin@delivery.com',
    passwordHash: bcrypt.hashSync('admin123', 10),
    role: 'ADMIN',
  },
];
