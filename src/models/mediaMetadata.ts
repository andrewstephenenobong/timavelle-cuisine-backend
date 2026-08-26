import { Schema } from 'mongoose';

export type MediaQualityStatus = 'ready' | 'unavailable';
export type MediaQualityFlag = 'small' | 'unusual_aspect' | 'low_detail' | 'blurry' | 'unavailable' | 'unsupported_source';

export interface IMediaQuality {
  status: MediaQualityStatus;
  width?: number;
  height?: number;
  bytes?: number;
  flags: MediaQualityFlag[];
  checkedAt: Date;
}

export const MediaQualitySchema = new Schema<IMediaQuality>({
  status: { type: String, enum: ['ready', 'unavailable'], required: true },
  width: { type: Number, min: 1 },
  height: { type: Number, min: 1 },
  bytes: { type: Number, min: 0 },
  flags: { type: [String], enum: ['small', 'unusual_aspect', 'low_detail', 'blurry', 'unavailable', 'unsupported_source'], default: [] },
  checkedAt: { type: Date, required: true },
}, { _id: false });
