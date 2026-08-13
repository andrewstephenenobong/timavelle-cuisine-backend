import { Router, Response } from 'express';
import multer from 'multer';
import cloudinary from '../config/cloudinary';
import { protect, AuthRequest } from '../middleware/auth';
import { uploadLimiter } from '../middleware/rateLimiter';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 10, fieldSize: 64 * 1024 },
  fileFilter: (_req, file, callback) => {
    callback(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype));
  },
});

function uploadToCloudinary(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder: 'timavelle-cuisine' }, (error, result) => {
      if (error || !result) return reject(error);
      resolve(result.secure_url);
    });
    stream.end(buffer);
  });
}

router.post('/', protect, uploadLimiter, upload.single('image'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image file provided.' });
    const url = await uploadToCloudinary(req.file.buffer);
    res.json({ url });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong uploading the image.' });
  }
});

export default router;
