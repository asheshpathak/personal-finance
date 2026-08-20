import express, { Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import Asset, { ASSET_KINDS, LIQUID_BY_DEFAULT, type AssetKind } from '../models/Asset';
import { isDayKey } from '../lib/schedule';

/**
 * Savings balances.
 *
 * The one thing a spending tracker structurally cannot know, and the thing
 * every "can I afford this" answer needs. See `models/Asset.ts` for why these
 * are single manually-confirmed figures rather than a ledger.
 */

const router = express.Router();

router.use(authenticateToken);

function validate(body: Record<string, unknown>): string | null {
  const { name, kind, balance, asOf } = body;
  if (!name || typeof name !== 'string' || !name.trim()) return 'Name is required';
  if (kind !== undefined && !ASSET_KINDS.includes(kind as AssetKind)) return 'Invalid account kind';
  const value = Number(balance);
  if (!Number.isFinite(value) || value < 0) return 'Balance must be a number';
  if (!isDayKey(asOf)) return 'As-of date must be YYYY-MM-DD';
  return null;
}

function writable(body: Record<string, any>) {
  const kind: AssetKind = ASSET_KINDS.includes(body.kind) ? body.kind : 'Cash & Bank';
  return {
    name: String(body.name).trim(),
    kind,
    balance: Number(body.balance),
    asOf: body.asOf,
    // Defaulted from the kind, then editable: someone's "Emergency Fund" in a
    // five-year lock-in is not liquid, and only they know that.
    liquid: typeof body.liquid === 'boolean' ? body.liquid : LIQUID_BY_DEFAULT[kind],
    ringFenced: body.ringFenced === true,
    earmarkedFor: typeof body.earmarkedFor === 'string' ? body.earmarkedFor.trim().slice(0, 80) : '',
    notes: typeof body.notes === 'string' ? body.notes.trim() : '',
  };
}

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const assets = await Asset.find({ userId: req.user!.id }).sort({ balance: -1 }).lean();

    const total = assets.reduce((sum, a) => sum + (Number(a.balance) || 0), 0);
    const liquid = assets.filter(a => a.liquid !== false).reduce((sum, a) => sum + (Number(a.balance) || 0), 0);
    const available = assets
      .filter(a => a.liquid !== false && a.ringFenced !== true)
      .reduce((sum, a) => sum + (Number(a.balance) || 0), 0);

    res.json({
      assets,
      summary: {
        total,
        liquid,
        available,
        // How stale the picture is. Surfaced rather than hidden — a six-month-old
        // balance presented as current is the failure mode of every
        // manually-maintained figure ever shipped.
        oldestAsOf: assets.length > 0 ? [...assets].map(a => String(a.asOf)).sort()[0] ?? null : null,
      },
    });
  } catch (err) {
    console.error('[assets] list failed:', err);
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
    const created = await Asset.create({ userId: req.user!.id, ...writable(req.body) });
    res.status(201).json(created);
  } catch (err) {
    console.error('[assets] create failed:', err);
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
    const updated = await Asset.findOneAndUpdate(
      { _id: req.params.id, userId: req.user!.id },
      writable(req.body),
      { new: true }
    );
    if (!updated) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }
    res.json(updated);
  } catch (err) {
    console.error('[assets] update failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const deleted = await Asset.findOneAndDelete({ _id: req.params.id, userId: req.user!.id });
    if (!deleted) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }
    res.json({ message: 'Account deleted successfully' });
  } catch (err) {
    console.error('[assets] delete failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
