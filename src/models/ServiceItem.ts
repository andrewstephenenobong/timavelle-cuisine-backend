import mongoose, { Document, Schema } from 'mongoose';

export interface IServiceItem extends Document {
  title: string;
  description: string;
  order: number;
  published: {
    title: string;
    description: string;
    order: number;
    publishedAt: Date;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

const ServiceItemSchema = new Schema<IServiceItem>({
  title: { type: String, required: true, trim: true },
  description: { type: String, required: true, trim: true },
  order: { type: Number, default: 0, min: 0 },
  published: {
    title: { type: String, trim: true },
    description: { type: String, trim: true },
    order: { type: Number, min: 0 },
    publishedAt: { type: Date },
  },
}, { timestamps: true });

export default mongoose.model<IServiceItem>('ServiceItem', ServiceItemSchema);
