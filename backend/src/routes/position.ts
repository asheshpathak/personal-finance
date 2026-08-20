import express, { Response } from 'express';
import { authenticateToken, clientDay, AuthRequest } from '../middleware/auth';
import { toDayKey, isDayKey } from '../lib/schedule';
import { loadPosition } from '../lib/loadPosition';
import { assessAffordability } from '../lib/affordability';
import { draftBudget } from '../lib/budgetPlanner';
import { runSubscriptionCharges } from '../lib/subscriptionCharges';
import { runDebtCharges } from '../lib/debtCharges';

/**
 * The whole financial picture, in one call.
 *
 * Income, debts, subscriptions, balances and spending habits are individually
 * uninteresting; the figures people care about — what is genuinely left over,
 * how long the savings would last, whether a purchase works — only exist when
 * all five are in the same place. Computing them here rather than on the client
 * means the assistant and the screen quote the same number by construction.
 */

const router = express.Router();

router.use(authenticateToken);

/** Brings scheduled charges up to date before anything is measured. */
async function catchUp(req: AuthRequest): Promise<void> {
  const day = clientDay(req);
  await Promise.all([
    runSubscriptionCharges(req.user!.id, day).catch(err =>
      console.error('[position] subscription catch-up failed:', err)
    ),
    runDebtCharges(req.user!.id, day).catch(err =>
      console.error('[position] debt catch-up failed:', err)
    ),
  ]);
}

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    await catchUp(req);
    const today = clientDay(req) ?? toDayKey(new Date());
    res.json(await loadPosition(req.user!.id, today));
  } catch (err) {
    console.error('[position] failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * "Can I afford this?"
 *
 * Deterministic — no model involved. The assistant calls the same code through
 * a tool, so a conversational answer and the one on the screen cannot disagree.
 */
router.post('/affordability', async (req: AuthRequest, res: Response) => {
  try {
    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      res.status(400).json({ error: 'Amount must be a number' });
      return;
    }

    await catchUp(req);
    const today = clientDay(req) ?? toDayKey(new Date());
    const position = await loadPosition(req.user!.id, today);

    res.json(
      assessAffordability(position, {
        label: typeof req.body?.label === 'string' ? req.body.label.slice(0, 80) : 'this',
        amount,
        when: isDayKey(req.body?.when) ? req.body.when : today,
        financing: req.body?.financing === 'emi' ? 'emi' : 'cash',
        emiMonths: req.body?.emiMonths != null ? Number(req.body.emiMonths) : undefined,
        emiRate: req.body?.emiRate != null ? Number(req.body.emiRate) : undefined,
        recurringMonthly: req.body?.recurringMonthly != null ? Number(req.body.recurringMonthly) : undefined,
        bufferMonths: req.body?.bufferMonths != null ? Number(req.body.bufferMonths) : undefined,
        useEarmarked: req.body?.useEarmarked !== false,
      })
    );
  } catch (err) {
    console.error('[position] affordability failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * A complete first draft of a budget for a period, derived from everything on
 * record. Nothing is saved — this is the starting point a person then argues
 * with, on the budget page or in a conversation.
 */
router.post('/budget-draft', async (req: AuthRequest, res: Response) => {
  try {
    await catchUp(req);
    const today = clientDay(req) ?? toDayKey(new Date());
    const position = await loadPosition(req.user!.id, today);

    const startDate = isDayKey(req.body?.startDate) ? req.body.startDate : monthStart(today);
    const endDate = isDayKey(req.body?.endDate) ? req.body.endDate : monthEnd(today);

    res.json(
      draftBudget(position, { startDate, endDate }, {
        savingsTarget: req.body?.savingsTarget != null ? Number(req.body.savingsTarget) : undefined,
        conservative: req.body?.conservative === true,
        exclude: Array.isArray(req.body?.exclude)
          ? (req.body.exclude as unknown[]).filter((c): c is string => typeof c === 'string')
          : undefined,
      })
    );
  } catch (err) {
    console.error('[position] budget-draft failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

const monthStart = (day: string) => `${day.slice(0, 7)}-01`;

const monthEnd = (day: string): string => {
  const [y = 0, m = 1] = day.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${day.slice(0, 7)}-${String(last).padStart(2, '0')}`;
};

export default router;
