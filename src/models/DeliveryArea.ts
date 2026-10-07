import mongoose, { Document, Schema } from 'mongoose';

export interface IDeliveryArea extends Document {
  name: string;
  fee: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const DeliveryAreaSchema = new Schema<IDeliveryArea>({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  fee: { type: Number, required: true, min: 0 },
  active: { type: Boolean, default: true, index: true },
}, { timestamps: true });

DeliveryAreaSchema.index({ name: 1 }, { unique: true });

export default mongoose.model<IDeliveryArea>('DeliveryArea', DeliveryAreaSchema);
