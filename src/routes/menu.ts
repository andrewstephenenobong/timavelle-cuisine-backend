import { Router, Request, Response } from 'express';
import MenuItem from '../models/MenuItem';
import GalleryImage from '../models/GalleryImage';
import { hammingDistance, inspectCloudinaryImage, isMediaSource, MediaSource, normalizeMediaTags } from '../lib/mediaLibrary';
import { AuthRequest, protect } from '../middleware/auth';
import { archiveScopeFilter, readContentScope, recordContentArchiveEvent, validContentId } from '../lib/contentArchive';

const router = Router();
const MENU_IMAGE_ASPECT_RATIOS = ['landscape', 'square', 'portrait', 'wide'] as const;
type MenuImageAspectRatio = typeof MENU_IMAGE_ASPECT_RATIOS[number];

function readImageFocalPoint(body: Record<string, unknown>) {
  const provided = Object.prototype.hasOwnProperty.call(body, 'imageFocalX') || Object.prototype.hasOwnProperty.call(body, 'imageFocalY');
  const imageFocalX = body.imageFocalX === undefined ? 50 : Number(body.imageFocalX);
  const imageFocalY = body.imageFocalY === undefined ? 50 : Number(body.imageFocalY);
  const valid = Number.isFinite(imageFocalX) && Number.isFinite(imageFocalY) && imageFocalX >= 0 && imageFocalX <= 100 && imageFocalY >= 0 && imageFocalY <= 100;
  return { provided, valid, imageFocalX, imageFocalY };
}

function readImageAspectRatio(body: Record<string, unknown>) {
  const provided = Object.prototype.hasOwnProperty.call(body, 'imageAspectRatio');
  const imageAspectRatio = body.imageAspectRatio === undefined ? 'landscape' : String(body.imageAspectRatio);
  return { provided, valid: (MENU_IMAGE_ASPECT_RATIOS as readonly string[]).includes(imageAspectRatio), imageAspectRatio: imageAspectRatio as MenuImageAspectRatio };
}

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

router.get('/media/library', protect, async (req: AuthRequest, res: Response) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100).toLowerCase() : '';
    const tag = typeof req.query.tag === 'string' ? req.query.tag.trim().slice(0, 32).toLowerCase() : '';
    const view = req.query.view === 'favorites' || req.query.view === 'recent' ? req.query.view : 'all';
    const quality = req.query.quality === 'attention' || req.query.quality === 'unchecked' ? req.query.quality : 'all';
    const duplicatesOnly = req.query.duplicates === 'only';
    const sort = req.query.sort === 'popular' || req.query.sort === 'newest' ? req.query.sort : 'recent';
    const [menuItems, galleryImages] = await Promise.all([
      MenuItem.find({ archivedAt: { $exists: false }, image: { $type: 'string', $ne: '' } }).select('_id name category image createdAt mediaTags mediaFavorite mediaLastUsedAt mediaUseCount mediaQuality mediaFingerprint').sort({ createdAt: -1 }).lean(),
      GalleryImage.find({ archivedAt: { $exists: false }, imageUrl: { $type: 'string', $ne: '' } }).select('_id caption category imageUrl createdAt mediaTags mediaFavorite mediaLastUsedAt mediaUseCount mediaQuality mediaFingerprint').sort({ createdAt: -1 }).lean(),
    ]);
    const allMedia = [...menuItems.map((item) => ({ id: String(item._id), imageUrl: item.image || '', label: item.name, category: item.category, source: 'menu' as const, createdAt: item.createdAt, tags: item.mediaTags || [], favorite: Boolean(item.mediaFavorite), lastUsedAt: item.mediaLastUsedAt, useCount: item.mediaUseCount || 0, quality: item.mediaQuality, fingerprint: item.mediaFingerprint })), ...galleryImages.map((image) => ({ id: String(image._id), imageUrl: image.imageUrl || '', label: image.caption || image.category, category: image.category, source: 'gallery' as const, createdAt: image.createdAt, tags: image.mediaTags || [], favorite: Boolean(image.mediaFavorite), lastUsedAt: image.mediaLastUsedAt, useCount: image.mediaUseCount || 0, quality: image.mediaQuality, fingerprint: image.mediaFingerprint }))].filter((item) => Boolean(item.imageUrl));
    const byUrl = new Map<string, typeof allMedia>();
    for (const item of allMedia) byUrl.set(item.imageUrl, [...(byUrl.get(item.imageUrl) || []), item]);
    const facets = [...new Set(allMedia.flatMap((item) => item.tags))].sort().map((value) => ({ value, count: allMedia.filter((item) => item.tags.includes(value)).length }));
    const media = allMedia.map((item) => {
      const exact = (byUrl.get(item.imageUrl) || []).find((candidate) => candidate.id !== item.id || candidate.source !== item.source);
      const similar = !exact && item.fingerprint ? allMedia.find((candidate) => candidate.fingerprint && candidate.id !== item.id && hammingDistance(item.fingerprint!, candidate.fingerprint) <= 8) : undefined;
      const duplicate = exact || similar;
      const usage = byUrl.get(item.imageUrl) || [];
      return { ...item, fingerprint: undefined, duplicate: duplicate ? { type: exact ? 'exact' : 'similar', label: duplicate.label, source: duplicate.source } : undefined, usage: { count: usage.length, labels: usage.slice(0, 3).map((entry) => entry.label) } };
    }).filter((item) => !search || `${item.label} ${item.category} ${item.tags.join(' ')}`.toLowerCase().includes(search)).filter((item) => !tag || item.tags.includes(tag)).filter((item) => view !== 'favorites' || item.favorite).filter((item) => view !== 'recent' || Boolean(item.lastUsedAt)).filter((item) => quality !== 'attention' || Boolean(item.quality?.flags.length)).filter((item) => quality !== 'unchecked' || !item.quality).filter((item) => !duplicatesOnly || Boolean(item.duplicate)).sort((left, right) => sort === 'popular' ? right.usage.count - left.usage.count || right.useCount - left.useCount : sort === 'newest' ? Number(new Date(right.createdAt)) - Number(new Date(left.createdAt)) : Number(new Date(right.lastUsedAt || 0)) - Number(new Date(left.lastUsedAt || 0)) || Number(new Date(right.createdAt)) - Number(new Date(left.createdAt))).slice(0, 120);
    res.json({ media, facets });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong loading the media library.' });
  }
});

router.patch('/media/:source/:id', protect, async (req: AuthRequest, res: Response) => {
  try {
    const source = Array.isArray(req.params.source) ? req.params.source[0] : req.params.source;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!isMediaSource(source) || !validContentId(id, 'media item', res)) return;
    const tags = req.body.tags === undefined ? undefined : normalizeMediaTags(req.body.tags);
    if (req.body.tags !== undefined && !tags) return res.status(400).json({ error: 'Use up to 12 concise media tags with letters, numbers, spaces, &, /, +, or -.' });
    if (req.body.favorite !== undefined && typeof req.body.favorite !== 'boolean') return res.status(400).json({ error: 'Favorite must be true or false.' });
    if (tags === undefined && req.body.favorite === undefined) return res.status(400).json({ error: 'Provide tags or a favorite state.' });
    const updates: Record<string, unknown> = {};
    if (tags !== undefined) updates.mediaTags = tags;
    if (req.body.favorite !== undefined) updates.mediaFavorite = req.body.favorite;
    const item = source === 'menu' ? await MenuItem.findOneAndUpdate({ _id: id, archivedAt: { $exists: false } }, updates, { new: true, runValidators: true }) : await GalleryImage.findOneAndUpdate({ _id: id, archivedAt: { $exists: false } }, updates, { new: true, runValidators: true });
    if (!item) return res.status(404).json({ error: 'Active media item not found.' });
    res.json({ message: 'Media metadata updated.', item });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong updating media metadata.' });
  }
});

router.post('/media/:source/:id/use', protect, async (req: AuthRequest, res: Response) => {
  try {
    const source = Array.isArray(req.params.source) ? req.params.source[0] : req.params.source;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!isMediaSource(source) || !validContentId(id, 'media item', res)) return;
    const item = source === 'menu' ? await MenuItem.findOneAndUpdate({ _id: id, archivedAt: { $exists: false } }, { mediaLastUsedAt: new Date(), $inc: { mediaUseCount: 1 } }, { new: true }) : await GalleryImage.findOneAndUpdate({ _id: id, archivedAt: { $exists: false } }, { mediaLastUsedAt: new Date(), $inc: { mediaUseCount: 1 } }, { new: true });
    if (!item) return res.status(404).json({ error: 'Active media item not found.' });
    res.json({ message: 'Media usage recorded.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong recording media usage.' });
  }
});

router.post('/media/library/analyze', protect, async (req: AuthRequest, res: Response) => {
  try {
    const candidates = Array.isArray(req.body.items) ? req.body.items : [];
    if (!candidates.length || candidates.length > 30) return res.status(400).json({ error: 'Select between 1 and 30 media items to analyse.' });
    const unique = new Map<string, { source: MediaSource; id: string }>();
    for (const candidate of candidates) if (candidate && isMediaSource(candidate.source) && typeof candidate.id === 'string' && /^[a-f\d]{24}$/i.test(candidate.id)) unique.set(`${candidate.source}:${candidate.id}`, { source: candidate.source, id: candidate.id });
    if (!unique.size) return res.status(400).json({ error: 'No valid media items were provided.' });
    let analyzed = 0; let unavailable = 0;
    for (const candidate of unique.values()) {
      const item = candidate.source === 'menu' ? await MenuItem.findOne({ _id: candidate.id, archivedAt: { $exists: false } }) : await GalleryImage.findOne({ _id: candidate.id, archivedAt: { $exists: false } });
      if (!item) continue;
      const imageUrl = candidate.source === 'menu' ? (item as typeof item & { image?: string }).image : (item as typeof item & { imageUrl?: string }).imageUrl;
      try {
        if (!imageUrl) throw new Error('No image URL is available.');
        const result = await inspectCloudinaryImage(imageUrl);
        item.set({ mediaQuality: result.quality, mediaFingerprint: result.fingerprint });
        analyzed += 1;
      } catch {
        item.set({ mediaQuality: { status: 'unavailable', flags: imageUrl?.startsWith('https://res.cloudinary.com') ? ['unavailable'] : ['unsupported_source'], checkedAt: new Date() }, mediaFingerprint: undefined });
        unavailable += 1;
      }
      await item.save();
    }
    res.json({ message: `Quality check completed for ${analyzed + unavailable} media items.`, analyzed, unavailable });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong analysing media quality.' });
  }
});

router.post('/', protect, async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, category, image, featured } = req.body;
    const focal = readImageFocalPoint(req.body); const aspect = readImageAspectRatio(req.body);
    if (!name || !description || !category) return res.status(400).json({ error: 'Name, description, and category are required.' });
    if (!focal.valid) return res.status(400).json({ error: 'Image focal point must be between 0 and 100.' });
    if (!aspect.valid) return res.status(400).json({ error: 'A valid Menu image aspect ratio is required.' });
    const item = await MenuItem.create({ name, description, category, image, featured, imageFocalX: focal.imageFocalX, imageFocalY: focal.imageFocalY, imageAspectRatio: aspect.imageAspectRatio });
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
    const focal = readImageFocalPoint(req.body); const aspect = readImageAspectRatio(req.body);
    if (!focal.valid) return res.status(400).json({ error: 'Image focal point must be between 0 and 100.' });
    if (!aspect.valid) return res.status(400).json({ error: 'A valid Menu image aspect ratio is required.' });
    const updates: Record<string, unknown> = { name, description, category, image, featured };
    if (focal.provided) {
      updates.imageFocalX = focal.imageFocalX;
      updates.imageFocalY = focal.imageFocalY;
    }
    if (aspect.provided) updates.imageAspectRatio = aspect.imageAspectRatio;
    const item = await MenuItem.findOneAndUpdate(
      { _id: req.params.id, archivedAt: { $exists: false } },
      updates,
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
    await recordContentArchiveEvent({ action: 'archive', resourceType: 'menu', resourceId: item._id, resourceLabel: item.name, details: { name: item.name, description: item.description, category: item.category, image: item.image || null, imageFocalX: item.imageFocalX, imageFocalY: item.imageFocalY, imageAspectRatio: item.imageAspectRatio, featured: item.featured }, actorId: req.adminId });
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
    await recordContentArchiveEvent({ action: 'restore', resourceType: 'menu', resourceId: item._id, resourceLabel: item.name, details: { name: item.name, description: item.description, category: item.category, image: item.image || null, imageFocalX: item.imageFocalX, imageFocalY: item.imageFocalY, imageAspectRatio: item.imageAspectRatio, featured: item.featured }, actorId: req.adminId });
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
