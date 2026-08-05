import rateLimit from 'express-rate-limit';

export const enquiryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per IP per window
  message: { error: 'Too many enquiries submitted. Please try again in a little while.' },
  standardHeaders: true,
  legacyHeaders: false,
});
