import { Request, Response, Router } from 'express';
import mongoose from 'mongoose';
import HeroImage, { IHeroImage } from '../models/HeroImage';
import { protect } from '../middleware/auth';

const router = Router();
const HERO_KEY = 'homepage-hero';
const DEFAULT_IMAGE_URL = '/images/About/image.png';
const DEFAULT_ALT_TEXT = 'A plated Timavelle Cuisine dish';

function isSafeImageUrl(value: string) {
  return value.startsWith('/') || /^https:\/\//i.test(value);
}

function publicHero(item: IHeroImage) {
  return {
    _id: item._id,
    imageUrl: item.published?.imageUrl,
    altText: item.published?.altText,
    publishedAt: item.published?.publishedAt,
  };
}

async function getOrCreateDraft() {
  return HeroImage.findOneAndUpdate(
    { key: HERO_KEY },
    { $setOnInsert: { key: HERO_KEY, imageUrl: DEFAULT_IMAGE_URL, altText: DEFAULT_ALT_TEXT, published: null } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
}

router.get('/', async (_req: Request, res: Response) => {
  try {
    const item = await HeroImage.findOne({ key: HERO_KEY });
    res.set('Cache-Control', 'no-store');
    res.json({ item: item ? publicHero(item) : null });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong fetching the hero image.' });
  }
});

router.get('/admin', protect, async (_req: Request, res: Response) => {
  try {
    const item = await getOrCreateDraft();
    res.json({ item });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong fetching the hero image draft.' });
  }
});

router.put('/', protect, async (req: Request, res: Response) => {
  try {
    const imageUrl = typeof req.body.imageUrl === 'string' ? req.body.imageUrl.trim() : '';
    const altText = typeof req.body.altText === 'string' ? req.body.altText.trim() : '';
    if (!imageUrl || !isSafeImageUrl(imageUrl)) return res.status(400).json({ error: 'Provide a valid image URL.' });
    if (!altText || altText.length > 160) return res.status(400).json({ error: 'Alt text is required and must be 160 characters or fewer.' });
    const item = await HeroImage.findOneAndUpdate(
      { key: HERO_KEY },
      { $set: { imageUrl, altText }, $setOnInsert: { key: HERO_KEY } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    res.json({ message: 'Hero image draft updated', item });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong updating the hero image draft.' });
  }
});

router.post('/publish', protect, async (_req: Request, res: Response) => {
  const session = await mongoose.startSession();
  try {
    let item: IHeroImage | null = null;
    await session.withTransaction(async () => {
      item = await HeroImage.findOne({ key: HERO_KEY }).session(session);
      if (!item) throw new Error('Save a hero image draft before publishing.');
      if (!isSafeImageUrl(item.imageUrl) || !item.altText.trim()) throw new Error('The hero image draft is incomplete.');
      item.published = { imageUrl: item.imageUrl, altText: item.altText, publishedAt: new Date() };
      await item.save({ session });
    });
    res.json({ message: 'Hero image published', item });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Something went wrong publishing the hero image.' });
  } finally {
    await session.endSession();
  }
});

export default router;
