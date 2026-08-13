import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import Admin from '../models/Admin';
import { generateToken } from '../utils/generateToken';
import { createPasswordResetToken, hashPasswordResetToken } from '../utils/passwordReset';
import { isEmailDeliveryConfigured, sendPasswordResetEmail } from '../services/email';
import { protect, AuthRequest } from '../middleware/auth';
import { authLimiter, passwordResetLimiter } from '../middleware/rateLimiter';

const router = Router();

router.post('/login', authLimiter, async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const admin = await Admin.findOne({ email: email.toLowerCase() });
    if (!admin) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const isMatch = await admin.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = generateToken(admin._id.toString());
    res.json({ token, admin: { email: admin.email } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong logging in.' });
  }
});

router.post('/forgot-password', passwordResetLimiter, async (req: Request, res: Response) => {
  const genericMessage = 'If an admin account exists for that email, a password reset link has been sent.';
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!email) return res.status(400).json({ error: 'Email is required.' });
  if (mongoose.connection.readyState !== 1) return res.status(202).json({ message: genericMessage });

  try {
    const admin = await Admin.findOne({ email });
    if (admin && isEmailDeliveryConfigured()) {
      const { token, hash } = createPasswordResetToken();
      admin.passwordResetTokenHash = hash;
      admin.passwordResetTokenExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
      await admin.save();
      const adminAppUrl = (process.env.ADMIN_APP_URL || 'https://timavelle-cuisine-admin.vercel.app').replace(/\/$/, '');
      await sendPasswordResetEmail(admin.email, `${adminAppUrl}/reset-password/${token}`);
    } else if (admin) {
      console.error('Password reset requested but SMTP delivery is not configured.');
    }
  } catch (error) {
    console.error('Password reset request failed:', error);
  }

  res.status(202).json({ message: genericMessage });
});

router.post('/reset-password', passwordResetLimiter, async (req: Request, res: Response) => {
  const token = typeof req.body.token === 'string' ? req.body.token.trim() : '';
  const newPassword = typeof req.body.newPassword === 'string' ? req.body.newPassword : '';
  if (!token || !newPassword) return res.status(400).json({ error: 'Reset token and new password are required.' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  if (!/^[a-f0-9]{64}$/i.test(token)) return res.status(400).json({ error: 'This reset link is invalid or has expired.' });

  try {
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const admin = await Admin.findOneAndUpdate(
      { passwordResetTokenHash: hashPasswordResetToken(token), passwordResetTokenExpiresAt: { $gt: new Date() } },
      { $set: { password: hashedPassword }, $unset: { passwordResetTokenHash: 1, passwordResetTokenExpiresAt: 1 } },
      { new: true },
    ).select('email');
    if (!admin) return res.status(400).json({ error: 'This reset link is invalid or has expired.' });
    res.json({ message: 'Password reset successfully. You can now sign in.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong resetting your password.' });
  }
});

router.get('/me', protect, async (req: AuthRequest, res: Response) => {
  const admin = await Admin.findById(req.adminId).select('-password -passwordResetTokenHash -passwordResetTokenExpiresAt');
  res.json({ admin });
});

router.put('/change-password', protect, authLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password are required.' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    }

    const admin = await Admin.findById(req.adminId);
    if (!admin) return res.status(404).json({ error: 'Admin not found.' });

    const isMatch = await admin.comparePassword(currentPassword);
    if (!isMatch) return res.status(401).json({ error: 'Current password is incorrect.' });

    admin.password = newPassword;
    admin.passwordResetTokenHash = undefined;
    admin.passwordResetTokenExpiresAt = undefined;
    await admin.save();

    res.json({ message: 'Password updated successfully.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong changing your password.' });
  }
});
export default router;
