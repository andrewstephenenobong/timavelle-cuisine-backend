import { Router, Request, Response } from 'express';
import Testimonial from '../models/Testimonial';
import { AuthRequest, protect } from '../middleware/auth';
import { archiveScopeFilter, readContentScope, recordContentArchiveEvent, validContentId } from '../lib/contentArchive';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    const testimonials = await Testimonial.find({ archivedAt: { $exists: false } }).sort({ createdAt: -1 });
    res.json({ testimonials });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong fetching testimonials.' });
  }
});

router.get('/admin', protect, async (req: AuthRequest, res: Response) => {
  try {
    const scope = readContentScope(req, res);
    if (!scope) return;
    const testimonials = await Testimonial.find(archiveScopeFilter(scope)).sort({ createdAt: -1 });
    res.json({ testimonials, scope });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong fetching the testimonial catalog.' });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    if (!validContentId(req.params.id, 'testimonial', res)) return;
    const testimonial = await Testimonial.findOne({ _id: req.params.id, archivedAt: { $exists: false } });
    if (!testimonial) return res.status(404).json({ error: 'Testimonial not found.' });
    res.json({ testimonial });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong fetching this testimonial.' });
  }
});

router.post('/', protect, async (req: AuthRequest, res: Response) => {
  try {
    const { clientName, quote, eventType, featured } = req.body;
    if (!clientName || !quote) return res.status(400).json({ error: 'Client name and quote are required.' });
    const testimonial = await Testimonial.create({ clientName, quote, eventType, featured });
    res.status(201).json({ message: 'Testimonial added', testimonial });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong adding this testimonial.' });
  }
});

router.put('/:id', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!validContentId(req.params.id, 'testimonial', res)) return;
    const { clientName, quote, eventType, featured } = req.body;
    const testimonial = await Testimonial.findOneAndUpdate(
      { _id: req.params.id, archivedAt: { $exists: false } },
      { clientName, quote, eventType, featured },
      { new: true, runValidators: true }
    );
    if (!testimonial) return res.status(404).json({ error: 'Active testimonial not found.' });
    res.json({ message: 'Testimonial updated', testimonial });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong updating this testimonial.' });
  }
});

router.post('/:id/archive', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!validContentId(req.params.id, 'testimonial', res)) return;
    const testimonial = await Testimonial.findById(req.params.id);
    if (!testimonial) return res.status(404).json({ error: 'Testimonial not found.' });
    if (testimonial.archivedAt) return res.status(409).json({ error: 'Testimonial is already archived.' });
    testimonial.archivedAt = new Date();
    testimonial.archivedBy = req.adminId;
    await testimonial.save();
    await recordContentArchiveEvent({ action: 'archive', resourceType: 'testimonial', resourceId: testimonial._id, resourceLabel: testimonial.clientName, actorId: req.adminId });
    res.json({ message: 'Testimonial archived', testimonial });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong archiving this testimonial.' });
  }
});

router.post('/:id/restore', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!validContentId(req.params.id, 'testimonial', res)) return;
    const testimonial = await Testimonial.findById(req.params.id);
    if (!testimonial) return res.status(404).json({ error: 'Testimonial not found.' });
    if (!testimonial.archivedAt) return res.status(409).json({ error: 'Testimonial is already active.' });
    testimonial.archivedAt = undefined;
    testimonial.archivedBy = undefined;
    await testimonial.save();
    await recordContentArchiveEvent({ action: 'restore', resourceType: 'testimonial', resourceId: testimonial._id, resourceLabel: testimonial.clientName, actorId: req.adminId });
    res.json({ message: 'Testimonial restored', testimonial });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong restoring this testimonial.' });
  }
});

router.delete('/:id', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!validContentId(req.params.id, 'testimonial', res)) return;
    const testimonial = await Testimonial.findById(req.params.id);
    if (!testimonial) return res.status(404).json({ error: 'Testimonial not found.' });
    if (!testimonial.archivedAt) return res.status(409).json({ error: 'Archive this testimonial before permanently deleting it.' });
    await testimonial.deleteOne();
    res.json({ message: 'Testimonial permanently deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong permanently deleting this testimonial.' });
  }
});

export default router;
