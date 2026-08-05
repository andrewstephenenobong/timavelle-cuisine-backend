import { Router, Request, Response } from 'express';
import Enquiry from '../models/Enquiry';
import { enquiryLimiter } from '../middleware/rateLimiter';

const router = Router();

router.post('/', enquiryLimiter, async (req: Request, res: Response) => {
  try {
    const { name, email, phone, eventDate, partySize, message } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Name, email, and message are required.' });
    }

    const enquiry = await Enquiry.create({ name, email, phone, eventDate, partySize, message });
    res.status(201).json({ message: 'Enquiry received', enquiry });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong sending your enquiry.' });
  }
});

export default router;