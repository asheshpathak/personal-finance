import { useState } from 'react';
import { Layout } from '@/components/layout/Layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useCurrency } from '@/context/CurrencyContext';
import type { Currency } from '@/context/CurrencyContext';
import { CheckCircle2, DollarSign, IndianRupee, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CurrencyOption {
  code: Currency;
  label: string;
  symbol: string;
  description: string;
  icon: React.ElementType;
}

const currencyOptions: CurrencyOption[] = [
  {
    code: 'USD',
    label: 'US Dollar',
    symbol: '$',
    description: 'United States Dollar',
    icon: DollarSign,
  },
  {
    code: 'INR',
    label: 'Indian Rupee',
    symbol: '₹',
    description: 'Indian National Rupee',
    icon: IndianRupee,
  },
];

export default function Settings() {
  const { currency, setCurrency } = useCurrency();
  // Only the user's explicit pick is state. Everything else follows the stored
  // preference, which lands a moment after mount once the account is fetched.
  const [picked, setPicked] = useState<Currency | null>(null);
  const selected = picked ?? currency;

  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await setCurrency(selected);
      setPicked(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      console.error(err);
      setError("Couldn't save your currency. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = selected !== currency;

  return (
    <Layout>
      <div className="flex flex-col gap-6 sm:gap-8 max-w-2xl">
        {/* Header */}
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tighter">Settings</h1>
          <p className="text-muted-foreground mt-1">Configure your preferences for the dashboard.</p>
        </div>

        {/* Currency Card */}
        <Card className="rounded-2xl border shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg sm:text-xl">Currency Preferences</CardTitle>
            <CardDescription>
              Choose your preferred currency. All monetary values across the app will update instantly.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {currencyOptions.map((opt) => {
                const isSelected = selected === opt.code;
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.code}
                    onClick={() => setPicked(opt.code)}
                    className={cn(
                      'relative flex flex-col items-start gap-3 p-4 sm:p-5 rounded-xl border-2 text-left transition-all duration-200 cursor-pointer w-full',
                      isSelected
                        ? 'border-primary bg-primary/5 shadow-sm'
                        : 'border-border hover:border-muted-foreground/40 hover:bg-muted/30'
                    )}
                  >
                    <div className={cn('w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center', isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
                      <Icon className="w-5 h-5 sm:w-6 sm:h-6" />
                    </div>
                    <div>
                      <p className="font-bold text-base sm:text-lg leading-none">{opt.symbol} {opt.code}</p>
                      <p className="text-xs sm:text-sm text-muted-foreground mt-1">{opt.description}</p>
                    </div>
                    {isSelected && (
                      <CheckCircle2 className="absolute top-3 right-3 sm:top-4 sm:right-4 w-5 h-5 text-primary" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Preview */}
            <div className="mt-4 p-4 rounded-xl bg-muted/40 border border-dashed">
              <p className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-2">Preview</p>
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-2xl sm:text-3xl font-bold tracking-tighter">
                  {new Intl.NumberFormat(selected === 'INR' ? 'en-IN' : 'en-US', {
                    style: 'currency',
                    currency: selected,
                    minimumFractionDigits: 2,
                  }).format(12500.50)}
                </span>
                <span className="text-muted-foreground text-sm">example value</span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 pt-2">
              <Button
                onClick={handleSave}
                disabled={saving || (!hasChanges && !saved)}
                className={cn(
                  'px-8 transition-all duration-300 w-full sm:w-auto',
                  saved && 'bg-success text-white hover:bg-success hover:brightness-100'
                )}
              >
                {saving ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Saving…
                  </span>
                ) : saved ? (
                  <span className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" /> Saved!
                  </span>
                ) : 'Save Changes'}
              </Button>
              {hasChanges && !saved && !saving && (
                <p className="text-sm text-muted-foreground">You have unsaved changes.</p>
              )}
            </div>

            {error && (
              <p className="text-sm text-destructive" role="alert">{error}</p>
            )}

            <p className="text-xs text-muted-foreground">
              Saved to your account, so it carries across every device you sign in on.
            </p>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
