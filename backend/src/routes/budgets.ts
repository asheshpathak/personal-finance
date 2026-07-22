import express, { Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import Budget from '../models/Budget';

const router = express.Router();

router.use(authenticateToken);

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
    const { startDate, endDate, isActive, categories } = req.body;
    
    // If setting to active, deactivate all other budgets
    if (isActive) {
      await Budget.updateMany({ userId: req.user!.id }, { isActive: false });
    }

    const budget = new Budget({
      userId: req.user!.id,
      startDate,
      endDate,
      isActive: isActive || false,
      categories: categories || [],
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
    const { startDate, endDate, isActive, categories } = req.body;

    // If setting to active, deactivate all other budgets
    if (isActive) {
      await Budget.updateMany({ userId: req.user!.id, _id: { $ne: req.params.id } }, { isActive: false });
    }

    const updatedBudget = await Budget.findOneAndUpdate(
      { _id: req.params.id, userId: req.user!.id },
      { startDate, endDate, isActive, categories },
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
