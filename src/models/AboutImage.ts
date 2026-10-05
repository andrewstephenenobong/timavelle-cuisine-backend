import mongoose, { Document, Schema } from 'mongoose';

export interface IAboutImage extends Document {
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

const AboutImageSchema = new Schema<IAboutImage>({
  key: { type: String, required: true, unique: true, trim: true, default: 'about-house' },
  imageUrl: { type: String, required: true, trim: true, default: '/images/About/image.png' },
  altText: { type: String, required: true, trim: true, default: 'Timavelle Cuisine — plated dish' },
  published: {
    imageUrl: { type: String, trim: true },
    altText: { type: String, trim: true },
    publishedAt: { type: Date },
  },
}, { timestamps: true });

export default mongoose.model<IAboutImage>('AboutImage', AboutImageSchema);