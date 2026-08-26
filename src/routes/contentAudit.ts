import { Response, Router } from 'express';
import mongoose from 'mongoose';
import ContentAuditEvent, { archiveAuditActions, auditedContentResources } from '../models/ContentAuditEvent';
import { AuthRequest, protect } from '../middleware/auth';

const router = Router();
const defaultLimit = 20;
const maxLimit = 100;
const maxExportRows = 5000;
const maxRangeDays = 366;

class AuditQueryError extends Error {}

function readPositiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readDate(value: unknown, boundary: 'start' | 'end', label: string) {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new AuditQueryError(`${label} must use YYYY-MM-DD.`);
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, boundary === 'end' ? 23 : 0, boundary === 'end' ? 59 : 0, boundary === 'end' ? 59 : 0, boundary === 'end' ? 999 : 0));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new AuditQueryError(`${label} is not a valid calendar date.`);
  return date;
}

function buildAuditFilter(req: AuthRequest) {
  const resource = typeof req.query.resource === 'string' ? req.query.resource : 'all';
  const action = typeof req.query.action === 'string' ? req.query.action : 'all';
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 180) : '';
  const from = readDate(req.query.from, 'start', 'From date');
  const to = readDate(req.query.to, 'end', 'To date');
  if (resource !== 'all' && !auditedContentResources.includes(resource as typeof auditedContentResources[number])) throw new AuditQueryError('Invalid audit resource filter.');
  if (action !== 'all' && !archiveAuditActions.includes(action as typeof archiveAuditActions[number])) throw new AuditQueryError('Invalid audit action filter.');
  if (from && to && from > to) throw new AuditQueryError('From date must be on or before To date.');
  if (from && to && to.getTime() - from.getTime() > maxRangeDays * 24 * 60 * 60 * 1000) throw new AuditQueryError(`Date range cannot exceed ${maxRangeDays} days.`);
  const filter: Record<string, unknown> = {};
  if (resource !== 'all') filter.resourceType = resource;
  if (action !== 'all') filter.action = action;
  if (from || to) filter.createdAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  if (search) {
    const expression = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ resourceLabel: expression }, { actorEmail: expression }];
  }
  return filter;
}

function csvCell(value: unknown) {
  const text = String(value ?? '');
  const neutralized = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${neutralized.replace(/"/g, '""')}"`;
}

router.get('/export', protect, async (req: AuthRequest, res: Response) => {
  try {
    const filter = buildAuditFilter(req);
    const items = await ContentAuditEvent.find(filter).sort({ createdAt: -1 }).limit(maxExportRows).lean();
    const header = ['Action', 'Resource', 'Item', 'Actor', 'Recorded at (UTC)', 'Snapshot available'];
    const rows = items.map((item) => [item.action, item.resourceType, item.resourceLabel, item.actorEmail, item.createdAt.toISOString(), item.details ? 'Yes' : 'No']);
    const csv = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="timavelle-audit-history-${date}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(`\uFEFF${csv}`);
  } catch (error) {
    if (error instanceof AuditQueryError) return res.status(400).json({ error: error.message });
    console.error(error);
    res.status(500).json({ error: 'Something went wrong exporting archive history.' });
  }
});

router.get('/:id', protect, async (req: AuthRequest, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid audit event id.' });
    const item = await ContentAuditEvent.findById(req.params.id).lean();
    if (!item) return res.status(404).json({ error: 'Audit event not found.' });
    res.set('Cache-Control', 'no-store');
    res.json({ item });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong loading audit-event details.' });
  }
});

router.get('/', protect, async (req: AuthRequest, res: Response) => {
  try {
    const page = readPositiveInteger(req.query.page, 1);
    const limit = Math.min(readPositiveInteger(req.query.limit, defaultLimit), maxLimit);
    const filter = buildAuditFilter(req);
    const [items, total, summary] = await Promise.all([
      ContentAuditEvent.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      ContentAuditEvent.countDocuments(filter),
      ContentAuditEvent.aggregate<{ _id: string; count: number }>([{ $match: filter }, { $group: { _id: '$action', count: { $sum: 1 } } }]),
    ]);
    const counts = summary.reduce((result, entry) => ({ ...result, [entry._id]: entry.count }), { archive: 0, restore: 0 });
    res.set('Cache-Control', 'no-store');
    res.json({ items, page, limit, total, pages: Math.max(1, Math.ceil(total / limit)), summary: { archive: counts.archive || 0, restore: counts.restore || 0 } });
  } catch (error) {
    if (error instanceof AuditQueryError) return res.status(400).json({ error: error.message });
    console.error(error);
    res.status(500).json({ error: 'Something went wrong loading archive history.' });
  }
});

export default router;
