import { Request, Response, Router } from 'express';
import mongoose from 'mongoose';
import ContactDetail, { IContactDetail } from '../models/ContactDetail';
import { AuthRequest, protect } from '../middleware/auth';
import { archiveScopeFilter, readContentScope, recordContentArchiveEvent, validContentId } from '../lib/contentArchive';

const router = Router();

function publicContact(item: IContactDetail) {
  return { _id: item._id, key: item.key, label: item.published?.label, value: item.published?.value, publishedAt: item.published?.publishedAt };
}

router.get('/', async (_req: Request, res: Response) => {
  try {
    const items = await ContactDetail.find({ 'published.value': { $exists: true }, 'published.isArchived': { $ne: true } }).sort({ key: 1 });
    res.json({ items: items.map(publicContact) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong fetching contact details.' });
  }
});

router.get('/admin', protect, async (req: AuthRequest, res: Response) => {
  try {
    const scope = readContentScope(req, res);
    if (!scope) return;
    const items = await ContactDetail.find(archiveScopeFilter(scope)).sort({ key: 1 });
    res.json({ items, scope });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong fetching contact drafts.' });
  }
});

router.post('/', protect, async (req: AuthRequest, res: Response) => {
  try {
    const key = typeof req.body.key === 'string' ? req.body.key.trim().toLowerCase() : '';
    const label = typeof req.body.label === 'string' ? req.body.label.trim() : '';
    const value = typeof req.body.value === 'string' ? req.body.value.trim() : '';
    if (!/^[a-z0-9-]{1,64}$/.test(key)) return res.status(400).json({ error: 'Key must use lowercase letters, numbers, and hyphens only.' });
    if (!label || !value) return res.status(400).json({ error: 'Label and value are required.' });
    const existing = await ContactDetail.findOne({ key });
    if (existing) return res.status(409).json({ error: 'A contact detail already uses this key. Restore the archived detail instead.' });
    const item = await ContactDetail.create({ key, label, value, published: null });
    res.status(201).json({ message: 'Contact detail draft created', item });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong creating this contact detail draft.' });
  }
});

router.put('/:id', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!validContentId(req.params.id, 'contact detail', res)) return;
    const item = await ContactDetail.findOne({ _id: req.params.id, archivedAt: { $exists: false } });
    if (!item) return res.status(404).json({ error: 'Active contact detail draft not found.' });
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

router.post('/:id/archive', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!validContentId(req.params.id, 'contact detail', res)) return;
    const item = await ContactDetail.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Contact detail draft not found.' });
    if (item.archivedAt) return res.status(409).json({ error: 'Contact detail draft is already archived.' });
    item.archivedAt = new Date();
    item.archivedBy = req.adminId;
    await item.save();
    await recordContentArchiveEvent({ action: 'archive', resourceType: 'contact', resourceId: item._id, resourceLabel: item.label, details: { key: item.key, label: item.label, value: item.value, publicState: item.published ? (item.published.isArchived ? 'archived' : 'published') : 'not-published' }, actorId: req.adminId });
    res.json({ message: 'Contact detail draft archived. Publish to remove it from the public site.', item });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong archiving this contact detail draft.' });
  }
});

router.post('/:id/restore', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!validContentId(req.params.id, 'contact detail', res)) return;
    const item = await ContactDetail.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Contact detail draft not found.' });
    if (!item.archivedAt) return res.status(409).json({ error: 'Contact detail draft is already active.' });
    item.archivedAt = undefined;
    item.archivedBy = undefined;
    await item.save();
    await recordContentArchiveEvent({ action: 'restore', resourceType: 'contact', resourceId: item._id, resourceLabel: item.label, details: { key: item.key, label: item.label, value: item.value, publicState: item.published ? (item.published.isArchived ? 'archived' : 'published') : 'not-published' }, actorId: req.adminId });
    res.json({ message: 'Contact detail draft restored. Publish to return it to the public site.', item });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong restoring this contact detail draft.' });
  }
});

router.delete('/:id', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!validContentId(req.params.id, 'contact detail', res)) return;
    const item = await ContactDetail.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Contact detail draft not found.' });
    if (!item.archivedAt) return res.status(409).json({ error: 'Archive this contact detail draft before permanently deleting it.' });
    if (item.published && !item.published.isArchived) return res.status(409).json({ error: 'Publish this archived contact detail before permanently deleting it so the public site stays in sync.' });
    await item.deleteOne();
    res.json({ message: 'Contact detail draft permanently deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong permanently deleting this contact detail draft.' });
  }
});

router.post('/publish', protect, async (_req: AuthRequest, res: Response) => {
  const session = await mongoose.startSession();
  try {
    let items: IContactDetail[] = [];
    await session.withTransaction(async () => {
      items = await ContactDetail.find().session(session);
      const activeItems = items.filter((item) => !item.archivedAt);
      if (!activeItems.length) throw new Error('Restore or create at least one contact detail before publishing.');
      const publishedAt = new Date();
      for (const item of activeItems) {
        if (!item.label.trim() || !item.value.trim()) throw new Error('Every active contact detail must have a label and value.');
        item.published = { label: item.label, value: item.value, publishedAt, isArchived: false };
        await item.save({ session });
      }
      for (const item of items.filter((item) => Boolean(item.archivedAt) && Boolean(item.published?.value))) {
        if (item.published) {
          item.published = { label: item.published.label, value: item.published.value, publishedAt, isArchived: true };
          await item.save({ session });
        }
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
