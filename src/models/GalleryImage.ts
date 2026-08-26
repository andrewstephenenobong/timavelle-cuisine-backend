import mongoose, { Schema, Document } from 'mongoose';
import { IMediaQuality, MediaQualitySchema } from './mediaMetadata';

export interface IGalleryImage extends Document {
  imageUrl: string;
  caption?: string;
  category: string;
  mediaTags: string[];
  mediaFavorite: boolean;
  mediaLastUsedAt?: Date;
  mediaUseCount: number;
  mediaQuality?: IMediaQuality;
  mediaFingerprint?: string;
  archivedAt?: Date;
  archivedBy?: string;
  createdAt: Date;
}

const GalleryImageSchema = new Schema<IGalleryImage>({
  imageUrl: { type: String, required: true, trim: true },
  caption: { type: String, trim: true },
  category: { type: String, required: true, trim: true },
  mediaTags: { type: [String], default: [] },
  mediaFavorite: { type: Boolean, default: false },
  mediaLastUsedAt: { type: Date },
  mediaUseCount: { type: Number, default: 0, min: 0 },
  mediaQuality: { type: MediaQualitySchema },
  mediaFingerprint: { type: String, trim: true },
  archivedAt: { type: Date, index: true },
  archivedBy: { type: String, trim: true },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model<IGalleryImage>('GalleryImage', GalleryImageSchema);
