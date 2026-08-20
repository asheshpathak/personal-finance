import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LogOut, MoreHorizontal, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { useQuickAdd } from '@/context/QuickAddContext';
import { lockBodyScroll } from '@/lib/bodyScrollLock';
import { PRIMARY_NAV, SECONDARY_NAV, isActivePath, type NavItem } from './nav';
import { displayName } from './Sidebar';

/**
 * The floating tab bar.
 *
 * A capsule inset from the edges rather than a bar welded to the bottom — the
 * iOS 26 shape, and better than the classic one for a practical reason as well
 * as a fashionable one: content scrolls *past* it rather than stopping at it,
 * so the page reads as continuing underneath.
 *
 * **Five equal grid columns, with the action in the middle one.** The obvious
 * construction — a flex row of tabs with the button pushed in between — centres
 * the button only when the two sides happen to hold the same number of items,
 * and it silently stops being centred the moment they don't. A grid puts the
 * button in the middle by arithmetic, whatever is on either side of it.
 *
 * **Icons only.** Two-word labels under an 11px cap do not fit five across at
 * 393px; they either truncate or force the bar taller than it deserves to be.
 * Dropping them costs the affordance a label provides, so three things pay it
 * back: a filled pill behind the active icon (so selection does not rest on
 * colour alone), a real accessible name on every tab, and the page title in the
 * top bar once the screen has scrolled.
 *
 * Glass here is correct and glass on a card is not: this is the *functional*
 * layer, floating above content, which is exactly what the material is for.
 */

function Tab({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      to={item.path}
      aria-current={active ? 'page' : undefined}
      // Both, deliberately: `aria-label` names it for assistive technology,
      // `title` gives a pointer user the tooltip an icon-only control owes them.
      aria-label={item.name}
      title={item.name}
      className="tactile flex min-w-0 items-center justify-center py-1"
    >
      <span
        className={cn(
          // 44px square, which is the touch minimum and also the pill.
          'flex h-11 w-11 items-center justify-center rounded-full transition-colors duration-200',
          active ? 'bg-primary-tint text-primary' : 'text-muted-foreground'
        )}
      >
        <item.icon className="h-[1.4rem] w-[1.4rem]" strokeWidth={active ? 2.4 : 1.9} />
      </span>
    </Link>
  );
}

export function TabBar() {
  const location = useLocation();
  const { openQuickAdd } = useQuickAdd();
  const [moreOpen, setMoreOpen] = useState(false);
  const { user, signOut } = useAuth();

  useEffect(() => {
    if (!moreOpen) return;
    return lockBodyScroll();
  }, [moreOpen]);

  // Any navigation closes the sheet — including a browser back gesture, which
  // otherwise leaves it open over the page you just returned to.
  //
  // Adjusted during render rather than in an effect: React re-runs this render
  // before committing, so the sheet is never briefly painted over the page you
  // just navigated to. (https://react.dev/learn/you-might-not-need-an-effect)
  const [lastPath, setLastPath] = useState(location.pathname);
  if (lastPath !== location.pathname) {
    setLastPath(location.pathname);
    setMoreOpen(false);
  }

  // Two on each side of the action. `PRIMARY_NAV` holds four for exactly this
  // reason; "More" is the fifth slot and takes the last column.
  const left = PRIMARY_NAV.slice(0, 2);
  const right = PRIMARY_NAV.slice(2, 3);
  const secondaryActive = SECONDARY_NAV.some(item => isActivePath(item.path, location.pathname));

  return (
    <>
      {/* ── The bar ──────────────────────────────────────────────────────── */}
      <nav
        aria-label="Main"
        className={cn(
          'md:hidden fixed z-40 left-3 right-3',
          // Inset above the home indicator rather than sitting on it. A control
          // under the gesture bar is a control that swipes the app away.
          'bottom-[max(0.75rem,env(safe-area-inset-bottom))]'
        )}
      >
        <div className="glass grid grid-cols-5 items-center rounded-[1.75rem] px-1.5 py-1.5">
          {left.map(item => (
            <Tab key={item.path} item={item} active={isActivePath(item.path, location.pathname)} />
          ))}

          {/* The middle column. Deliberately breaking the bar's top edge — an
              action that sits flush is just a fifth tab. */}
          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={() => openQuickAdd()}
              aria-label="Record a payment"
              title="Record a payment"
              className={cn(
                'tactile -mt-7 flex h-[3.5rem] w-[3.5rem] flex-shrink-0 items-center justify-center rounded-full',
                'bg-primary text-primary-foreground shadow-primary-glow',
                'ring-4 ring-background/70',
                'focus-visible:outline-none focus-visible:ring-[6px] focus-visible:ring-primary/30'
              )}
            >
              <Plus className="h-6 w-6" strokeWidth={2.6} />
            </button>
          </div>

          {right.map(item => (
            <Tab key={item.path} item={item} active={isActivePath(item.path, location.pathname)} />
          ))}

          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-label="More destinations"
            title="More"
            aria-expanded={moreOpen}
            className="tactile flex min-w-0 items-center justify-center py-1"
          >
            <span
              className={cn(
                'flex h-11 w-11 items-center justify-center rounded-full transition-colors duration-200',
                secondaryActive || moreOpen ? 'bg-primary-tint text-primary' : 'text-muted-foreground'
              )}
            >
              <MoreHorizontal
                className="h-[1.4rem] w-[1.4rem]"
                strokeWidth={secondaryActive || moreOpen ? 2.4 : 1.9}
              />
            </span>
          </button>
        </div>
      </nav>

      {/* ── "More" sheet ─────────────────────────────────────────────────── */}
      {moreOpen && (
        <div
          className="md:hidden fixed inset-0 z-50 bg-foreground/35 backdrop-blur-[2px] animate-fade-in"
          onClick={() => setMoreOpen(false)}
          aria-hidden="true"
        />
      )}

      <div
        role="dialog"
        aria-modal={moreOpen}
        aria-label="More destinations"
        aria-hidden={!moreOpen}
        className={cn(
          'md:hidden fixed inset-x-0 bottom-0 z-50 rounded-t-[1.75rem] bg-popover shadow-sheet',
          'max-h-[85dvh] overflow-y-auto overscroll-contain',
          'pb-[max(1.5rem,env(safe-area-inset-bottom))]',
          'transition-transform duration-[420ms] ease-ios',
          moreOpen ? 'translate-y-0' : 'translate-y-full',
          // Off-screen sheets stay in the DOM for the slide, so they must not
          // be focusable or hit-testable while closed — an invisible panel
          // catching touches is a classic phantom-scroll cause.
          !moreOpen && 'pointer-events-none invisible'
        )}
      >
        <div
          aria-hidden="true"
          className="mx-auto mt-2.5 mb-1 h-[5px] w-9 rounded-full bg-border-strong"
        />

        <div className="flex items-start justify-between gap-3 px-5 pt-3 pb-4">
          <div className="min-w-0">
            <p className="text-title-3">{displayName(user?.email)}</p>
            <p className="text-footnote text-muted-foreground truncate">{user?.email}</p>
          </div>
          <button
            type="button"
            onClick={() => setMoreOpen(false)}
            aria-label="Close"
            className="tactile flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
          >
            <X className="h-4 w-4" strokeWidth={2.5} />
          </button>
        </div>

        <div className="px-3 pb-3">
          {/* Whatever the bar could not fit, named in full. This is where the
              labels the tabs gave up actually live. */}
          {[...PRIMARY_NAV.slice(3), ...SECONDARY_NAV].map(item => (
            <Link
              key={item.path}
              to={item.path}
              onClick={() => setMoreOpen(false)}
              className={cn(
                'tactile flex items-center gap-3.5 rounded-lg px-3 py-3 min-h-[3.5rem]',
                isActivePath(item.path, location.pathname) ? 'bg-primary-tint' : 'active:bg-subtle'
              )}
            >
              <span
                className={cn(
                  'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[0.7rem]',
                  isActivePath(item.path, location.pathname)
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
                )}
              >
                <item.icon className="h-[1.15rem] w-[1.15rem]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-row font-medium truncate">{item.name}</span>
                {item.blurb && (
                  <span className="block text-footnote text-muted-foreground truncate">{item.blurb}</span>
                )}
              </span>
            </Link>
          ))}

          <button
            type="button"
            onClick={() => {
              setMoreOpen(false);
              signOut();
            }}
            className="tactile mt-2 flex w-full items-center gap-3.5 rounded-lg px-3 py-3 min-h-[3.5rem] text-left active:bg-subtle"
          >
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[0.7rem] bg-muted text-muted-foreground">
              <LogOut className="h-[1.15rem] w-[1.15rem]" />
            </span>
            <span className="text-row font-medium">Log out</span>
          </button>
        </div>
      </div>
    </>
  );
}
