import { Router, Request, Response } from 'express';
import Admin from '../models/Admin';
import { generateToken } from '../utils/generateToken';
import { protect, AuthRequest } from '../middleware/auth';

const router = Router();

router.post('/login', async (req: Request, res: Response) => {
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

router.get('/me', protect, async (req: AuthRequest, res: Response) => {
  const admin = await Admin.findById(req.adminId).select('-password');
  res.json({ admin });
});

export default router;
