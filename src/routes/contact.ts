import { Request, Response, Router } from 'express';
import mongoose from 'mongoose';
import ContactDetail, { IContactDetail } from '../models/ContactDetail';
import { protect } from '../middleware/auth';

const router = Router();

function publicContact(item: IContactDetail) {
  return { _id: item._id, key: item.key, label: item.published?.label, value: item.published?.value, publishedAt: item.published?.publishedAt };
}

router.get('/', async (_req: Request, res: Response) => {
  try {
    const items = await ContactDetail.find({ 'published.value': { $exists: true } }).sort({ key: 1 });
    res.json({ items: items.map(publicContact) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong fetching contact details.' });
  }
});

router.get('/admin', protect, async (_req: Request, res: Response) => {
  try {
    const items = await ContactDetail.find().sort({ key: 1 });
    res.json({ items });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong fetching contact drafts.' });
  }
});

router.put('/:id', protect, async (req: Request, res: Response) => {
  try {
    const item = await ContactDetail.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Contact detail draft not found.' });
    if (req.body.label !== undefined && !req.body.label?.trim()) return res.status(400).json({ error: 'Label cannot be blank.' });
    if (req.body.value !== undefined && !req.body.value?.trim()) return res.status(400).json({ error: 'Value cannot be blank.' });
    item.label = req.body.label ?? item.label;
    item.value = req.body.value ?? item.value;
    await item.save();
    res.json({ message: 'Contact detail draft updated', item });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong updating this contact detail draft.' });
  }
});

router.post('/publish', protect, async (_req: Request, res: Response) => {
  const session = await mongoose.startSession();
  try {
    let items: IContactDetail[] = [];
    await session.withTransaction(async () => {
      items = await ContactDetail.find().session(session);
      if (!items.length) throw new Error('No contact details are available to publish.');
      const publishedAt = new Date();
      for (const item of items) {
        if (!item.label.trim() || !item.value.trim()) throw new Error('Every contact detail must have a label and value.');
        item.published = { label: item.label, value: item.value, publishedAt };
        await item.save({ session });
      }
    });
    res.json({ message: 'Contact details published', items });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Something went wrong publishing contact details.' });
  } finally {
    await session.endSession();
  }
});

export default router;
