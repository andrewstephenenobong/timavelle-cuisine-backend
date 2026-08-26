import mongoose, { Schema, Document } from 'mongoose';
import { IMediaQuality, MediaQualitySchema } from './mediaMetadata';

export interface IMenuItem extends Document {
  name: string;
  description: string;
  category: string;
  image?: string;
  imageFocalX: number;
  imageFocalY: number;
  imageAspectRatio: 'landscape' | 'square' | 'portrait' | 'wide';
  mediaTags: string[];
  mediaFavorite: boolean;
  mediaLastUsedAt?: Date;
  mediaUseCount: number;
  mediaQuality?: IMediaQuality;
  mediaFingerprint?: string;
  featured: boolean;
  archivedAt?: Date;
  archivedBy?: string;
  createdAt: Date;
}

const MenuItemSchema = new Schema<IMenuItem>({
  name: { type: String, required: true, trim: true },
  description: { type: String, required: true, trim: true },
  category: { type: String, required: true, trim: true },
  image: { type: String, trim: true },
  imageFocalX: { type: Number, default: 50, min: 0, max: 100 },
  imageFocalY: { type: Number, default: 50, min: 0, max: 100 },
  imageAspectRatio: { type: String, enum: ['landscape', 'square', 'portrait', 'wide'], default: 'landscape' },
  mediaTags: { type: [String], default: [] },
  mediaFavorite: { type: Boolean, default: false },
  mediaLastUsedAt: { type: Date },
  mediaUseCount: { type: Number, default: 0, min: 0 },
  mediaQuality: { type: MediaQualitySchema },
  mediaFingerprint: { type: String, trim: true },
  featured: { type: Boolean, default: false },
  archivedAt: { type: Date, index: true },
  archivedBy: { type: String, trim: true },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model<IMenuItem>('MenuItem', MenuItemSchema);
