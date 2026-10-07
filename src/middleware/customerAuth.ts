import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

export interface CustomerRequest extends Request {
  customerPhone?: string;
}

function getSecret() {
  return process.env.CUSTOMER_HISTORY_SECRET || process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'timavelle-dev-customer-history-secret');
}

export function protectCustomerHistory(req: CustomerRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const secret = getSecret();
  if (!authHeader?.startsWith('Bearer ') || !secret) return res.status(401).json({ error: 'Your customer session is missing or invalid.' });
  try {
    const decoded = jwt.verify(authHeader.slice(7), secret) as { phone?: string; purpose?: string };
    if (decoded.purpose !== 'customer-history' || typeof decoded.phone !== 'string' || !decoded.phone) throw new Error('Invalid customer session');
    req.customerPhone = decoded.phone;
    next();
  } catch {
    return res.status(401).json({ error: 'Your customer session has expired. Please verify your phone again.' });
  }
}

export function signCustomerHistoryToken(phone: string) {
  const secret = getSecret();
  if (!secret) throw new Error('Customer history secret is not configured.');
  return jwt.sign({ phone, purpose: 'customer-history' }, secret, { expiresIn: '7d' });
}
