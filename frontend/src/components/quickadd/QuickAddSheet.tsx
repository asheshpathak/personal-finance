import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Check,
  Loader2,
  Sparkles,
  Undo2,
  Wand2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { api, ApiError } from '@/lib/api';
import { aiStatus, captureExpense } from '@/lib/ai';
import { useCurrency } from '@/context/CurrencyContext';
import { useQuickAdd } from '@/context/QuickAddContext';
import { useDataRefresh } from '@/context/DataRefreshContext';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SegmentedTrack } from '@/components/ui/segmented';
import { Keypad } from './Keypad';
import { ALL_CATEGORIES } from '@/lib/expenseCategories';
import { PAYMENT_MODES } from '@/components/ExpenseForm';
import { fromMinor, toMinor } from '@/lib/money';
import { toDayKey } from '@/lib/dates';
import type { PaymentShortcut } from '@/lib/paymentShortcuts';

/**
 * Recording a payment, in about three seconds.
 *
 * The flow is amount → category → done, on one surface, without the OS keyboard
 * ever appearing. Everything else — the date, the payment mode, a note — has a
 * sensible default and can be corrected afterwards. That ordering is the entire
 * design: an expense tracker is only as good as its completeness, and every
 * extra required field is a payment that eventually doesn't get recorded at
 * all.
 *
 * Two faster paths sit above it:
 *
 *  · **Shortcuts** — the person's own saved templates. One tap records the
 *    whole payment, because it is a payment they have made before.
 *  · **Say it** — a line of text ("chai 30 cash", "swiggy 480 yesterday") read
 *    by Claude into a filled-in draft. Nothing is written until they confirm;
 *    the model fills the form, the person presses save.
 */

type Step = 'amount' | 'details';

const RECENT_CATEGORY_KEY = 'recentCategories';

/**
 * The categories to offer first.
 *
 * Ranked by recency and frequency together rather than either alone: a
 * frequency-only list ossifies (the category you used most last year stays on
 * top forever), and a recency-only list thrashes. Stored locally because it is
 * device-shaped convenience, not an account preference — and losing it costs
 * one extra tap, not data.
 */
function readRecentCategories(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_CATEGORY_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((c): c is string => typeof c === 'string') : [];
  } catch {
    return [];
  }
}

function rememberCategory(category: string): void {
  try {
    const next = [category, ...readRecentCategories().filter(c => c !== category)].slice(0, 8);
    localStorage.setItem(RECENT_CATEGORY_KEY, JSON.stringify(next));
  } catch {
    /* private mode, quota — the feature degrades to the default order */
  }
}

const DEFAULT_SUGGESTIONS = [
  'Food & Groceries',
  'Dining Out',
  'Transport',
  'Shopping',
  'Utilities',
  'Entertainment',
];

/** Your recent categories first, topped up from the common ones. */
function suggestedCategories(): string[] {
  const seen = readRecentCategories();
  return [...seen, ...DEFAULT_SUGGESTIONS.filter(c => !seen.includes(c))].slice(0, 6);
}

export function QuickAddSheet() {
  const { open, close } = useQuickAdd();
  const { refresh } = useDataRefresh();
  const { currency, currencySymbol, formatAmount, formatMoney } = useCurrency();

  const [step, setStep] = useState<Step>('amount');
  const [minor, setMinor] = useState(0);
  const [category, setCategory] = useState('');
  const [paymentMode, setPaymentMode] = useState('Cash');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(toDayKey);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ amount: number; category: string } | null>(null);

  const [shortcuts, setShortcuts] = useState<PaymentShortcut[]>([]);
  const [aiOn, setAiOn] = useState(false);

  // ── "Say it" ──────────────────────────────────────────────────────────────
  const [phrase, setPhrase] = useState('');
  const [parsing, setParsing] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);

  const [recent, setRecent] = useState<string[]>(suggestedCategories);

  // Re-read the recent categories each time the sheet opens, so one used a
  // moment ago is near the front without a reload. Adjusted during render
  // rather than in an effect — it is a synchronous read of local storage, not a
  // subscription, and the effect version paints one frame with the stale order.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) setRecent(suggestedCategories());
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    aiStatus().then(status => { if (!cancelled) setAiOn(status.configured); });
    api
      .get<PaymentShortcut[]>('/api/payment-shortcuts')
      .then(list => { if (!cancelled) setShortcuts(list.slice(0, 6)); })
      .catch(() => { /* shortcuts are a convenience; their absence is not an error */ });

    return () => { cancelled = true; };
  }, [open]);

  /** Back to a blank slate. Called on close rather than on open, so the sheet
   *  never flashes the previous entry while it animates away. */
  const reset = () => {
    setStep('amount');
    setMinor(0);
    setCategory('');
    setPaymentMode('Cash');
    setDescription('');
    setDate(toDayKey());
    setError(null);
    setPhrase('');
    setAiNote(null);
    setSaved(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      close();
      // After the sheet has left, so the reset is never visible.
      window.setTimeout(reset, 300);
    }
  };

  const record = async (payload: {
    amount: number;
    category: string;
    paymentMode: string;
    description: string;
    date: string;
    shortcutId?: string;
  }) => {
    if (saving) return;
    setSaving(true);
    setError(null);

    try {
      await api.post('/api/expenses', {
        amount: payload.amount,
        category: payload.category,
        paymentMode: payload.paymentMode,
        description: payload.description,
        // Local noon, so the stored UTC instant can't slip to the adjacent day
        // for anyone far from UTC — the same convention every other write in
        // this app uses, and the reason the day a payment shows on is stable.
        date: new Date(`${payload.date}T12:00:00`).toISOString(),
      });

      rememberCategory(payload.category);
      if (payload.shortcutId) {
        // Ranking metadata only — never block the save on it.
        api.post(`/api/payment-shortcuts/${payload.shortcutId}/use`).catch(() => {});
      }

      refresh();
      setSaved({ amount: payload.amount, category: payload.category });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save that. Try again.');
    } finally {
      setSaving(false);
    }
  };

  /** The shortcut path: one tap records a payment already described in full. */
  const applyShortcut = (shortcut: PaymentShortcut) => {
    void record({
      amount: shortcut.amount,
      category: shortcut.category,
      paymentMode: shortcut.paymentMode,
      description: shortcut.description,
      date: toDayKey(),
      shortcutId: shortcut._id,
    });
  };

  const parsePhrase = async () => {
    const text = phrase.trim();
    if (!text || parsing) return;

    setParsing(true);
    setError(null);
    setAiNote(null);

    try {
      const draft = await captureExpense(text, ALL_CATEGORIES);
      setMinor(toMinor(draft.amount));
      setCategory(draft.category);
      setPaymentMode(draft.paymentMode);
      setDescription(draft.description);
      setDate(draft.date);
      setAiNote(
        draft.note ??
          (draft.confidence === 'low' ? 'Low confidence — check the amount and category.' : null)
      );
      // Straight to the review step. The point is that the person *sees* what
      // was understood before it is written — a parser that saved silently
      // would be a parser nobody could trust twice.
      setStep('details');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't read that.");
    } finally {
      setParsing(false);
    }
  };

  const amount = fromMinor(minor);
  const canContinue = minor > 0;
  const canSave = minor > 0 && category !== '' && paymentMode !== '';

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        // The sheet opens with the keypad ready, and a focus landing on the
        // close button would put the first tap in the wrong place.
        onOpenAutoFocus={event => event.preventDefault()}
      >
        <DialogTitle className="sr-only">Record a payment</DialogTitle>

        {saved ? (
          <Recorded
            amount={formatAmount(saved.amount)}
            category={saved.category}
            onAnother={() => { reset(); }}
            onDone={() => handleOpenChange(false)}
          />
        ) : step === 'amount' ? (
          <div className="min-w-0">
            {/* ── Shortcuts: the fastest path of all ─────────────────────── */}
            {shortcuts.length > 0 && (
              <div className="min-w-0">
                <p className="text-overline uppercase text-faint">One tap</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {shortcuts.map(shortcut => (
                    <button
                      key={shortcut._id}
                      type="button"
                      disabled={saving}
                      onClick={() => applyShortcut(shortcut)}
                      className={cn(
                        'tactile inline-flex h-10 max-w-full items-center gap-2 rounded-full',
                        'bg-primary-tint px-3.5 text-footnote font-semibold text-primary',
                        'active:bg-primary-border disabled:opacity-50'
                      )}
                    >
                      <span className="min-w-0 truncate">{shortcut.label}</span>
                      <span className="flex-shrink-0 tnum opacity-70">
                        {formatMoney(shortcut.amount)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── Natural language ───────────────────────────────────────── */}
            {aiOn && (
              <div className={cn('min-w-0', shortcuts.length > 0 && 'mt-5')}>
                <p className="text-overline uppercase text-faint">Or just say it</p>
                <div className="mt-2 flex gap-2">
                  <Input
                    value={phrase}
                    onChange={event => setPhrase(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void parsePhrase();
                      }
                    }}
                    placeholder="coffee 180 upi"
                    aria-label="Describe the payment"
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="tinted"
                    size="icon"
                    onClick={() => void parsePhrase()}
                    disabled={!phrase.trim() || parsing}
                    aria-label="Read that"
                  >
                    {parsing ? <Loader2 className="animate-spin" /> : <Wand2 />}
                  </Button>
                </div>
              </div>
            )}

            <Keypad
              value={minor}
              onChange={setMinor}
              currency={currency}
              symbol={currencySymbol}
              className={cn(shortcuts.length > 0 || aiOn ? 'mt-2' : 'mt-0')}
            />

            {error && (
              <p role="alert" className="mt-3 text-center text-footnote text-destructive-text">
                {error}
              </p>
            )}

            <Button
              size="block"
              className="mt-4"
              disabled={!canContinue}
              onClick={() => setStep('details')}
            >
              Continue
              <ArrowRight />
            </Button>
          </div>
        ) : (
          <div className="min-w-0">
            {/* ── The amount, now a summary rather than an input ─────────── */}
            <button
              type="button"
              onClick={() => setStep('amount')}
              className="tactile flex w-full items-baseline justify-center gap-1.5 rounded-lg py-2 active:bg-subtle"
            >
              <span className="text-title-3 font-semibold text-muted-foreground">
                {currencySymbol}
              </span>
              <span className="text-title-1 tnum">{amount.toFixed(2)}</span>
              <Undo2 className="ml-1.5 h-3.5 w-3.5 self-center text-faint" />
            </button>

            {aiNote && (
              <p className="mt-1 flex items-start justify-center gap-1.5 text-center text-footnote text-warning-text">
                <Sparkles className="mt-[3px] h-3 w-3 flex-shrink-0" />
                <span className="min-w-0">{aiNote}</span>
              </p>
            )}

            {/* ── Category ───────────────────────────────────────────────── */}
            <div className="mt-4 min-w-0">
              <p className="text-overline uppercase text-faint">Category</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {recent.map(name => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setCategory(name)}
                    aria-pressed={category === name}
                    className={cn(
                      'tactile inline-flex h-10 items-center rounded-full px-3.5 text-footnote font-semibold',
                      category === name
                        ? 'bg-foreground text-background'
                        : 'bg-muted text-muted-foreground active:bg-hover'
                    )}
                  >
                    {name}
                  </button>
                ))}
              </div>

              {/* The full list, for the times the six chips are wrong. Native
                  select on purpose: this is a rarely-used fallback inside a
                  sheet, and a second popover layer here is a focus-management
                  problem in exchange for nothing. */}
              <select
                value={recent.includes(category) ? '' : category}
                onChange={event => event.target.value && setCategory(event.target.value)}
                aria-label="All categories"
                className={cn(
                  'mt-2 h-11 w-full rounded-md border border-border bg-subtle px-3 text-callout md:h-10 md:text-subhead',
                  'focus-visible:outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/28',
                  recent.includes(category) || !category ? 'text-muted-foreground' : 'text-foreground'
                )}
              >
                <option value="">
                  {recent.includes(category) || !category ? 'Something else…' : category}
                </option>
                {ALL_CATEGORIES.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>

            {/* ── Payment mode ───────────────────────────────────────────── */}
            <div className="mt-4 min-w-0">
              <p className="text-overline uppercase text-faint">Paid with</p>
              <SegmentedTrack
                className="mt-2 w-full"
                ariaLabel="Payment mode"
                value={paymentMode}
                onChange={setPaymentMode}
                options={PAYMENT_MODES.map(mode => ({
                  value: mode,
                  // Two words don't fit four-across on a phone; the first is
                  // unambiguous within this set.
                  label: <span className="truncate">{mode.split(' ')[0]}</span>,
                }))}
              />
            </div>

            {/* ── Note ───────────────────────────────────────────────────── */}
            <div className="mt-4 min-w-0">
              <p className="text-overline uppercase text-faint">Note</p>
              <Input
                className="mt-2"
                value={description}
                onChange={event => setDescription(event.target.value)}
                placeholder="Optional"
                aria-label="Note"
              />
            </div>

            {date !== toDayKey() && (
              <p className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-subtle px-3 py-2 text-footnote">
                <span className="text-muted-foreground">Dated {date}</span>
                <button
                  type="button"
                  onClick={() => setDate(toDayKey())}
                  className="tactile font-semibold text-primary"
                >
                  Use today
                </button>
              </p>
            )}

            {error && (
              <p role="alert" className="mt-3 text-center text-footnote text-destructive-text">
                {error}
              </p>
            )}

            <Button
              size="block"
              className="mt-5"
              disabled={!canSave || saving}
              onClick={() =>
                void record({ amount, category, paymentMode, description, date })
              }
            >
              {saving ? (
                <>
                  <Loader2 className="animate-spin" />
                  Saving…
                </>
              ) : (
                `Record ${formatAmount(amount)}`
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The confirmation.
 *
 * Deliberately offers "add another" first. Recording one payment is usually
 * recording two — the coffee and the parking, the groceries and the taxi — and
 * closing the sheet after each one makes the second entry cost the whole
 * opening sequence again.
 */
function Recorded({
  amount,
  category,
  onAnother,
  onDone,
}: {
  amount: string;
  category: string;
  onAnother: () => void;
  onDone: () => void;
}) {
  return (
    <div className="flex flex-col items-center py-6 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-positive-tint text-positive-text">
        <Check className="h-7 w-7" strokeWidth={2.6} />
      </span>
      <p className="mt-4 text-title-2 tnum">{amount}</p>
      <p className="mt-1 text-subhead text-muted-foreground">recorded under {category}</p>

      <div className="mt-6 flex w-full flex-col gap-2.5">
        <Button size="lg" onClick={onAnother}>Add another</Button>
        <Button size="lg" variant="ghost" onClick={onDone}>Done</Button>
      </div>
    </div>
  );
}
