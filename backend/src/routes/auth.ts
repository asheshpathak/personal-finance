import express, { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User, { CURRENCIES } from '../models/User';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { config } from '../config';

const router = express.Router();

router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      res.status(400).json({ error: 'Email already exists' });
      return;
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const user = new User({ email, password: hashedPassword });
    await user.save();

    const token = jwt.sign({ id: user._id }, config.jwtSecret, { expiresIn: '7d' });
    
    res.status(201).json({ token, user: { id: user._id, email: user.email, currency: user.currency ?? null } });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    
    const user = await User.findOne({ email });
    if (!user) {
      res.status(400).json({ error: 'Invalid credentials' });
      return;
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      res.status(400).json({ error: 'Invalid credentials' });
      return;
    }

    const token = jwt.sign({ id: user._id }, config.jwtSecret, { expiresIn: '7d' });
    
    res.json({ token, user: { id: user._id, email: user.email, currency: user.currency ?? null } });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// The signed-in account, including preferences that must survive a device
// change — the client reads this on load rather than trusting local storage.
router.get('/me', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const user = await User.findById(req.user!.id).select('email currency');
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json({ id: user._id, email: user.email, currency: user.currency ?? null });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/preferences', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { currency } = req.body;
    if (!CURRENCIES.includes(currency)) {
      res.status(400).json({ error: 'Unsupported currency' });
      return;
    }

    const user = await User.findByIdAndUpdate(
      req.user!.id,
      { currency },
      { new: true }
    ).select('email currency');

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({ id: user._id, email: user.email, currency: user.currency ?? null });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
