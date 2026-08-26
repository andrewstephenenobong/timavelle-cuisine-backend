import { Response, Router } from 'express';
import ContentAuditEvent, { archiveAuditActions, auditedContentResources } from '../models/ContentAuditEvent';
import { AuthRequest, protect } from '../middleware/auth';

const router = Router();
const defaultLimit = 20;
const maxLimit = 100;

function readPositiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

router.get('/', protect, async (req: AuthRequest, res: Response) => {
  try {
    const page = readPositiveInteger(req.query.page, 1);
    const limit = Math.min(readPositiveInteger(req.query.limit, defaultLimit), maxLimit);
    const resource = typeof req.query.resource === 'string' ? req.query.resource : 'all';
    const action = typeof req.query.action === 'string' ? req.query.action : 'all';
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    if (resource !== 'all' && !auditedContentResources.includes(resource as typeof auditedContentResources[number])) return res.status(400).json({ error: 'Invalid audit resource filter.' });
    if (action !== 'all' && !archiveAuditActions.includes(action as typeof archiveAuditActions[number])) return res.status(400).json({ error: 'Invalid audit action filter.' });
    const filter: Record<string, unknown> = {};
    if (resource !== 'all') filter.resourceType = resource;
    if (action !== 'all') filter.action = action;
    if (search) {
      const expression = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ resourceLabel: expression }, { actorEmail: expression }];
    }
    const [items, total, summary] = await Promise.all([
      ContentAuditEvent.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      ContentAuditEvent.countDocuments(filter),
      ContentAuditEvent.aggregate<{ _id: string; count: number }>([{ $match: filter }, { $group: { _id: '$action', count: { $sum: 1 } } }]),
    ]);
    const counts = summary.reduce((result, entry) => ({ ...result, [entry._id]: entry.count }), { archive: 0, restore: 0 });
    res.json({ items, page, limit, total, pages: Math.max(1, Math.ceil(total / limit)), summary: { archive: counts.archive || 0, restore: counts.restore || 0 } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong loading archive history.' });
  }
});

export default router;
