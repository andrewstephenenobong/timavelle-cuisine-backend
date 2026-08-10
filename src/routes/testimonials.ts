import { Router, Request, Response } from 'express';
import Testimonial from '../models/Testimonial';
import { protect } from '../middleware/auth';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  try {
    const testimonials = await Testimonial.find().sort({ createdAt: -1 });
    res.json({ testimonials });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong fetching testimonials.' });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const testimonial = await Testimonial.findById(req.params.id);
    if (!testimonial) return res.status(404).json({ error: 'Testimonial not found.' });
    res.json({ testimonial });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong fetching this testimonial.' });
  }
});

router.post('/', protect, async (req: Request, res: Response) => {
  try {
    const { clientName, quote, eventType, featured } = req.body;

    if (!clientName || !quote) {
      return res.status(400).json({ error: 'Client name and quote are required.' });
    }

    const testimonial = await Testimonial.create({ clientName, quote, eventType, featured });
    res.status(201).json({ message: 'Testimonial added', testimonial });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong adding this testimonial.' });
  }
});

router.put('/:id', protect, async (req: Request, res: Response) => {
  try {
    const { clientName, quote, eventType, featured } = req.body;

    const testimonial = await Testimonial.findByIdAndUpdate(
      req.params.id,
      { clientName, quote, eventType, featured },
      { new: true, runValidators: true }
    );

    if (!testimonial) return res.status(404).json({ error: 'Testimonial not found.' });
    res.json({ message: 'Testimonial updated', testimonial });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong updating this testimonial.' });
  }
});

router.delete('/:id', protect, async (req: Request, res: Response) => {
  try {
    const testimonial = await Testimonial.findByIdAndDelete(req.params.id);
    if (!testimonial) return res.status(404).json({ error: 'Testimonial not found.' });
    res.json({ message: 'Testimonial deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong deleting this testimonial.' });
  }
});

export default router;
