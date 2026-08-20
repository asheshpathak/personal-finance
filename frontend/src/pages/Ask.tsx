import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Loader2, Search, Sparkles, Square } from 'lucide-react';
import { Layout } from '@/components/layout/Layout';
import { PageHeader, EmptyState } from '@/components/ui/section';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ApiError } from '@/lib/api';
import { aiStatus, streamChat, type ChatTurn } from '@/lib/ai';
import { Wordmark } from '@/components/layout/Wordmark';

/**
 * Ask Tetra.
 *
 * The case for this feature is narrow and, I think, sound: the app can chart
 * anything it was designed to chart, and nothing else. "How much did I spend at
 * that restaurant near the office in March" is not a chart anybody would build,
 * and it is exactly the shape of question people have about their own money.
 *
 * The assistant reads a summary of the last six months plus the recent
 * payments, and reaches into the full history through a read-only query tool
 * when the summary does not cover the question. It cannot write anything.
 */

const STARTERS = [
  'What did I spend the most on last month?',
  'How much do my subscriptions cost me a year?',
  'Am I spending more on eating out than I was three months ago?',
  'What was my biggest single payment this year?',
];

interface Message extends ChatTurn {
  /** True while tokens are still arriving into this message. */
  streaming?: boolean;
}

export default function Ask() {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [toolCalls, setToolCalls] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    aiStatus().then(status => { if (!cancelled) setAvailable(status.configured); });
    return () => {
      cancelled = true;
      // Leaving the page stops the generation. Otherwise the server keeps
      // producing tokens nobody will ever read, and they are billed.
      abortRef.current?.abort();
    };
  }, []);

  // Follow the answer as it streams. `block: 'end'` rather than
  // `scrollIntoView()` with defaults, which centres and makes the page jump
  // upward on the first token.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [messages]);

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;

    setDraft('');
    setError(null);
    setToolCalls(0);
    setBusy(true);

    // The history sent up is the conversation *before* this question — the
    // question itself goes in its own field, so the server can put it after the
    // cache breakpoint.
    const history = messages.map(({ role, content }) => ({ role, content }));

    setMessages(prev => [
      ...prev,
      { role: 'user', content: question },
      { role: 'assistant', content: '', streaming: true },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;

    /** Appends to the last message — the one currently streaming. */
    const appendToLast = (chunk: string) =>
      setMessages(prev =>
        prev.map((message, index) =>
          index === prev.length - 1 ? { ...message, content: message.content + chunk } : message
        )
      );

    const settle = () =>
      setMessages(prev =>
        prev.map((message, index) =>
          index === prev.length - 1 ? { ...message, streaming: false } : message
        )
      );

    try {
      await streamChat(
        question,
        history,
        {
          onDelta: appendToLast,
          onTool: count => setToolCalls(c => c + count),
          onError: message => {
            setError(message);
            settle();
          },
          onDone: () => {
            settle();
            setBusy(false);
          },
        },
        controller.signal
      );
    } catch (err) {
      if (controller.signal.aborted) {
        settle();
      } else {
        setError(err instanceof ApiError ? err.message : 'Could not reach the assistant.');
        // Drop the empty assistant turn rather than leaving a blank bubble.
        setMessages(prev => (prev[prev.length - 1]?.content === '' ? prev.slice(0, -1) : prev.map((m, i) => (i === prev.length - 1 ? { ...m, streaming: false } : m))));
      }
      setBusy(false);
    } finally {
      abortRef.current = null;
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    setBusy(false);
  };

  if (available === false) {
    return (
      <Layout title="Ask Tetra">
        <PageHeader title="Ask Tetra" lede="Questions about your own money, answered from your own data." />
        <EmptyState
          className="mt-6"
          icon={Sparkles}
          title="AI isn't set up on this server"
          body="Set ANTHROPIC_API_KEY in the backend environment and this becomes available. Everything else in the app works without it."
        />
      </Layout>
    );
  }

  return (
    <Layout title="Ask Tetra">
      <div className="flex flex-col gap-5 min-w-0">
        <PageHeader
          title="Ask Tetra"
          lede="Answered from your own payments. Nothing is ever changed — this can only read."
        />

        {/* ── Transcript ───────────────────────────────────────────────── */}
        {messages.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card shadow-card p-6 sm:p-8">
            <div className="flex flex-col items-center text-center">
              <Wordmark size={40} />
              <p className="mt-4 text-title-3">What would you like to know?</p>
              <p className="mt-1.5 max-w-md text-subhead text-muted-foreground">
                It reads your recorded payments, budgets and subscriptions — and looks further
                back when a question needs it.
              </p>
            </div>

            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              {STARTERS.map(starter => (
                <button
                  key={starter}
                  type="button"
                  onClick={() => void send(starter)}
                  className="tactile flex items-start gap-2.5 rounded-xl bg-subtle p-3.5 text-left text-subhead hover:bg-hover"
                >
                  <Search className="mt-[3px] h-4 w-4 flex-shrink-0 text-faint" />
                  <span className="min-w-0">{starter}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 min-w-0">
            {messages.map((message, index) => (
              <div
                key={index}
                className={cn(
                  'flex min-w-0',
                  message.role === 'user' ? 'justify-end' : 'justify-start'
                )}
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
                      {toolCalls > 0 ? 'Looking through your history…' : 'Thinking…'}
                    </span>
                  ) : (
                    // `whitespace-pre-wrap` rather than a markdown renderer: the
                    // prompt asks for short plain answers with no headers, and
                    // parsing markdown to render two paragraphs is a dependency
                    // and an injection surface bought for nothing.
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

        {/* ── Composer ─────────────────────────────────────────────────── */}
        <div
          className={cn(
            'sticky z-30 rounded-2xl border border-border bg-card p-2 shadow-card',
            // Above the tab bar on touch, at the foot of the column on a pointer.
            'bottom-[calc(var(--tabbar-height)+0.5rem)] md:bottom-6'
          )}
        >
          <form
            onSubmit={event => {
              event.preventDefault();
              void send(draft);
            }}
            className="flex items-end gap-2"
          >
            <textarea
              ref={inputRef}
              value={draft}
              onChange={event => {
                setDraft(event.target.value);
                // Grow with the content, capped. `auto` first, so shrinking
                // works too — without it the box only ever gets taller.
                const el = event.target;
                el.style.height = 'auto';
                el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
              }}
              onKeyDown={event => {
                // Enter sends, Shift+Enter breaks the line. The reverse is the
                // convention in a document editor and wrong in a message box.
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send(draft);
                }
              }}
              rows={1}
              placeholder="Ask about your spending…"
              aria-label="Your question"
              className={cn(
                'min-h-[2.75rem] flex-1 resize-none rounded-xl bg-transparent px-3 py-2.5',
                // 16px on touch, or iOS zooms the viewport on focus and never
                // zooms back.
                'text-callout md:text-subhead',
                'placeholder:text-faint focus:outline-none'
              )}
            />

            {busy ? (
              <Button type="button" size="icon" variant="secondary" onClick={stop} aria-label="Stop">
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
    </Layout>
  );
}
