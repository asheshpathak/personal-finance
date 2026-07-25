import { useId, useState } from 'react';
import { BarChart3, Table2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface TableColumn<T> {
  header: string;
  /** Right-aligned and tabular — use for every numeric column. */
  numeric?: boolean;
  cell: (row: T) => React.ReactNode;
}

/**
 * A chart with its table twin.
 *
 * Every chart here can be read without seeing colour or hovering anything: the
 * toggle swaps the plot for the same numbers as text, which is what keeps the
 * page usable with a screen reader, in print, or with any colour vision.
 */
export function ChartCard<T>({
  title,
  subtitle,
  action,
  rows,
  columns,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  /** Extra control rendered next to the view toggle (a legend, usually). */
  action?: React.ReactNode;
  rows: T[];
  columns: TableColumn<T>[];
  children: React.ReactNode;
  className?: string;
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const panelId = useId();

  return (
    <Card className={cn('rounded-2xl border shadow-sm p-4 sm:p-6 min-w-0', className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4">
        <div className="min-w-0">
          <h2 className="text-base font-bold tracking-tight">{title}</h2>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          {action}
          <div className="flex rounded-lg bg-white/[0.04] p-0.5" role="group" aria-label={`${title} view`}>
            {([
              { key: 'chart', label: 'Chart', Icon: BarChart3 },
              { key: 'table', label: 'Table', Icon: Table2 },
            ] as const).map(({ key, label, Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setView(key)}
                aria-pressed={view === key}
                aria-controls={panelId}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-2.5 h-9 md:h-8 text-xs font-semibold transition-colors',
                  view === key ? 'bg-white/[0.10] text-foreground' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="sr-only sm:not-sr-only">{label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div id={panelId} className="min-w-0">
        {view === 'chart' ? (
          children
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Nothing to show for this selection.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.08]">
                  {columns.map(col => (
                    <th
                      key={col.header}
                      scope="col"
                      className={cn(
                        'py-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap',
                        col.numeric ? 'text-right pl-4' : 'text-left'
                      )}
                    >
                      {col.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className="border-b border-white/[0.05] last:border-0">
                    {columns.map(col => (
                      <td
                        key={col.header}
                        className={cn(
                          'py-2 whitespace-nowrap',
                          col.numeric ? 'text-right tabular-nums pl-4' : 'text-left'
                        )}
                      >
                        {col.cell(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}
