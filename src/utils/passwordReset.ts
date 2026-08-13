import { createHash, randomBytes } from 'crypto';

export function createPasswordResetToken() {
  const token = randomBytes(32).toString('hex');
  return { token, hash: hashPasswordResetToken(token) };
}

export function hashPasswordResetToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}
