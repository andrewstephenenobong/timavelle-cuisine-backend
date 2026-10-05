import { Request, Response, Router } from 'express';
import mongoose from 'mongoose';
import AboutImage, { IAboutImage } from '../models/AboutImage';
import { protect } from '../middleware/auth';

const router = Router();
const ABOUT_KEY = 'about-house';
const DEFAULT_IMAGE_URL = '/images/About/image.png';
const DEFAULT_ALT_TEXT = 'Timavelle Cuisine — plated dish';

function isSafeImageUrl(value: string) {
  return value.startsWith('/') || /^https:\/\//i.test(value);
}

function publicAboutImage(item: IAboutImage) {
  return {
    _id: item._id,
    imageUrl: item.published?.imageUrl,
    altText: item.published?.altText,
    publishedAt: item.published?.publishedAt,
  };
}

async function getOrCreateDraft() {
  return AboutImage.findOneAndUpdate(
    { key: ABOUT_KEY },
    { $setOnInsert: { key: ABOUT_KEY, imageUrl: DEFAULT_IMAGE_URL, altText: DEFAULT_ALT_TEXT, published: null } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
}

router.get('/', async (_req: Request, res: Response) => {
  try {
    const item = await AboutImage.findOne({ key: ABOUT_KEY });
    res.set('Cache-Control', 'no-store');
    res.json({ item: item ? publicAboutImage(item) : null });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong fetching the about image.' });
  }
});

router.get('/admin', protect, async (_req: Request, res: Response) => {
  try {
    const item = await getOrCreateDraft();
    res.json({ item });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong fetching the about image draft.' });
  }
});

router.put('/', protect, async (req: Request, res: Response) => {
  try {
    const imageUrl = typeof req.body.imageUrl === 'string' ? req.body.imageUrl.trim() : '';
    const altText = typeof req.body.altText === 'string' ? req.body.altText.trim() : '';
    if (!imageUrl || !isSafeImageUrl(imageUrl)) return res.status(400).json({ error: 'Provide a valid image URL.' });
    if (!altText || altText.length > 160) return res.status(400).json({ error: 'Alt text is required and must be 160 characters or fewer.' });
    const item = await AboutImage.findOneAndUpdate(
      { key: ABOUT_KEY },
      { $set: { imageUrl, altText }, $setOnInsert: { key: ABOUT_KEY } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    res.json({ message: 'About image draft updated', item });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong updating the about image draft.' });
  }
});

router.delete('/', protect, async (_req: Request, res: Response) => {
  try {
    const item = await AboutImage.findOneAndDelete({ key: ABOUT_KEY });
    if (!item) return res.status(404).json({ error: 'No custom about image draft is available to reset.' });
    res.json({ message: 'About image reset to the website default' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong resetting the about image.' });
  }
});

router.post('/publish', protect, async (_req: Request, res: Response) => {
  const session = await mongoose.startSession();
  try {
    let item: IAboutImage | null = null;
    await session.withTransaction(async () => {
      item = await AboutImage.findOne({ key: ABOUT_KEY }).session(session);
      if (!item) throw new Error('Save an about image draft before publishing.');
      if (!isSafeImageUrl(item.imageUrl) || !item.altText.trim()) throw new Error('The about image draft is incomplete.');
      item.published = { imageUrl: item.imageUrl, altText: item.altText, publishedAt: new Date() };
      await item.save({ session });
    });
    res.json({ message: 'About image published', item });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Something went wrong publishing the about image.' });
  } finally {
    await session.endSession();
  }
});

export default router;