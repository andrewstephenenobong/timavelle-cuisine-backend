import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { connectDB } from './config/db';
import enquiryRoutes from './routes/enquiries';
import authRoutes from './routes/auth';
import menuRoutes from './routes/menu';
import galleryRoutes from './routes/gallery';
import testimonialRoutes from './routes/testimonials';
import uploadRoutes from './routes/upload';
import serviceRoutes from './routes/services';
import faqRoutes from './routes/faqs';
import contactRoutes from './routes/contact';
import mongoose from 'mongoose';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
app.disable('x-powered-by');

app.use(helmet());
const defaultOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'https://Timavelle-cuisine.vercel.app',
  'https://timavelle-cuisine.vercel.app',
  'https://timavelle-cuisine-admin.vercel.app',
];
const allowedOrigins = (process.env.CORS_ORIGINS || defaultOrigins.join(','))
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed by CORS.'));
  },
  credentials: true,
}));
app.use(morgan('dev'));
app.use(express.json({ limit: '100kb' }));
app.use('/api/enquiries', enquiryRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/gallery', galleryRoutes);
app.use('/api/testimonials', testimonialRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/faqs', faqRoutes);
app.use('/api/contact-details', contactRoutes);
app.set('trust proxy', 1);

app.get('/api/health', (_req, res) => {
  const databaseReady = mongoose.connection.readyState === 1;
  res.status(databaseReady ? 200 : 503).json({ status: databaseReady ? 'ok' : 'degraded', database: databaseReady ? 'ready' : 'unavailable', message: 'Timavelle Cuisine API is running' });
});



export { app };

async function startServer() {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

if (require.main === module) startServer();
