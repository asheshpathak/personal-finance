import express, { Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import Budget from '../models/Budget';

const router = express.Router();

router.use(authenticateToken);

const FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'];

type Allocation = { name: string; allocatedAmount: number };

/** Drops half-filled rows the form leaves behind and coerces amounts to numbers. */
function normalizeAllocations(input: unknown): Allocation[] {
  if (!Array.isArray(input)) return [];
  return input
    .map(item => ({
      name: typeof item?.name === 'string' ? item.name.trim() : '',
      allocatedAmount: Number(item?.allocatedAmount) || 0,
    }))
    .filter(item => item.name !== '');
}

function normalizeSubscriptions(input: unknown) {
  if (!Array.isArray(input)) return [];
  return input
    .map(item => ({
      subscriptionId: item?.subscriptionId || null,
      name: typeof item?.name === 'string' ? item.name.trim() : '',
      amount: Number(item?.amount) || 0,
      frequency: item?.frequency,
    }))
    .filter(item => item.name !== '' && FREQUENCIES.includes(item.frequency));
}

/**
 * Builds the writable fields from a request body. Section keys absent from the
 * body are left out entirely rather than normalized to `[]`, so a partial
 * update (e.g. "set as active") can't silently wipe a section it never sent.
 */
function buildUpdate(body: Record<string, unknown>) {
  const update: Record<string, unknown> = {
    startDate: body.startDate,
    endDate: body.endDate,
    isActive: body.isActive,
  };
  if ('income' in body) update.income = Number(body.income) || 0;
  if ('categories' in body) update.categories = normalizeAllocations(body.categories);
  if ('investments' in body) update.investments = normalizeAllocations(body.investments);
  if ('savings' in body) update.savings = normalizeAllocations(body.savings);
  if ('subscriptions' in body) update.subscriptions = normalizeSubscriptions(body.subscriptions);
  return update;
}

// Get all budgets for the user
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const budgets = await Budget.find({ userId: req.user!.id }).sort({ createdAt: -1 });
    res.json(budgets);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Create a new budget
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { startDate, endDate, isActive } = req.body;

    // If setting to active, deactivate all other budgets
    if (isActive) {
      await Budget.updateMany({ userId: req.user!.id }, { isActive: false });
    }

    const budget = new Budget({
      userId: req.user!.id,
      startDate,
      endDate,
      isActive: isActive || false,
      income: Number(req.body.income) || 0,
      categories: normalizeAllocations(req.body.categories),
      investments: normalizeAllocations(req.body.investments),
      savings: normalizeAllocations(req.body.savings),
      subscriptions: normalizeSubscriptions(req.body.subscriptions),
    });

    const savedBudget = await budget.save();
    res.status(201).json(savedBudget);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Update a budget
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    // If setting to active, deactivate all other budgets
    if (req.body.isActive) {
      await Budget.updateMany({ userId: req.user!.id, _id: { $ne: req.params.id } }, { isActive: false });
    }

    const updatedBudget = await Budget.findOneAndUpdate(
      { _id: req.params.id, userId: req.user!.id },
      buildUpdate(req.body),
      { new: true }
    );

    if (!updatedBudget) {
      res.status(404).json({ error: 'Budget not found' });
      return;
    }

    res.json(updatedBudget);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete a budget
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const budget = await Budget.findOneAndDelete({ _id: req.params.id, userId: req.user!.id });
    if (!budget) {
      res.status(404).json({ error: 'Budget not found' });
      return;
    }
    res.json({ message: 'Budget deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
