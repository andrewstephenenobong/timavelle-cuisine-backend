import { Router, Request, Response } from 'express';
import MenuItem from '../models/MenuItem';
import { protect } from '../middleware/auth';

const router = Router();

// READ — public, anyone can view the menu
router.get('/', async (req: Request, res: Response) => {
  try {
    const items = await MenuItem.find().sort({ createdAt: -1 });
    res.json({ items });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong fetching the menu.' });
  }
});

// READ single item — public
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const item = await MenuItem.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Menu item not found.' });
    res.json({ item });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong fetching this item.' });
  }
});

// CREATE — protected, admin only
router.post('/', protect, async (req: Request, res: Response) => {
  try {
    const { name, description, category, image, featured } = req.body;

    if (!name || !description || !category) {
      return res.status(400).json({ error: 'Name, description, and category are required.' });
    }

    const item = await MenuItem.create({ name, description, category, image, featured });
    res.status(201).json({ message: 'Menu item created', item });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong creating this item.' });
  }
});

// UPDATE — protected, admin only
router.put('/:id', protect, async (req: Request, res: Response) => {
  try {
    const { name, description, category, image, featured } = req.body;

    const item = await MenuItem.findByIdAndUpdate(
      req.params.id,
      { name, description, category, image, featured },
      { new: true, runValidators: true }
    );

    if (!item) return res.status(404).json({ error: 'Menu item not found.' });
    res.json({ message: 'Menu item updated', item });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong updating this item.' });
  }
});

// DELETE — protected, admin only
router.delete('/:id', protect, async (req: Request, res: Response) => {
  try {
    const item = await MenuItem.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ error: 'Menu item not found.' });
    res.json({ message: 'Menu item deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong deleting this item.' });
  }
});

export default router;
