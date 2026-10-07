import { Router, Request, Response } from 'express';
import PaymentSettings from '../models/PaymentSettings';
import { AuthRequest, protect } from '../middleware/auth';

const router = Router();
const MAIN_KEY = 'main';

async function getOrCreateSettings() {
  let settings = await PaymentSettings.findOne({ key: MAIN_KEY });
  if (!settings) settings = await PaymentSettings.create({ key: MAIN_KEY });
  return settings;
}

function toPublicSettings(settings: InstanceType<typeof PaymentSettings>) {
  return {
    bankTransferEnabled: settings.bankTransferEnabled,
    whatsappEnabled: settings.whatsappEnabled,
    bankName: settings.bankName,
    accountName: settings.accountName,
    accountNumber: settings.accountNumber,
  };
}

router.get('/public', async (_req: Request, res: Response) => {
  try {
    const settings = await getOrCreateSettings();
    res.set('Cache-Control', 'no-store');
    res.json({ settings: toPublicSettings(settings) });
  } catch (error) {
    console.error(error);
    res.status(503).json({ error: 'Payment options are temporarily unavailable.' });
  }
});

router.get('/admin', protect, async (_req: AuthRequest, res: Response) => {
  try {
    const settings = await getOrCreateSettings();
    res.set('Cache-Control', 'no-store');
    res.json({ settings: toPublicSettings(settings) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not load payment settings.' });
  }
});

router.put('/admin', protect, async (req: AuthRequest, res: Response) => {
  try {
    const { bankTransferEnabled, whatsappEnabled, bankName, accountName, accountNumber } = req.body as Record<string, unknown>;
    if (typeof bankTransferEnabled !== 'boolean' || typeof whatsappEnabled !== 'boolean') {
      return res.status(400).json({ error: 'Choose whether bank transfer and WhatsApp ordering are enabled.' });
    }
    if (typeof bankName !== 'string' || !bankName.trim() || bankName.trim().length > 100) {
      return res.status(400).json({ error: 'Enter a valid bank name.' });
    }
    if (typeof accountName !== 'string' || !accountName.trim() || accountName.trim().length > 120) {
      return res.status(400).json({ error: 'Enter a valid account name.' });
    }
    const normalizedAccountNumber = typeof accountNumber === 'string' ? accountNumber.replace(/\s/g, '') : '';
    if (!/^\d{8,20}$/.test(normalizedAccountNumber)) return res.status(400).json({ error: 'Enter an account number containing 8 to 20 digits.' });
    if (!bankTransferEnabled && !whatsappEnabled) return res.status(400).json({ error: 'At least one checkout option must remain enabled.' });

    const settings = await PaymentSettings.findOneAndUpdate(
      { key: MAIN_KEY },
      { $set: { bankTransferEnabled, whatsappEnabled, bankName: bankName.trim(), accountName: accountName.trim(), accountNumber: normalizedAccountNumber }, $setOnInsert: { key: MAIN_KEY } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    );
    res.set('Cache-Control', 'no-store');
    res.json({ message: 'Payment settings updated.', settings: toPublicSettings(settings) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not save payment settings.' });
  }
});

export default router;
