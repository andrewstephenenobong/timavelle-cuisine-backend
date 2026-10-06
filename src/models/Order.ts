import mongoose, { Document, Schema } from 'mongoose';

export const ORDER_STATUSES = ['new', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled'] as const;
export type OrderStatus = typeof ORDER_STATUSES[number];
export const ORDER_TYPES = ['delivery', 'pickup'] as const;
export type OrderType = typeof ORDER_TYPES[number];
export const ORDER_CHANNELS = ['whatsapp', 'admin'] as const;
export type OrderChannel = typeof ORDER_CHANNELS[number];

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

export interface IOrder extends Document {
  customerName: string;
  customerPhone: string;
  orderType: OrderType;
  deliveryAddress?: string;
  items: IOrderLine[];
  subtotal: number;
  total: number;
  notes?: string;
  status: OrderStatus;
  channel: OrderChannel;
  paymentStatus: 'unpaid' | 'paid';
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

const OrderSchema = new Schema<IOrder>({
  customerName: { type: String, required: true, trim: true, maxlength: 120 },
  customerPhone: { type: String, required: true, trim: true, maxlength: 32 },
  orderType: { type: String, enum: ORDER_TYPES, required: true },
  deliveryAddress: { type: String, trim: true, maxlength: 300 },
  items: { type: [OrderLineSchema], required: true, validate: { validator: (value: IOrderLine[]) => Array.isArray(value) && value.length > 0 && value.length <= 50, message: 'An order needs between 1 and 50 items.' } },
  subtotal: { type: Number, required: true, min: 0 },
  total: { type: Number, required: true, min: 0 },
  notes: { type: String, trim: true, maxlength: 500 },
  status: { type: String, enum: ORDER_STATUSES, default: 'new', index: true },
  channel: { type: String, enum: ORDER_CHANNELS, default: 'whatsapp' },
  paymentStatus: { type: String, enum: ['unpaid', 'paid'], default: 'unpaid' },
  internalNotes: { type: String, trim: true, default: '' },
  archivedAt: { type: Date, index: true },
  archivedBy: { type: String, trim: true },
}, { timestamps: true });

OrderSchema.index({ createdAt: -1 });

export default mongoose.model<IOrder>('Order', OrderSchema);
