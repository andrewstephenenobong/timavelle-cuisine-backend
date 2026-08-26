import mongoose, { Document, Schema } from 'mongoose';

export interface IContactDetail extends Document {
  key: string;
  label: string;
  value: string;
  published: {
    label: string;
    value: string;
    publishedAt: Date;
    isArchived?: boolean;
  } | null;
  archivedAt?: Date;
  archivedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ContactDetailSchema = new Schema<IContactDetail>({
  key: { type: String, required: true, trim: true, unique: true },
  label: { type: String, required: true, trim: true },
  value: { type: String, required: true, trim: true },
  published: {
    label: { type: String, trim: true },
    value: { type: String, trim: true },
    publishedAt: { type: Date },
    isArchived: { type: Boolean, default: false },
  },
  archivedAt: { type: Date, index: true },
  archivedBy: { type: String, trim: true },
}, { timestamps: true });

export default mongoose.model<IContactDetail>('ContactDetail', ContactDetailSchema);
