import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { useCurrency } from '@/context/CurrencyContext';
import { matchesShortcut, type PaymentShortcut } from '@/lib/paymentShortcuts';

/** Just the fields a shortcut writes — keeps this decoupled from the form. */
type ShortcutFormValues = {
  category: string;
  paymentMode: string;
  description: string;
};

/**
 * The user's own one-tap payment templates, above the expense form.
 *
 * Every shortcut here was saved deliberately by ticking "Save as shortcut" when
 * recording a payment — nothing is inferred from history or pulled in from
 * subscriptions. Tapping one fills the form; every field stays editable.
 */
export function PaymentShortcuts({
  values,
  onApply,
}: {
  values: ShortcutFormValues;
  onApply: (shortcut: PaymentShortcut) => void;
}) {
  const { formatAmount } = useCurrency();

  const [shortcuts, setShortcuts] = useState<PaymentShortcut[]>([]);
  const [loading, setLoading] = useState(true);
  const [managing, setManaging] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const data = await api.get<PaymentShortcut[]>('/api/payment-shortcuts');
        if (!cancelled) setShortcuts(data);
      } catch (err) {
        console.error(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, []);

  const handleRemove = async (id: string) => {
    try {
      await api.delete(`/api/payment-shortcuts/${id}`);
      setShortcuts(prev => prev.filter(s => s._id !== id));
    } catch (err) {
      console.error(err);
    }
  };

  // Nothing to show until there's something saved — the form opens at its
  // normal height rather than behind an empty panel.
  if (loading || shortcuts.length === 0) return null;

  return (
    <div className="min-w-0 rounded-xl border border-white/[0.08] bg-white/[0.02] p-2.5">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
          Quick fill
        </span>
        <button
          type="button"
          onClick={() => setManaging(m => !m)}
          className="flex-shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-colors"
        >
          {managing ? 'Done' : 'Edit'}
        </button>
      </div>

      {/* Wraps rather than scrolls: a scroll container inside the dialog's grid
          would stretch the dialog past the viewport on a phone. */}
      <div className="flex flex-wrap gap-1.5">
        {shortcuts.map(shortcut => {
          const isActive = matchesShortcut(shortcut, values);

          return (
            <button
              key={shortcut._id}
              type="button"
              onClick={() => (managing ? handleRemove(shortcut._id) : onApply(shortcut))}
              className={cn(
                // h-11 on touch, tightening at md — the same tap-target scale
                // the rest of the app uses.
                'inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 h-11 md:h-9 text-xs transition-all duration-150 active:scale-[0.97]',
                managing
                  ? 'border-destructive/40 bg-destructive/10 hover:bg-destructive/20'
                  : isActive
                    ? 'border-primary/60 bg-primary/10'
                    : 'border-white/10 bg-white/[0.04] hover:border-white/20 hover:bg-white/[0.07]'
              )}
              aria-label={managing ? `Remove shortcut ${shortcut.label}` : `Use shortcut ${shortcut.label}`}
            >
              {managing && <X className="w-3 h-3 flex-shrink-0 text-destructive" />}
              {/* min-w-0 so a long label truncates instead of widening the pill. */}
              <span className="min-w-0 truncate font-semibold">{shortcut.label}</span>
              <span className="flex-shrink-0 tabular-nums text-muted-foreground">
                {formatAmount(shortcut.amount)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
