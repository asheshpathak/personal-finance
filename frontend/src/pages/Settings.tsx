import { useEffect, useState } from 'react';
import { Check, CheckCircle2, DollarSign, IndianRupee, Loader2, Sparkles } from 'lucide-react';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageHeader, SectionHeader } from '@/components/ui/section';
import { IncomeSection } from '@/components/settings/IncomeSection';
import { AssetsSection } from '@/components/settings/AssetsSection';
import { useCurrency, type Currency } from '@/context/CurrencyContext';
import { useAuth } from '@/context/AuthContext';
import { aiStatus } from '@/lib/ai';
import { cn } from '@/lib/utils';
import * as money from '@/lib/money';

const OPTIONS: {
  code: Currency;
  label: string;
  description: string;
  icon: React.ElementType;
}[] = [
  { code: 'USD', label: 'US Dollar', description: 'Grouped in thousands', icon: DollarSign },
  { code: 'INR', label: 'Indian Rupee', description: 'Grouped in lakhs and crores', icon: IndianRupee },
];

export default function Settings() {
  const { currency, setCurrency } = useCurrency();
  const { user } = useAuth();

  // Only the user's explicit pick is state. Everything else follows the stored
  // preference, which lands a moment after mount once the account is fetched.
  const [picked, setPicked] = useState<Currency | null>(null);
  const selected = picked ?? currency;

  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ai, setAi] = useState<{ configured: boolean; model: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    aiStatus().then(status => { if (!cancelled) setAi(status); });
    return () => { cancelled = true; };
  }, []);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await setCurrency(selected);
      setPicked(null);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      console.error(err);
      setError("Couldn't save your currency. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = selected !== currency;

  return (
    <Layout title="Settings">
      <div className="flex max-w-2xl flex-col gap-5 min-w-0">
        <PageHeader
          title="Settings"
          lede="What you earn, what you have, and the preferences that follow your account."
        />

        {/*
          Income and balances come first, above currency and account.
          They are the two things the rest of the app cannot work without —
          every "left over", "can I afford it" and "how long could I last"
          figure has no denominator until they are filled in — and burying them
          under a currency picker would be ordering this screen by how much
          code each section took rather than by what it is worth.
        */}
        <IncomeSection />
        <AssetsSection />

        {/* ── Currency ─────────────────────────────────────────────────── */}
        <section className="rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6 min-w-0">
          <SectionHeader
            title="Currency"
            subtitle="Every amount in the app reformats immediately."
          />

          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {OPTIONS.map(option => {
              const isSelected = selected === option.code;
              const Icon = option.icon;
              return (
                <button
                  key={option.code}
                  type="button"
                  onClick={() => setPicked(option.code)}
                  aria-pressed={isSelected}
                  className={cn(
                    'tactile relative flex w-full items-center gap-3.5 rounded-xl border p-4 text-left',
                    isSelected
                      ? 'border-primary bg-primary-tint'
                      : 'border-border bg-card hover:bg-subtle'
                  )}
                >
                  <span
                    className={cn(
                      'flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[0.75rem]',
                      isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                    )}
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-row font-semibold">
                      {money.symbolFor(option.code)} {option.code}
                    </span>
                    <span className="block truncate text-caption text-muted-foreground">
                      {option.description}
                    </span>
                  </span>
                  {isSelected && (
                    <Check className="h-5 w-5 flex-shrink-0 text-primary" strokeWidth={2.5} />
                  )}
                </button>
              );
            })}
          </div>

          {/*
            A live preview across all four formatters, because the difference
            between the two currencies here is not the symbol — it is the digit
            grouping. `₹1,23,456` against `$123,456` is the thing worth seeing
            before committing to it.
          */}
          <div className="mt-4 rounded-xl bg-subtle p-4">
            <p className="text-overline uppercase text-faint">Preview</p>
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-subhead">
              <Preview label="Exact" value={money.exact(1234567.89, selected)} />
              <Preview label="Rounded" value={money.rounded(1234567.89, selected)} />
              <Preview label="Compact" value={money.compact(1234567.89, selected)} />
              <Preview label="Change" value={money.delta(-4820, selected)} />
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button
              onClick={() => void handleSave()}
              disabled={saving || (!hasChanges && !saved)}
              className={cn('w-full sm:w-auto', saved && 'bg-positive hover:bg-positive')}
            >
              {saving ? (
                <>
                  <Loader2 className="animate-spin" />
                  Saving…
                </>
              ) : saved ? (
                <>
                  <CheckCircle2 />
                  Saved
                </>
              ) : (
                'Save changes'
              )}
            </Button>
            {hasChanges && !saved && !saving && (
              <p className="text-footnote text-muted-foreground">You have unsaved changes.</p>
            )}
          </div>

          {error && (
            <p className="mt-3 text-footnote text-destructive-text" role="alert">
              {error}
            </p>
          )}
        </section>

        {/* ── AI ───────────────────────────────────────────────────────── */}
        <section className="rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6 min-w-0">
          <SectionHeader
            title="AI features"
            subtitle="Reading a line of text into an expense, the briefing, and Ask Tetra."
          />

          <div className="mt-5 flex items-start gap-3.5 rounded-xl bg-subtle p-4">
            <span
              className={cn(
                'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[0.7rem]',
                ai?.configured ? 'bg-pop-tint text-pop' : 'bg-muted text-muted-foreground'
              )}
            >
              <Sparkles className="h-[1.05rem] w-[1.05rem]" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-subhead font-semibold">
                {ai === null ? 'Checking…' : ai.configured ? 'Available' : 'Not configured'}
                {ai?.model && <Badge tone="neutral" size="sm">{ai.model}</Badge>}
              </p>
              <p className="mt-1 text-footnote text-muted-foreground">
                {ai?.configured
                  ? 'Runs on this server with your own key — nothing is sent anywhere else, and nothing is ever written without you confirming it.'
                  : 'Set ANTHROPIC_API_KEY in the backend environment to switch these on. Everything else in the app works without them.'}
              </p>
            </div>
          </div>
        </section>

        {/* ── Account ──────────────────────────────────────────────────── */}
        <section className="rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6 min-w-0">
          <SectionHeader title="Account" />
          <dl className="mt-4 divide-y divide-border">
            <Row label="Email" value={user?.email ?? '—'} />
            <Row label="Currency" value={`${money.symbolFor(currency)} ${currency}`} />
          </dl>
          <p className="mt-4 text-caption text-muted-foreground">
            Preferences are stored on your account, so they carry to any device you sign in on.
          </p>
        </section>
      </div>
    </Layout>
  );
}

function Preview({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-caption text-muted-foreground">{label}</p>
      <p className="truncate font-semibold tnum">{value}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3 min-w-0">
      <dt className="flex-shrink-0 text-subhead text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-subhead font-medium">{value}</dd>
    </div>
  );
}
