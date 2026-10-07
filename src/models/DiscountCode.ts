import mongoose, { Document, Schema } from 'mongoose';

export const DISCOUNT_TYPES = ['percent', 'fixed'] as const;
export type DiscountType = typeof DISCOUNT_TYPES[number];

export interface IDiscountCode extends Document {
  code: string;
  type: DiscountType;
  value: number;
  expiresAt?: Date;
  usageLimit?: number;
  usedCount: number;
  minimumOrderValue: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const DiscountCodeSchema = new Schema<IDiscountCode>({
  code: { type: String, required: true, trim: true, uppercase: true, maxlength: 40 },
  type: { type: String, enum: DISCOUNT_TYPES, required: true },
  value: { type: Number, required: true, min: 0 },
  expiresAt: { type: Date },
  usageLimit: { type: Number, min: 1 },
  usedCount: { type: Number, default: 0, min: 0 },
  minimumOrderValue: { type: Number, default: 0, min: 0 },
  active: { type: Boolean, default: true, index: true },
}, { timestamps: true });

DiscountCodeSchema.index({ code: 1 }, { unique: true });

export default mongoose.model<IDiscountCode>('DiscountCode', DiscountCodeSchema);
