import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import GalleryImage from '../models/GalleryImage';
import GallerySetting, { GALLERY_ORDERS, GalleryOrder } from '../models/GallerySetting';
import { AuthRequest, protect } from '../middleware/auth';
import { archiveScopeFilter, readContentScope, recordContentArchiveEvent, validContentId } from '../lib/contentArchive';

const router = Router();
const MAX_BULK_GALLERY_IMAGES = 100;

function parseBulkIds(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_BULK_GALLERY_IMAGES) return null;
  const ids = [...new Set(value.filter((item): item is string => typeof item === 'string' && mongoose.isValidObjectId(item)))];
  return ids.length === value.length ? ids : null;
}

async function readGalleryOrder(): Promise<GalleryOrder> {
  const setting = await GallerySetting.findOne({ key: 'gallery' }).lean();
  return setting?.order ?? 'newest';
}

// Newest/oldest follow upload date. Manual follows the order the admin arranged; photos added since the
// last arrangement have no position yet and are listed first (newest first) until the next rearrange.
function gallerySort(order: GalleryOrder): Record<string, 1 | -1> {
  if (order === 'oldest') return { createdAt: 1 };
  if (order === 'manual') return { sortOrder: 1, createdAt: -1 };
  return { createdAt: -1 };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function galleryAuditDetails(image: { imageUrl: string; caption?: string; category: string }) {
  return { caption: image.caption || null, category: image.category, imageUrl: image.imageUrl };
}

router.get('/', async (_req: Request, res: Response) => {
  try {
    const order = await readGalleryOrder();
    const images = await GalleryImage.find({ archivedAt: { $exists: false } }).sort(gallerySort(order));
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
    const order = await readGalleryOrder();
    const [images, categories] = await Promise.all([
    GalleryImage.find(filter).sort(scope === 'active' ? gallerySort(order) : { createdAt: -1 }),
    GalleryImage.distinct('category', scopeFilter),
    ]);
    res.json({ images, scope, order, categories: categories.filter((value): value is string => Boolean(value)).sort((a, b) => a.localeCompare(b)) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong fetching the gallery catalog.' });
  }
});
router.get('/settings', protect, async (_req: AuthRequest, res: Response) => {
  try {
    res.json({ order: await readGalleryOrder() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong loading gallery settings.' });
  }
});

router.put('/settings', protect, async (req: AuthRequest, res: Response) => {
  try {
    const order = req.body?.order;
    if (!GALLERY_ORDERS.includes(order)) return res.status(400).json({ error: 'Choose newest first, oldest first, or custom order.' });
    await GallerySetting.findOneAndUpdate({ key: 'gallery' }, { $set: { order } }, { upsert: true, setDefaultsOnInsert: true });
    res.json({ message: 'Gallery order updated', order });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong updating the gallery order.' });
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

const MAX_BATCH_GALLERY_IMAGES = 50;

function isSafeGalleryImageUrl(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 2048 && (/^https:\/\//i.test(value) || value.startsWith('/'));
}

// Creates many gallery records in one request so a phone upload of 10-20 photos is one database round-trip,
// all sharing one category. Individual images can be re-captioned later from the gallery grid.
router.post('/batch', protect, async (req: AuthRequest, res: Response) => {
  try {
    const category = typeof req.body?.category === 'string' ? req.body.category.trim() : '';
    const rawImages: unknown = req.body?.images;
    if (!category || category.length > 80) return res.status(400).json({ error: 'A category (up to 80 characters) is required.' });
    if (!Array.isArray(rawImages) || rawImages.length === 0 || rawImages.length > MAX_BATCH_GALLERY_IMAGES) {
      return res.status(400).json({ error: `Add between 1 and ${MAX_BATCH_GALLERY_IMAGES} photos per batch.` });
    }
    const documents: { imageUrl: string; category: string; caption?: string }[] = [];
    for (const entry of rawImages) {
      const imageUrl = entry && typeof entry === 'object' ? (entry as Record<string, unknown>).imageUrl : undefined;
      if (!isSafeGalleryImageUrl(imageUrl)) return res.status(400).json({ error: 'Every photo needs a valid image URL.' });
      const caption = entry && typeof entry === 'object' && typeof (entry as Record<string, unknown>).caption === 'string' ? ((entry as Record<string, unknown>).caption as string).trim().slice(0, 200) : '';
      documents.push({ imageUrl, category, ...(caption ? { caption } : {}) });
    }
    const images = await GalleryImage.insertMany(documents);
    res.status(201).json({ message: `${images.length} photo${images.length === 1 ? '' : 's'} added`, count: images.length, images });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong adding these photos.' });
  }
});
const MAX_REORDER_IMAGES = 1000;

// Saves a hand-arranged order for the public gallery and switches the gallery to "custom order".
router.post('/reorder', protect, async (req: AuthRequest, res: Response) => {
  try {
    const raw: unknown = req.body?.ids;
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_REORDER_IMAGES) return res.status(400).json({ error: 'Send the photos in the order you want them.' });
    const ids = [...new Set(raw.filter((item): item is string => typeof item === 'string' && mongoose.isValidObjectId(item)))];
    if (ids.length !== raw.length) return res.status(400).json({ error: 'The photo list contains invalid or duplicate entries.' });
    await GalleryImage.bulkWrite(ids.map((id, index) => ({ updateOne: { filter: { _id: id, archivedAt: { $exists: false } }, update: { $set: { sortOrder: index } } } })));
    await GallerySetting.findOneAndUpdate({ key: 'gallery' }, { $set: { order: 'manual' } }, { upsert: true, setDefaultsOnInsert: true });
    res.json({ message: 'Gallery order saved', count: ids.length, order: 'manual' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong saving the gallery order.' });
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
