import { useEffect, useState } from 'react';
import { ArrowRight, Loader2, TrendingDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DatePicker } from '@/components/ui/date-picker';
import { useCurrency } from '@/context/CurrencyContext';
import { ApiError } from '@/lib/api';
import { formatDay, toDayKey } from '@/lib/dates';
import {
  addPrepayment,
  describeTerm,
  simulatePrepayment,
  type DebtRecord,
  type PrepaymentEffect,
  type PrepaymentSimulation,
} from '@/lib/debts';
import { cn } from '@/lib/utils';

/**
 * Recording a part payment — and, first, seeing what it would do.
 *
 * The simulation is not a nicety. "Should I put the bonus into the home loan"
 * is unanswerable from a balance and a rate in your head, and completely
 * obvious once you can see that ₹200,000 today removes ₹740,000 of interest and
 * fourteen months. Showing that before the button is pressed is most of the
 * value of modelling debt at all.
 *
 * The **tenure or instalment** choice is given the same weight as the amount,
 * because on a twenty-year loan the difference between them is frequently
 * larger than the payment itself, and the default at most lenders is whichever
 * one you did not ask for.
 */

export function PrepaymentDialog({
  debt,
  open,
  onOpenChange,
  onSaved,
}: {
  debt: DebtRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { formatRounded } = useCurrency();
  const today = toDayKey();

  const [amount, setAmount] = useState('');
  const [day, setDay] = useState(today);
  const [effect, setEffect] = useState<PrepaymentEffect>('reduce-tenure');
  const [simulation, setSimulation] = useState<PrepaymentSimulation | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setAmount('');
    setDay(today);
    setEffect('reduce-tenure');
    setSimulation(null);
    setError(null);
  }, [open, today]);

  const value = Number(amount);
  const valid = Number.isFinite(value) && value > 0;

  /**
   * Debounced so typing "200000" does not fire six projections.
   *
   * 400ms rather than the usual 250: this is a server round-trip that replays a
   * whole amortization schedule twice, and a figure that flickers through five
   * wrong values on the way to the right one is worse than one that appears a
   * beat late.
   */
  useEffect(() => {
    if (!open || !debt || !valid) {
      setSimulation(null);
      return;
    }
    let cancelled = false;
    setSimulating(true);

    const timer = window.setTimeout(() => {
      simulatePrepayment(debt._id, { amount: value, day, effect })
        .then(result => { if (!cancelled) setSimulation(result); })
        .catch(() => { if (!cancelled) setSimulation(null); })
        .finally(() => { if (!cancelled) setSimulating(false); });
    }, 400);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      setSimulating(false);
    };
  }, [open, debt, value, valid, day, effect]);

  const handleSave = async () => {
    if (!debt || !valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      await addPrepayment(debt._id, { day, amount: value, effect });
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record that payment.');
    } finally {
      setSaving(false);
    }
  };

  if (!debt) return null;

  const future = day > today;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Part payment — {debt.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 min-w-0">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="prepay-amount">Amount</Label>
              <Input
                id="prepay-amount"
                type="number"
                step="0.01"
                min="0.01"
                inputMode="decimal"
                autoFocus
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder={formatRounded(Math.round(debt.balance * 0.1)).replace(/[^\d.,]/g, '')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="prepay-day">On</Label>
              <DatePicker
                id="prepay-day"
                value={day}
                onChange={setDay}
                min={debt.balanceAsOf}
              />
            </div>
          </div>

          {future && (
            <p className="rounded-lg bg-info-tint px-3.5 py-3 text-caption text-info-text">
              Dated in the future, so this is a plan rather than a payment. It shapes the projection
              and is not recorded as spending until the day arrives.
            </p>
          )}

          {/* ── The choice that is worth more than the amount ──────────── */}
          <div className="space-y-2">
            <Label>What should the lender do with it?</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              <EffectOption
                selected={effect === 'reduce-tenure'}
                onSelect={() => setEffect('reduce-tenure')}
                title="Finish sooner"
                blurb="Instalment stays the same, the loan ends earlier. Saves far more interest."
              />
              <EffectOption
                selected={effect === 'reduce-emi'}
                onSelect={() => setEffect('reduce-emi')}
                title="Lower the instalment"
                blurb="End date stays the same, the monthly payment falls. Frees up cash now."
              />
            </div>
            <p className="text-caption text-muted-foreground">
              Most lenders pick one by default and it is usually not the one you would have chosen.
              Worth asking them explicitly.
            </p>
          </div>

          {/* ── What it would do ──────────────────────────────────────── */}
          {valid && (
            <div className="rounded-xl border border-border bg-subtle p-3.5">
              {simulating && !simulation ? (
                <p className="flex items-center gap-2 text-subhead text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Working it out…
                </p>
              ) : simulation ? (
                <div className="space-y-3 min-w-0">
                  <p className="flex items-center gap-2 text-subhead font-semibold">
                    <TrendingDown className="h-4 w-4 text-positive-text" />
                    Saves {formatRounded(simulation.interestSaved)} in interest
                  </p>

                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-footnote text-muted-foreground">
                    <span>{simulation.payoffWithout ? formatDay(simulation.payoffWithout) : 'no end date'}</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                    <span className="font-semibold text-foreground">
                      {simulation.payoffWith ? formatDay(simulation.payoffWith) : 'no end date'}
                    </span>
                    {simulation.periodsSaved > 0 && (
                      <span>— {describeTerm(simulation.periodsSaved, debt.frequency)} earlier</span>
                    )}
                  </div>

                  {effect === 'reduce-emi' && simulation.instalmentAfter < simulation.instalmentBefore && (
                    <p className="text-footnote text-muted-foreground">
                      Instalment falls from {formatRounded(simulation.instalmentBefore)} to{' '}
                      {formatRounded(simulation.instalmentAfter)} a month.
                    </p>
                  )}

                  {/*
                    The comparison almost nobody runs. The same money spread as a
                    permanently larger instalment usually beats the lump sum, and
                    seeing both is the only way anyone would know.
                  */}
                  {simulation.ifInstalmentRose.interestSaved > simulation.interestSaved && (
                    <p className="border-t border-border pt-3 text-caption text-muted-foreground">
                      For comparison: paying{' '}
                      <span className="font-semibold text-foreground">
                        {formatRounded(simulation.ifInstalmentRose.extraPerPeriod)} extra every month
                      </span>{' '}
                      instead would save {formatRounded(simulation.ifInstalmentRose.interestSaved)} —{' '}
                      {formatRounded(simulation.ifInstalmentRose.interestSaved - simulation.interestSaved)} more
                      than this lump sum.
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-subhead text-muted-foreground">
                  Couldn't project that. The payment will still record correctly.
                </p>
              )}
            </div>
          )}

          {error && <p className="text-footnote text-destructive-text" role="alert">{error}</p>}

          <Button size="block" disabled={!valid || saving} onClick={() => void handleSave()}>
            {saving ? (
              <>
                <Loader2 className="animate-spin" />
                Recording…
              </>
            ) : future ? (
              'Plan this payment'
            ) : (
              'Record this payment'
            )}
          </Button>

          <p className="text-caption text-muted-foreground">
            Nothing already recorded changes. The balance, the payoff date and every figure after
            this day are worked out again from the events in order — so a payment entered late, or
            removed later, is always simply right.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EffectOption({
  selected,
  onSelect,
  title,
  blurb,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  blurb: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'tactile rounded-xl border p-3 text-left',
        selected ? 'border-primary bg-primary-tint' : 'border-border bg-card hover:bg-subtle'
      )}
    >
      <span className="block text-subhead font-semibold">{title}</span>
      <span className="mt-0.5 block text-caption text-muted-foreground">{blurb}</span>
    </button>
  );
}
