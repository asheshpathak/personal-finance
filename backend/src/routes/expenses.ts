import express, { Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import Expense from '../models/Expense';

const router = express.Router();

router.use(authenticateToken);

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
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
