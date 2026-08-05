import jwt from 'jsonwebtoken';

export function generateToken(adminId: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not defined in .env');
  return jwt.sign({ id: adminId }, secret, { expiresIn: '7d' });
}
