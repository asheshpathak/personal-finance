import { createContext, useCallback, useContext, useMemo, useState } from 'react';

/**
 * The one way to open the quick-add sheet.
 *
 * The sheet is mounted once in the app shell rather than per page, for a reason
 * that shows up immediately on a phone: a sheet mounted inside a route unmounts
 * mid-animation when that route changes, and a half-recorded expense
 * disappears. Mounted above the router it survives navigation, and there is
 * exactly one instance of the form's state in the app.
 */

export type QuickAddMode = 'keypad' | 'form';

interface QuickAddValue {
  open: boolean;
  mode: QuickAddMode;
  /** Opens the sheet. `keypad` is the fast path; `form` is the full one. */
  openQuickAdd: (mode?: QuickAddMode) => void;
  close: () => void;
  setMode: (mode: QuickAddMode) => void;
}

const QuickAddContext = createContext<QuickAddValue | undefined>(undefined);

export function QuickAddProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<QuickAddMode>('keypad');

  const openQuickAdd = useCallback((next: QuickAddMode = 'keypad') => {
    setMode(next);
    setOpen(true);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  const value = useMemo(
    () => ({ open, mode, openQuickAdd, close, setMode }),
    [open, mode, openQuickAdd, close]
  );

  return <QuickAddContext.Provider value={value}>{children}</QuickAddContext.Provider>;
}

export function useQuickAdd(): QuickAddValue {
  const ctx = useContext(QuickAddContext);
  if (!ctx) throw new Error('useQuickAdd must be used within QuickAddProvider');
  return ctx;
}
