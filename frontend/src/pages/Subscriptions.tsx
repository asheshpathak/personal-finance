import { useState, useEffect } from 'react';
import { Layout } from '@/components/layout/Layout';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Pencil, Trash2, Repeat } from 'lucide-react';
import { useCurrency } from '@/context/CurrencyContext';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import { computeSpendTotals, computeCategorySpend, toMonthlyEquivalent, type Frequency } from '@/lib/subscriptionTotals';
import { SubscriptionCategoryChart } from '@/components/SubscriptionCategoryChart';
import {
  DAYS_OF_WEEK,
  DAYS_OF_MONTH,
  MONTHS,
  formatDueDate,
  type DayOfWeek,
} from '@/lib/subscriptionDueDate';
import { api } from '@/lib/api';

interface Subscription {
  _id: string;
  name: string;
  amount: number;
  frequency: Frequency;
  category: string;
  dueDayOfWeek?: DayOfWeek | null;
  dueDayOfMonth?: number | null;
  dueMonth?: number | null;
}

const CATEGORIES = [
  'Streaming & Media',
  'Software & SaaS',
  'Cloud & Hosting',
  'Phone & Internet',
  'Utilities',
  'Insurance',
  'Fitness & Health',
  'News & Publications',
  'Gaming',
  'Food & Delivery',
  'Transport & Commute',
  'Finance & Banking',
  'Education & Learning',
  'Other',
];

const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

function SubscriptionForm({
  onSubmit,
  submitLabel,
  name,
  setName,
  amount,
  setAmount,
  frequency,
  setFrequency,
  category,
  setCategory,
  dueDayOfWeek,
  setDueDayOfWeek,
  dueDayOfMonth,
  setDueDayOfMonth,
  dueMonth,
  setDueMonth,
}: {
  onSubmit: (e: React.FormEvent) => void;
  submitLabel: string;
  name: string;
  setName: (v: string) => void;
  amount: string;
  setAmount: (v: string) => void;
  frequency: Frequency | '';
  setFrequency: (v: Frequency) => void;
  category: string;
  setCategory: (v: string) => void;
  dueDayOfWeek: DayOfWeek | '';
  setDueDayOfWeek: (v: DayOfWeek | '') => void;
  dueDayOfMonth: string;
  setDueDayOfMonth: (v: string) => void;
  dueMonth: string;
  setDueMonth: (v: string) => void;
}) {
  const handleFrequencyChange = (v: Frequency) => {
    setFrequency(v);
    setDueDayOfWeek('');
    setDueDayOfMonth('');
    setDueMonth('');
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4 mt-4">
      <div className="space-y-2">
        <Label>Name</Label>
        <Input required value={name} onChange={e => setName(e.target.value)} placeholder="Netflix, Gym membership..." />
      </div>
      <div className="space-y-2">
        <Label>Amount</Label>
        <Input type="number" step="0.01" min="0.01" required value={amount} onChange={e => setAmount(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label>Frequency</Label>
        <Select value={frequency} onValueChange={v => handleFrequencyChange(v as Frequency)} required>
          <SelectTrigger><SelectValue placeholder="Select frequency" /></SelectTrigger>
          <SelectContent>
            {FREQUENCIES.map(f => (
              <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {frequency === 'weekly' && (
        <div className="space-y-2">
          <Label>Due day</Label>
          <Select value={dueDayOfWeek} onValueChange={v => setDueDayOfWeek(v as DayOfWeek)} required>
            <SelectTrigger><SelectValue placeholder="Day of week" /></SelectTrigger>
            <SelectContent>
              {DAYS_OF_WEEK.map(d => (
                <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {frequency === 'monthly' && (
        <div className="space-y-2">
          <Label>Due day</Label>
          <Select value={dueDayOfMonth} onValueChange={setDueDayOfMonth} required>
            <SelectTrigger><SelectValue placeholder="Day of month" /></SelectTrigger>
            <SelectContent>
              {DAYS_OF_MONTH.map(d => (
                <SelectItem key={d} value={String(d)}>{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {frequency === 'yearly' && (
        <>
          <div className="space-y-2">
            <Label>Due month</Label>
            <Select value={dueMonth} onValueChange={setDueMonth} required>
              <SelectTrigger><SelectValue placeholder="Month" /></SelectTrigger>
              <SelectContent>
                {MONTHS.map(m => (
                  <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Due day</Label>
            <Select value={dueDayOfMonth} onValueChange={setDueDayOfMonth} required>
              <SelectTrigger><SelectValue placeholder="Day of month" /></SelectTrigger>
              <SelectContent>
                {DAYS_OF_MONTH.map(d => (
                  <SelectItem key={d} value={String(d)}>{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
      )}

      <div className="space-y-2">
        <Label>Category</Label>
        <Select value={category} onValueChange={setCategory} required>
          <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
          <SelectContent>
            {CATEGORIES.map(c => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="pt-4">
        <Button type="submit" className="rounded-xl w-full bg-foreground text-background hover:bg-foreground/90">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

export default function Subscriptions() {
  const { formatAmount } = useCurrency();

  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [frequency, setFrequency] = useState<Frequency | ''>('');
  const [category, setCategory] = useState('');
  const [dueDayOfWeek, setDueDayOfWeek] = useState<DayOfWeek | ''>('');
  const [dueDayOfMonth, setDueDayOfMonth] = useState('');
  const [dueMonth, setDueMonth] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const fetchSubscriptions = async () => {
    try {
      setSubscriptions(await api.get<Subscription[]>('/api/subscriptions'));
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => { fetchSubscriptions(); }, []);

  const resetForm = () => {
    setName('');
    setAmount('');
    setFrequency('');
    setCategory('');
    setDueDayOfWeek('');
    setDueDayOfMonth('');
    setDueMonth('');
    setEditId(null);
  };

  const buildPayload = () => ({
    name,
    amount: Number(amount),
    frequency,
    category,
    dueDayOfWeek: frequency === 'weekly' ? dueDayOfWeek : undefined,
    dueDayOfMonth: frequency === 'monthly' || frequency === 'yearly' ? Number(dueDayOfMonth) : undefined,
    dueMonth: frequency === 'yearly' ? Number(dueMonth) : undefined,
  });

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/api/subscriptions', buildPayload());
      setIsAddOpen(false);
      resetForm();
      fetchSubscriptions();
    } catch (err) {
      console.error(err);
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editId) return;
    try {
      await api.put(`/api/subscriptions/${editId}`, buildPayload());
      setIsEditOpen(false);
      resetForm();
      fetchSubscriptions();
    } catch (err) {
      console.error(err);
    }
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    try {
      await api.delete(`/api/subscriptions/${deleteId}`);
      fetchSubscriptions();
    } catch (err) {
      console.error(err);
    }
  };

  const openEdit = (sub: Subscription) => {
    setEditId(sub._id);
    setName(sub.name);
    setAmount(sub.amount.toString());
    setFrequency(sub.frequency);
    setCategory(sub.category);
    setDueDayOfWeek(sub.dueDayOfWeek ?? '');
    setDueDayOfMonth(sub.dueDayOfMonth ? String(sub.dueDayOfMonth) : '');
    setDueMonth(sub.dueMonth ? String(sub.dueMonth) : '');
    setIsEditOpen(true);
  };

  const totals = computeSpendTotals(subscriptions);
  const categorySpend = computeCategorySpend(subscriptions);

  const frequencyLabel = (freq: Frequency) =>
    FREQUENCIES.find(f => f.value === freq)?.label ?? freq;

  const formProps = {
    name, setName, amount, setAmount, frequency, setFrequency, category, setCategory,
    dueDayOfWeek, setDueDayOfWeek, dueDayOfMonth, setDueDayOfMonth, dueMonth, setDueMonth,
  };

  return (
    <Layout>
      <div className="flex flex-col gap-6 sm:gap-8">

        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl sm:text-4xl font-bold tracking-tight sm:tracking-tighter">Subscriptions &amp; Recurring</h1>
            <p className="text-muted-foreground mt-1">Track recurring costs. Totals are normalized across all subscriptions.</p>
          </div>

          <div className="flex gap-3 flex-shrink-0">
            <Dialog open={isAddOpen} onOpenChange={open => { setIsAddOpen(open); if (!open) resetForm(); }}>
              <DialogTrigger asChild>
                <Button className="rounded-xl px-4 sm:px-6 bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm w-full sm:w-auto">
                  <Plus className="w-4 h-4 mr-2" /> Add subscription
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[425px] rounded-2xl">
                <DialogHeader><DialogTitle>Add subscription</DialogTitle></DialogHeader>
                <SubscriptionForm onSubmit={handleAdd} submitLabel="Save subscription" {...formProps} />
              </DialogContent>
            </Dialog>

            <Dialog open={isEditOpen} onOpenChange={open => { setIsEditOpen(open); if (!open) resetForm(); }}>
              <DialogContent className="sm:max-w-[425px] rounded-2xl">
                <DialogHeader><DialogTitle>Edit subscription</DialogTitle></DialogHeader>
                <SubscriptionForm onSubmit={handleEdit} submitLabel="Update subscription" {...formProps} />
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          {([
            { label: 'Daily', value: totals.daily },
            { label: 'Weekly', value: totals.weekly },
            { label: 'Monthly', value: totals.monthly },
            { label: 'Yearly', value: totals.yearly },
          ] as const).map(({ label, value }) => (
            <Card key={label} className="rounded-2xl p-4 sm:p-5 border shadow-sm min-w-0">
              <p className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-1">{label}</p>
              <p className="text-lg sm:text-2xl font-bold tracking-tight tabular-nums break-words">{formatAmount(value)}</p>
            </Card>
          ))}
        </div>

        <SubscriptionCategoryChart data={categorySpend} formatAmount={formatAmount} />

        <div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
            <h2 className="text-base font-semibold text-muted-foreground flex items-center gap-2">
              <Repeat className="w-4 h-4" />
              All subscriptions ({subscriptions.length})
            </h2>
          </div>

          <Card className="border shadow-sm bg-card rounded-2xl overflow-hidden hidden lg:block">
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow className="border-b border-muted">
                  <TableHead className="font-semibold text-xs uppercase tracking-wider">Name</TableHead>
                  <TableHead className="font-semibold text-xs uppercase tracking-wider">Category</TableHead>
                  <TableHead className="font-semibold text-xs uppercase tracking-wider text-right">Amount</TableHead>
                  <TableHead className="font-semibold text-xs uppercase tracking-wider">Frequency</TableHead>
                  <TableHead className="font-semibold text-xs uppercase tracking-wider">Due Date</TableHead>
                  <TableHead className="font-semibold text-xs uppercase tracking-wider text-right hidden xl:table-cell">~Monthly</TableHead>
                  <TableHead className="font-semibold text-xs uppercase tracking-wider text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subscriptions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                      No subscriptions yet. Add your first one to see spend totals.
                    </TableCell>
                  </TableRow>
                ) : (
                  subscriptions.map(sub => (
                    <TableRow key={sub._id} className="border-b border-muted/50 hover:bg-muted/20 transition-colors">
                      <TableCell className="font-semibold">{sub.name}</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted text-foreground">
                          {sub.category}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-bold whitespace-nowrap">
                        {formatAmount(sub.amount)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{frequencyLabel(sub.frequency)}</TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {formatDueDate(sub)}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground whitespace-nowrap hidden xl:table-cell">
                        {formatAmount(toMonthlyEquivalent(sub))}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-foreground" onClick={() => openEdit(sub)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive hover:bg-destructive/10" onClick={() => setDeleteId(sub._id)}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>

          <div className="lg:hidden space-y-3">
            {subscriptions.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground rounded-2xl border bg-card">
                No subscriptions yet. Add your first one to see spend totals.
              </div>
            ) : (
              subscriptions.map(sub => (
                <Card key={sub._id} className="rounded-2xl border shadow-sm bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">{sub.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatAmount(sub.amount)} / {frequencyLabel(sub.frequency).toLowerCase()}
                        {sub.frequency !== 'daily' && (
                          <> · Due {formatDueDate(sub)}</>
                        )}
                      </p>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-foreground">
                          {sub.category}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          ~{formatAmount(toMonthlyEquivalent(sub))}/mo
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <Button variant="ghost" size="icon" className="h-11 w-11 md:h-9 md:w-9 text-muted-foreground hover:text-foreground" onClick={() => openEdit(sub)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-11 w-11 md:h-9 md:w-9 text-destructive hover:bg-destructive/10" onClick={() => setDeleteId(sub._id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </Card>
              ))
            )}
          </div>
        </div>

      </div>

      <DeleteConfirmDialog
        open={deleteId !== null}
        onOpenChange={open => { if (!open) setDeleteId(null); }}
        title="Delete subscription?"
        description="This subscription will be permanently removed."
        onConfirm={confirmDelete}
      />
    </Layout>
  );
}
