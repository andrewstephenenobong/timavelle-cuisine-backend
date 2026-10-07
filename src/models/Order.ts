import mongoose, { Document, Schema } from 'mongoose';

export const ORDER_STATUSES = ['awaiting_payment', 'new', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled'] as const;
export type OrderStatus = typeof ORDER_STATUSES[number];
export const ORDER_TYPES = ['delivery', 'pickup'] as const;
export type OrderType = typeof ORDER_TYPES[number];
export const ORDER_CHANNELS = ['website', 'whatsapp', 'admin'] as const;
export type OrderChannel = typeof ORDER_CHANNELS[number];
export const PAYMENT_METHODS = ['bank_transfer', 'whatsapp'] as const;
export type PaymentMethod = typeof PAYMENT_METHODS[number];
export const PAYMENT_STATUSES = ['unpaid', 'receipt_submitted', 'paid', 'rejected', 'refunded'] as const;
export type PaymentStatus = typeof PAYMENT_STATUSES[number];

export interface IOrderLineAddOn {
  name: string;
  price: number;
}

export interface IOrderLine {
  menuItemId?: mongoose.Types.ObjectId;
  name: string;
  unitPrice: number;
  quantity: number;
  addOns: IOrderLineAddOn[];
  lineTotal: number;
}

export interface IOrderPaymentInstructions {
  bankName: string;
  accountName: string;
  accountNumber: string;
}

export interface IOrder extends Document {
  customerName: string;
  customerPhone: string;
  customerPhoneNormalized: string;
  orderType: OrderType;
  deliveryAreaId?: mongoose.Types.ObjectId;
  deliveryAreaName?: string;
  deliveryFee: number;
  deliveryAddress?: string;
  items: IOrderLine[];
  subtotal: number;
  discountCode?: string;
  discountAmount: number;
  total: number;
  notes?: string;
  status: OrderStatus;
  channel: OrderChannel;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  paymentInstructions?: IOrderPaymentInstructions;
  receiptUrl?: string;
  receiptUploadedAt?: Date;
  paymentRejectionReason?: string;
  idempotencyKey?: string;
  checkoutTokenHash?: string;
  checkoutTokenExpiresAt?: Date;
  internalNotes: string;
  archivedAt?: Date;
  archivedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const OrderLineAddOnSchema = new Schema<IOrderLineAddOn>({
  name: { type: String, required: true, trim: true },
  price: { type: Number, required: true, min: 0 },
}, { _id: false });

const OrderLineSchema = new Schema<IOrderLine>({
  menuItemId: { type: Schema.Types.ObjectId, ref: 'MenuItem' },
  name: { type: String, required: true, trim: true },
  unitPrice: { type: Number, required: true, min: 0 },
  quantity: { type: Number, required: true, min: 1, max: 50 },
  addOns: { type: [OrderLineAddOnSchema], default: [] },
  lineTotal: { type: Number, required: true, min: 0 },
}, { _id: false });

const OrderPaymentInstructionsSchema = new Schema<IOrderPaymentInstructions>({
  bankName: { type: String, required: true, trim: true },
  accountName: { type: String, required: true, trim: true },
  accountNumber: { type: String, required: true, trim: true },
}, { _id: false });

const OrderSchema = new Schema<IOrder>({
  customerName: { type: String, required: true, trim: true, maxlength: 120 },
  customerPhone: { type: String, required: true, trim: true, maxlength: 32 },
  customerPhoneNormalized: { type: String, required: true, trim: true, maxlength: 32, index: true },
  orderType: { type: String, enum: ORDER_TYPES, required: true },
  deliveryAreaId: { type: Schema.Types.ObjectId, ref: 'DeliveryArea' },
  deliveryAreaName: { type: String, trim: true, maxlength: 120 },
  deliveryFee: { type: Number, required: true, min: 0, default: 0 },
  deliveryAddress: { type: String, trim: true, maxlength: 300 },
  items: { type: [OrderLineSchema], required: true, validate: { validator: (value: IOrderLine[]) => Array.isArray(value) && value.length > 0 && value.length <= 50, message: 'An order needs between 1 and 50 items.' } },
  subtotal: { type: Number, required: true, min: 0 },
  discountCode: { type: String, trim: true, uppercase: true, maxlength: 40 },
  discountAmount: { type: Number, required: true, min: 0, default: 0 },
  total: { type: Number, required: true, min: 0 },
  notes: { type: String, trim: true, maxlength: 500 },
  status: { type: String, enum: ORDER_STATUSES, default: 'new', index: true },
  channel: { type: String, enum: ORDER_CHANNELS, default: 'whatsapp' },
  paymentMethod: { type: String, enum: PAYMENT_METHODS, default: 'whatsapp' },
  paymentStatus: { type: String, enum: PAYMENT_STATUSES, default: 'unpaid' },
  paymentInstructions: { type: OrderPaymentInstructionsSchema },
  receiptUrl: { type: String, trim: true },
  receiptUploadedAt: { type: Date },
  paymentRejectionReason: { type: String, trim: true, maxlength: 500 },
  idempotencyKey: { type: String, trim: true, maxlength: 100, select: false },
  checkoutTokenHash: { type: String, select: false },
  checkoutTokenExpiresAt: { type: Date, select: false },
  internalNotes: { type: String, trim: true, default: '' },
  archivedAt: { type: Date, index: true },
  archivedBy: { type: String, trim: true },
}, { timestamps: true });

OrderSchema.index({ createdAt: -1 });
OrderSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

export default mongoose.model<IOrder>('Order', OrderSchema);
