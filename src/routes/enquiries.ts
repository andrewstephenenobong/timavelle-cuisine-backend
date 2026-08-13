import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import Enquiry from '../models/Enquiry';
import { AuthRequest, protect } from '../middleware/auth';
import { enquiryLimiter } from '../middleware/rateLimiter';

const router = Router();
export const ENQUIRY_STATUSES = ['new', 'contacted', 'quoted', 'won', 'closed'] as const;
export const ENQUIRY_SCOPES = ['active', 'archived', 'all'] as const;
export const ENQUIRY_BULK_ACTIONS = ['archive', 'restore', 'delete'] as const;
const MAX_BULK_ENQUIRIES = 100;

function parsePage(value: unknown, fallback: number, max: number) {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function parseIds(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_BULK_ENQUIRIES) return null;
  const ids = [...new Set(value.filter((item): item is string => typeof item === 'string' && mongoose.isValidObjectId(item)))];
  return ids.length === value.length ? ids : null;
}

router.post('/', enquiryLimiter, async (req: Request, res: Response) => {
  try {
    const { name, email, phone, eventDate, partySize, message } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Name, email, and message are required.' });
    }

    const enquiry = await Enquiry.create({ name, email, phone, eventDate, partySize, message, status: 'new' });
    res.status(201).json({ message: 'Enquiry received', enquiry });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong sending your enquiry.' });
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

    if (status && !ENQUIRY_STATUSES.includes(status as typeof ENQUIRY_STATUSES[number])) {
      return res.status(400).json({ error: 'Invalid enquiry status.' });
    }
    if (!ENQUIRY_SCOPES.includes(scope as typeof ENQUIRY_SCOPES[number])) {
      return res.status(400).json({ error: 'Invalid enquiry scope.' });
    }

    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    if (scope === 'active') filter.archivedAt = { $exists: false };
    if (scope === 'archived') filter.archivedAt = { $exists: true };
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name: { $regex: escaped, $options: 'i' } },
        { email: { $regex: escaped, $options: 'i' } },
        { message: { $regex: escaped, $options: 'i' } },
      ];
    }

    const [items, total] = await Promise.all([
      Enquiry.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Enquiry.countDocuments(filter),
    ]);
    res.json({ items, page, limit, total, pages: Math.max(1, Math.ceil(total / limit)), scope });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong loading enquiries.' });
  }
});

router.get('/:id', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid enquiry id.' });
    const enquiry = await Enquiry.findById(req.params.id);
    if (!enquiry) return res.status(404).json({ error: 'Enquiry not found.' });
    res.json({ enquiry });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong loading the enquiry.' });
  }
});

router.patch('/:id/status', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid enquiry id.' });
    const { status } = req.body as { status?: string };
    if (!status || !ENQUIRY_STATUSES.includes(status as typeof ENQUIRY_STATUSES[number])) return res.status(400).json({ error: 'A valid enquiry status is required.' });
    const enquiry = await Enquiry.findById(req.params.id);
    if (!enquiry) return res.status(404).json({ error: 'Enquiry not found.' });
    enquiry.status = status as typeof enquiry.status;
    if (status !== 'new' && !enquiry.lastContactedAt) enquiry.lastContactedAt = new Date();
    await enquiry.save();
    res.json({ message: 'Enquiry status updated', enquiry });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong updating enquiry status.' });
  }
});

router.patch('/:id/notes', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid enquiry id.' });
    const internalNotes = typeof req.body.internalNotes === 'string' ? req.body.internalNotes.trim().slice(0, 5000) : null;
    if (internalNotes === null) return res.status(400).json({ error: 'Internal notes must be text.' });
    const enquiry = await Enquiry.findByIdAndUpdate(req.params.id, { internalNotes }, { new: true, runValidators: true });
    if (!enquiry) return res.status(404).json({ error: 'Enquiry not found.' });
    res.json({ message: 'Internal notes updated', enquiry });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong updating enquiry notes.' });
  }
});

router.post('/bulk-action', protect, async (req: AuthRequest, res: Response) => {
  try {
    const { action } = req.body as { action?: string };
    const ids = parseIds(req.body?.ids);
    if (!ids) return res.status(400).json({ error: `Select between 1 and ${MAX_BULK_ENQUIRIES} valid enquiries.` });
    if (!action || !ENQUIRY_BULK_ACTIONS.includes(action as typeof ENQUIRY_BULK_ACTIONS[number])) {
      return res.status(400).json({ error: 'A valid bulk enquiry action is required.' });
    }

    if (action === 'delete') {
      const result = await Enquiry.deleteMany({ _id: { $in: ids } });
      return res.json({ message: 'Bulk enquiry deletion complete', action, requestedCount: ids.length, affectedCount: result.deletedCount, skippedCount: ids.length - result.deletedCount });
    }

    const filter: Record<string, unknown> = { _id: { $in: ids } };
    const update: Record<string, unknown> = {};
    if (action === 'archive') {
      filter.archivedAt = { $exists: false };
      update.$set = { archivedAt: new Date(), archivedBy: req.adminId };
    } else {
      filter.archivedAt = { $exists: true };
      update.$unset = { archivedAt: 1, archivedBy: 1 };
    }
    const result = await Enquiry.updateMany(filter, update);
    const affectedCount = result.matchedCount;
    res.json({ message: `Bulk enquiry ${action} complete`, action, requestedCount: ids.length, affectedCount, skippedCount: ids.length - affectedCount });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong applying the bulk enquiry action.' });
  }
});

router.post('/:id/archive', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid enquiry id.' });
    const enquiry = await Enquiry.findById(req.params.id);
    if (!enquiry) return res.status(404).json({ error: 'Enquiry not found.' });
    if (enquiry.archivedAt) return res.status(409).json({ error: 'Enquiry is already archived.' });
    enquiry.archivedAt = new Date();
    enquiry.archivedBy = req.adminId;
    await enquiry.save();
    res.json({ message: 'Enquiry archived', enquiry });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong archiving the enquiry.' });
  }
});

router.post('/:id/restore', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid enquiry id.' });
    const enquiry = await Enquiry.findById(req.params.id);
    if (!enquiry) return res.status(404).json({ error: 'Enquiry not found.' });
    if (!enquiry.archivedAt) return res.status(409).json({ error: 'Enquiry is already active.' });
    enquiry.archivedAt = undefined;
    enquiry.archivedBy = undefined;
    await enquiry.save();
    res.json({ message: 'Enquiry restored', enquiry });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong restoring the enquiry.' });
  }
});

router.delete('/:id', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid enquiry id.' });
    const enquiry = await Enquiry.findByIdAndDelete(req.params.id);
    if (!enquiry) return res.status(404).json({ error: 'Enquiry not found.' });
    res.json({ message: 'Enquiry deleted', enquiryId: enquiry._id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong deleting the enquiry.' });
  }
});

export default router;
