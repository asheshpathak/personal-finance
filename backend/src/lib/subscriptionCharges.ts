import mongoose from 'mongoose';
import Expense from '../models/Expense';
import Subscription from '../models/Subscription';
import {
  addDaysKey,
  dueDaysThrough,
  fromDayKey,
  isDayKey,
  toDayKey,
  type SubscriptionSchedule,
} from './schedule';

/**
 * Posts subscription charges that have come due.
 *
 * There is no scheduler in this deployment, so catch-up is done lazily: any
 * read that would show subscription money runs this first. That is strictly
 * better than a cron for a personal app — it cannot drift, cannot double-fire
 * across restarts, and a subscription is charged the first time the owner looks
 * at the app on or after its due date rather than depending on a worker being
 * alive at midnight.
 *
 * Correctness rests on two things:
 *
 *  1. `lastChargedDay` advances only over days that were actually written, so a
 *     run is resumable;
 *  2. a unique index on (userId, subscriptionId, billingDay) makes a duplicate
 *     physically impossible even if two requests race.
 */

/** The category auto-posted charges are filed under, matching budget matching. */
const SUBSCRIPTION_CATEGORY = 'Subscriptions';

export interface ChargeResult {
  /** Expenses actually written by this run. */
  created: number;
  /** Subscriptions whose staged due-date change became live. */
  promoted: number;
}

/**
 * The day to bill through: the client's own calendar day when it looks sane,
 * otherwise the server's. Clamped to ±1 day so a wrong or hostile value can
 * only ever move a user's own charge by one day.
 */
function resolveToday(clientDay?: string): string {
  const serverDay = toDayKey(new Date());
  if (!isDayKey(clientDay)) return serverDay;
  const lower = addDaysKey(serverDay, -1);
  const upper = addDaysKey(serverDay, 1);
  if (clientDay < lower || clientDay > upper) return serverDay;
  return clientDay;
}

/** Duplicate-key: another request won the race and already posted this day. */
const isDuplicateKey = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;

/**
 * The expense document for one occurrence.
 *
 * `date` is stored at 12:00 UTC — the hour that survives the widest band of
 * offsets intact. It is not universal: offsets of +12 and beyond (Auckland,
 * Fiji) read 12:00 UTC as the following calendar day. `billingDay` is the
 * authoritative record of which occurrence this is, and readers that care about
 * the exact day use it in preference to re-deriving one from the timestamp.
 */
function chargeDocument(
  sub: {
    _id: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    name: string;
    amount: number;
    paymentMode?: string | null;
  },
  billingDay: string
) {
  const at = fromDayKey(billingDay);
  at.setUTCHours(12, 0, 0, 0);

  return {
    userId: sub.userId,
    amount: sub.amount,
    category: SUBSCRIPTION_CATEGORY,
    paymentMode: sub.paymentMode || 'Bank Transfer',
    // Budget matching pairs a subscription line to its spending on the
    // description, so this has to be exactly the subscription's name.
    description: sub.name,
    date: at,
    source: 'subscription' as const,
    subscriptionId: sub._id,
    billingDay,
  };
}

/**
 * Brings one user's subscriptions up to date.
 *
 * Safe to call on every request: with nothing due it does one indexed read and
 * no writes.
 */
export async function runSubscriptionCharges(
  userId: string,
  /**
   * The calendar day where the *user* is, as `YYYY-MM-DD`.
   *
   * Without it the server bills on its own UTC day, which for anyone in the
   * Americas flips hours before their local midnight — so an evening in Los
   * Angeles posts tomorrow's charge and the dashboard's "Today" filter shows a
   * future-dated expense. The client sends its own day; it is clamped to ±1 day
   * of the server's, so the worst a bad value can do is shift someone's own
   * charge by a day.
   */
  clientDay?: string
): Promise<ChargeResult> {
  const today = resolveToday(clientDay);
  const result: ChargeResult = { created: 0, promoted: 0 };

  const subscriptions = await Subscription.find({ userId });

  for (const sub of subscriptions) {
    try {
      // A subscription saved before this feature existed has no start day.
      // Anchor it at creation so it begins billing from when it was added,
      // rather than being skipped forever or back-filling from 1970.
      if (!isDayKey(sub.get('startDay'))) {
        const createdAt = (sub.get('createdAt') as Date | undefined) ?? new Date();
        sub.set('startDay', toDayKey(createdAt));
      }

      if (sub.get('autoRecord') === false) {
        // Paused means *skipped*, not deferred.
        //
        // Leaving `lastChargedDay` where it was would make the pause a debt:
        // switch automatic recording back on after six months away and the next
        // read posts six back-dated charges into budgets that closed long ago.
        // Advancing the marker over the paused span is what makes resuming
        // start from today rather than from where you left off.
        const paused: SubscriptionSchedule = readSchedule(sub);
        const skipped = dueDaysThrough(paused, today).days;
        const lastSkipped = skipped[skipped.length - 1];
        if (lastSkipped) sub.set('lastChargedDay', lastSkipped);

        // Still promote a staged change, so the displayed schedule stays honest
        // even while automatic posting is paused.
        if (await promotePendingIfDue(sub, today)) result.promoted += 1;
        if (sub.isModified()) await sub.save();
        continue;
      }

      const { days } = dueDaysThrough(readSchedule(sub), today);

      for (const billingDay of days) {
        try {
          await Expense.create(
            chargeDocument(
              {
                _id: sub._id as mongoose.Types.ObjectId,
                userId: sub.get('userId'),
                name: sub.get('name'),
                amount: sub.get('amount'),
                paymentMode: sub.get('paymentMode'),
              },
              billingDay
            )
          );
          result.created += 1;
        } catch (err) {
          // Already posted — by an earlier run, or by a request that raced this
          // one. Either way the day is covered, so keep advancing.
          if (!isDuplicateKey(err)) throw err;
        }
        // Advanced only after the day is known to be covered, so an error
        // partway through leaves the remaining days to be picked up next time.
        sub.set('lastChargedDay', billingDay);
      }

      if (await promotePendingIfDue(sub, today)) result.promoted += 1;
      if (sub.isModified()) await sub.save();
    } catch (err) {
      // One broken subscription must not stop the others from billing.
      console.error(`[subscriptions] charge run failed for ${String(sub._id)}:`, err);
    }
  }

  return result;
}

/** The schedule fields a charge walk needs, read off a subscription document. */
function readSchedule(sub: mongoose.Document): SubscriptionSchedule {
  return {
    frequency: sub.get('frequency'),
    dueDayOfWeek: sub.get('dueDayOfWeek'),
    dueDayOfMonth: sub.get('dueDayOfMonth'),
    dueMonth: sub.get('dueMonth'),
    startDay: sub.get('startDay'),
    lastChargedDay: sub.get('lastChargedDay'),
    pendingSchedule: sub.get('pendingSchedule'),
    pendingEffectiveFrom: sub.get('pendingEffectiveFrom'),
  };
}

/**
 * Makes a staged due-date change live once its effective date has passed.
 *
 * Kept separate from the charge walk because it must also happen for paused
 * subscriptions — otherwise a change staged while auto-record was off would sit
 * pending forever.
 */
async function promotePendingIfDue(
  sub: mongoose.Document,
  today: string
): Promise<boolean> {
  const pending = sub.get('pendingSchedule');
  const effectiveFrom = sub.get('pendingEffectiveFrom');
  if (!pending || !isDayKey(effectiveFrom) || effectiveFrom > today) return false;

  sub.set('frequency', pending.frequency);
  sub.set('dueDayOfWeek', pending.dueDayOfWeek ?? null);
  sub.set('dueDayOfMonth', pending.dueDayOfMonth ?? null);
  sub.set('dueMonth', pending.dueMonth ?? null);
  sub.set('pendingSchedule', null);
  sub.set('pendingEffectiveFrom', null);
  return true;
}
