import express, { Response } from 'express';
import { authenticateToken, clientDay, AuthRequest } from '../middleware/auth';
import Expense from '../models/Expense';
import { runSubscriptionCharges } from '../lib/subscriptionCharges';
import { runDebtCharges } from '../lib/debtCharges';

const router = express.Router();

router.use(authenticateToken);

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    // Subscriptions that have come due post themselves before the list is read,
    // so a recurring charge appears on its due date without anyone recording
    // it. Cheap when nothing is due: one indexed read, no writes.
    // Debt instalments post themselves the same way, for the same reason: an
    // EMI that only appears once someone visits the debts page is an EMI
    // missing from the spending total on every other page.
    await Promise.all([
      runSubscriptionCharges(req.user!.id, clientDay(req)).catch(err => {
        // Never fail the expense list over this — showing the expenses that do
        // exist beats a 500.
        console.error('[expenses] subscription catch-up failed:', err);
      }),
      runDebtCharges(req.user!.id, clientDay(req)).catch(err => {
        console.error('[expenses] debt catch-up failed:', err);
      }),
    ]);

    // date is the expense day (often stored at local noon, so same-day entries
    // tie); createdAt breaks the tie by when it was actually recorded.
    const expenses = await Expense.find({ userId: req.user!.id }).sort({ date: -1, createdAt: -1 });
    res.json(expenses);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { amount, category, paymentMode, date, description } = req.body;
    const expense = new Expense({
      userId: req.user!.id,
      amount,
      category,
      paymentMode,
      date,
      description,
      // Anything arriving through the API is something a person entered. The
      // fields that mark an auto-posted charge are set only by the charger, so
      // a client cannot forge one and break the idempotency index.
      source: 'manual',
    });
    const savedExpense = await expense.save();
    res.status(201).json(savedExpense);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const expense = await Expense.findOneAndDelete({ _id: req.params.id, userId: req.user!.id });
    if (!expense) {
      res.status(404).json({ error: 'Expense not found' });
      return;
    }
    res.json({ message: 'Expense deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { amount, category, paymentMode, date, description } = req.body;
    // Provenance is not editable: an auto-posted charge stays linked to its
    // subscription even after the amount is corrected, so the idempotency key
    // survives and the day is never re-posted.
    const updatedExpense = await Expense.findOneAndUpdate(
      { _id: req.params.id, userId: req.user!.id },
      { amount, category, paymentMode, date, description },
      { new: true }
    );
    if (!updatedExpense) {
      res.status(404).json({ error: 'Expense not found' });
      return;
    }
    res.json(updatedExpense);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
