import mongoose, { Document, Schema } from 'mongoose';

export interface IFaqItem extends Document {
  question: string;
  answer: string;
  order: number;
  published: {
    question: string;
    answer: string;
    order: number;
    publishedAt: Date;
    isArchived?: boolean;
  } | null;
  archivedAt?: Date;
  archivedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const FaqItemSchema = new Schema<IFaqItem>({
  question: { type: String, required: true, trim: true },
  answer: { type: String, required: true, trim: true },
  order: { type: Number, default: 0, min: 0 },
  published: {
    question: { type: String, trim: true },
    answer: { type: String, trim: true },
    order: { type: Number, min: 0 },
    publishedAt: { type: Date },
    isArchived: { type: Boolean, default: false },
  },
  archivedAt: { type: Date, index: true },
  archivedBy: { type: String, trim: true },
}, { timestamps: true });

export default mongoose.model<IFaqItem>('FaqItem', FaqItemSchema);
