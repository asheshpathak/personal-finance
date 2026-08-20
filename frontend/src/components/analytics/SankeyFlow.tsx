import { useId, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { useCurrency } from '@/context/CurrencyContext';
import { buildCashFlow, type FlowExpense } from '@/lib/cashflow';
import { categoricalColor } from '@/lib/chartTheme';

/**
 * Where the money actually went.
 *
 * The most screenshotted artefact in personal finance, and for a reason no pie
 * chart can match: a pie answers "what share of spending was groceries", while
 * this answers "of the money that came in, what happened to it" — including the
 * part that didn't go anywhere, which is the part people are looking for.
 *
 * Rendered as plain SVG rather than through a charting library. The layout is a
 * strict three-column flow with no cycles; a general graph solver is a
 * dependency bought to avoid forty lines of arithmetic.
 *
 * The accessible path is not the diagram. An SVG of thirty ribbons is
 * unreadable to a screen reader whatever you label it, so the whole graphic is
 * hidden from the accessibility tree and the same numbers are offered as a
 * table — which doubles as the better mobile view.
 */
export function SankeyFlow({
  expenses,
  income,
  className,
}: {
  expenses: FlowExpense[];
  income?: number;
  className?: string;
}) {
  const { formatAmount, formatCompact } = useCurrency();
  const gradientId = useId();
  const [hovered, setHovered] = useState<string | null>(null);

  const flow = useMemo(
    () => buildCashFlow({ expenses, income: income ?? 0, width: 760, height: 460 }),
    [expenses, income]
  );

  if (flow.nodes.length < 2) return null;

  return (
    <div className={cn('min-w-0', className)}>
      {/* The diagram scrolls rather than shrinking. Below about 600px the
          labels collide and the ribbons become unreadable — a chart that is
          technically visible and practically illegible is worse than one that
          asks for a swipe. */}
      <div className="scroll-x no-scrollbar -mx-1 px-1">
        <svg
          viewBox={`0 0 ${flow.width} ${flow.height}`}
          width={flow.width}
          height={flow.height}
          role="img"
          aria-hidden="true"
          className="h-auto w-full min-w-[640px]"
        >
          <defs>
            {flow.links.map((link, index) => (
              <linearGradient
                key={`${gradientId}-${index}`}
                id={`${gradientId}-${index}`}
                x1="0"
                y1="0"
                x2="1"
                y2="0"
              >
                {/* The ribbon fades along its length, so a dense column of
                    arrivals doesn't turn into a solid block of colour. */}
                <stop offset="0%" stopColor={categoricalColor(link.accent)} stopOpacity={0.32} />
                <stop offset="100%" stopColor={categoricalColor(link.accent)} stopOpacity={0.16} />
              </linearGradient>
            ))}
          </defs>

          {flow.links.map((link, index) => {
            const active = hovered === null || hovered === link.target || hovered === link.source;
            return (
              <path
                key={`${link.source}-${link.target}`}
                d={link.path}
                fill={`url(#${gradientId}-${index})`}
                className="transition-opacity duration-200"
                opacity={active ? 1 : 0.22}
                onMouseEnter={() => setHovered(link.target)}
                onMouseLeave={() => setHovered(null)}
              />
            );
          })}

          {flow.nodes.map(node => {
            const active = hovered === null || hovered === node.id;
            // The source bar is ink-coloured in a lot of Sankey examples and it
            // reads as a bug on a light canvas — a black slab beside eight
            // coloured ones. It is the trunk of the diagram, so it takes the
            // brand hue.
            const color =
              node.depth === 0 ? 'hsl(var(--primary))' : categoricalColor(node.accent);
            // Leaf labels sit outside the bar on the right; everything else
            // reads left-to-right from its own bar.
            const leaf = node.depth === 2;

            return (
              <g
                key={node.id}
                className="transition-opacity duration-200"
                opacity={active ? 1 : 0.3}
                onMouseEnter={() => setHovered(node.id)}
                onMouseLeave={() => setHovered(null)}
              >
                <rect
                  x={node.x}
                  y={node.y}
                  width={node.width}
                  height={node.height}
                  rx={Math.min(node.width / 2, 6)}
                  fill={color}
                />
                <text
                  x={leaf ? node.x - 8 : node.x + node.width + 8}
                  y={node.y + node.height / 2}
                  dominantBaseline="middle"
                  textAnchor={leaf ? 'end' : 'start'}
                  className="fill-foreground text-[12px] font-semibold"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {node.label}
                </text>
                <text
                  x={leaf ? node.x - 8 : node.x + node.width + 8}
                  y={node.y + node.height / 2 + 14}
                  dominantBaseline="middle"
                  textAnchor={leaf ? 'end' : 'start'}
                  className="fill-muted-foreground text-[11px]"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {formatCompact(node.value)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* ── The same thing, readable ─────────────────────────────────────── */}
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-footnote">
        {flow.nodes
          .filter(node => node.depth === 1)
          .map(node => (
            <span key={node.id} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                style={{ backgroundColor: categoricalColor(node.accent) }}
              />
              <span className="text-muted-foreground">{node.label}</span>
              <span className="font-semibold tnum">{formatAmount(node.value)}</span>
            </span>
          ))}
      </div>

      {flow.incomeKnown && (
        <p className="mt-3 text-footnote text-muted-foreground">
          {flow.net >= 0 ? (
            <>
              <span className="font-semibold text-positive-text tnum">
                {formatAmount(flow.net)}
              </span>{' '}
              of {formatAmount(flow.inflow)} never left.
            </>
          ) : (
            <>
              Spending exceeded income by{' '}
              <span className="font-semibold text-destructive-text tnum">
                {formatAmount(Math.abs(flow.net))}
              </span>
              .
            </>
          )}
        </p>
      )}
    </div>
  );
}
