import mongoose from 'mongoose';
import Expense from '../models/Expense';
import Debt from '../models/Debt';
import {
  addDaysKey,
  dueDaysThrough,
  fromDayKey,
  isDayKey,
  toDayKey,
  type SubscriptionSchedule,
} from './schedule';

/**
 * Posts debt instalments and part-payments that have come due.
 *
 * Deliberately the same shape as `subscriptionCharges`: lazy catch-up on read,
 * idempotency enforced by a unique index rather than by careful code, and
 * `lastChargedDay` advanced only over days that were actually written. The
 * reasoning is identical and repeating it here would be repeating it twice —
 * see that file.
 *
 * What is different is what an instalment *means*. A subscription charge is
 * money spent. A debt instalment is money spent too, but part of it is interest
 * and part of it retires principal, and only the interest is a cost in any
 * meaningful sense. The expense recorded here is the full instalment, because
 * that is what leaves the account and a spending total that quietly omitted
 * ₹40,000 of EMI would be useless. The split is available wherever the debt is
 * shown, derived from the schedule rather than stored on the expense.
 */

/** The category debt payments are filed under. Matches the expense picker. */
const DEBT_CATEGORY = 'Debt Payments';

export interface DebtChargeResult {
  created: number;
  prepaymentsRecorded: number;
  promoted: number;
  closed: number;
}

function resolveToday(clientDay?: string): string {
  const serverDay = toDayKey(new Date());
  if (!isDayKey(clientDay)) return serverDay;
  const lower = addDaysKey(serverDay, -1);
  const upper = addDaysKey(serverDay, 1);
  if (clientDay < lower || clientDay > upper) return serverDay;
  return clientDay;
}

const isDuplicateKey = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;

/** Noon UTC, for the same reason expenses everywhere else are written at noon. */
function atNoon(day: string): Date {
  const at = fromDayKey(day);
  at.setUTCHours(12, 0, 0, 0);
  return at;
}

function readSchedule(debt: mongoose.Document): SubscriptionSchedule {
  return {
    frequency: debt.get('frequency'),
    dueDayOfWeek: debt.get('dueDayOfWeek'),
    dueDayOfMonth: debt.get('dueDayOfMonth'),
    dueMonth: debt.get('dueMonth'),
    startDay: debt.get('startDay'),
    lastChargedDay: debt.get('lastChargedDay'),
    pendingSchedule: debt.get('pendingSchedule'),
    pendingEffectiveFrom: debt.get('pendingEffectiveFrom'),
  };
}

async function promotePendingIfDue(debt: mongoose.Document, today: string): Promise<boolean> {
  const pending = debt.get('pendingSchedule');
  const effectiveFrom = debt.get('pendingEffectiveFrom');
  if (!pending || !isDayKey(effectiveFrom) || effectiveFrom > today) return false;

  debt.set('frequency', pending.frequency);
  debt.set('dueDayOfWeek', pending.dueDayOfWeek ?? null);
  debt.set('dueDayOfMonth', pending.dueDayOfMonth ?? null);
  debt.set('dueMonth', pending.dueMonth ?? null);
  debt.set('pendingSchedule', null);
  debt.set('pendingEffectiveFrom', null);
  return true;
}

/**
 * Writes an expense for each part-payment that has happened and is not yet in
 * the history.
 *
 * Future-dated part-payments are left alone entirely. Someone planning "I'll
 * put the March bonus against the car loan" wants to see what it would do,
 * which the projection already shows; recording it as spending today would put
 * money that has not moved into this month's totals.
 */
async function recordPrepayments(
  debt: mongoose.Document,
  today: string
): Promise<number> {
  const prepayments = debt.get('prepayments') as mongoose.Types.DocumentArray<any> | undefined;
  if (!prepayments || prepayments.length === 0) return 0;

  let written = 0;

  for (const prepayment of prepayments) {
    if (prepayment.recorded) continue;
    const day = String(prepayment.day ?? '');
    if (!isDayKey(day) || day > today) continue;

    try {
      await Expense.create({
        userId: debt.get('userId'),
        amount: Number(prepayment.amount) || 0,
        category: DEBT_CATEGORY,
        paymentMode: debt.get('paymentMode') || 'Bank Transfer',
        description: `${debt.get('name')} — part payment`,
        date: atNoon(day),
        source: 'debt',
        debtId: debt._id,
        debtPrepaymentId: prepayment._id,
        billingDay: day,
      });
      written += 1;
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
    }

    prepayment.recorded = true;
  }

  return written;
}

/**
 * Brings one user's debts up to date.
 *
 * Safe to call on every request: with nothing due it is one indexed read and no
 * writes.
 */
export async function runDebtCharges(
  userId: string,
  clientDay?: string
): Promise<DebtChargeResult> {
  const today = resolveToday(clientDay);
  const result: DebtChargeResult = { created: 0, prepaymentsRecorded: 0, promoted: 0, closed: 0 };

  const debts = await Debt.find({ userId });

  for (const debt of debts) {
    try {
      if (!isDayKey(debt.get('startDay'))) {
        // A debt entered without a start day begins billing from the day its
        // balance was stated. Anchoring at creation instead would skip an
        // instalment for anyone who backdated the balance to their last
        // statement, which is the normal way to enter an existing loan.
        const anchor = debt.get('balanceAsOf');
        debt.set('startDay', isDayKey(anchor) ? anchor : toDayKey(debt.get('createdAt') ?? new Date()));
      }

      const closed = debt.get('status') === 'closed';

      if (closed || debt.get('autoRecord') === false) {
        // Paused or closed means skipped, not deferred — advancing the marker
        // over the gap is what stops resuming from back-filling months of
        // instalments into budgets that already closed.
        const skipped = dueDaysThrough(readSchedule(debt), today).days;
        const lastSkipped = skipped[skipped.length - 1];
        if (lastSkipped) debt.set('lastChargedDay', lastSkipped);
        if (await promotePendingIfDue(debt, today)) result.promoted += 1;
        if (!closed) result.prepaymentsRecorded += await recordPrepayments(debt, today);
        if (debt.isModified()) await debt.save();
        continue;
      }

      result.prepaymentsRecorded += await recordPrepayments(debt, today);

      const { days } = dueDaysThrough(readSchedule(debt), today);

      for (const billingDay of days) {
        try {
          await Expense.create({
            userId: debt.get('userId'),
            amount: Number(debt.get('emiAmount')) || 0,
            category: DEBT_CATEGORY,
            paymentMode: debt.get('paymentMode') || 'Bank Transfer',
            // Matched by description wherever a budget line is paired to its
            // spending, so this has to be exactly the debt's name.
            description: debt.get('name'),
            date: atNoon(billingDay),
            source: 'debt',
            debtId: debt._id,
            billingDay,
          });
          result.created += 1;
        } catch (err) {
          if (!isDuplicateKey(err)) throw err;
        }
        debt.set('lastChargedDay', billingDay);
      }

      if (await promotePendingIfDue(debt, today)) result.promoted += 1;
      if (debt.isModified()) await debt.save();
    } catch (err) {
      console.error(`[debts] charge run failed for ${String(debt._id)}:`, err);
    }
  }

  return result;
}

export { DEBT_CATEGORY };
