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

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(helmet());
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'https://Timavelle-cuisine.vercel.app',
  'https://timavelle-cuisine.vercel.app',
  'https://timavelle-cuisine-admin.vercel.app',
];

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));
app.use(morgan('dev'));
app.use(express.json());
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

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Timavelle Cuisine API is running' });
});



async function startServer() {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
