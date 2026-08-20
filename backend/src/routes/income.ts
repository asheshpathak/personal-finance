import express, { Response } from 'express';
import { authenticateToken, clientDay, AuthRequest } from '../middleware/auth';
import IncomeSource, { FREQUENCIES, INCOME_TYPES } from '../models/IncomeSource';
import { summarizeIncome, type IncomeStream } from '../lib/income';
import { isDayKey, toDayKey } from '../lib/schedule';

/**
 * Income lives on the account, not on a budget.
 *
 * That is the whole point of this route existing. Before it, income was a
 * number typed into each budget and visible nowhere else — which meant it had
 * to be retyped every period, could not be seen by the dashboard, the
 * affordability check or the assistant, and could not express the ordinary case
 * of a salary plus a rent plus an annual bonus. A budget's income is now a
 * derived figure it may override, and this is where the truth is.
 */

const router = express.Router();

router.use(authenticateToken);

const RELIABILITY = ['guaranteed', 'likely', 'variable'];

function validate(body: Record<string, unknown>): string | null {
  const { name, amount, frequency, type, reliability, payDayOfMonth } = body;

  if (!name || typeof name !== 'string' || !name.trim()) return 'Name is required';
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) return 'Amount must be a number';
  if (!frequency || !FREQUENCIES.includes(frequency as typeof FREQUENCIES[number])) return 'Invalid frequency';
  if (type !== undefined && !INCOME_TYPES.includes(type as typeof INCOME_TYPES[number])) return 'Invalid income type';
  if (reliability !== undefined && !RELIABILITY.includes(String(reliability))) return 'Invalid reliability';
  if (payDayOfMonth != null) {
    const day = Number(payDayOfMonth);
    if (!Number.isInteger(day) || day < 1 || day > 31) return 'Pay day must be between 1 and 31';
  }
  if (body.startDay != null && body.startDay !== '' && !isDayKey(body.startDay)) return 'Start date must be YYYY-MM-DD';
  if (body.endDay != null && body.endDay !== '' && !isDayKey(body.endDay)) return 'End date must be YYYY-MM-DD';
  return null;
}

function writable(body: Record<string, any>) {
  return {
    name: String(body.name).trim(),
    type: body.type ?? 'Salary',
    amount: Number(body.amount),
    frequency: body.frequency,
    payDayOfMonth: body.payDayOfMonth != null && body.payDayOfMonth !== '' ? Number(body.payDayOfMonth) : null,
    reliability: RELIABILITY.includes(String(body.reliability)) ? body.reliability : 'guaranteed',
    typicalLow: body.typicalLow != null && body.typicalLow !== '' ? Number(body.typicalLow) : null,
    startDay: isDayKey(body.startDay) ? body.startDay : null,
    endDay: isDayKey(body.endDay) ? body.endDay : null,
    active: body.active !== false,
    notes: typeof body.notes === 'string' ? body.notes.trim() : '',
  };
}

const asStream = (doc: any): IncomeStream => ({
  name: doc.name,
  type: doc.type,
  amount: Number(doc.amount) || 0,
  frequency: doc.frequency,
  reliability: doc.reliability ?? 'guaranteed',
  typicalLow: doc.typicalLow,
  payDayOfMonth: doc.payDayOfMonth,
  startDay: doc.startDay,
  endDay: doc.endDay,
  active: doc.active,
});

/**
 * Every stream plus the summary the rest of the app reads.
 *
 * Returned together rather than as two endpoints because there is no caller
 * that wants one without the other, and two round-trips to render one card is
 * two chances for the figures on screen to disagree.
 */
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const today = clientDay(req) ?? toDayKey(new Date());
    const sources = await IncomeSource.find({ userId: req.user!.id }).sort({ active: -1, amount: -1 }).lean();
    res.json({
      sources,
      summary: summarizeIncome(sources.map(asStream), today),
    });
  } catch (err) {
    console.error('[income] list failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const error = validate(req.body);
    if (error) {
      res.status(400).json({ error });
      return;
    }
    const created = await IncomeSource.create({ userId: req.user!.id, ...writable(req.body) });
    res.status(201).json(created);
  } catch (err) {
    console.error('[income] create failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const error = validate(req.body);
    if (error) {
      res.status(400).json({ error });
      return;
    }
    const updated = await IncomeSource.findOneAndUpdate(
      { _id: req.params.id, userId: req.user!.id },
      writable(req.body),
      { new: true }
    );
    if (!updated) {
      res.status(404).json({ error: 'Income source not found' });
      return;
    }
    res.json(updated);
  } catch (err) {
    console.error('[income] update failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const deleted = await IncomeSource.findOneAndDelete({ _id: req.params.id, userId: req.user!.id });
    if (!deleted) {
      res.status(404).json({ error: 'Income source not found' });
      return;
    }
    res.json({ message: 'Income source deleted successfully' });
  } catch (err) {
    console.error('[income] delete failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
