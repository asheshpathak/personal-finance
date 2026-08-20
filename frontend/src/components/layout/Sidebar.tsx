import { Link, useLocation } from 'react-router-dom';
import { LogOut, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';
import { useQuickAdd } from '@/context/QuickAddContext';
import { Lockup } from './Wordmark';
import { PRIMARY_NAV, SECONDARY_NAV, isActivePath, type NavItem } from './nav';

/**
 * The pointer-device rail.
 *
 * Collapsed to icons between `md` and `lg` and full-width above it, because a
 * 256px rail on a 1024px laptop is a quarter of the window spent on
 * navigation. Hidden entirely on touch, where the bottom tab bar takes over —
 * a hamburger drawer is measurably worse on every metric that has been tested
 * (navigation is used less, found slower, and rated harder), and there is no
 * reason to ship one when four destinations fit along the bottom edge.
 */

/** Module scope, not inside Sidebar: a component declared inside another is a
 *  new type every render, forcing React to remount the whole nav each time. */
function RailLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      to={item.path}
      title={item.name}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'tactile group relative flex items-center gap-3 rounded-lg py-2.5 min-h-[44px]',
        'px-2.5 lg:px-3 justify-center lg:justify-start',
        'text-subhead font-medium transition-colors duration-150',
        active
          ? 'bg-primary-tint text-primary'
          : 'text-muted-foreground hover:bg-subtle hover:text-foreground'
      )}
    >
      <item.icon
        className={cn('h-[1.15rem] w-[1.15rem] flex-shrink-0', active && 'text-primary')}
        strokeWidth={active ? 2.3 : 1.9}
      />
      <span className="hidden lg:inline truncate">{item.name}</span>
    </Link>
  );
}

/** "ashesh.cosmid@gmail.com" → "Ashesh" — a name to greet, not an address. */
export function displayName(email: string | undefined): string {
  if (!email) return 'there';
  const handle = email.split('@')[0] ?? '';
  const first = handle.split(/[._\-+]/)[0] ?? handle;
  if (!first) return 'there';
  return first.charAt(0).toUpperCase() + first.slice(1);
}

export function Sidebar() {
  const location = useLocation();
  const { user, signOut } = useAuth();
  const { openQuickAdd } = useQuickAdd();

  return (
    /*
      self-start is load-bearing for the sticky: a flex child stretches to the
      container's full height by default, and an element as tall as its scroll
      area has nowhere to stick to. It stays pinned instead of scrolling away
      only once its own height is its content's.

      min-h-0 + overflow-y-auto lets a long nav scroll inside the rail rather
      than pushing the log-out button off-screen.
    */
    <aside className="hidden md:flex w-[72px] lg:w-[248px] h-dvh sticky top-0 self-start min-h-0 flex-col flex-shrink-0 border-r border-border bg-card">
      <div className="px-3 lg:px-4 pt-6 pb-4">
        <Link to="/" className="tactile block px-1">
          <Lockup compact />
        </Link>
      </div>

      <div className="px-3 lg:px-4 pb-4">
        <Button
          onClick={() => openQuickAdd()}
          className="w-full justify-center lg:justify-start gap-2 px-0 lg:px-4"
          title="Record a payment"
        >
          <Plus className="h-[1.05rem] w-[1.05rem]" strokeWidth={2.5} />
          <span className="hidden lg:inline">Record</span>
        </Button>
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto overscroll-contain no-scrollbar px-3 lg:px-4">
        <nav className="space-y-0.5">
          {PRIMARY_NAV.map(item => (
            <RailLink key={item.path} item={item} active={isActivePath(item.path, location.pathname)} />
          ))}
        </nav>

        <div className="my-4 hairline-t" />

        <nav className="space-y-0.5 pb-4">
          {SECONDARY_NAV.map(item => (
            <RailLink key={item.path} item={item} active={isActivePath(item.path, location.pathname)} />
          ))}
        </nav>
      </div>

      <div className="flex-shrink-0 border-t border-border p-3 lg:p-4">
        <div className="hidden lg:block min-w-0 mb-2 px-1">
          <p className="text-subhead font-semibold truncate">{displayName(user?.email)}</p>
          <p className="text-caption text-muted-foreground truncate" title={user?.email}>
            {user?.email ?? 'Signed in'}
          </p>
        </div>
        <Button
          variant="ghost"
          className="w-full justify-center lg:justify-start gap-3 px-0 lg:px-3 text-muted-foreground hover:text-foreground"
          onClick={() => signOut()}
          title="Log out"
        >
          <LogOut className="h-[1.05rem] w-[1.05rem]" />
          <span className="hidden lg:inline">Log out</span>
        </Button>
      </div>
    </aside>
  );
}
