import { Router, Response } from 'express';
import { createHash, randomInt } from 'node:crypto';
import Order from '../models/Order';
import { orderLimiter } from '../middleware/rateLimiter';
import { CustomerRequest, protectCustomerHistory, signCustomerHistoryToken } from '../middleware/customerAuth';
import { normalizeCustomerPhone } from '../lib/customerPhone';

const router = Router();
const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const challenges = new Map<string, { codeHash: string; expiresAt: number; attempts: number }>();

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function simulatedOtpEnabled() {
  // Temporary development/testing mode. Set CUSTOMER_OTP_MODE=live before connecting a real provider.
  return process.env.CUSTOMER_OTP_MODE !== 'live';
}

function safeOrder(order: any) {
  return {
    _id: String(order._id),
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    orderType: order.orderType,
    deliveryAreaName: order.deliveryAreaName,
    deliveryAddress: order.deliveryAddress,
    items: order.items,
    subtotal: order.subtotal,
    deliveryFee: order.deliveryFee,
    discountCode: order.discountCode,
    discountAmount: order.discountAmount,
    total: order.total,
    notes: order.notes,
    status: order.status,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    paymentRejectionReason: order.paymentRejectionReason,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

router.post('/request-otp', orderLimiter, async (req, res) => {
  const phone = typeof req.body?.phone === 'string' ? normalizeCustomerPhone(req.body.phone) : '';
  if (phone.length < 7 || phone.length > 32) return res.status(400).json({ error: 'Enter a valid phone number.' });
  const code = simulatedOtpEnabled() ? '123456' : String(randomInt(100000, 1000000));
  challenges.set(phone, { codeHash: hash(code), expiresAt: Date.now() + OTP_TTL_MS, attempts: 0 });
  const response: { message: string; expiresInSeconds: number; devCode?: string } = { message: 'If this phone number has Timavelle orders, a verification code is ready.', expiresInSeconds: OTP_TTL_MS / 1000 };
  if (simulatedOtpEnabled()) response.devCode = code;
  res.set('Cache-Control', 'no-store');
  return res.json(response);
});

router.post('/verify-otp', orderLimiter, async (req, res) => {
  const phone = typeof req.body?.phone === 'string' ? normalizeCustomerPhone(req.body.phone) : '';
  const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
  const challenge = challenges.get(phone);
  if (!challenge || Date.now() > challenge.expiresAt || challenge.attempts >= MAX_OTP_ATTEMPTS || code.length !== 6 || hash(code) !== challenge.codeHash) {
    if (challenge) challenge.attempts += 1;
    return res.status(401).json({ error: 'That verification code is invalid or has expired.' });
  }
  challenges.delete(phone);
  const token = signCustomerHistoryToken(phone);
  res.set('Cache-Control', 'no-store');
  return res.json({ token, expiresInSeconds: 7 * 24 * 60 * 60 });
});

router.get('/', protectCustomerHistory, async (req: CustomerRequest, res: Response) => {
  try {
    const phone = req.customerPhone || '';
    const orders = await Order.find({ $or: [{ customerPhoneNormalized: phone }, { customerPhone: phone }] }).sort({ createdAt: -1 }).limit(50);
    res.set('Cache-Control', 'no-store');
    return res.json({ orders: orders.map(safeOrder) });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'We could not load your order history. Please try again.' });
  }
});

export default router;
