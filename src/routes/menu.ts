import { Router, Request, Response } from 'express';
import MenuItem from '../models/MenuItem';
import { AuthRequest, protect } from '../middleware/auth';
import { archiveScopeFilter, readContentScope, recordContentArchiveEvent, validContentId } from '../lib/contentArchive';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    const items = await MenuItem.find({ archivedAt: { $exists: false } }).sort({ createdAt: -1 });
    res.json({ items });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong fetching the menu.' });
  }
});

router.get('/admin', protect, async (req: AuthRequest, res: Response) => {
  try {
    const scope = readContentScope(req, res);
    if (!scope) return;
    const items = await MenuItem.find(archiveScopeFilter(scope)).sort({ createdAt: -1 });
    res.json({ items, scope });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong fetching the menu catalog.' });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    if (!validContentId(req.params.id, 'menu item', res)) return;
    const item = await MenuItem.findOne({ _id: req.params.id, archivedAt: { $exists: false } });
    if (!item) return res.status(404).json({ error: 'Menu item not found.' });
    res.json({ item });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong fetching this item.' });
  }
});

router.post('/', protect, async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, category, image, featured } = req.body;
    if (!name || !description || !category) return res.status(400).json({ error: 'Name, description, and category are required.' });
    const item = await MenuItem.create({ name, description, category, image, featured });
    res.status(201).json({ message: 'Menu item created', item });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong creating this item.' });
  }
});

router.put('/:id', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!validContentId(req.params.id, 'menu item', res)) return;
    const { name, description, category, image, featured } = req.body;
    const item = await MenuItem.findOneAndUpdate(
      { _id: req.params.id, archivedAt: { $exists: false } },
      { name, description, category, image, featured },
      { new: true, runValidators: true }
    );
    if (!item) return res.status(404).json({ error: 'Active menu item not found.' });
    res.json({ message: 'Menu item updated', item });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong updating this item.' });
  }
});

router.post('/:id/archive', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!validContentId(req.params.id, 'menu item', res)) return;
    const item = await MenuItem.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Menu item not found.' });
    if (item.archivedAt) return res.status(409).json({ error: 'Menu item is already archived.' });
    item.archivedAt = new Date();
    item.archivedBy = req.adminId;
    await item.save();
    await recordContentArchiveEvent({ action: 'archive', resourceType: 'menu', resourceId: item._id, resourceLabel: item.name, actorId: req.adminId });
    res.json({ message: 'Menu item archived', item });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong archiving this item.' });
  }
});

router.post('/:id/restore', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!validContentId(req.params.id, 'menu item', res)) return;
    const item = await MenuItem.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Menu item not found.' });
    if (!item.archivedAt) return res.status(409).json({ error: 'Menu item is already active.' });
    item.archivedAt = undefined;
    item.archivedBy = undefined;
    await item.save();
    await recordContentArchiveEvent({ action: 'restore', resourceType: 'menu', resourceId: item._id, resourceLabel: item.name, actorId: req.adminId });
    res.json({ message: 'Menu item restored', item });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong restoring this item.' });
  }
});

router.delete('/:id', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!validContentId(req.params.id, 'menu item', res)) return;
    const item = await MenuItem.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Menu item not found.' });
    if (!item.archivedAt) return res.status(409).json({ error: 'Archive this menu item before permanently deleting it.' });
    await item.deleteOne();
    res.json({ message: 'Menu item permanently deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong permanently deleting this item.' });
  }
});

export default router;
