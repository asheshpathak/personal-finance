import express, { Response } from 'express';
import { authenticateToken, clientDay, AuthRequest } from '../middleware/auth';
import Debt, { FREQUENCIES, DAYS_OF_WEEK, DEBT_KINDS, DEBT_CATEGORIES, PREPAYMENT_EFFECTS } from '../models/Debt';
import Expense from '../models/Expense';
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
import { amortize, balanceOn, minimumPayment, prepaymentImpact, monthlyEquivalent, type DebtTerms } from '../lib/amortization';
import { runDebtCharges } from '../lib/debtCharges';

const router = express.Router();

router.use(authenticateToken);

const PAYMENT_MODES = ['Credit Card', 'Debit Card', 'Cash', 'Bank Transfer'];

/**
 * How far back a debt may be anchored.
 *
 * The anchor is where the replay starts, and every instalment between it and
 * today is posted as a real expense on the first read. Two years is generous
 * for "I want my payment history in here" and is the wall against
 * `{frequency:'daily', balanceAsOf:'2015-01-01'}`, which would otherwise drop
 * three thousand invented expenses into closed budgets.
 */
const MAX_BACKDATE_DAYS = 731;

function validateDueDate(
  frequency: string,
  dueDayOfWeek: unknown,
  dueDayOfMonth: unknown,
  dueMonth: unknown
): string | null {
  if (frequency === 'daily') return null;
  if (frequency === 'weekly') {
    if (!dueDayOfWeek || !DAYS_OF_WEEK.includes(dueDayOfWeek as typeof DAYS_OF_WEEK[number])) {
      return 'Day of week is required for weekly instalments';
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
      return 'Month is required for yearly instalments';
    }
  }
  return null;
}

function normalizeDueDate(frequency: string, dueDayOfWeek: unknown, dueDayOfMonth: unknown, dueMonth: unknown) {
  if (frequency === 'daily') return { dueDayOfWeek: null, dueDayOfMonth: null, dueMonth: null };
  if (frequency === 'weekly') return { dueDayOfWeek, dueDayOfMonth: null, dueMonth: null };
  if (frequency === 'monthly') return { dueDayOfWeek: null, dueDayOfMonth: Number(dueDayOfMonth), dueMonth: null };
  return { dueDayOfWeek: null, dueDayOfMonth: Number(dueDayOfMonth), dueMonth: Number(dueMonth) };
}

function validateBody(body: Record<string, unknown>): string | null {
  const { name, category, kind, openingBalance, balanceAsOf, emiAmount, annualRate, frequency, paymentMode } = body;

  if (!name || typeof name !== 'string' || !name.trim()) return 'Name is required';
  if (!category || !DEBT_CATEGORIES.includes(category as typeof DEBT_CATEGORIES[number])) return 'Pick a debt category';
  if (kind !== undefined && !DEBT_KINDS.includes(kind as typeof DEBT_KINDS[number])) return 'Invalid debt kind';
  if (typeof openingBalance !== 'number' || !Number.isFinite(openingBalance) || openingBalance < 0) {
    return 'Outstanding balance must be a number';
  }
  if (!isDayKey(balanceAsOf)) return 'Balance date must be YYYY-MM-DD';
  if (typeof emiAmount !== 'number' || !Number.isFinite(emiAmount) || emiAmount < 0) {
    return 'Instalment must be a number';
  }
  if (annualRate !== undefined) {
    const rate = Number(annualRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) return 'Interest rate must be between 0 and 100';
  }
  if (!frequency || !FREQUENCIES.includes(frequency as typeof FREQUENCIES[number])) return 'Invalid frequency';
  if (paymentMode !== undefined && paymentMode !== null && !PAYMENT_MODES.includes(String(paymentMode))) {
    return 'Invalid payment mode';
  }

  // An interest-bearing debt whose instalment cannot cover one period's
  // interest never ends. Rejecting it outright would be wrong — that is a real
  // situation people are in, and refusing to record it is refusing to help —
  // so it is allowed through and flagged in the derived fields instead.
  return validateDueDate(String(frequency), body.dueDayOfWeek, body.dueDayOfMonth, body.dueMonth);
}

function clampAnchor(requested: unknown, today: string): string {
  if (!isDayKey(requested)) return today;
  const floor = addDaysKey(today, -MAX_BACKDATE_DAYS);
  if (requested < floor) return floor;
  // A balance stated for a future date has nothing to replay from and would
  // make every derived figure a projection of a projection.
  if (requested > today) return today;
  return requested;
}

/** The terms a projection needs, read off a stored debt. */
export function termsOf(plain: Record<string, any>): DebtTerms {
  return {
    kind: plain.kind ?? 'amortizing',
    frequency: plain.frequency,
    annualRate: Number(plain.annualRate) || 0,
    instalment: Number(plain.emiAmount) || 0,
    openingBalance: Number(plain.openingBalance) || 0,
    balanceAsOf: plain.balanceAsOf,
    dueDayOfWeek: plain.dueDayOfWeek,
    dueDayOfMonth: plain.dueDayOfMonth,
    dueMonth: plain.dueMonth,
    prepayments: (plain.prepayments ?? []).map((p: any) => ({
      day: p.day,
      amount: Number(p.amount) || 0,
      effect: p.effect ?? 'reduce-tenure',
      note: p.note,
    })),
    rateChanges: (plain.rateChanges ?? []).map((r: any) => ({
      effectiveFrom: r.effectiveFrom,
      annualRate: Number(r.annualRate) || 0,
    })),
    minimumFraction: plain.minimumFraction ?? undefined,
    minimumFloor: plain.minimumFloor ?? undefined,
  };
}

/**
 * The read shape: what is stored, plus everything derived from it.
 *
 * Derived on read rather than stored, so a part-payment entered against last
 * March is reflected everywhere the moment it is saved — with no migration and
 * nothing to reconcile. See `models/Debt.ts` for why that is the whole design.
 */
function withDerived(doc: any, today: string) {
  const plain = doc.toObject ? doc.toObject() : doc;
  const terms = termsOf(plain);
  const active = plain.status !== 'closed';

  const balance = active ? balanceOn(terms, today) : 0;
  // Re-anchored at today so the projection describes what is left rather than
  // re-walking instalments already paid.
  const projection = active ? amortize({ ...terms, openingBalance: balance, balanceAsOf: today }) : null;

  const periodRate = terms.kind === 'interest-free' ? 0 : terms.annualRate / 100 / 12;

  return {
    ...plain,
    balance,
    monthlyCost: active ? monthlyEquivalent(terms.instalment, terms.frequency as Frequency) : 0,
    monthlyInterestCost: Math.round(balance * periodRate * 100) / 100,
    // Null rather than a number when the debt is growing: the payment does not
    // cover the interest, so there is no total to report and the one month the
    // projection managed before stopping would understate it without limit.
    interestRemaining: projection && !projection.negativelyAmortizing ? projection.interestRemaining : null,
    totalRemaining: projection && !projection.negativelyAmortizing ? projection.totalRemaining : null,
    payoffDay: projection?.payoffDay ?? null,
    periodsRemaining: projection?.periodsRemaining ?? 0,
    negativelyAmortizing: projection?.negativelyAmortizing ?? false,
    minimumDue: active ? minimumPayment(terms, balance) : 0,
    utilization: plain.creditLimit > 0 ? Math.round((balance / plain.creditLimit) * 1000) / 1000 : null,
    /** Progress since the debt was taken out, when the original figure is known. */
    paidOffFraction:
      plain.principal > 0 ? Math.max(0, Math.min(1, 1 - balance / plain.principal)) : null,
    nextDueDay: active
      ? nextDueDay(
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
        )
      : null,
  };
}

// ── List ────────────────────────────────────────────────────────────────────

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    // Catch up before reading, so the list and the expenses it implies are
    // consistent the moment the page loads.
    await runDebtCharges(req.user!.id, clientDay(req));

    const today = clientDay(req) ?? toDayKey(new Date());
    const debts = await Debt.find({ userId: req.user!.id }).sort({ status: 1, createdAt: -1 });
    res.json(debts.map(debt => withDerived(debt, today)));
  } catch (err) {
    console.error('[debts] list failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Create ──────────────────────────────────────────────────────────────────

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const body = { ...req.body, openingBalance: Number(req.body.openingBalance), emiAmount: Number(req.body.emiAmount) };
    const error = validateBody(body);
    if (error) {
      res.status(400).json({ error });
      return;
    }

    const today = clientDay(req) ?? toDayKey(new Date());
    const balanceAsOf = clampAnchor(body.balanceAsOf, today);

    const debt = new Debt({
      userId: req.user!.id,
      name: String(body.name).trim(),
      lender: typeof body.lender === 'string' ? body.lender.trim() : '',
      category: body.category,
      kind: body.kind ?? 'amortizing',
      principal: Number(body.principal) || 0,
      openingBalance: Number(body.openingBalance),
      balanceAsOf,
      annualRate: Number(body.annualRate) || 0,
      emiAmount: Number(body.emiAmount),
      frequency: body.frequency,
      ...normalizeDueDate(String(body.frequency), body.dueDayOfWeek, body.dueDayOfMonth, body.dueMonth),
      termMonths: body.termMonths != null ? Number(body.termMonths) : null,
      minimumFraction: body.minimumFraction != null ? Number(body.minimumFraction) : null,
      minimumFloor: body.minimumFloor != null ? Number(body.minimumFloor) : null,
      creditLimit: body.creditLimit != null ? Number(body.creditLimit) : null,
      autoRecord: body.autoRecord !== false,
      paymentMode: PAYMENT_MODES.includes(String(body.paymentMode)) ? body.paymentMode : 'Bank Transfer',
      // Instalments begin at the anchor: a balance stated as of last month's
      // statement implies the instalments since then were paid, and they are
      // what the person expects to see in their history.
      startDay: isDayKey(body.startDay) ? clampAnchor(body.startDay, today) : balanceAsOf,
      notes: typeof body.notes === 'string' ? body.notes.trim() : '',
    });

    const saved = await debt.save();
    await runDebtCharges(req.user!.id, clientDay(req));

    const fresh = await Debt.findById(saved._id);
    res.status(201).json(withDerived(fresh ?? saved, today));
  } catch (err) {
    console.error('[debts] create failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Update ──────────────────────────────────────────────────────────────────

router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const body = { ...req.body, openingBalance: Number(req.body.openingBalance), emiAmount: Number(req.body.emiAmount) };
    const error = validateBody(body);
    if (error) {
      res.status(400).json({ error });
      return;
    }

    const existing = await Debt.findOne({ _id: req.params.id, userId: req.user!.id });
    if (!existing) {
      res.status(404).json({ error: 'Debt not found' });
      return;
    }

    const today = clientDay(req) ?? toDayKey(new Date());

    // Everything except the schedule applies at once. A corrected balance, a
    // rate change or a rename is a statement about the debt, not about when it
    // bills, and staging those would mean a typo took a month to fix.
    existing.set('name', String(body.name).trim());
    existing.set('lender', typeof body.lender === 'string' ? body.lender.trim() : '');
    existing.set('category', body.category);
    if (body.kind) existing.set('kind', body.kind);
    existing.set('principal', Number(body.principal) || 0);
    existing.set('openingBalance', Number(body.openingBalance));
    existing.set('balanceAsOf', clampAnchor(body.balanceAsOf, today));
    existing.set('emiAmount', Number(body.emiAmount));
    if (body.termMonths !== undefined) existing.set('termMonths', body.termMonths != null ? Number(body.termMonths) : null);
    if (body.minimumFraction !== undefined) existing.set('minimumFraction', body.minimumFraction != null ? Number(body.minimumFraction) : null);
    if (body.minimumFloor !== undefined) existing.set('minimumFloor', body.minimumFloor != null ? Number(body.minimumFloor) : null);
    if (body.creditLimit !== undefined) existing.set('creditLimit', body.creditLimit != null ? Number(body.creditLimit) : null);
    if (body.autoRecord !== undefined) existing.set('autoRecord', body.autoRecord !== false);
    if (PAYMENT_MODES.includes(String(body.paymentMode))) existing.set('paymentMode', body.paymentMode);
    if (typeof body.notes === 'string') existing.set('notes', body.notes.trim());

    // A rate change is recorded as an event rather than overwriting the field,
    // so a projection made last year stays explicable and the replay charges
    // the old rate for the months it actually applied to.
    const newRate = Number(body.annualRate) || 0;
    if (Number.isFinite(newRate) && newRate !== Number(existing.get('annualRate'))) {
      const effectiveFrom = isDayKey(body.rateEffectiveFrom) ? body.rateEffectiveFrom : today;
      existing.get('rateChanges').push({ effectiveFrom, annualRate: newRate, note: '' });
      existing.set('annualRate', newRate);
    }

    const requested: Schedule & { frequency: Frequency } = {
      frequency: body.frequency,
      ...normalizeDueDate(String(body.frequency), body.dueDayOfWeek, body.dueDayOfMonth, body.dueMonth),
    } as Schedule & { frequency: Frequency };

    const current: Schedule = {
      frequency: existing.get('frequency'),
      dueDayOfWeek: existing.get('dueDayOfWeek'),
      dueDayOfMonth: existing.get('dueDayOfMonth'),
      dueMonth: existing.get('dueMonth'),
    };

    if (scheduleChanged(current, requested)) {
      if (!isDayKey(existing.get('lastChargedDay'))) {
        // Nothing billed yet, so there is no cycle in progress to protect —
        // this is still someone correcting what they just typed.
        existing.set('frequency', requested.frequency);
        existing.set('dueDayOfWeek', requested.dueDayOfWeek ?? null);
        existing.set('dueDayOfMonth', requested.dueDayOfMonth ?? null);
        existing.set('dueMonth', requested.dueMonth ?? null);
        existing.set('pendingSchedule', null);
        existing.set('pendingEffectiveFrom', null);
      } else {
        // This cycle has already been billed on the old date; moving it now
        // would either double-charge or silently skip a cycle.
        existing.set('pendingSchedule', requested);
        existing.set('pendingEffectiveFrom', nextCycleStart(requested.frequency, today));
      }
    } else {
      existing.set('pendingSchedule', null);
      existing.set('pendingEffectiveFrom', null);
    }

    await existing.save();
    await runDebtCharges(req.user!.id, clientDay(req));

    const fresh = await Debt.findById(existing._id);
    res.json(withDerived(fresh ?? existing, today));
  } catch (err) {
    console.error('[debts] update failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Part payments ───────────────────────────────────────────────────────────

/**
 * Records a part-payment.
 *
 * The requirement in the user's own words: *"if I decide to part pay a debt in
 * future it should not mess up the previous."* This endpoint is the whole
 * answer, and it is an insert. Nothing stored is rewritten — not the balance,
 * not the schedule, not a single past figure. The next read replays the events
 * in date order and the numbers come out right, whether the payment is dated
 * next March or last April.
 */
router.post('/:id/prepayments', async (req: AuthRequest, res: Response) => {
  try {
    const { day, amount, effect, note } = req.body;
    const today = clientDay(req) ?? toDayKey(new Date());

    if (!isDayKey(day)) {
      res.status(400).json({ error: 'Date must be YYYY-MM-DD' });
      return;
    }
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      res.status(400).json({ error: 'Amount must be a positive number' });
      return;
    }
    if (effect !== undefined && !PREPAYMENT_EFFECTS.includes(effect)) {
      res.status(400).json({ error: 'Effect must be reduce-tenure or reduce-emi' });
      return;
    }

    const debt = await Debt.findOne({ _id: req.params.id, userId: req.user!.id });
    if (!debt) {
      res.status(404).json({ error: 'Debt not found' });
      return;
    }

    if (day < String(debt.get('balanceAsOf'))) {
      // Before the anchor the payment is already inside `openingBalance` —
      // adding it would deduct the same money twice.
      res.status(400).json({
        error: `That is before this debt's balance date (${debt.get('balanceAsOf')}), so it is already reflected in the outstanding figure.`,
      });
      return;
    }

    debt.get('prepayments').push({
      day,
      amount: value,
      effect: effect ?? 'reduce-tenure',
      note: typeof note === 'string' ? note.trim() : '',
      recorded: false,
    });

    await debt.save();
    // Posts the expense straight away when the payment is in the past; a
    // future-dated one is left to the catch-up run on the day it arrives.
    await runDebtCharges(req.user!.id, clientDay(req));

    const fresh = await Debt.findById(debt._id);
    res.status(201).json(withDerived(fresh ?? debt, today));
  } catch (err) {
    console.error('[debts] prepayment failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Removes a part-payment — a correction, not an unwinding.
 *
 * The expense it posted goes with it: it was written by the app to mirror the
 * event, so leaving it behind would leave spending nobody can trace to
 * anything. A part-payment the person entered by mistake is money that never
 * moved.
 */
router.delete('/:id/prepayments/:prepaymentId', async (req: AuthRequest, res: Response) => {
  try {
    const debt = await Debt.findOne({ _id: req.params.id, userId: req.user!.id });
    if (!debt) {
      res.status(404).json({ error: 'Debt not found' });
      return;
    }

    const prepaymentId = String(req.params.prepaymentId ?? '');
    const existing = debt.get('prepayments').id(prepaymentId);
    if (!existing) {
      res.status(404).json({ error: 'Part payment not found' });
      return;
    }

    await Expense.deleteOne({
      userId: req.user!.id,
      debtPrepaymentId: existing._id,
    });

    existing.deleteOne();
    await debt.save();

    res.json(withDerived(debt, clientDay(req) ?? toDayKey(new Date())));
  } catch (err) {
    console.error('[debts] prepayment delete failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── What-if ─────────────────────────────────────────────────────────────────

/**
 * What a part-payment *would* do, without recording anything.
 *
 * The figure that makes the decision — "₹200,000 now removes ₹740,000 of
 * interest and fourteen months" — is not one anybody arrives at by intuition,
 * and getting it before committing is the difference between a feature and a
 * form.
 */
router.post('/:id/simulate', async (req: AuthRequest, res: Response) => {
  try {
    const debt = await Debt.findOne({ _id: req.params.id, userId: req.user!.id }).lean();
    if (!debt) {
      res.status(404).json({ error: 'Debt not found' });
      return;
    }

    const today = clientDay(req) ?? toDayKey(new Date());
    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ error: 'Amount must be a positive number' });
      return;
    }

    const day = isDayKey(req.body?.day) ? req.body.day : today;
    const effect = PREPAYMENT_EFFECTS.includes(req.body?.effect) ? req.body.effect : 'reduce-tenure';

    const terms = termsOf(debt as Record<string, any>);
    const balance = balanceOn(terms, today);
    const forward: DebtTerms = { ...terms, openingBalance: balance, balanceAsOf: today };

    res.json({
      balance,
      ...prepaymentImpact(forward, { day, amount, effect }),
      // Both are useful and people conflate them: extra money once, versus a
      // permanently larger instalment. The second is usually the better deal
      // and almost nobody models it.
      ifInstalmentRose: (() => {
        const raised = amortize({ ...forward, instalment: forward.instalment + amount });
        const base = amortize(forward);
        return {
          extraPerPeriod: amount,
          payoffDay: raised.payoffDay,
          interestRemaining: raised.interestRemaining,
          interestSaved: Math.round((base.interestRemaining - raised.interestRemaining) * 100) / 100,
          periodsSaved: base.periodsRemaining - raised.periodsRemaining,
        };
      })(),
    });
  } catch (err) {
    console.error('[debts] simulate failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/** The full remaining amortization schedule, for the detail view. */
router.get('/:id/schedule', async (req: AuthRequest, res: Response) => {
  try {
    const debt = await Debt.findOne({ _id: req.params.id, userId: req.user!.id }).lean();
    if (!debt) {
      res.status(404).json({ error: 'Debt not found' });
      return;
    }

    const today = clientDay(req) ?? toDayKey(new Date());
    const terms = termsOf(debt as Record<string, any>);
    const balance = balanceOn(terms, today);
    const projection = amortize({ ...terms, openingBalance: balance, balanceAsOf: today });

    res.json({
      balance,
      ...projection,
      // A fifty-year daily schedule is 18,000 rows nobody will read and a
      // response nobody wants to parse.
      schedule: projection.schedule.slice(0, 480),
      scheduleTruncated: projection.schedule.length > 480,
    });
  } catch (err) {
    console.error('[debts] schedule failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Lifecycle ───────────────────────────────────────────────────────────────

/** Marks a debt cleared. Stops projecting and stops charging; keeps the history. */
router.post('/:id/close', async (req: AuthRequest, res: Response) => {
  try {
    const today = clientDay(req) ?? toDayKey(new Date());
    const updated = await Debt.findOneAndUpdate(
      { _id: req.params.id, userId: req.user!.id },
      { status: 'closed', closedOn: isDayKey(req.body?.on) ? req.body.on : today },
      { new: true }
    );
    if (!updated) {
      res.status(404).json({ error: 'Debt not found' });
      return;
    }
    res.json(withDerived(updated, today));
  } catch (err) {
    console.error('[debts] close failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/reopen', async (req: AuthRequest, res: Response) => {
  try {
    const today = clientDay(req) ?? toDayKey(new Date());
    const updated = await Debt.findOneAndUpdate(
      { _id: req.params.id, userId: req.user!.id },
      { status: 'active', closedOn: null },
      { new: true }
    );
    if (!updated) {
      res.status(404).json({ error: 'Debt not found' });
      return;
    }
    res.json(withDerived(updated, today));
  } catch (err) {
    console.error('[debts] reopen failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id/pending-schedule', async (req: AuthRequest, res: Response) => {
  try {
    const updated = await Debt.findOneAndUpdate(
      { _id: req.params.id, userId: req.user!.id },
      { pendingSchedule: null, pendingEffectiveFrom: null },
      { new: true }
    );
    if (!updated) {
      res.status(404).json({ error: 'Debt not found' });
      return;
    }
    res.json(withDerived(updated, clientDay(req) ?? toDayKey(new Date())));
  } catch (err) {
    console.error('[debts] pending-schedule delete failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Deletes a debt outright.
 *
 * The instalments it posted stay in the spending history — that money genuinely
 * left the account, and deleting the debt is a statement about the future.
 * Deleting a debt to tidy up should not silently reduce last year's spending by
 * half a million.
 */
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const deleted = await Debt.findOneAndDelete({ _id: req.params.id, userId: req.user!.id });
    if (!deleted) {
      res.status(404).json({ error: 'Debt not found' });
      return;
    }
    res.json({ message: 'Debt deleted successfully' });
  } catch (err) {
    console.error('[debts] delete failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
