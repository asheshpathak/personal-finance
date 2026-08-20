import express, { Response } from 'express';
import { authenticateToken, clientDay, AuthRequest } from '../middleware/auth';
import Subscription, { FREQUENCIES, DAYS_OF_WEEK } from '../models/Subscription';
import {
  addDaysKey,
  isDayKey,
  nextCycleStart,
  nextDueDay,
  scheduleChanged,
  toDayKey,
  type Frequency,
  type Schedule,
} from '../lib/schedule';
import { runSubscriptionCharges } from '../lib/subscriptionCharges';

const router = express.Router();

router.use(authenticateToken);

const PAYMENT_MODES = ['Credit Card', 'Debit Card', 'Cash', 'Bank Transfer'];

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
  const { name, amount, frequency, category, dueDayOfWeek, dueDayOfMonth, dueMonth, paymentMode } = body;
  if (!name || typeof name !== 'string' || !name.trim()) return 'Name is required';
  if (amount === undefined || typeof amount !== 'number' || amount <= 0) return 'Amount must be a positive number';
  if (!frequency || !FREQUENCIES.includes(frequency as typeof FREQUENCIES[number])) return 'Invalid frequency';
  if (!category || typeof category !== 'string' || !category.trim()) return 'Category is required';
  if (paymentMode !== undefined && paymentMode !== null && !PAYMENT_MODES.includes(String(paymentMode))) {
    return 'Invalid payment mode';
  }
  return validateDueDate(frequency as string, dueDayOfWeek, dueDayOfMonth, dueMonth);
}

/**
 * How far back a subscription may be back-dated when it's created.
 *
 * A year is generous for "I've been paying this a while, catch it up" and is
 * the wall against the pathological case: `{frequency:'daily', startDay:'2015-01-01'}`
 * would otherwise make the create request sit through hundreds of sequential
 * inserts and drop hundreds of invented expenses into closed budgets.
 */
const MAX_BACKDATE_DAYS = 366;

function clampStartDay(requested: unknown, today: string): string {
  if (!isDayKey(requested)) return today;
  const floor = addDaysKey(today, -MAX_BACKDATE_DAYS);
  return requested < floor ? floor : requested;
}

/** The read shape: stored fields plus the derived next charge date. */
function withDerived(doc: any, today: string) {
  const plain = doc.toObject ? doc.toObject() : doc;
  return {
    ...plain,
    nextDueDay: nextDueDay(
      {
        frequency: plain.frequency,
        dueDayOfWeek: plain.dueDayOfWeek,
        dueDayOfMonth: plain.dueDayOfMonth,
        dueMonth: plain.dueMonth,
        startDay: plain.startDay,
        lastChargedDay: plain.lastChargedDay,
        pendingSchedule: plain.pendingSchedule,
        pendingEffectiveFrom: plain.pendingEffectiveFrom,
      },
      today
    ),
  };
}

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    // Catch up before reading, so the list and the expenses it implies are
    // consistent the moment the page loads.
    await runSubscriptionCharges(req.user!.id, clientDay(req));

    const today = clientDay(req) ?? toDayKey(new Date());
    const subscriptions = await Subscription.find({ userId: req.user!.id }).sort({ createdAt: -1 });
    res.json(subscriptions.map(sub => withDerived(sub, today)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { name, amount, frequency, category, dueDayOfWeek, dueDayOfMonth, dueMonth, autoRecord, paymentMode, startDay } = req.body;
    const error = validateBody({ name, amount: Number(amount), frequency, category, dueDayOfWeek, dueDayOfMonth, dueMonth, paymentMode });
    if (error) {
      res.status(400).json({ error });
      return;
    }

    const today = clientDay(req) ?? toDayKey(new Date());
    const dueDate = normalizeDueDate(frequency, dueDayOfWeek, dueDayOfMonth, dueMonth);

    const subscription = new Subscription({
      userId: req.user!.id,
      name: name.trim(),
      amount: Number(amount),
      frequency,
      category: category.trim(),
      ...dueDate,
      autoRecord: autoRecord !== false,
      paymentMode: PAYMENT_MODES.includes(String(paymentMode)) ? paymentMode : 'Bank Transfer',
      // Billing starts today unless a start day is given. Never earlier by
      // default: a new subscription must not invent months of past charges.
      startDay: clampStartDay(startDay, today),
    });

    const saved = await subscription.save();
    await runSubscriptionCharges(req.user!.id, clientDay(req));

    const fresh = await Subscription.findById(saved._id);
    res.status(201).json(withDerived(fresh ?? saved, today));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { name, amount, frequency, category, dueDayOfWeek, dueDayOfMonth, dueMonth, autoRecord, paymentMode } = req.body;
    const error = validateBody({ name, amount: Number(amount), frequency, category, dueDayOfWeek, dueDayOfMonth, dueMonth, paymentMode });
    if (error) {
      res.status(400).json({ error });
      return;
    }

    const existing = await Subscription.findOne({ _id: req.params.id, userId: req.user!.id });
    if (!existing) {
      res.status(404).json({ error: 'Subscription not found' });
      return;
    }

    const today = clientDay(req) ?? toDayKey(new Date());
    const requested: Schedule & { frequency: Frequency } = {
      frequency,
      ...normalizeDueDate(frequency, dueDayOfWeek, dueDayOfMonth, dueMonth),
    } as Schedule & { frequency: Frequency };

    const current: Schedule = {
      frequency: existing.get('frequency'),
      dueDayOfWeek: existing.get('dueDayOfWeek'),
      dueDayOfMonth: existing.get('dueDayOfMonth'),
      dueMonth: existing.get('dueMonth'),
    };

    // Everything except the schedule applies at once — a price correction or a
    // rename is about the subscription, not about when it bills.
    existing.set('name', name.trim());
    existing.set('amount', Number(amount));
    existing.set('category', category.trim());
    if (autoRecord !== undefined) existing.set('autoRecord', autoRecord !== false);
    if (PAYMENT_MODES.includes(String(paymentMode))) existing.set('paymentMode', paymentMode);

    if (scheduleChanged(current, requested)) {
      if (!isDayKey(existing.get('lastChargedDay'))) {
        // Nothing has been billed yet, so there is no cycle in progress to
        // protect — this is still someone correcting what they just typed.
        // Staging it here would charge once on the wrong date before the fix
        // they already made took effect.
        existing.set('frequency', requested.frequency);
        existing.set('dueDayOfWeek', requested.dueDayOfWeek ?? null);
        existing.set('dueDayOfMonth', requested.dueDayOfMonth ?? null);
        existing.set('dueMonth', requested.dueMonth ?? null);
        existing.set('pendingSchedule', null);
        existing.set('pendingEffectiveFrom', null);
      } else {
        // The due date is deliberately NOT applied now.
        //
        // This cycle has already been billed on the old date; moving it would
        // either double-charge (new date still ahead) or silently skip a cycle
        // (new date already past). So the change is staged and takes effect at
        // the start of the next cycle — the same behaviour as changing a
        // renewal date with any app store or streaming service.
        existing.set('pendingSchedule', requested);
        existing.set('pendingEffectiveFrom', nextCycleStart(requested.frequency, today));
      }
    } else {
      // Edited back to what it already was — drop any staged change.
      existing.set('pendingSchedule', null);
      existing.set('pendingEffectiveFrom', null);
    }

    await existing.save();
    await runSubscriptionCharges(req.user!.id, clientDay(req));

    const fresh = await Subscription.findById(existing._id);
    res.json(withDerived(fresh ?? existing, today));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

/** Discards a staged due-date change, keeping the schedule that's billing now. */
router.delete('/:id/pending-schedule', async (req: AuthRequest, res: Response) => {
  try {
    const updated = await Subscription.findOneAndUpdate(
      { _id: req.params.id, userId: req.user!.id },
      { pendingSchedule: null, pendingEffectiveFrom: null },
      { new: true }
    );
    if (!updated) {
      res.status(404).json({ error: 'Subscription not found' });
      return;
    }
    res.json(withDerived(updated, toDayKey(new Date())));
  } catch (err) {
    console.error(err);
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

    // Charges already posted are real spending and stay in the history — the
    // money genuinely left the account, and deleting the subscription is a
    // statement about the future, not a correction of the past.
    //
    // There is deliberately no "withdraw future charges" step: the walk stops
    // at today, so a charge dated after today cannot exist to withdraw.
    res.json({ message: 'Subscription deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
