import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Sidebar } from './Sidebar';
import { TabBar } from './TabBar';
import { Wordmark } from './Wordmark';
import { ALL_NAV, isActivePath } from './nav';

/**
 * The mobile top bar.
 *
 * Glass, and it earns the material: it is the functional layer floating over
 * content, which is precisely where iOS says this belongs and precisely where
 * a card does not.
 *
 * The title cross-fades in only once the page has scrolled, which is the
 * large-title collapse from every system app. Before the scroll the page's own
 * heading is on screen and a second copy in the bar would be redundant; after
 * it, the bar becomes the only thing telling you where you are.
 */
function TopBar({ title }: { title: string }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    // 24px, roughly the point where a large title has started leaving. Passive,
    // because a scroll listener that can call preventDefault forces the browser
    // to wait for it before painting the next frame.
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={cn(
        'md:hidden fixed inset-x-0 top-0 z-40 flex items-center gap-3 px-4 h-14 box-content',
        'pt-[env(safe-area-inset-top)]',
        'transition-[background-color,box-shadow] duration-300',
        scrolled ? 'glass' : 'bg-background'
      )}
    >
      <Link
        to="/"
        className="tactile -m-2 flex flex-shrink-0 items-center justify-center p-2"
        aria-label="Tetra home"
      >
        <Wordmark size={28} />
      </Link>

      <span
        className={cn(
          'min-w-0 flex-1 truncate text-headline transition-opacity duration-200',
          scrolled ? 'opacity-100' : 'opacity-0'
        )}
        aria-hidden={!scrolled}
      >
        {title}
      </span>
    </header>
  );
}

/**
 * The back link for a page that is a level down.
 *
 * Rendered inside the content rather than in the bar, so it scrolls away with
 * the heading it belongs to — the same behaviour a large-title screen has when
 * it is pushed onto a stack.
 */
export function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="tactile -ml-2 inline-flex h-11 w-fit items-center gap-0.5 rounded-full pl-1.5 pr-3.5 text-subhead font-medium text-primary hover:bg-primary-tint"
    >
      <ChevronLeft className="h-[1.15rem] w-[1.15rem]" strokeWidth={2.2} />
      {label}
    </Link>
  );
}

export function Layout({
  children,
  /** Shown in the mobile bar once the page has scrolled. */
  title,
  /** Widens the content column for pages that are mostly tables or charts. */
  wide = false,
}: {
  children: React.ReactNode;
  title?: string;
  wide?: boolean;
}) {
  const location = useLocation();
  const resolved =
    title ?? ALL_NAV.find(item => isActivePath(item.path, location.pathname))?.name ?? 'Tetra';

  // dvh, not vh: iOS resolves vh against the toolbar-retracted viewport, so
  // min-h-screen leaves ~100px of phantom scroll on every page.
  return (
    <div className="flex min-h-dvh bg-background">
      <Sidebar />

      {/*
        min-w-0 is load-bearing: a flex child defaults to min-width:auto, so any
        wide descendant (a table, a long unbroken string) forces this column
        wider than the viewport and the whole page scrolls sideways.

        No overflow-y here either — the sidebar is `sticky`, so the document
        itself should be the only vertical scroller. A second scroll container
        nested inside the page is what produces the "dead scroll" on iOS, where
        momentum gets captured by the wrong element.

        pt-topbar, not pt-14: the fixed mobile bar is 3.5rem *plus* the notch
        inset, so a flat 14 tucks the first heading under the status bar on
        every notched iPhone. pb-tabbar does the same job at the other end.
      */}
      <main className="flex-1 min-w-0 pt-topbar md:pt-0">
        <TopBar title={resolved} />

        <div
          className={cn(
            // pt-2 under the mobile bar, not pt-5: `pt-topbar` on <main> has
            // already cleared 3.5rem plus the notch, and stacking a comfortable
            // page inset on top of that pushed the large title a third of the
            // way down a phone screen.
            'mx-auto w-full min-w-0 px-4 sm:px-6 lg:px-8 pt-2 sm:pt-8',
            'pb-tabbar md:pb-16',
            wide ? 'max-w-[88rem]' : 'max-w-5xl'
          )}
        >
          {children}
        </div>
      </main>

      <TabBar />
    </div>
  );
}
