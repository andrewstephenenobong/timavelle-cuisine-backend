import { Request, Response, Router } from 'express';
import mongoose from 'mongoose';
import ServiceItem, { IServiceItem } from '../models/ServiceItem';
import { AuthRequest, protect } from '../middleware/auth';
import { archiveScopeFilter, readContentScope, recordContentArchiveEvent, validContentId } from '../lib/contentArchive';

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
    const items = await ServiceItem.find({ 'published.title': { $exists: true }, 'published.isArchived': { $ne: true } }).sort({ 'published.order': 1, 'published.publishedAt': 1 });
    res.json({ items: items.map(publicService) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong fetching services.' });
  }
});

router.get('/admin', protect, async (req: AuthRequest, res: Response) => {
  try {
    const scope = readContentScope(req, res);
    if (!scope) return;
    const items = await ServiceItem.find(archiveScopeFilter(scope)).sort({ order: 1, createdAt: 1 });
    res.json({ items, scope });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong fetching service drafts.' });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    if (!validContentId(req.params.id, 'service', res)) return;
    const item = await ServiceItem.findOne({ _id: req.params.id, 'published.title': { $exists: true }, 'published.isArchived': { $ne: true } });
    if (!item) return res.status(404).json({ error: 'Published service not found.' });
    res.json({ item: publicService(item) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong fetching this service.' });
  }
});

router.post('/', protect, async (req: AuthRequest, res: Response) => {
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

router.put('/:id', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!validContentId(req.params.id, 'service', res)) return;
    const item = await ServiceItem.findOne({ _id: req.params.id, archivedAt: { $exists: false } });
    if (!item) return res.status(404).json({ error: 'Active service draft not found.' });
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

router.post('/:id/archive', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!validContentId(req.params.id, 'service', res)) return;
    const item = await ServiceItem.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Service draft not found.' });
    if (item.archivedAt) return res.status(409).json({ error: 'Service draft is already archived.' });
    item.archivedAt = new Date();
    item.archivedBy = req.adminId;
    await item.save();
    await recordContentArchiveEvent({ action: 'archive', resourceType: 'service', resourceId: item._id, resourceLabel: item.title, actorId: req.adminId });
    res.json({ message: 'Service draft archived. Publish to remove it from the public site.', item });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong archiving this service draft.' });
  }
});

router.post('/:id/restore', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!validContentId(req.params.id, 'service', res)) return;
    const item = await ServiceItem.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Service draft not found.' });
    if (!item.archivedAt) return res.status(409).json({ error: 'Service draft is already active.' });
    item.archivedAt = undefined;
    item.archivedBy = undefined;
    await item.save();
    await recordContentArchiveEvent({ action: 'restore', resourceType: 'service', resourceId: item._id, resourceLabel: item.title, actorId: req.adminId });
    res.json({ message: 'Service draft restored. Publish to return it to the public site.', item });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong restoring this service draft.' });
  }
});

router.delete('/:id', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!validContentId(req.params.id, 'service', res)) return;
    const item = await ServiceItem.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Service draft not found.' });
    if (!item.archivedAt) return res.status(409).json({ error: 'Archive this service draft before permanently deleting it.' });
    if (item.published && !item.published.isArchived) return res.status(409).json({ error: 'Publish this archived service before permanently deleting it so the public site stays in sync.' });
    await item.deleteOne();
    res.json({ message: 'Service draft permanently deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong permanently deleting this service draft.' });
  }
});

router.post('/publish-batch', protect, async (req: AuthRequest, res: Response) => {
  const ids: string[] = Array.isArray(req.body?.ids) ? Array.from(new Set(req.body.ids.filter((id: unknown): id is string => typeof id === 'string'))) : [];
  if (!ids.length || ids.some((id) => !mongoose.isValidObjectId(id))) return res.status(400).json({ error: 'A non-empty list of valid service ids is required.' });
  const session = await mongoose.startSession();
  try {
    let publishedItems: IServiceItem[] = [];
    await session.withTransaction(async () => {
      const items = await ServiceItem.find({ _id: { $in: ids }, archivedAt: { $exists: false } }).session(session);
      if (items.length !== ids.length) throw new Error('One or more active service drafts were not found. Refresh and try again.');
      const archivedItems = await ServiceItem.find({ archivedAt: { $exists: true }, 'published.title': { $exists: true } }).session(session);
      const publishedAt = new Date();
      for (const item of items) {
        if (!item.title.trim() || !item.description.trim()) throw new Error('Every service draft must have a title and description.');
        item.published = { title: item.title, description: item.description, order: item.order, publishedAt, isArchived: false };
        await item.save({ session });
      }
      for (const item of archivedItems) {
        if (item.published) {
          item.published = { title: item.published.title, description: item.published.description, order: item.published.order, publishedAt, isArchived: true };
          await item.save({ session });
        }
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

router.post('/:id/publish', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!validContentId(req.params.id, 'service', res)) return;
    const item = await ServiceItem.findOne({ _id: req.params.id, archivedAt: { $exists: false } });
    if (!item) return res.status(404).json({ error: 'Active service draft not found.' });
    item.published = { title: item.title, description: item.description, order: item.order, publishedAt: new Date(), isArchived: false };
    await item.save();
    res.json({ message: 'Service published', item });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong publishing this service.' });
  }
});

export default router;
