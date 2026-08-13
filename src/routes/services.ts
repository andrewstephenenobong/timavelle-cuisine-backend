import { Request, Response, Router } from 'express';
import mongoose from 'mongoose';
import ServiceItem, { IServiceItem } from '../models/ServiceItem';
import { protect } from '../middleware/auth';

const router = Router();

function parseOrder(value: unknown, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const order = Number(value);
  return Number.isFinite(order) && order >= 0 ? order : null;
}

function publicService(item: IServiceItem) {
  return { _id: item._id, title: item.published?.title, description: item.published?.description, order: item.published?.order, publishedAt: item.published?.publishedAt };
}

router.get('/', async (_req: Request, res: Response) => {
  try {
    const items = await ServiceItem.find({ 'published.title': { $exists: true } }).sort({ 'published.order': 1, 'published.publishedAt': 1 });
    res.json({ items: items.map(publicService) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong fetching services.' });
  }
});

router.get('/admin', protect, async (_req: Request, res: Response) => {
  try {
    const items = await ServiceItem.find().sort({ order: 1, createdAt: 1 });
    res.json({ items });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong fetching service drafts.' });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const item = await ServiceItem.findOne({ _id: req.params.id, 'published.title': { $exists: true } });
    if (!item) return res.status(404).json({ error: 'Published service not found.' });
    res.json({ item: publicService(item) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong fetching this service.' });
  }
});

router.post('/', protect, async (req: Request, res: Response) => {
  try {
    const { title, description } = req.body;
    const order = parseOrder(req.body.order);
    if (!title?.trim() || !description?.trim()) return res.status(400).json({ error: 'Title and description are required.' });
    if (order === null) return res.status(400).json({ error: 'Order must be a non-negative number.' });
    const item = await ServiceItem.create({ title, description, order, published: null });
    res.status(201).json({ message: 'Service draft created', item });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong creating this service draft.' });
  }
});

router.put('/:id', protect, async (req: Request, res: Response) => {
  try {
    const item = await ServiceItem.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Service draft not found.' });
    const order = parseOrder(req.body.order, item.order);
    if (req.body.title !== undefined && !req.body.title?.trim()) return res.status(400).json({ error: 'Title cannot be blank.' });
    if (req.body.description !== undefined && !req.body.description?.trim()) return res.status(400).json({ error: 'Description cannot be blank.' });
    if (order === null) return res.status(400).json({ error: 'Order must be a non-negative number.' });
    item.title = req.body.title ?? item.title;
    item.description = req.body.description ?? item.description;
    item.order = order;
    await item.save();
    res.json({ message: 'Service draft updated', item });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong updating this service draft.' });
  }
});

router.delete('/:id', protect, async (req: Request, res: Response) => {
  try {
    const item = await ServiceItem.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ error: 'Service draft not found.' });
    res.json({ message: 'Service draft deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong deleting this service draft.' });
  }
});

router.post('/publish-batch', protect, async (req: Request, res: Response) => {
  const ids: string[] = Array.isArray(req.body?.ids) ? Array.from(new Set(req.body.ids.filter((id: unknown): id is string => typeof id === 'string'))) : [];
  if (!ids.length || ids.some((id) => !mongoose.isValidObjectId(id))) return res.status(400).json({ error: 'A non-empty list of valid service ids is required.' });
  const session = await mongoose.startSession();
  try {
    let publishedItems: IServiceItem[] = [];
    await session.withTransaction(async () => {
      const items = await ServiceItem.find({ _id: { $in: ids } }).session(session);
      if (items.length !== ids.length) throw new Error('One or more service drafts were not found.');
      const publishedAt = new Date();
      for (const item of items) {
        if (!item.title.trim() || !item.description.trim()) throw new Error('Every service draft must have a title and description.');
        item.published = { title: item.title, description: item.description, order: item.order, publishedAt };
        await item.save({ session });
      }
      publishedItems = items;
    });
    res.json({ message: 'Services published atomically', items: publishedItems });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Something went wrong publishing services.' });
  } finally {
    await session.endSession();
  }
});

router.post('/:id/publish', protect, async (req: Request, res: Response) => {
  try {
    const item = await ServiceItem.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Service draft not found.' });
    item.published = { title: item.title, description: item.description, order: item.order, publishedAt: new Date() };
    await item.save();
    res.json({ message: 'Service published', item });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong publishing this service.' });
  }
});

export default router;
