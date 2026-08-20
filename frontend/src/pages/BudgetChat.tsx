import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, Loader2, Sparkles, Square, Wallet } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { PageHeader, EmptyState } from '@/components/ui/section';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useCurrency } from '@/context/CurrencyContext';
import { useDataRefresh } from '@/context/DataRefreshContext';
import { api, ApiError } from '@/lib/api';
import { formatDayRange, fromDayKey } from '@/lib/dates';
import { aiStatus, streamBudgetChat, type BudgetProposal, type ChatTurn } from '@/lib/ai';
import { cn } from '@/lib/utils';

/**
 * Building a budget by talking about it.
 *
 * The case for this over the form is narrow and, I think, sound. A budget form
 * asks for a number per category and can offer a median from history as a hint.
 * What it cannot do is *argue*. "Cut dining out to ₹6,000" is a sentence a form
 * accepts silently and a person should hear an answer to — you have been over
 * ₹12,000 in five of the last six months, so this is the line that breaks
 * first, and here is the rest of the plan rebalanced around your decision
 * anyway.
 *
 * The proposal is a **draft**, always. It lands in the app as an editable
 * budget that is not in force and does not touch the dashboard until someone
 * activates it. That boundary is the whole safety story: the worst a bad
 * completion can do is propose a wrong number that a human then edits.
 */

const STARTERS = [
  'Build me a budget for this month.',
  'I want to save more. What should I change?',
  'Plan next month assuming a lean income.',
  "I'm trying to clear my debts faster — build a plan around that.",
];

interface Message extends ChatTurn {
  streaming?: boolean;
}

export default function BudgetChat() {
  const { formatRounded } = useCurrency();
  const { refresh } = useDataRefresh();
  const navigate = useNavigate();

  const [available, setAvailable] = useState<boolean | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [proposal, setProposal] = useState<BudgetProposal | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    aiStatus().then(status => { if (!cancelled) setAvailable(status.configured); });
    return () => {
      cancelled = true;
      // Leaving stops the generation. Otherwise the server keeps producing
      // tokens nobody will read, and they are billed.
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [messages, proposal]);

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;

    setDraft('');
    setError(null);
    setBusy(true);
    setThinking(false);
    // A new turn supersedes the plan on screen. Leaving the old one visible
    // while a revision streams in is how someone saves the version they were
    // just told was wrong.
    setSavedId(null);

    const history = messages.map(({ role, content }) => ({ role, content }));

    setMessages(prev => [
      ...prev,
      { role: 'user', content: question },
      { role: 'assistant', content: '', streaming: true },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;

    const appendToLast = (chunk: string) =>
      setMessages(prev =>
        prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: m.content + chunk } : m))
      );

    const settle = () =>
      setMessages(prev => prev.map((m, i) => (i === prev.length - 1 ? { ...m, streaming: false } : m)));

    try {
      await streamBudgetChat(
        question,
        history,
        {
          onDelta: appendToLast,
          onTool: () => setThinking(true),
          onProposal: next => { setProposal(next); setThinking(false); },
          onError: message => { setError(message); settle(); },
          onDone: () => { settle(); setBusy(false); setThinking(false); },
        },
        controller.signal
      );
    } catch (err) {
      if (controller.signal.aborted) {
        settle();
      } else {
        setError(err instanceof ApiError ? err.message : 'Could not reach the planner.');
        setMessages(prev =>
          prev[prev.length - 1]?.content === ''
            ? prev.slice(0, -1)
            : prev.map((m, i) => (i === prev.length - 1 ? { ...m, streaming: false } : m))
        );
      }
      setBusy(false);
      setThinking(false);
    } finally {
      abortRef.current = null;
    }
  };

  /**
   * Saves the plan as a draft.
   *
   * Never active. A budget in force changes what the dashboard measures against
   * and what "safe to spend" means, and that is a decision a person makes
   * deliberately on the budgets page — not a side effect of a conversation.
   */
  const saveDraft = async () => {
    if (!proposal || saving) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await api.post<{ _id: string }>('/api/budgets', {
        label: proposal.label,
        notes: proposal.summary,
        startDate: proposal.startDate,
        endDate: proposal.endDate,
        isDraft: true,
        isActive: false,
        origin: 'ai',
        income: proposal.income,
        categories: proposal.categories.map(l => ({ name: l.name, allocatedAmount: l.allocatedAmount })),
        savings: proposal.savings.map(l => ({ name: l.name, allocatedAmount: l.allocatedAmount })),
        investments: proposal.investments.map(l => ({ name: l.name, allocatedAmount: l.allocatedAmount })),
        subscriptions: proposal.subscriptions,
        debts: proposal.debts,
      });
      setSavedId(saved._id);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save that plan.');
    } finally {
      setSaving(false);
    }
  };

  if (available === false) {
    return (
      <Layout title="Plan with AI">
        <PageHeader title="Plan a budget" lede="Talk it through, and get a draft you can edit." />
        <EmptyState
          className="mt-6"
          icon={Sparkles}
          title="AI isn't set up on this server"
          body="Set ANTHROPIC_API_KEY in the backend environment and this becomes available. The budget form works without it, and so does everything else."
        />
      </Layout>
    );
  }

  return (
    <Layout title="Plan with AI">
      <div className="flex flex-col gap-5 min-w-0">
        <PageHeader
          title="Plan a budget"
          lede="Talk it through. Nothing is saved until you say so, and what you save is a draft."
        />

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
          {/* ── Conversation ────────────────────────────────────────── */}
          <div className="flex flex-col gap-4 min-w-0">
            {messages.length === 0 ? (
              <div className="rounded-2xl border border-border bg-card p-6 shadow-card sm:p-8">
                <div className="flex flex-col items-center text-center">
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-tint text-primary">
                    <Wallet className="h-5 w-5" />
                  </span>
                  <p className="mt-4 text-title-3">Let's work out a plan</p>
                  <p className="mt-1.5 max-w-md text-subhead text-muted-foreground">
                    It starts from what is already known — your income, your instalments, your
                    subscriptions, and what every category has actually cost you. Then you argue with it.
                  </p>
                </div>

                <div className="mt-6 grid gap-2 sm:grid-cols-2">
                  {STARTERS.map(starter => (
                    <button
                      key={starter}
                      type="button"
                      onClick={() => void send(starter)}
                      className="tactile rounded-xl bg-subtle p-3.5 text-left text-subhead hover:bg-hover"
                    >
                      {starter}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-4 min-w-0">
                {messages.map((message, index) => (
                  <div
                    key={index}
                    className={cn('flex min-w-0', message.role === 'user' ? 'justify-end' : 'justify-start')}
                  >
                    <div
                      className={cn(
                        'min-w-0 max-w-[46rem] rounded-2xl px-4 py-3',
                        message.role === 'user'
                          ? 'bg-primary text-primary-foreground rounded-br-md'
                          : 'bg-card border border-border shadow-card rounded-bl-md'
                      )}
                    >
                      {message.role === 'assistant' && message.content === '' && message.streaming ? (
                        <span className="flex items-center gap-2 text-subhead text-muted-foreground">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          {thinking ? 'Working out the numbers…' : 'Thinking…'}
                        </span>
                      ) : (
                        <p className="whitespace-pre-wrap text-row">
                          {message.content}
                          {message.streaming && (
                            <span className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[2px] animate-pulse bg-current align-baseline" />
                          )}
                        </p>
                      )}
                    </div>
                  </div>
                ))}

                {error && (
                  <p role="alert" className="rounded-xl bg-destructive-tint px-4 py-3 text-footnote text-destructive-text">
                    {error}
                  </p>
                )}

                <div ref={endRef} />
              </div>
            )}

            {/* ── Composer ──────────────────────────────────────────── */}
            <div
              className={cn(
                'sticky z-30 rounded-2xl border border-border bg-card p-2 shadow-card',
                'bottom-[calc(var(--tabbar-height)+0.5rem)] md:bottom-6'
              )}
            >
              <form
                onSubmit={event => { event.preventDefault(); void send(draft); }}
                className="flex items-end gap-2"
              >
                <textarea
                  value={draft}
                  onChange={event => {
                    setDraft(event.target.value);
                    const el = event.target;
                    el.style.height = 'auto';
                    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
                  }}
                  onKeyDown={event => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void send(draft);
                    }
                  }}
                  rows={1}
                  placeholder={proposal ? 'Ask for a change…' : 'What are you planning?'}
                  aria-label="Your message"
                  className={cn(
                    'min-h-[2.75rem] flex-1 resize-none rounded-xl bg-transparent px-3 py-2.5',
                    // 16px on touch, or iOS zooms the viewport on focus and
                    // never zooms back.
                    'text-callout md:text-subhead placeholder:text-faint focus:outline-none'
                  )}
                />

                {busy ? (
                  <Button
                    type="button"
                    size="icon"
                    variant="secondary"
                    onClick={() => { abortRef.current?.abort(); setBusy(false); }}
                    aria-label="Stop"
                  >
                    <Square className="h-3.5 w-3.5 fill-current" />
                  </Button>
                ) : (
                  <Button type="submit" size="icon" disabled={!draft.trim()} aria-label="Send">
                    <ArrowUp strokeWidth={2.5} />
                  </Button>
                )}
              </form>
            </div>
          </div>

          {/* ── The plan ────────────────────────────────────────────── */}
          <aside className="min-w-0 lg:sticky lg:top-6 lg:self-start">
            {proposal ? (
              <div className="rounded-2xl border border-border bg-card shadow-card min-w-0">
                <div className="border-b border-border p-4 sm:p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-headline">{proposal.label}</h2>
                    <Badge tone="primary" size="sm">Draft</Badge>
                  </div>
                  <p className="mt-1 text-caption text-muted-foreground">
                    {formatDayRange(fromDayKey(proposal.startDate), fromDayKey(proposal.endDate))}
                  </p>
                  {proposal.summary && (
                    <p className="mt-2 text-footnote text-muted-foreground">{proposal.summary}</p>
                  )}
                </div>

                <div className="max-h-[26rem] overflow-y-auto p-4 sm:p-5">
                  <PlanGroup title="Income" lines={[{ name: 'Take-home', allocatedAmount: proposal.income }]} formatRounded={formatRounded} />
                  {proposal.debts.length > 0 && (
                    <PlanGroup
                      title="Instalments"
                      lines={proposal.debts.map(d => ({ name: d.name, allocatedAmount: d.amount }))}
                      formatRounded={formatRounded}
                    />
                  )}
                  {proposal.subscriptions.length > 0 && (
                    <PlanGroup
                      title="Subscriptions"
                      lines={proposal.subscriptions.map(s => ({ name: s.name, allocatedAmount: s.amount }))}
                      formatRounded={formatRounded}
                    />
                  )}
                  <PlanGroup title="Spending" lines={proposal.categories} formatRounded={formatRounded} />
                  <PlanGroup title="Savings" lines={proposal.savings} formatRounded={formatRounded} />
                  <PlanGroup title="Investments" lines={proposal.investments} formatRounded={formatRounded} />
                </div>

                <div className="border-t border-border p-4 sm:p-5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-subhead text-muted-foreground">Left unallocated</span>
                    <span
                      className={cn(
                        'text-headline tnum',
                        proposal.totals.unallocated < 0 && 'text-destructive-text'
                      )}
                    >
                      {formatRounded(proposal.totals.unallocated)}
                    </span>
                  </div>

                  {proposal.totals.unallocated < 0 && (
                    <p className="mt-2 text-caption text-destructive-text">
                      This plan spends more than comes in. Ask for it to be brought back into line
                      before saving.
                    </p>
                  )}

                  {savedId ? (
                    <div className="mt-4 space-y-2">
                      <p className="flex items-center gap-2 text-subhead text-positive-text">
                        <Check className="h-4 w-4" strokeWidth={2.5} />
                        Saved as a draft
                      </p>
                      <Button variant="secondary" size="block" onClick={() => navigate(`/budgets/${savedId}/edit`)}>
                        Open and edit it
                      </Button>
                    </div>
                  ) : (
                    <Button className="mt-4" size="block" disabled={saving} onClick={() => void saveDraft()}>
                      {saving ? <><Loader2 className="animate-spin" />Saving…</> : 'Save as a draft'}
                    </Button>
                  )}

                  <p className="mt-3 text-caption text-muted-foreground">
                    A draft is not in force. Nothing on your dashboard changes until you activate it
                    from the budgets page.
                  </p>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-border p-6 text-center">
                <p className="text-subhead font-medium">No plan yet</p>
                <p className="mt-1 text-caption text-muted-foreground">
                  Once there is something worth showing, it appears here — and updates every time you
                  ask for a change.
                </p>
              </div>
            )}
          </aside>
        </div>
      </div>
    </Layout>
  );
}

function PlanGroup({
  title,
  lines,
  formatRounded,
}: {
  title: string;
  lines: { name: string; allocatedAmount: number; note?: string }[];
  formatRounded: (n: number) => string;
}) {
  if (lines.length === 0) return null;
  const total = lines.reduce((sum, l) => sum + l.allocatedAmount, 0);

  return (
    <div className="mb-5 last:mb-0 min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-overline uppercase text-faint">{title}</p>
        <p className="text-caption tnum text-muted-foreground">{formatRounded(total)}</p>
      </div>
      <ul className="mt-2 divide-y divide-border">
        {lines.map(line => (
          <li key={line.name} className="flex items-baseline justify-between gap-3 py-2 min-w-0">
            <div className="min-w-0">
              <p className="truncate text-subhead">{line.name}</p>
              {line.note && <p className="truncate text-caption text-muted-foreground">{line.note}</p>}
            </div>
            <p className="flex-shrink-0 text-subhead font-medium tnum">
              {formatRounded(line.allocatedAmount)}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
