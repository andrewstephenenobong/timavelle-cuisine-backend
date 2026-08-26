import { Router, Request, Response } from 'express';
import GalleryImage from '../models/GalleryImage';
import { AuthRequest, protect } from '../middleware/auth';
import { archiveScopeFilter, readContentScope, recordContentArchiveEvent, validContentId } from '../lib/contentArchive';

const router = Router();

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
    const images = await GalleryImage.find(archiveScopeFilter(scope)).sort({ createdAt: -1 });
    res.json({ images, scope });
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
    await recordContentArchiveEvent({ action: 'archive', resourceType: 'gallery', resourceId: image._id, resourceLabel: image.caption?.trim() || image.category, details: { caption: image.caption || null, category: image.category, imageUrl: image.imageUrl }, actorId: req.adminId });
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
    await recordContentArchiveEvent({ action: 'restore', resourceType: 'gallery', resourceId: image._id, resourceLabel: image.caption?.trim() || image.category, details: { caption: image.caption || null, category: image.category, imageUrl: image.imageUrl }, actorId: req.adminId });
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
