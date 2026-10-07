import mongoose, { Document, Schema } from 'mongoose';

export interface IPaymentSettings extends Document {
  key: string;
  bankTransferEnabled: boolean;
  whatsappEnabled: boolean;
  bankName: string;
  accountName: string;
  accountNumber: string;
  updatedAt: Date;
}

const PaymentSettingsSchema = new Schema<IPaymentSettings>({
  key: { type: String, required: true, unique: true, default: 'main' },
  bankTransferEnabled: { type: Boolean, default: true },
  whatsappEnabled: { type: Boolean, default: true },
  bankName: { type: String, trim: true, required: true, default: 'Access Bank', maxlength: 100 },
  accountName: { type: String, trim: true, required: true, default: 'Fatima Binta Suleiman', maxlength: 120 },
  accountNumber: { type: String, trim: true, required: true, default: '1828143371', maxlength: 20 },
}, { timestamps: true });

export default mongoose.model<IPaymentSettings>('PaymentSettings', PaymentSettingsSchema);
