import mongoose, { Document, Schema } from 'mongoose';

export interface IHeroImage extends Document {
  key: string;
  imageUrl: string;
  altText: string;
  published: {
    imageUrl: string;
    altText: string;
    publishedAt: Date;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

const HeroImageSchema = new Schema<IHeroImage>({
  key: { type: String, required: true, unique: true, trim: true, default: 'homepage-hero' },
  imageUrl: { type: String, required: true, trim: true, default: '/images/About/image.png' },
  altText: { type: String, required: true, trim: true, default: 'A plated Timavelle Cuisine dish' },
  published: {
    imageUrl: { type: String, trim: true },
    altText: { type: String, trim: true },
    publishedAt: { type: Date },
  },
}, { timestamps: true });

export default mongoose.model<IHeroImage>('HeroImage', HeroImageSchema);
