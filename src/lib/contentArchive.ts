import { Request, Response } from 'express';
import mongoose from 'mongoose';
import Admin from '../models/Admin';
import ContentAuditEvent, { ArchiveAuditAction, AuditedContentResource } from '../models/ContentAuditEvent';

export const CONTENT_SCOPES = ['active', 'archived', 'all'] as const;
export type ContentScope = typeof CONTENT_SCOPES[number];

export function readContentScope(req: Request, res: Response): ContentScope | null {
  const scope = typeof req.query.scope === 'string' ? req.query.scope : 'active';
  if (!CONTENT_SCOPES.includes(scope as ContentScope)) {
    res.status(400).json({ error: 'Invalid content scope.' });
    return null;
  }
  return scope as ContentScope;
}

export function archiveScopeFilter(scope: ContentScope): Record<string, unknown> {
  if (scope === 'active') return { archivedAt: { $exists: false } };
  if (scope === 'archived') return { archivedAt: { $exists: true } };
  return {};
}

export function validContentId(id: string | string[], label: string, res: Response) {
  if (typeof id === 'string' && mongoose.isValidObjectId(id)) return true;
  res.status(400).json({ error: `Invalid ${label} id.` });
  return false;
}

export async function recordContentArchiveEvent({
  action,
  resourceType,
  resourceId,
  resourceLabel,
  details,
  actorId,
}: {
  action: ArchiveAuditAction;
  resourceType: AuditedContentResource;
  resourceId: mongoose.Types.ObjectId | string;
  resourceLabel: string;
  details?: Record<string, unknown>;
  actorId?: string;
}) {
  if (!actorId || !mongoose.isValidObjectId(actorId)) throw new Error('Missing authenticated audit actor.');
  const actor = await Admin.findById(actorId).select('email').lean();
  if (!actor) throw new Error('Authenticated audit actor no longer exists.');
  await ContentAuditEvent.create({ action, resourceType, resourceId, resourceLabel, details, actorId, actorEmail: actor.email });
}
