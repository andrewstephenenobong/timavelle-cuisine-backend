import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import GalleryImage from '../models/GalleryImage';
import { AuthRequest, protect } from '../middleware/auth';
import { archiveScopeFilter, readContentScope, recordContentArchiveEvent, validContentId } from '../lib/contentArchive';

const router = Router();
const MAX_BULK_GALLERY_IMAGES = 100;

function parseBulkIds(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_BULK_GALLERY_IMAGES) return null;
  const ids = [...new Set(value.filter((item): item is string => typeof item === 'string' && mongoose.isValidObjectId(item)))];
  return ids.length === value.length ? ids : null;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function galleryAuditDetails(image: { imageUrl: string; caption?: string; category: string }) {
  return { caption: image.caption || null, category: image.category, imageUrl: image.imageUrl };
}

router.get('/', async (_req: Request, res: Response) => {
  try {
    const images = await GalleryImage.find({ archivedAt: { $exists: false } }).sort({ createdAt: -1 });
    res.json({ images });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong fetching the gallery.' });
  }
});

router.get('/admin', protect, async (req: AuthRequest, res: Response) => {
  try {
    const scope = readContentScope(req, res);
    if (!scope) return;
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 120) : '';
    const category = typeof req.query.category === 'string' ? req.query.category.trim().slice(0, 80) : '';
    const scopeFilter = archiveScopeFilter(scope);
    const filter: Record<string, unknown> = { ...scopeFilter };
    if (category && category !== 'all') filter.category = new RegExp(`^${escapeRegExp(category)}$`, 'i');
    if (search) {
      const expression = new RegExp(escapeRegExp(search), 'i');
      filter.$or = [{ caption: expression }, { category: expression }];
    }
    const [images, categories] = await Promise.all([
      GalleryImage.find(filter).sort({ createdAt: -1 }),
      GalleryImage.distinct('category', scopeFilter),
    ]);
    res.json({ images, scope, categories: categories.filter((value): value is string => Boolean(value)).sort((a, b) => a.localeCompare(b)) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong fetching the gallery catalog.' });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    if (!validContentId(req.params.id, 'gallery image', res)) return;
    const image = await GalleryImage.findOne({ _id: req.params.id, archivedAt: { $exists: false } });
    if (!image) return res.status(404).json({ error: 'Image not found.' });
    res.json({ image });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong fetching this image.' });
  }
});

router.post('/', protect, async (req: AuthRequest, res: Response) => {
  try {
    const { imageUrl, caption, category } = req.body;
    if (!imageUrl || !category) return res.status(400).json({ error: 'Image URL and category are required.' });
    const image = await GalleryImage.create({ imageUrl, caption, category });
    res.status(201).json({ message: 'Image added', image });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong adding this image.' });
  }
});

router.post('/bulk-action', protect, async (req: AuthRequest, res: Response) => {
  try {
    const { action } = req.body as { action?: string };
    const ids = parseBulkIds(req.body?.ids);
    if (!ids) return res.status(400).json({ error: `Select between 1 and ${MAX_BULK_GALLERY_IMAGES} valid gallery images.` });
    if (action !== 'archive' && action !== 'restore') return res.status(400).json({ error: 'A valid bulk Gallery action is required.' });
    const filter: Record<string, unknown> = { _id: { $in: ids }, archivedAt: action === 'archive' ? { $exists: false } : { $exists: true } };
    const images = await GalleryImage.find(filter).select('_id imageUrl caption category').lean();
    if (images.length > 0) {
      if (action === 'archive') await GalleryImage.updateMany(filter, { $set: { archivedAt: new Date(), archivedBy: req.adminId } });
      else await GalleryImage.updateMany(filter, { $unset: { archivedAt: 1, archivedBy: 1 } });
      await Promise.all(images.map((image) => recordContentArchiveEvent({ action, resourceType: 'gallery', resourceId: image._id, resourceLabel: image.caption?.trim() || image.category, details: galleryAuditDetails(image), actorId: req.adminId })));
    }
    res.json({ message: `Gallery images ${action}d`, action, requestedCount: ids.length, affectedCount: images.length, skippedCount: ids.length - images.length });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong applying the bulk Gallery action.' });
  }
});

router.put('/:id', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!validContentId(req.params.id, 'gallery image', res)) return;
    const { imageUrl, caption, category } = req.body;
    const image = await GalleryImage.findOneAndUpdate(
      { _id: req.params.id, archivedAt: { $exists: false } },
      { imageUrl, caption, category },
      { new: true, runValidators: true }
    );
    if (!image) return res.status(404).json({ error: 'Active image not found.' });
    res.json({ message: 'Image updated', image });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong updating this image.' });
  }
});

router.post('/:id/archive', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!validContentId(req.params.id, 'gallery image', res)) return;
    const image = await GalleryImage.findById(req.params.id);
    if (!image) return res.status(404).json({ error: 'Image not found.' });
    if (image.archivedAt) return res.status(409).json({ error: 'Image is already archived.' });
    image.archivedAt = new Date();
    image.archivedBy = req.adminId;
    await image.save();
    await recordContentArchiveEvent({ action: 'archive', resourceType: 'gallery', resourceId: image._id, resourceLabel: image.caption?.trim() || image.category, details: galleryAuditDetails(image), actorId: req.adminId });
    res.json({ message: 'Image archived', image });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong archiving this image.' });
  }
});

router.post('/:id/restore', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!validContentId(req.params.id, 'gallery image', res)) return;
    const image = await GalleryImage.findById(req.params.id);
    if (!image) return res.status(404).json({ error: 'Image not found.' });
    if (!image.archivedAt) return res.status(409).json({ error: 'Image is already active.' });
    image.archivedAt = undefined;
    image.archivedBy = undefined;
    await image.save();
    await recordContentArchiveEvent({ action: 'restore', resourceType: 'gallery', resourceId: image._id, resourceLabel: image.caption?.trim() || image.category, details: galleryAuditDetails(image), actorId: req.adminId });
    res.json({ message: 'Image restored', image });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong restoring this image.' });
  }
});

router.delete('/:id', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!validContentId(req.params.id, 'gallery image', res)) return;
    const image = await GalleryImage.findById(req.params.id);
    if (!image) return res.status(404).json({ error: 'Image not found.' });
    if (!image.archivedAt) return res.status(409).json({ error: 'Archive this image before permanently deleting it.' });
    await image.deleteOne();
    res.json({ message: 'Image permanently deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong permanently deleting this image.' });
  }
});

export default router;
