import express, { Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import PaymentShortcut from '../models/PaymentShortcut';

const router = express.Router();

router.use(authenticateToken);

type ShortcutBody = {
  label?: unknown;
  amount?: unknown;
  category?: unknown;
  paymentMode?: unknown;
  description?: unknown;
};

/** Returns the sanitized fields, or an error string when the body is unusable. */
function parseBody(body: ShortcutBody): { error: string } | {
  label: string;
  amount: number;
  category: string;
  paymentMode: string;
  description: string;
} {
  const { label, amount, category, paymentMode, description } = body;

  if (!category || typeof category !== 'string' || !category.trim()) {
    return { error: 'Category is required' };
  }
  if (!paymentMode || typeof paymentMode !== 'string' || !paymentMode.trim()) {
    return { error: 'Payment mode is required' };
  }

  const parsedAmount = Number(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
    return { error: 'Amount must be a positive number' };
  }

  const desc = typeof description === 'string' ? description.trim() : '';
  // The label is what shows on the chip. Fall back to the description, then the
  // category, so a shortcut is never nameless.
  const resolvedLabel =
    (typeof label === 'string' && label.trim()) || desc || category.trim();

  return {
    label: resolvedLabel,
    amount: parsedAmount,
    category: category.trim(),
    paymentMode: paymentMode.trim(),
    description: desc,
  };
}

// Most-used first; ties broken by most-recently-used so the picker stays fresh.
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const shortcuts = await PaymentShortcut.find({ userId: req.user!.id })
      .sort({ usageCount: -1, lastUsedAt: -1, createdAt: -1 });
    res.json(shortcuts);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const parsed = parseBody(req.body);
    if ('error' in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    // Saving the same template twice is a no-op rather than an error — the user
    // just tapped "save" on something they had already pinned.
    const existing = await PaymentShortcut.findOne({
      userId: req.user!.id,
      category: parsed.category,
      paymentMode: parsed.paymentMode,
      description: parsed.description,
    });
    if (existing) {
      res.status(200).json(existing);
      return;
    }

    const saved = await new PaymentShortcut({ userId: req.user!.id, ...parsed }).save();
    res.status(201).json(saved);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const parsed = parseBody(req.body);
    if ('error' in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const updated = await PaymentShortcut.findOneAndUpdate(
      { _id: req.params.id, userId: req.user!.id },
      parsed,
      { new: true }
    );
    if (!updated) {
      res.status(404).json({ error: 'Shortcut not found' });
      return;
    }
    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// Fired when a shortcut is actually used to record an expense.
router.post('/:id/use', async (req: AuthRequest, res: Response) => {
  try {
    const updated = await PaymentShortcut.findOneAndUpdate(
      { _id: req.params.id, userId: req.user!.id },
      { $inc: { usageCount: 1 }, $set: { lastUsedAt: new Date() } },
      { new: true }
    );
    if (!updated) {
      res.status(404).json({ error: 'Shortcut not found' });
      return;
    }
    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const deleted = await PaymentShortcut.findOneAndDelete({
      _id: req.params.id,
      userId: req.user!.id,
    });
    if (!deleted) {
      res.status(404).json({ error: 'Shortcut not found' });
      return;
    }
    res.json({ message: 'Shortcut deleted successfully' });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
