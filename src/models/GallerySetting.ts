import mongoose, { Document, Schema } from 'mongoose';

export const GALLERY_ORDERS = ['newest', 'oldest', 'manual'] as const;
export type GalleryOrder = typeof GALLERY_ORDERS[number];

export interface IGallerySetting extends Document {
  key: string;
  order: GalleryOrder;
}

const GallerySettingSchema = new Schema<IGallerySetting>({
  key: { type: String, required: true, unique: true, default: 'gallery' },
  order: { type: String, enum: GALLERY_ORDERS, default: 'newest' },
}, { timestamps: true });

export default mongoose.model<IGallerySetting>('GallerySetting', GallerySettingSchema);

