import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { createHash, randomBytes } from 'node:crypto';
import Order, { ORDER_STATUSES, ORDER_TYPES, PAYMENT_STATUSES, PAYMENT_METHODS, OrderStatus, PaymentMethod, PaymentStatus } from '../models/Order';
import MenuItem from '../models/MenuItem';
import PaymentSettings from '../models/PaymentSettings';
import { AuthRequest, protect } from '../middleware/auth';
import { orderLimiter } from '../middleware/rateLimiter';
import { recordContentArchiveEvent } from '../lib/contentArchive';
import DeliveryArea from '../models/DeliveryArea';
import DiscountCode from '../models/DiscountCode';
import multer from 'multer';
import cloudinary from '../config/cloudinary';
import { normalizeCustomerPhone } from '../lib/customerPhone';

const router = Router();
export const ORDER_SCOPES = ['active', 'archived', 'all'] as const;
export const ORDER_BULK_ACTIONS = ['archive', 'restore', 'delete'] as const;
const MAX_BULK_ORDERS = 100;
const MAX_ORDER_LINES = 50;
const receiptUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 }, fileFilter: (_req, file, callback) => {
  const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
  callback(null, allowed.has(file.mimetype.toLowerCase()));
} });

function orderAuditLabel(id: mongoose.Types.ObjectId | string) {
  return `Order #${String(id).slice(-6)}`;
}

function parsePage(value: unknown, fallback: number, max: number) {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function parseIds(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_BULK_ORDERS) return null;
  const ids = [...new Set(value.filter((item): item is string => typeof item === 'string' && mongoose.isValidObjectId(item)))];
  return ids.length === value.length ? ids : null;
}

// Prices are always recomputed from the live catalog here — the client only ever sends menu item ids,
// quantities and the names of chosen add-ons. This is what stops a tampered client request from
// submitting an order at an arbitrary price.
async function buildPricedLines(rawItems: unknown) {
  if (!Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > MAX_ORDER_LINES) {
    return { error: `An order needs between 1 and ${MAX_ORDER_LINES} items.` as string | null, lines: [], subtotal: 0 };
  }
  const lines: { menuItemId: string; name: string; unitPrice: number; quantity: number; addOns: { name: string; price: number }[]; lineTotal: number }[] = [];
  let subtotal = 0;
  for (const raw of rawItems) {
    if (!raw || typeof raw !== 'object') return { error: 'Each order item must be an object.', lines: [], subtotal: 0 };
    const { menuItemId, quantity, addOns: requestedAddOns } = raw as Record<string, unknown>;
    if (typeof menuItemId !== 'string' || !mongoose.isValidObjectId(menuItemId)) return { error: 'Each order item needs a valid menu item id.', lines: [], subtotal: 0 };
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 50) return { error: 'Item quantities must be whole numbers between 1 and 50.', lines: [], subtotal: 0 };
    const menuItem = await MenuItem.findOne({ _id: menuItemId, archivedAt: { $exists: false } });
    if (!menuItem) return { error: 'One of the items in this order is no longer available.', lines: [], subtotal: 0 };
    const requestedNames = Array.isArray(requestedAddOns) ? requestedAddOns.filter((name): name is string => typeof name === 'string') : [];
    const matchedAddOns = menuItem.addOns.filter((addOn) => requestedNames.includes(addOn.name)).map((addOn) => ({ name: addOn.name, price: addOn.price }));
    if (matchedAddOns.length !== requestedNames.length) return { error: `One of the selected add-ons for "${menuItem.name}" is no longer available.`, lines: [], subtotal: 0 };
    const unitPrice = menuItem.price + matchedAddOns.reduce((sum, addOn) => sum + addOn.price, 0);
    const lineTotal = unitPrice * qty;
    subtotal += lineTotal;
    lines.push({ menuItemId, name: menuItem.name, unitPrice: menuItem.price, quantity: qty, addOns: matchedAddOns, lineTotal });
  }
  return { error: null, lines, subtotal };
}

function hashCheckoutToken(token: string) { return createHash('sha256').update(token).digest('hex'); }

async function uploadReceipt(buffer: Buffer, mimetype: string) {
  return new Promise<string>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder: 'timavelle-cuisine/payment-receipts', resource_type: mimetype === 'application/pdf' ? 'raw' : 'image' }, (error, result) => {
      if (error || !result) return reject(error || new Error('Receipt upload failed'));
      resolve(result.secure_url);
    });
    stream.end(buffer);
  });
}

router.post('/', orderLimiter, async (req: Request, res: Response) => {
  try {
    const { customerName, customerPhone, orderType, deliveryAddress, notes, deliveryAreaId, discountCode } = req.body as Record<string, unknown>;
    const idempotencyKey = typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'].trim().slice(0, 100) : '';
    if (idempotencyKey) {
      const existing = await Order.findOne({ idempotencyKey }).select('+idempotencyKey');
      if (existing) {
        const retryToken = existing.paymentMethod === 'bank_transfer' ? randomBytes(32).toString('base64url') : undefined;
        if (retryToken) { existing.checkoutTokenHash = hashCheckoutToken(retryToken); existing.checkoutTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); await existing.save(); }
        const retryOrder = existing.toObject();
        delete retryOrder.checkoutTokenHash; delete retryOrder.checkoutTokenExpiresAt;
        return res.status(200).json({ message: 'Order already prepared', order: retryOrder, ...(retryToken ? { checkoutToken: retryToken } : {}) });
      }
    }
    const requestedPaymentMethod = (req.body as Record<string, unknown>).paymentMethod ?? 'whatsapp';
    const name = typeof customerName === 'string' ? customerName.trim() : '';
    const phone = typeof customerPhone === 'string' ? customerPhone.trim() : '';
    if (!name) return res.status(400).json({ error: 'Your name is required.' });
    if (!phone) return res.status(400).json({ error: 'A phone number is required.' });
    if (!ORDER_TYPES.includes(orderType as typeof ORDER_TYPES[number])) return res.status(400).json({ error: 'Choose delivery or pickup.' });
    if (!PAYMENT_METHODS.includes(requestedPaymentMethod as PaymentMethod)) return res.status(400).json({ error: 'Choose a supported checkout option.' });
    const paymentMethod = requestedPaymentMethod as PaymentMethod;
    const paymentSettings = await PaymentSettings.findOne({ key: 'main' });
    if (paymentMethod === 'bank_transfer' && !paymentSettings?.bankTransferEnabled) return res.status(400).json({ error: 'Bank transfer is temporarily unavailable. Please choose WhatsApp.' });
    if (paymentMethod === 'whatsapp' && !paymentSettings?.whatsappEnabled) return res.status(400).json({ error: 'WhatsApp ordering is temporarily unavailable. Please choose bank transfer.' });
    const address = typeof deliveryAddress === 'string' ? deliveryAddress.trim() : '';
    if (orderType === 'delivery' && !address) return res.status(400).json({ error: 'A delivery address is required for delivery orders.' });
    let deliveryFee = 0;
    let deliveryAreaName: string | undefined;
    let resolvedDeliveryAreaId: mongoose.Types.ObjectId | undefined;
    if (orderType === 'delivery') {
      if (typeof deliveryAreaId !== 'string' || !mongoose.isValidObjectId(deliveryAreaId)) return res.status(400).json({ error: 'Choose a valid delivery area.' });
      const area = await DeliveryArea.findOne({ _id: deliveryAreaId, active: true });
      if (!area) return res.status(400).json({ error: 'That delivery area is no longer available. Please choose another area.' });
      deliveryFee = area.fee; deliveryAreaName = area.name; resolvedDeliveryAreaId = area._id;
    }

    const priced = await buildPricedLines(req.body.items);
    if (priced.error) return res.status(400).json({ error: priced.error });
    let discountAmount = 0;
    let normalizedDiscountCode: string | undefined;
    if (typeof discountCode === 'string' && discountCode.trim()) {
      normalizedDiscountCode = discountCode.trim().toUpperCase();
      const discount = await DiscountCode.findOne({ code: normalizedDiscountCode, active: true });
      if (!discount || (discount.expiresAt && discount.expiresAt.getTime() < Date.now()) || (discount.usageLimit && discount.usedCount >= discount.usageLimit)) return res.status(400).json({ error: 'That discount code is invalid or has expired.' });
      if (priced.subtotal < discount.minimumOrderValue) return res.status(400).json({ error: `This code requires a minimum order of ₦${discount.minimumOrderValue.toLocaleString('en-NG')}.` });
      discountAmount = discount.type === 'percent' ? Math.min(priced.subtotal, Math.round(priced.subtotal * discount.value / 100)) : Math.min(priced.subtotal, discount.value);
    }

    const checkoutToken = paymentMethod === 'bank_transfer' ? randomBytes(32).toString('base64url') : undefined;
    const order = await Order.create({
      customerName: name,
      customerPhone: phone,
      customerPhoneNormalized: normalizeCustomerPhone(phone),
      orderType: orderType as typeof ORDER_TYPES[number],
      deliveryAreaId: resolvedDeliveryAreaId,
      deliveryAreaName,
      deliveryFee,
      deliveryAddress: orderType === 'delivery' ? address : undefined,
      items: priced.lines,
      subtotal: priced.subtotal,
      discountCode: normalizedDiscountCode,
      discountAmount,
      total: Math.max(0, priced.subtotal + deliveryFee - discountAmount),
      notes: typeof notes === 'string' ? notes.trim().slice(0, 500) : undefined,
      channel: paymentMethod === 'whatsapp' ? 'whatsapp' : 'website',
      paymentMethod,
      paymentStatus: 'unpaid',
      status: paymentMethod === 'bank_transfer' ? 'awaiting_payment' : 'new',
      ...(paymentMethod === 'bank_transfer' && paymentSettings ? { paymentInstructions: { bankName: paymentSettings.bankName, accountName: paymentSettings.accountName, accountNumber: paymentSettings.accountNumber } } : {}),
      ...(checkoutToken ? { checkoutTokenHash: createHash('sha256').update(checkoutToken).digest('hex'), checkoutTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } : {}),
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });
    if (normalizedDiscountCode) await DiscountCode.updateOne({ code: normalizedDiscountCode }, { $inc: { usedCount: 1 } });
    const responseOrder = order.toObject();
    delete responseOrder.checkoutTokenHash;
    delete responseOrder.checkoutTokenExpiresAt;
    res.status(201).json({ message: paymentMethod === 'bank_transfer' ? 'Payment details prepared' : 'Order received', order: responseOrder, ...(checkoutToken ? { checkoutToken } : {}) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong submitting your order.' });
  }
});

async function findOrderForCheckout(id: string, token: unknown) {
  if (!mongoose.isValidObjectId(id) || typeof token !== 'string' || token.length < 32 || token.length > 128) return null;
  const order = await Order.findById(id).select('+checkoutTokenHash +checkoutTokenExpiresAt');
  if (!order || !order.checkoutTokenHash || order.checkoutTokenHash !== hashCheckoutToken(token)) return null;
  if (order.checkoutTokenExpiresAt && order.checkoutTokenExpiresAt.getTime() < Date.now()) return null;
  return order;
}

router.post('/:id/access', orderLimiter, async (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const order = await findOrderForCheckout(id, req.body?.checkoutToken);
    if (!order) return res.status(404).json({ error: 'This secure order link is invalid or has expired.' });
    const responseOrder = order.toObject();
    delete responseOrder.checkoutTokenHash; delete responseOrder.checkoutTokenExpiresAt;
    res.set('Cache-Control', 'no-store');
    res.json({ order: responseOrder });
  } catch (error) { console.error(error); res.status(500).json({ error: 'Could not load this order.' }); }
});

router.post('/:id/receipt', orderLimiter, (req: Request, res: Response, next) => {
  receiptUpload.single('receipt')(req, res, async (uploadError) => {
    if (uploadError) return res.status(415).json({ error: 'Receipt must be a JPG, PNG, WebP, or PDF file up to 8 MB.' });
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const order = await findOrderForCheckout(id, req.body?.checkoutToken);
      if (!order) return res.status(404).json({ error: 'This secure checkout session is invalid or has expired.' });
      if (!req.file) return res.status(400).json({ error: 'Choose a payment receipt before continuing.' });
      order.receiptUrl = await uploadReceipt(req.file.buffer, req.file.mimetype);
      order.receiptUploadedAt = new Date();
      order.paymentStatus = 'receipt_submitted';
      await order.save();
      const responseOrder = order.toObject();
      delete responseOrder.checkoutTokenHash; delete responseOrder.checkoutTokenExpiresAt;
      res.json({ message: 'Payment receipt uploaded.', order: responseOrder });
    } catch (error) { console.error(error); res.status(502).json({ error: 'The receipt could not be saved. Please try again with a smaller file.' }); }
  });
});

router.post('/:id/place', orderLimiter, async (req: Request, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid order id.' });
    const token = typeof req.body?.checkoutToken === 'string' ? req.body.checkoutToken : '';
    if (token.length < 32 || token.length > 128) return res.status(401).json({ error: 'Checkout session is invalid. Please contact Timavelle with your order reference.' });
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const order = await Order.findById(req.params.id).select('+checkoutTokenHash +checkoutTokenExpiresAt');
    if (!order || order.checkoutTokenHash !== tokenHash) return res.status(404).json({ error: 'Checkout session could not be verified.' });
    if (order.checkoutTokenExpiresAt && order.checkoutTokenExpiresAt.getTime() < Date.now()) return res.status(410).json({ error: 'This bank-transfer checkout has expired. Please contact Timavelle before transferring.' });
    if (order.status === 'awaiting_payment') {
      order.status = 'new';
      await order.save();
    } else if (order.status !== 'new') {
      return res.status(409).json({ error: 'This order can no longer be placed from checkout.' });
    }
    const responseOrder = order.toObject();
    delete responseOrder.checkoutTokenHash;
    delete responseOrder.checkoutTokenExpiresAt;
    res.json({ message: 'Order placed; payment remains unverified.', order: responseOrder });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong placing the order.' });
  }
});

router.patch('/:id/payment-status', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid order id.' });
    const paymentStatus = (req.body as { paymentStatus?: string }).paymentStatus;
    const rejectionReason = typeof req.body.rejectionReason === 'string' ? req.body.rejectionReason.trim().slice(0, 500) : '';
    if (!paymentStatus || !PAYMENT_STATUSES.includes(paymentStatus as PaymentStatus)) return res.status(400).json({ error: 'A valid payment status is required.' });
    if (paymentStatus === 'rejected' && !rejectionReason) return res.status(400).json({ error: 'Add a reason when rejecting a payment receipt.' });
    const order = await Order.findByIdAndUpdate(req.params.id, { paymentStatus, ...(paymentStatus === 'rejected' ? { paymentRejectionReason: rejectionReason } : { $unset: { paymentRejectionReason: 1 } }) }, { new: true, runValidators: true });
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    res.json({ message: 'Payment status updated', order });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong updating payment status.' });
  }
});

router.get('/', protect, async (req: AuthRequest, res: Response) => {
  try {
    const page = parsePage(req.query.page, 1, 100000);
    const limit = parsePage(req.query.limit, 20, 100);
    const skip = (page - 1) * limit;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
    const scope = typeof req.query.scope === 'string' ? req.query.scope : 'active';

    if (status && !ORDER_STATUSES.includes(status as OrderStatus)) return res.status(400).json({ error: 'Invalid order status.' });
    if (!ORDER_SCOPES.includes(scope as typeof ORDER_SCOPES[number])) return res.status(400).json({ error: 'Invalid order scope.' });

    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    if (scope === 'active') filter.archivedAt = { $exists: false };
    if (scope === 'archived') filter.archivedAt = { $exists: true };
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [{ customerName: { $regex: escaped, $options: 'i' } }, { customerPhone: { $regex: escaped, $options: 'i' } }];
    }

    const [items, total] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Order.countDocuments(filter),
    ]);
    res.json({ items, page, limit, total, pages: Math.max(1, Math.ceil(total / limit)), scope });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong loading orders.' });
  }
});

router.get('/:id', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid order id.' });
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    res.json({ order });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong loading the order.' });
  }
});

router.patch('/:id/status', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid order id.' });
    const { status } = req.body as { status?: string };
    if (!status || !ORDER_STATUSES.includes(status as OrderStatus)) return res.status(400).json({ error: 'A valid order status is required.' });
    const order = await Order.findByIdAndUpdate(req.params.id, { status }, { new: true, runValidators: true });
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    res.json({ message: 'Order status updated', order });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong updating order status.' });
  }
});

router.patch('/:id/notes', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid order id.' });
    const internalNotes = typeof req.body.internalNotes === 'string' ? req.body.internalNotes.trim().slice(0, 5000) : null;
    if (internalNotes === null) return res.status(400).json({ error: 'Internal notes must be text.' });
    const order = await Order.findByIdAndUpdate(req.params.id, { internalNotes }, { new: true, runValidators: true });
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    res.json({ message: 'Internal notes updated', order });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong updating order notes.' });
  }
});

router.post('/bulk-action', protect, async (req: AuthRequest, res: Response) => {
  try {
    const { action } = req.body as { action?: string };
    const ids = parseIds(req.body?.ids);
    if (!ids) return res.status(400).json({ error: `Select between 1 and ${MAX_BULK_ORDERS} valid orders.` });
    if (!action || !ORDER_BULK_ACTIONS.includes(action as typeof ORDER_BULK_ACTIONS[number])) return res.status(400).json({ error: 'A valid bulk order action is required.' });

    if (action === 'delete') {
      const result = await Order.deleteMany({ _id: { $in: ids } });
      return res.json({ message: 'Bulk order deletion complete', action, requestedCount: ids.length, affectedCount: result.deletedCount, skippedCount: ids.length - result.deletedCount });
    }

    const filter: Record<string, unknown> = { _id: { $in: ids } };
    const update: Record<string, unknown> = {};
    if (action === 'archive') { filter.archivedAt = { $exists: false }; update.$set = { archivedAt: new Date(), archivedBy: req.adminId }; }
    else { filter.archivedAt = { $exists: true }; update.$unset = { archivedAt: 1, archivedBy: 1 }; }
    const matchingOrders = await Order.find(filter).select('_id').lean();
    await Order.updateMany(filter, update);
    await Promise.all(matchingOrders.map((order) => recordContentArchiveEvent({ action: action as 'archive' | 'restore', resourceType: 'order', resourceId: order._id, resourceLabel: orderAuditLabel(order._id), details: { privacy: 'Order customer and item values are deliberately not copied into audit history.' }, actorId: req.adminId })));
    const affectedCount = matchingOrders.length;
    res.json({ message: `Bulk order ${action} complete`, action, requestedCount: ids.length, affectedCount, skippedCount: ids.length - affectedCount });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong applying the bulk order action.' });
  }
});

router.post('/:id/archive', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid order id.' });
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    if (order.archivedAt) return res.status(409).json({ error: 'Order is already archived.' });
    order.archivedAt = new Date();
    order.archivedBy = req.adminId;
    await order.save();
    await recordContentArchiveEvent({ action: 'archive', resourceType: 'order', resourceId: order._id, resourceLabel: orderAuditLabel(order._id), details: { privacy: 'Order customer and item values are deliberately not copied into audit history.' }, actorId: req.adminId });
    res.json({ message: 'Order archived', order });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong archiving the order.' });
  }
});

router.post('/:id/restore', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid order id.' });
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    if (!order.archivedAt) return res.status(409).json({ error: 'Order is already active.' });
    order.archivedAt = undefined;
    order.archivedBy = undefined;
    await order.save();
    await recordContentArchiveEvent({ action: 'restore', resourceType: 'order', resourceId: order._id, resourceLabel: orderAuditLabel(order._id), details: { privacy: 'Order customer and item values are deliberately not copied into audit history.' }, actorId: req.adminId });
    res.json({ message: 'Order restored', order });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong restoring the order.' });
  }
});

router.delete('/:id', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid order id.' });
    const order = await Order.findByIdAndDelete(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    res.json({ message: 'Order deleted', orderId: order._id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong deleting the order.' });
  }
});

export default router;
