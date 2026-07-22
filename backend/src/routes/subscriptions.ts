import express, { Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import Subscription, { FREQUENCIES, DAYS_OF_WEEK } from '../models/Subscription';

const router = express.Router();

router.use(authenticateToken);

function validateDueDate(
  frequency: string,
  dueDayOfWeek: unknown,
  dueDayOfMonth: unknown,
  dueMonth: unknown
): string | null {
  if (frequency === 'daily') return null;

  if (frequency === 'weekly') {
    if (!dueDayOfWeek || !DAYS_OF_WEEK.includes(dueDayOfWeek as typeof DAYS_OF_WEEK[number])) {
      return 'Day of week is required for weekly subscriptions';
    }
    return null;
  }

  const day = Number(dueDayOfMonth);
  if (!dueDayOfMonth || !Number.isInteger(day) || day < 1 || day > 31) {
    return 'Day of month is required (1–31)';
  }

  if (frequency === 'yearly') {
    const month = Number(dueMonth);
    if (!dueMonth || !Number.isInteger(month) || month < 1 || month > 12) {
      return 'Month is required for yearly subscriptions';
    }
  }

  return null;
}

function normalizeDueDate(frequency: string, dueDayOfWeek: unknown, dueDayOfMonth: unknown, dueMonth: unknown) {
  if (frequency === 'daily') {
    return { dueDayOfWeek: null, dueDayOfMonth: null, dueMonth: null };
  }
  if (frequency === 'weekly') {
    return { dueDayOfWeek, dueDayOfMonth: null, dueMonth: null };
  }
  if (frequency === 'monthly') {
    return { dueDayOfWeek: null, dueDayOfMonth: Number(dueDayOfMonth), dueMonth: null };
  }
  return {
    dueDayOfWeek: null,
    dueDayOfMonth: Number(dueDayOfMonth),
    dueMonth: Number(dueMonth),
  };
}

function validateBody(body: Record<string, unknown>): string | null {
  const { name, amount, frequency, category, dueDayOfWeek, dueDayOfMonth, dueMonth } = body;
  if (!name || typeof name !== 'string' || !name.trim()) return 'Name is required';
  if (amount === undefined || typeof amount !== 'number' || amount <= 0) return 'Amount must be a positive number';
  if (!frequency || !FREQUENCIES.includes(frequency as typeof FREQUENCIES[number])) return 'Invalid frequency';
  if (!category || typeof category !== 'string' || !category.trim()) return 'Category is required';
  return validateDueDate(frequency as string, dueDayOfWeek, dueDayOfMonth, dueMonth);
}

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const subscriptions = await Subscription.find({ userId: req.user!.id }).sort({ createdAt: -1 });
    res.json(subscriptions);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { name, amount, frequency, category, dueDayOfWeek, dueDayOfMonth, dueMonth } = req.body;
    const error = validateBody({ name, amount: Number(amount), frequency, category, dueDayOfWeek, dueDayOfMonth, dueMonth });
    if (error) {
      res.status(400).json({ error });
      return;
    }
    const dueDate = normalizeDueDate(frequency, dueDayOfWeek, dueDayOfMonth, dueMonth);
    const subscription = new Subscription({
      userId: req.user!.id,
      name: name.trim(),
      amount: Number(amount),
      frequency,
      category: category.trim(),
      ...dueDate,
    });
    const saved = await subscription.save();
    res.status(201).json(saved);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { name, amount, frequency, category, dueDayOfWeek, dueDayOfMonth, dueMonth } = req.body;
    const error = validateBody({ name, amount: Number(amount), frequency, category, dueDayOfWeek, dueDayOfMonth, dueMonth });
    if (error) {
      res.status(400).json({ error });
      return;
    }
    const dueDate = normalizeDueDate(frequency, dueDayOfWeek, dueDayOfMonth, dueMonth);
    const updated = await Subscription.findOneAndUpdate(
      { _id: req.params.id, userId: req.user!.id },
      { name: name.trim(), amount: Number(amount), frequency, category: category.trim(), ...dueDate },
      { new: true }
    );
    if (!updated) {
      res.status(404).json({ error: 'Subscription not found' });
      return;
    }
    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const deleted = await Subscription.findOneAndDelete({ _id: req.params.id, userId: req.user!.id });
    if (!deleted) {
      res.status(404).json({ error: 'Subscription not found' });
      return;
    }
    res.json({ message: 'Subscription deleted successfully' });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
