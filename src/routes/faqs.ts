import { Request, Response, Router } from 'express';
import mongoose from 'mongoose';
import FaqItem, { IFaqItem } from '../models/FaqItem';
import { protect } from '../middleware/auth';

const router = Router();

function parseOrder(value: unknown, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const order = Number(value);
  return Number.isFinite(order) && order >= 0 ? order : null;
}

function publicFaq(item: IFaqItem) {
  return { _id: item._id, question: item.published?.question, answer: item.published?.answer, order: item.published?.order, publishedAt: item.published?.publishedAt };
}

router.get('/', async (_req: Request, res: Response) => {
  try {
    const items = await FaqItem.find({ 'published.question': { $exists: true } }).sort({ 'published.order': 1, 'published.publishedAt': 1 });
    res.json({ items: items.map(publicFaq) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong fetching FAQs.' });
  }
});

router.get('/admin', protect, async (_req: Request, res: Response) => {
  try {
    const items = await FaqItem.find().sort({ order: 1, createdAt: 1 });
    res.json({ items });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong fetching FAQ drafts.' });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const item = await FaqItem.findOne({ _id: req.params.id, 'published.question': { $exists: true } });
    if (!item) return res.status(404).json({ error: 'Published FAQ not found.' });
    res.json({ item: publicFaq(item) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong fetching this FAQ.' });
  }
});

router.post('/', protect, async (req: Request, res: Response) => {
  try {
    const { question, answer } = req.body;
    const order = parseOrder(req.body.order);
    if (!question?.trim() || !answer?.trim()) return res.status(400).json({ error: 'Question and answer are required.' });
    if (order === null) return res.status(400).json({ error: 'Order must be a non-negative number.' });
    const item = await FaqItem.create({ question, answer, order, published: null });
    res.status(201).json({ message: 'FAQ draft created', item });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong creating this FAQ draft.' });
  }
});

router.put('/:id', protect, async (req: Request, res: Response) => {
  try {
    const item = await FaqItem.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'FAQ draft not found.' });
    const order = parseOrder(req.body.order, item.order);
    if (req.body.question !== undefined && !req.body.question?.trim()) return res.status(400).json({ error: 'Question cannot be blank.' });
    if (req.body.answer !== undefined && !req.body.answer?.trim()) return res.status(400).json({ error: 'Answer cannot be blank.' });
    if (order === null) return res.status(400).json({ error: 'Order must be a non-negative number.' });
    item.question = req.body.question ?? item.question;
    item.answer = req.body.answer ?? item.answer;
    item.order = order;
    await item.save();
    res.json({ message: 'FAQ draft updated', item });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong updating this FAQ draft.' });
  }
});

router.delete('/:id', protect, async (req: Request, res: Response) => {
  try {
    const item = await FaqItem.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ error: 'FAQ draft not found.' });
    res.json({ message: 'FAQ draft deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong deleting this FAQ draft.' });
  }
});

router.post('/publish-batch', protect, async (req: Request, res: Response) => {
  const ids: string[] = Array.isArray(req.body?.ids) ? Array.from(new Set(req.body.ids.filter((id: unknown): id is string => typeof id === 'string'))) : [];
  if (!ids.length || ids.some((id) => !mongoose.isValidObjectId(id))) return res.status(400).json({ error: 'A non-empty list of valid FAQ ids is required.' });
  const session = await mongoose.startSession();
  try {
    let publishedItems: IFaqItem[] = [];
    await session.withTransaction(async () => {
      const items = await FaqItem.find({ _id: { $in: ids } }).session(session);
      if (items.length !== ids.length) throw new Error('One or more FAQ drafts were not found.');
      const publishedAt = new Date();
      for (const item of items) {
        if (!item.question.trim() || !item.answer.trim()) throw new Error('Every FAQ draft must have a question and answer.');
        item.published = { question: item.question, answer: item.answer, order: item.order, publishedAt };
        await item.save({ session });
      }
      publishedItems = items;
    });
    res.json({ message: 'FAQs published atomically', items: publishedItems });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Something went wrong publishing FAQs.' });
  } finally {
    await session.endSession();
  }
});

router.post('/:id/publish', protect, async (req: Request, res: Response) => {
  try {
    const item = await FaqItem.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'FAQ draft not found.' });
    item.published = { question: item.question, answer: item.answer, order: item.order, publishedAt: new Date() };
    await item.save();
    res.json({ message: 'FAQ published', item });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong publishing this FAQ.' });
  }
});

export default router;
