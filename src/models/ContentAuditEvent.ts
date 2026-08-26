import mongoose, { Document, Schema } from 'mongoose';

export const auditedContentResources = ['menu', 'gallery', 'testimonial', 'service', 'faq', 'contact', 'enquiry'] as const;
export type AuditedContentResource = typeof auditedContentResources[number];
export const archiveAuditActions = ['archive', 'restore'] as const;
export type ArchiveAuditAction = typeof archiveAuditActions[number];

export interface IContentAuditEvent extends Document {
  action: ArchiveAuditAction;
  resourceType: AuditedContentResource;
  resourceId: mongoose.Types.ObjectId;
  resourceLabel: string;
  details?: Record<string, unknown>;
  actorId: mongoose.Types.ObjectId;
  actorEmail: string;
  createdAt: Date;
  updatedAt: Date;
}

const ContentAuditEventSchema = new Schema<IContentAuditEvent>({
  action: { type: String, enum: archiveAuditActions, required: true, immutable: true },
  resourceType: { type: String, enum: auditedContentResources, required: true, immutable: true },
  resourceId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  resourceLabel: { type: String, required: true, trim: true, maxlength: 180, immutable: true },
  details: { type: Schema.Types.Mixed, immutable: true },
  actorId: { type: Schema.Types.ObjectId, ref: 'Admin', required: true, immutable: true },
  actorEmail: { type: String, required: true, trim: true, lowercase: true, maxlength: 320, immutable: true },
}, { timestamps: true });

ContentAuditEventSchema.index({ createdAt: -1 });
ContentAuditEventSchema.index({ resourceType: 1, action: 1, createdAt: -1 });
ContentAuditEventSchema.index({ resourceId: 1, createdAt: -1 });

export default mongoose.model<IContentAuditEvent>('ContentAuditEvent', ContentAuditEventSchema);
