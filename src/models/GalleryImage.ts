import mongoose, { Schema, Document } from 'mongoose';

export interface IGalleryImage extends Document {
  imageUrl: string;
  caption?: string;
  category: string;
  createdAt: Date;
}

const GalleryImageSchema = new Schema<IGalleryImage>({
  imageUrl: { type: String, required: true, trim: true },
  caption: { type: String, trim: true },
  category: { type: String, required: true, trim: true },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model<IGalleryImage>('GalleryImage', GalleryImageSchema);
