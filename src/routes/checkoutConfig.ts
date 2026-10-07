import { Router, Request, Response } from 'express';
import DeliveryArea from '../models/DeliveryArea';
import DiscountCode, { DISCOUNT_TYPES } from '../models/DiscountCode';
import { AuthRequest, protect } from '../middleware/auth';

const router = Router();

router.get('/delivery-areas', async (_req: Request, res: Response) => {
  try {
    const items = await DeliveryArea.find({ active: true }).sort({ name: 1 }).select('_id name fee active');
    res.set('Cache-Control', 'no-store');
    res.json({ items });
  } catch (error) {
    console.error(error);
    res.status(503).json({ error: 'Delivery areas are temporarily unavailable.' });
  }
});

router.get('/delivery-areas/admin', protect, async (_req: AuthRequest, res: Response) => {
  try { res.json({ items: await DeliveryArea.find().sort({ name: 1 }) }); }
  catch (error) { console.error(error); res.status(500).json({ error: 'Could not load delivery areas.' }); }
});

router.post('/delivery-areas', protect, async (req: AuthRequest, res: Response) => {
  try {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const fee = Number(req.body.fee);
    if (!name || name.length > 120 || !Number.isFinite(fee) || fee < 0) return res.status(400).json({ error: 'Enter a delivery area name and a valid non-negative fee.' });
    const item = await DeliveryArea.create({ name, fee, active: req.body.active !== false });
    res.status(201).json({ item });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return res.status(409).json({ error: 'A delivery area with this name already exists.' });
    console.error(error); res.status(500).json({ error: 'Could not create delivery area.' });
  }
});

router.put('/delivery-areas/:id', protect, async (req: AuthRequest, res: Response) => {
  try {
    const updates: Record<string, unknown> = {};
    if (req.body.name !== undefined) { if (typeof req.body.name !== 'string' || !req.body.name.trim()) return res.status(400).json({ error: 'Enter a delivery area name.' }); updates.name = req.body.name.trim(); }
    if (req.body.fee !== undefined) { const fee = Number(req.body.fee); if (!Number.isFinite(fee) || fee < 0) return res.status(400).json({ error: 'Delivery fee must be zero or greater.' }); updates.fee = fee; }
    if (req.body.active !== undefined) { if (typeof req.body.active !== 'boolean') return res.status(400).json({ error: 'Active must be true or false.' }); updates.active = req.body.active; }
    const item = await DeliveryArea.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
    if (!item) return res.status(404).json({ error: 'Delivery area not found.' });
    res.json({ item });
  } catch (error) { console.error(error); res.status(500).json({ error: 'Could not update delivery area.' }); }
});

router.delete('/delivery-areas/:id', protect, async (req: AuthRequest, res: Response) => {
  try {
    const item = await DeliveryArea.findByIdAndUpdate(req.params.id, { active: false }, { new: true });
    if (!item) return res.status(404).json({ error: 'Delivery area not found.' });
    res.json({ item });
  } catch (error) { console.error(error); res.status(500).json({ error: 'Could not deactivate delivery area.' }); }
});

router.get('/discount-codes', protect, async (_req: AuthRequest, res: Response) => {
  try { res.json({ items: await DiscountCode.find().sort({ createdAt: -1 }) }); }
  catch (error) { console.error(error); res.status(500).json({ error: 'Could not load discount codes.' }); }
});

router.post('/discount-codes', protect, async (req: AuthRequest, res: Response) => {
  try {
    const code = typeof req.body.code === 'string' ? req.body.code.trim().toUpperCase() : '';
    const type = req.body.type;
    const value = Number(req.body.value);
    const minimumOrderValue = Number(req.body.minimumOrderValue || 0);
    if (!code || !DISCOUNT_TYPES.includes(type) || !Number.isFinite(value) || value <= 0 || (type === 'percent' && value > 100) || !Number.isFinite(minimumOrderValue) || minimumOrderValue < 0) return res.status(400).json({ error: 'Enter a valid discount code, type, value, and minimum order value.' });
    const item = await DiscountCode.create({ code, type, value, minimumOrderValue, active: req.body.active !== false, expiresAt: req.body.expiresAt || undefined, usageLimit: req.body.usageLimit || undefined });
    res.status(201).json({ item });
  } catch (error) { if ((error as { code?: number }).code === 11000) return res.status(409).json({ error: 'That discount code already exists.' }); console.error(error); res.status(500).json({ error: 'Could not create discount code.' }); }
});

router.put('/discount-codes/:id', protect, async (req: AuthRequest, res: Response) => {
  try {
    const updates: Record<string, unknown> = {};
    if (req.body.active !== undefined) updates.active = Boolean(req.body.active);
    if (req.body.expiresAt !== undefined) updates.expiresAt = req.body.expiresAt || undefined;
    if (req.body.usageLimit !== undefined) updates.usageLimit = req.body.usageLimit ? Number(req.body.usageLimit) : undefined;
    const item = await DiscountCode.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
    if (!item) return res.status(404).json({ error: 'Discount code not found.' });
    res.json({ item });
  } catch (error) { console.error(error); res.status(500).json({ error: 'Could not update discount code.' }); }
});

export default router;
