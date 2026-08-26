import mongoose, { Schema, Document } from 'mongoose';

export interface ITestimonial extends Document {
  clientName: string;
  quote: string;
  eventType?: string;
  featured: boolean;
  archivedAt?: Date;
  archivedBy?: string;
  createdAt: Date;
}

const TestimonialSchema = new Schema<ITestimonial>({
  clientName: { type: String, required: true, trim: true },
  quote: { type: String, required: true, trim: true },
  eventType: { type: String, trim: true },
  featured: { type: Boolean, default: false },
  archivedAt: { type: Date, index: true },
  archivedBy: { type: String, trim: true },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model<ITestimonial>('Testimonial', TestimonialSchema);
