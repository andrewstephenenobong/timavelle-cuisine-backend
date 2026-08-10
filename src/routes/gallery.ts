import { Router, Request, Response } from 'express';
import GalleryImage from '../models/GalleryImage';
import { protect } from '../middleware/auth';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  try {
    const images = await GalleryImage.find().sort({ createdAt: -1 });
    res.json({ images });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong fetching the gallery.' });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const image = await GalleryImage.findById(req.params.id);
    if (!image) return res.status(404).json({ error: 'Image not found.' });
    res.json({ image });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong fetching this image.' });
  }
});

router.post('/', protect, async (req: Request, res: Response) => {
  try {
    const { imageUrl, caption, category } = req.body;

    if (!imageUrl || !category) {
      return res.status(400).json({ error: 'Image URL and category are required.' });
    }

    const image = await GalleryImage.create({ imageUrl, caption, category });
    res.status(201).json({ message: 'Image added', image });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong adding this image.' });
  }
});

router.put('/:id', protect, async (req: Request, res: Response) => {
  try {
    const { imageUrl, caption, category } = req.body;

    const image = await GalleryImage.findByIdAndUpdate(
      req.params.id,
      { imageUrl, caption, category },
      { new: true, runValidators: true }
    );

    if (!image) return res.status(404).json({ error: 'Image not found.' });
    res.json({ message: 'Image updated', image });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong updating this image.' });
  }
});

router.delete('/:id', protect, async (req: Request, res: Response) => {
  try {
    const image = await GalleryImage.findByIdAndDelete(req.params.id);
    if (!image) return res.status(404).json({ error: 'Image not found.' });
    res.json({ message: 'Image deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong deleting this image.' });
  }
});

export default router;
