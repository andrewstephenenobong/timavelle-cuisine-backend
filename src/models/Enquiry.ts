import mongoose, { Schema, Document } from 'mongoose';

export interface IEnquiry extends Document {
  name: string;
  email: string;
  phone?: string;
  eventDate?: string;
  partySize?: number;
  message: string;
  status: 'new' | 'contacted' | 'quoted' | 'won' | 'closed';
  internalNotes: string;
  lastContactedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const EnquirySchema = new Schema<IEnquiry>({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  phone: { type: String, trim: true },
  eventDate: { type: String },
  partySize: { type: Number, min: 1, max: 500 },
  message: { type: String, required: true, trim: true },
  status: { type: String, enum: ['new', 'contacted', 'quoted', 'won', 'closed'], default: 'new', index: true },
  internalNotes: { type: String, trim: true, default: '' },
  lastContactedAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
}, { timestamps: true });

export default mongoose.model<IEnquiry>('Enquiry', EnquirySchema);
