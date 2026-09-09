import { Router, Response } from 'express';
import multer from 'multer';
import cloudinary from '../config/cloudinary';
import { protect, AuthRequest } from '../middleware/auth';
import { uploadLimiter } from '../middleware/rateLimiter';

const router = Router();
const allowedImageTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/heic',
  'image/heif',
]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 10, fieldSize: 64 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (allowedImageTypes.has(file.mimetype.toLowerCase())) return callback(null, true);
    callback(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'image'));
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

router.post('/', protect, uploadLimiter, (req: AuthRequest, res: Response, next) => {
  upload.single('image')(req, res, async (uploadError) => {
    if (uploadError instanceof multer.MulterError) {
      if (uploadError.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Image is too large. Choose an image up to 8 MB.' });
      if (uploadError.code === 'LIMIT_UNEXPECTED_FILE') return res.status(415).json({ error: 'Unsupported image format. Use JPG, PNG, WebP, AVIF, HEIC, or HEIF.' });
      return res.status(400).json({ error: 'The image upload could not be processed.' });
    }
    if (uploadError) return next(uploadError);
    try {
      if (!req.file) return res.status(400).json({ error: 'No image file provided.' });
      const url = await uploadToCloudinary(req.file.buffer);
      res.json({ url });
    } catch (error) {
      console.error(error);
      res.status(502).json({ error: 'The image service could not save this file. Please try again.' });
    }
  });
});

export default router;
