import mongoose, { Schema, Document } from 'mongoose';

export interface IEnquiry extends Document {
  name: string;
  email: string;
  phone?: string;
  eventDate?: string;
  partySize?: number;
  message: string;
  createdAt: Date;
}

const EnquirySchema = new Schema<IEnquiry>({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  phone: { type: String, trim: true },
  eventDate: { type: String },
  partySize: { type: Number, min: 1, max: 500 },
  message: { type: String, required: true, trim: true },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model<IEnquiry>('Enquiry', EnquirySchema);
