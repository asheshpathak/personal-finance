import { useEffect, useState } from 'react';
import { Info, Loader2, Lock, PiggyBank, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DatePicker } from '@/components/ui/date-picker';
import { SectionHeader, Skeleton } from '@/components/ui/section';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import { useCurrency } from '@/context/CurrencyContext';
import { useDataRefresh } from '@/context/DataRefreshContext';
import { ApiError } from '@/lib/api';
import { formatDay, toDayKey } from '@/lib/dates';
import {
  ASSET_KINDS,
  createAsset,
  deleteAsset,
  listAssets,
  updateAsset,
  type AssetKind,
  type AssetRecord,
  type AssetSummary,
} from '@/lib/incomeSources';

/**
 * What is in the accounts.
 *
 * The one thing a spending tracker structurally cannot know, and the thing every
 * "can I afford this" answer needs. Without it the app can say what a purchase
 * would do to a normal month and nothing at all about whether the money is
 * there.
 *
 * Deliberately a balance with a date rather than a ledger. This app connects to
 * no bank and never will; asking anyone to maintain a savings ledger by hand
 * produces a number that is wrong within a month. One figure, and the date it
 * was last true, is honest about what it is — and the staleness shows on the
 * row rather than hiding inside it.
 */

interface FormState {
  name: string;
  kind: AssetKind;
  balance: string;
  asOf: string;
  liquid: boolean;
  ringFenced: boolean;
  earmarkedFor: string;
}

const emptyForm = (today: string): FormState => ({
  name: '',
  kind: 'Cash & Bank',
  balance: '',
  asOf: today,
  liquid: true,
  ringFenced: false,
  earmarkedFor: '',
});

/** Balances older than this are called out on the row rather than trusted. */
const STALE_MONTHS = 3;

export function AssetsSection() {
  const { formatMoney, formatRounded } = useCurrency();
  const { refresh } = useDataRefresh();
  const today = toDayKey();

  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [summary, setSummary] = useState<AssetSummary | null>(null);
  const [ready, setReady] = useState(false);

  const [isOpen, setIsOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm(today));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const load = async () => {
    try {
      const data = await listAssets();
      setAssets(data.assets);
      setSummary(data.summary);
    } catch (err) {
      console.error(err);
    } finally {
      setReady(true);
    }
  };

  useEffect(() => { void load(); }, []);

  const patch = (next: Partial<FormState>) => setForm(prev => ({ ...prev, ...next }));

  const openAdd = () => {
    setForm(emptyForm(today));
    setEditId(null);
    setError(null);
    setIsOpen(true);
  };

  const openEdit = (asset: AssetRecord) => {
    setForm({
      name: asset.name,
      kind: asset.kind,
      balance: String(asset.balance),
      asOf: asset.asOf,
      liquid: asset.liquid,
      ringFenced: asset.ringFenced,
      earmarkedFor: asset.earmarkedFor,
    });
    setEditId(asset._id);
    setError(null);
    setIsOpen(true);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);

    const body = {
      name: form.name.trim(),
      kind: form.kind,
      balance: Number(form.balance),
      asOf: form.asOf,
      liquid: form.liquid,
      ringFenced: form.ringFenced,
      earmarkedFor: form.ringFenced ? form.earmarkedFor.trim() : '',
    };

    try {
      if (editId) await updateAsset(editId, body);
      else await createAsset(body);
      setIsOpen(false);
      await load();
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save that.');
    } finally {
      setSaving(false);
    }
  };

  const staleBefore = (() => {
    const [y = 0, m = 1, d = 1] = today.split('-').map(Number);
    const at = new Date(Date.UTC(y, m - 1 - STALE_MONTHS, d));
    return at.toISOString().slice(0, 10);
  })();

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6 min-w-0">
      <SectionHeader
        title="Savings and balances"
        subtitle="What is actually there. This is what makes “can I afford it” answerable."
        action={
          <Button size="sm" onClick={openAdd}>
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
            Add
          </Button>
        }
      />

      {!ready ? (
        <div className="mt-5 space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : assets.length === 0 ? (
        <div className="mt-5 rounded-xl border border-dashed border-border px-4 py-8 text-center">
          <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-muted text-faint">
            <PiggyBank className="h-5 w-5" />
          </span>
          <p className="text-subhead font-medium">No balances recorded</p>
          <p className="mx-auto mt-1 max-w-sm text-caption text-muted-foreground">
            One figure per account, and the date you last checked. Nothing is connected to a bank —
            you update these when you feel like it, and the app says how old they are rather than
            pretending they are live.
          </p>
          <Button className="mt-4" size="sm" onClick={openAdd}>
            Add a balance
          </Button>
        </div>
      ) : (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-subtle p-4">
              <p className="text-overline uppercase text-faint">Available to spend</p>
              <p className="mt-1 text-title-2 tnum">{formatRounded(summary?.available ?? 0)}</p>
              <p className="mt-1 text-caption text-muted-foreground">
                Liquid, and not set aside for something specific.
              </p>
            </div>
            <div className="rounded-xl bg-subtle p-4">
              <p className="text-overline uppercase text-faint">Everything</p>
              <p className="mt-1 text-title-2 tnum">{formatRounded(summary?.total ?? 0)}</p>
              <p className="mt-1 text-caption text-muted-foreground">
                Including what is locked up or earmarked.
              </p>
            </div>
          </div>

          <ul className="mt-4 divide-y divide-border">
            {assets.map(asset => {
              const stale = asset.asOf < staleBefore;
              return (
                <li key={asset._id} className="flex items-center justify-between gap-3 py-3 min-w-0">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-row font-medium">
                      <span className="truncate">{asset.name}</span>
                      {asset.ringFenced && (
                        <Badge tone="info" size="sm">
                          <Lock />
                          {asset.earmarkedFor || 'set aside'}
                        </Badge>
                      )}
                      {!asset.liquid && <Badge tone="neutral" size="sm">Not liquid</Badge>}
                      {stale && <Badge tone="warning" size="sm">Out of date</Badge>}
                    </p>
                    <p className="truncate text-caption text-muted-foreground">
                      {formatMoney(asset.balance)} · {asset.kind} · confirmed {formatDay(asset.asOf)}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 gap-1">
                    <Button variant="ghost" size="icon-sm" aria-label={`Edit ${asset.name}`} onClick={() => openEdit(asset)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete ${asset.name}`}
                      className="text-destructive-text"
                      onClick={() => setDeleteId(asset._id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>

          {summary?.oldestAsOf && summary.oldestAsOf < staleBefore && (
            <p className="mt-4 flex gap-2 rounded-lg bg-warning-tint px-3.5 py-3 text-caption text-warning-text">
              <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <span className="min-w-0">
                The oldest of these was last confirmed {formatDay(summary.oldestAsOf)}. Anything the
                app tells you about affording something rests on these figures, and it will say so —
                but it is worth two minutes to update them.
              </span>
            </p>
          )}
        </>
      )}

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editId ? 'Edit balance' : 'Add a balance'}</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4 min-w-0">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="asset-name">Name</Label>
                <Input
                  id="asset-name"
                  required
                  value={form.name}
                  onChange={e => patch({ name: e.target.value })}
                  placeholder="Salary account, emergency fund…"
                />
              </div>
              <div className="space-y-2">
                <Label>Kind</Label>
                <Select value={form.kind} onValueChange={v => patch({ kind: v as AssetKind })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ASSET_KINDS.map(k => <SelectItem key={k} value={k}>{k}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="asset-balance">Balance</Label>
                <Input
                  id="asset-balance"
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  required
                  value={form.balance}
                  onChange={e => patch({ balance: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="asset-asof">Last confirmed</Label>
                <DatePicker
                  id="asset-asof"
                  value={form.asOf}
                  onChange={asOf => patch({ asOf })}
                  max={today}
                />
              </div>
            </div>

            <div className="space-y-3 rounded-lg bg-subtle p-3.5">
              <Switch
                checked={form.liquid}
                onCheckedChange={liquid => patch({ liquid })}
                label="Reachable this week"
                description="Off for anything you would have to sell, break or wait for — property, a locked deposit, a pension."
              />
              <div className="border-t border-border pt-3">
                <Switch
                  checked={form.ringFenced}
                  onCheckedChange={ringFenced => patch({ ringFenced })}
                  label="Set aside for something"
                  description="The app will not offer this money up for anything else."
                />
              </div>

              {form.ringFenced && (
                <div className="space-y-2 border-t border-border pt-3">
                  <Label htmlFor="asset-purpose">Set aside for</Label>
                  <Input
                    id="asset-purpose"
                    value={form.earmarkedFor}
                    onChange={e => patch({ earmarkedFor: e.target.value })}
                    placeholder="House down payment, Japan trip, emergencies…"
                  />
                  {/*
                    Saying what it is for is what makes the fence useful rather
                    than merely restrictive. Without it, someone saving for a
                    house is told they cannot afford a house.
                  */}
                  <p className="flex gap-2 text-caption text-muted-foreground">
                    <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                    <span className="min-w-0">
                      Naming the purpose matters: the app keeps this money out of every other answer,
                      and counts it in full when you ask about the thing it is for.
                    </span>
                  </p>
                </div>
              )}
            </div>

            {error && <p className="text-footnote text-destructive-text" role="alert">{error}</p>}

            <Button type="submit" size="block" disabled={saving}>
              {saving ? <><Loader2 className="animate-spin" />Saving…</> : editId ? 'Save changes' : 'Add balance'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={deleteId !== null}
        onOpenChange={open => { if (!open) setDeleteId(null); }}
        title="Delete this balance?"
        description="Anything the app says about what you can afford will change."
        onConfirm={async () => {
          if (!deleteId) return;
          await deleteAsset(deleteId);
          setDeleteId(null);
          await load();
          refresh();
        }}
      />
    </section>
  );
}
