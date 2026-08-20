import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CircleHelp,
  Info,
  Loader2,
  Lock,
  Scale,
  TriangleAlert,
} from 'lucide-react';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { PageHeader } from '@/components/ui/section';
import { Stat, StatRow } from '@/components/ui/stat';
import { useCurrency } from '@/context/CurrencyContext';
import { ApiError } from '@/lib/api';
import { formatDay } from '@/lib/dates';
import {
  VERDICT_LABEL,
  VERDICT_TONE,
  checkAffordability,
  type AffordabilityAnswer,
} from '@/lib/position';
import { cn } from '@/lib/utils';

/**
 * Can I afford this?
 *
 * The question people actually open a money app to ask, and the one a spending
 * tracker has never been able to answer — because it only knows what left, not
 * what is there or what is owed. With income, debts and balances recorded it
 * becomes arithmetic, and the arithmetic is worth doing carefully: the naive
 * version ("is the money in your account") gives a confident yes to someone who
 * would then be clearing it off a 42% credit card for a year.
 *
 * **No model is involved.** The verdict is computed by the same code the
 * assistant reaches through a tool, so a conversational answer and this page can
 * never disagree. That also means it works on a deployment with no API key at
 * all.
 *
 * The layout puts the reasoning under the verdict rather than beside it,
 * because the point is not the verdict. Somebody who disagrees with a premise —
 * "I don't need six months of buffer" — should be able to see which premise it
 * was and change it.
 */

const VERDICT_ICON = {
  comfortable: Check,
  tight: Scale,
  stretch: TriangleAlert,
  no: AlertTriangle,
} as const;

const VERDICT_CLASS = {
  positive: 'bg-positive-tint text-positive-text',
  warning: 'bg-warning-tint text-warning-text',
  negative: 'bg-destructive-tint text-destructive-text',
} as const;

const EXAMPLES = [
  { label: 'A trip', amount: '' },
  { label: 'A new phone', amount: '' },
  { label: 'A car', amount: '' },
];

export default function Afford() {
  const { formatRounded, formatMoney } = useCurrency();

  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [financing, setFinancing] = useState<'cash' | 'emi'>('cash');
  const [emiMonths, setEmiMonths] = useState('12');
  const [emiRate, setEmiRate] = useState('0');
  const [recurring, setRecurring] = useState('');
  const [bufferMonths, setBufferMonths] = useState('');
  const [useEarmarked, setUseEarmarked] = useState(true);

  const [answer, setAnswer] = useState<AffordabilityAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = Number(amount);
  const monthly = Number(recurring);
  // Something with no purchase price but an ongoing cost — hiring someone, a
  // rent rise, a new subscription — is a real question, and it was the one the
  // first version of this could not answer.
  const askable = (Number.isFinite(value) && value > 0) || (Number.isFinite(monthly) && monthly > 0);

  const ask = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!askable || busy) return;
    setBusy(true);
    setError(null);
    try {
      setAnswer(
        await checkAffordability({
          label: label.trim() || 'this',
          amount: Number.isFinite(value) ? value : 0,
          financing,
          ...(financing === 'emi' ? { emiMonths: Number(emiMonths) || 12, emiRate: Number(emiRate) || 0 } : {}),
          ...(monthly > 0 ? { recurringMonthly: monthly } : {}),
          ...(bufferMonths ? { bufferMonths: Number(bufferMonths) } : {}),
          useEarmarked,
        })
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not work that out just now.');
    } finally {
      setBusy(false);
    }
  };

  // Re-runs when a premise changes, so someone dragging the buffer from three
  // months to one watches the verdict move rather than pressing a button again.
  useEffect(() => {
    if (!answer || !askable) return;
    const timer = window.setTimeout(() => void ask(), 350);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [financing, emiMonths, emiRate, bufferMonths, useEarmarked]);

  const Icon = answer ? VERDICT_ICON[answer.verdict] : CircleHelp;
  const tone = answer ? VERDICT_TONE[answer.verdict] : 'warning';

  return (
    <Layout title="Can I afford it?">
      <div className="flex max-w-3xl flex-col gap-5 min-w-0">
        <PageHeader
          title="Can I afford it?"
          lede="Weighed against your savings, your emergency buffer, what a normal month costs you and what you already owe."
        />

        <form
          onSubmit={ask}
          className="rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6 min-w-0"
        >
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <div className="space-y-2">
              <Label htmlFor="afford-label">What is it?</Label>
              <Input
                id="afford-label"
                value={label}
                onChange={e => setLabel(e.target.value)}
                placeholder="Japan trip, iPhone, a second car…"
                list="afford-examples"
              />
              <datalist id="afford-examples">
                {EXAMPLES.map(e => <option key={e.label} value={e.label} />)}
              </datalist>
            </div>
            <div className="space-y-2">
              <Label htmlFor="afford-amount">Cost</Label>
              <Input
                id="afford-amount"
                type="number"
                step="1"
                min="0"
                inputMode="decimal"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>How would you pay?</Label>
              <div className="flex gap-2">
                <Choice selected={financing === 'cash'} onSelect={() => setFinancing('cash')} label="Cash" />
                <Choice selected={financing === 'emi'} onSelect={() => setFinancing('emi')} label="Instalments" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="afford-recurring">Ongoing cost, if any</Label>
              <Input
                id="afford-recurring"
                type="number"
                min="0"
                inputMode="decimal"
                value={recurring}
                onChange={e => setRecurring(e.target.value)}
                placeholder="Per month — insurance, fuel, a plan"
              />
            </div>
          </div>

          {financing === 'emi' && (
            <div className="mt-4 grid gap-4 rounded-xl bg-subtle p-3.5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="afford-months">Over how many months</Label>
                <Input
                  id="afford-months"
                  type="number"
                  min="1"
                  max="120"
                  inputMode="numeric"
                  value={emiMonths}
                  onChange={e => setEmiMonths(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="afford-rate">Interest rate (% a year)</Label>
                <Input
                  id="afford-rate"
                  type="number"
                  step="0.1"
                  min="0"
                  inputMode="decimal"
                  value={emiRate}
                  onChange={e => setEmiRate(e.target.value)}
                />
                <p className="text-caption text-muted-foreground">
                  0 for a no-cost plan — though check for a processing fee, which is the same thing
                  under a different name.
                </p>
              </div>
            </div>
          )}

          <details className="mt-4 rounded-xl border border-border">
            <summary className="tactile cursor-pointer list-none px-3.5 py-3 text-subhead font-medium">
              Assumptions
              <span className="mt-0.5 block text-caption font-normal text-muted-foreground sm:mt-0 sm:ml-2 sm:inline">
                Change these if you disagree with them
              </span>
            </summary>
            <div className="space-y-4 border-t border-border p-3.5">
              <div className="space-y-2">
                <Label htmlFor="afford-buffer">Emergency buffer to keep untouched</Label>
                <Input
                  id="afford-buffer"
                  type="number"
                  min="0"
                  max="24"
                  inputMode="numeric"
                  value={bufferMonths}
                  onChange={e => setBufferMonths(e.target.value)}
                  placeholder="3 months, or 6 if your income varies"
                />
                <p className="text-caption text-muted-foreground">
                  Months of your normal outgo. Spending down to zero is not affording something.
                </p>
              </div>
              <Switch
                checked={useEarmarked}
                onCheckedChange={setUseEarmarked}
                label="Use money set aside for this"
                description="A fund saved for a house counts towards a house and nothing else. Turn off to keep every earmarked balance out of the answer."
              />
            </div>
          </details>

          {error && <p className="mt-4 text-footnote text-destructive-text" role="alert">{error}</p>}

          <Button type="submit" className="mt-5" size="block" disabled={!askable || busy}>
            {busy ? <><Loader2 className="animate-spin" />Working it out…</> : 'Check'}
          </Button>
        </form>

        {/* ── The answer ────────────────────────────────────────────── */}
        {answer && (
          <div className={cn('flex flex-col gap-5 min-w-0', busy && 'opacity-60 transition-opacity')}>
            <section className="rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6 min-w-0">
              <div className="flex items-start gap-3.5">
                <span
                  className={cn(
                    'flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[0.75rem]',
                    VERDICT_CLASS[tone]
                  )}
                >
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-title-3">
                    {VERDICT_LABEL[answer.verdict]}
                    <Badge
                      tone={tone === 'positive' ? 'positive' : tone === 'warning' ? 'warning' : 'negative'}
                      size="sm"
                    >
                      {label.trim() || 'this'}
                    </Badge>
                  </p>
                  <p className="mt-1.5 text-subhead text-muted-foreground text-balance">
                    {answer.headline}
                  </p>
                </div>
              </div>

              <div className="mt-5 border-t border-border pt-5">
                <StatRow>
                  <Stat
                    label="Available now"
                    value={formatRounded(answer.numbers.availableNow)}
                    hint={`buffer keeps ${formatRounded(answer.numbers.emergencyBuffer)} back`}
                  />
                  <Stat
                    label={financing === 'emi' ? 'Instalment' : 'After paying'}
                    value={
                      financing === 'emi'
                        ? `${formatRounded(answer.numbers.monthlyInstalment)}/mo`
                        : formatRounded(answer.numbers.availableAfter)
                    }
                    hint={
                      financing === 'emi' && answer.numbers.financingCost > 0
                        ? `${formatRounded(answer.numbers.financingCost)} of interest`
                        : undefined
                    }
                  />
                  <Stat
                    label="Left each month"
                    value={`${formatRounded(answer.numbers.freeCashflowAfter)}`}
                    hint={`from ${formatRounded(answer.numbers.freeCashflowMonthly)} before`}
                    tone={answer.numbers.freeCashflowAfter < 0 ? 'negative' : 'default'}
                  />
                  <Stat
                    label="Cover afterwards"
                    value={
                      answer.numbers.runwayAfterMonths === null
                        ? '—'
                        : `${answer.numbers.runwayAfterMonths.toFixed(1)} mo`
                    }
                    hint="of normal outgo"
                    tone={
                      answer.numbers.runwayAfterMonths !== null && answer.numbers.runwayAfterMonths < 3
                        ? 'warning'
                        : 'default'
                    }
                  />
                </StatRow>
              </div>

              {answer.numbers.monthsToSave !== null && answer.numbers.monthsToSave > 0 && (
                <p className="mt-5 rounded-xl bg-subtle px-3.5 py-3 text-subhead">
                  Saving at your current rate, this is affordable outright from{' '}
                  <span className="font-semibold">
                    {answer.numbers.affordableFrom ? formatDay(answer.numbers.affordableFrom) : '—'}
                  </span>{' '}
                  — about {answer.numbers.monthsToSave} month
                  {answer.numbers.monthsToSave === 1 ? '' : 's'} away.
                </p>
              )}

              {answer.numbers.earmarkedUsed.length > 0 && (
                <p className="mt-3 flex gap-2 rounded-xl bg-info-tint px-3.5 py-3 text-footnote text-info-text">
                  <Lock className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                  <span className="min-w-0">
                    This counts{' '}
                    {answer.numbers.earmarkedUsed
                      .map(f => `${f.name} (${formatMoney(f.balance)}, set aside for ${f.purpose})`)
                      .join(' and ')}
                    , because that is what the money is for. It is not counted for anything else.
                  </span>
                </p>
              )}
            </section>

            {answer.cautions.length > 0 && (
              <section className="rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6 min-w-0">
                <h2 className="text-headline">Worth knowing</h2>
                <ul className="mt-3 space-y-2.5">
                  {answer.cautions.map((caution, index) => (
                    <li key={index} className="flex gap-2.5 text-subhead text-muted-foreground">
                      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning-text" />
                      <span className="min-w-0">{caution}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {answer.options.length > 0 && (
              <section className="rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6 min-w-0">
                <h2 className="text-headline">What else you could do</h2>
                <ul className="mt-3 space-y-2.5">
                  {answer.options.map((option, index) => (
                    <li key={index} className="flex gap-2.5 text-subhead">
                      <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-positive-text" />
                      <span className="min-w-0">{option}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/*
              What the answer is missing, named rather than papered over. A
              verdict computed without a balance is a guess, and presenting a
              guess in the same voice as an answer is the failure this is here
              to prevent.
            */}
            {answer.missing.length > 0 && (
              <section className="rounded-2xl border border-dashed border-border p-5 min-w-0">
                <p className="flex items-center gap-2 text-subhead font-medium">
                  <Info className="h-4 w-4 text-faint" />
                  This answer is working with gaps
                </p>
                <ul className="mt-2 space-y-1.5">
                  {answer.missing.map((gap, index) => (
                    <li key={index} className="text-footnote text-muted-foreground">{gap}</li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}

function Choice({
  selected,
  onSelect,
  label,
}: {
  selected: boolean;
  onSelect: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'tactile h-11 flex-1 rounded-xl border px-3 text-subhead font-medium',
        selected ? 'border-primary bg-primary-tint text-primary' : 'border-border bg-card hover:bg-subtle'
      )}
    >
      {label}
    </button>
  );
}
