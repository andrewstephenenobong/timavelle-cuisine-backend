import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Admin from '../models/Admin';

dotenv.config();

async function seed() {
  const uri = process.env.MONGO_URI;
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!uri) throw new Error('MONGO_URI is not set in .env');
  if (!email || !password) {
    throw new Error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in .env before running this script');
  }

  await mongoose.connect(uri);

  const existing = await Admin.findOne({ email });
  if (existing) {
    console.log('An admin with this email already exists.');
    process.exit(0);
  }

  const admin = await Admin.create({ email, password });
  console.log('Admin created successfully:', admin.email);
  process.exit(0);
}

seed();
