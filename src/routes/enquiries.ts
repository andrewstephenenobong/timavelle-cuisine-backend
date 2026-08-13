import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import Enquiry from '../models/Enquiry';
import { AuthRequest, protect } from '../middleware/auth';
import { enquiryLimiter } from '../middleware/rateLimiter';

const router = Router();
export const ENQUIRY_STATUSES = ['new', 'contacted', 'quoted', 'won', 'closed'] as const;

function parsePage(value: unknown, fallback: number, max: number) {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
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

    if (status && !ENQUIRY_STATUSES.includes(status as typeof ENQUIRY_STATUSES[number])) {
      return res.status(400).json({ error: 'Invalid enquiry status.' });
    }

    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
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
    res.json({ items, page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) });
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

export default router;
