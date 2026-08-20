import { useEffect, useState } from 'react';

/**
 * A media query as React state.
 *
 * The initial value is read synchronously rather than defaulting to false and
 * correcting in an effect. The naive version renders the mobile tree once on a
 * desktop, then swaps — which on a page with a chart means mounting it twice
 * and, worse, means any component keyed on the breakpoint loses its state on
 * first paint.
 */
const read = (query: string): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches
    : false;

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => read(query));

  // A changed query is answered during render rather than in an effect: React
  // re-runs this render before committing, so the caller never sees one frame
  // of the *old* query's answer. The effect below is left with the one thing it
  // is genuinely for — subscribing to an external system.
  // (https://react.dev/learn/you-might-not-need-an-effect)
  const [subscribed, setSubscribed] = useState(query);
  if (subscribed !== query) {
    setSubscribed(query);
    setMatches(read(query));
  }

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    const list = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);

    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** The one breakpoint that does most of the work: tabs → sidebar, sheet → dialog. */
export const useIsDesktop = () => useMediaQuery('(min-width: 768px)');

/** Motion is reduced. Checked in JS as well as CSS, so a transition can be
 *  skipped entirely rather than merely shortened. */
export const usePrefersReducedMotion = () => useMediaQuery('(prefers-reduced-motion: reduce)');

/** Running from the home screen rather than a browser tab. */
export const useIsStandalone = () => useMediaQuery('(display-mode: standalone)');
