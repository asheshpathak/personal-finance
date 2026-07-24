import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Home, PieChart, Wallet, Settings, LogOut, Briefcase, ReceiptText, Repeat, Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { lockBodyScroll } from '@/lib/bodyScrollLock';

const navItems = [
  { name: 'Dashboard', icon: Home, path: '/' },
  { name: 'Expenses', icon: ReceiptText, path: '/expenses' },
  { name: 'Subscriptions', icon: Repeat, path: '/subscriptions' },
  { name: 'Analytics', icon: PieChart, path: '/analytics' },
  { name: 'Budgets', icon: Briefcase, path: '/budgets' },
  { name: 'Wallet', icon: Wallet, path: '/wallet' },
  { name: 'Settings', icon: Settings, path: '/settings' },
];

/** Module scope, not inside Sidebar: a component declared inside another is a
 *  new type every render, forcing React to remount the whole nav each time. */
function NavLink({
  item,
  mobile = false,
  isActive,
  onNavigate,
}: {
  item: (typeof navItems)[number];
  mobile?: boolean;
  isActive: boolean;
  onNavigate: () => void;
}) {
  return (
    <Link to={item.path} onClick={onNavigate} title={item.name} className="group relative block">
      {/* Active indicator: a short violet bar on the left edge. */}
      <span
        className={cn(
          'absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-primary transition-all duration-200',
          isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-40',
          !mobile && 'lg:block hidden'
        )}
      />
      <span
        className={cn(
          'flex items-center gap-3.5 rounded-xl py-3 min-h-[44px] text-sm font-semibold transition-all duration-200',
          mobile ? 'px-3.5' : 'px-3 lg:px-3.5 justify-center lg:justify-start',
          isActive
            ? 'bg-white/[0.08] text-foreground'
            : 'text-muted-foreground hover:bg-white/[0.04] hover:text-foreground'
        )}
      >
        <item.icon
          className={cn(
            'h-[1.15rem] w-[1.15rem] flex-shrink-0 transition-colors',
            isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'
          )}
        />
        <span className={cn(!mobile && 'hidden lg:inline')}>{item.name}</span>
      </span>
    </Link>
  );
}

function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-grad-from to-grad-to shadow-glow flex-shrink-0">
        <span className="text-base font-extrabold leading-none text-white">T</span>
      </div>
      <span className={cn('text-xl font-extrabold tracking-tight', compact && 'hidden lg:inline')}>
        Tetra
      </span>
    </div>
  );
}

export function Sidebar() {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = () => {
    localStorage.removeItem('token');
    window.location.href = '/login';
  };

  useEffect(() => {
    if (!mobileOpen) return;
    return lockBodyScroll();
  }, [mobileOpen]);

  const isActive = (path: string) =>
    location.pathname === path || (path !== '/' && location.pathname.startsWith(path));
  const closeDrawer = () => setMobileOpen(false);

  return (
    <>
      {/* ── Desktop Sidebar (md+) ──────────────────────────── */}
      <aside className="hidden md:flex w-[76px] lg:w-64 h-dvh sticky top-0 flex-col justify-between py-6 px-3 lg:px-4 flex-shrink-0 border-r border-white/[0.06] bg-black/20 backdrop-blur-xl transition-all duration-300">
        <div className="min-w-0">
          <div className="px-1.5 lg:px-2 mb-8">
            <Wordmark compact />
          </div>

          <div className="mb-8 px-2 hidden lg:block">
            <h2 className="text-lg font-bold tracking-tight">Hi, User!</h2>
            <p className="text-sm text-muted-foreground">Welcome back</p>
          </div>

          <div className="px-2 mb-3 text-[11px] font-bold text-muted-foreground/70 tracking-[0.14em] uppercase hidden lg:block">
            Menu
          </div>

          <nav className="space-y-1">
            {navItems.map(item => (
              <NavLink key={item.name} item={item} isActive={isActive(item.path)} onNavigate={closeDrawer} />
            ))}
          </nav>
        </div>

        <div className="px-1">
          <Button
            variant="ghost"
            className="w-full justify-start gap-3.5 px-3.5 text-muted-foreground hover:text-foreground rounded-xl hidden lg:flex"
            onClick={handleLogout}
          >
            <LogOut className="h-[1.15rem] w-[1.15rem]" />
            Log out
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="w-full text-muted-foreground hover:text-foreground rounded-xl flex lg:hidden"
            onClick={handleLogout}
            title="Log out"
          >
            <LogOut className="h-[1.15rem] w-[1.15rem]" />
          </Button>
        </div>
      </aside>

      {/* ── Mobile Top Bar ────────────────────────────────── */}
      <header className="md:hidden fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 h-14 bg-background/70 backdrop-blur-xl border-b border-white/[0.06] pt-[env(safe-area-inset-top)] box-content">
        <Wordmark />
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setMobileOpen(!mobileOpen)}
          className="rounded-xl h-11 w-11"
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
      </header>

      {/* ── Mobile Drawer ─────────────────────────────────── */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm animate-in fade-in"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <div
        className={cn(
          'md:hidden fixed top-[calc(3.5rem+env(safe-area-inset-top))] left-0 bottom-0 z-50 w-72 max-w-[85vw] bg-[hsl(250_22%_8%)] border-r border-white/[0.06] shadow-elevated transition-transform duration-300 ease-out flex flex-col',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex flex-col h-full py-6 px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] overflow-y-auto overscroll-contain">
          <div className="mb-6">
            <h2 className="text-lg font-bold tracking-tight">Hi, User!</h2>
            <p className="text-sm text-muted-foreground">Welcome back</p>
          </div>
          <div className="px-2 mb-3 text-[11px] font-bold text-muted-foreground/70 tracking-[0.14em] uppercase">
            Menu
          </div>
          <nav className="space-y-1 flex-1 min-h-0">
            {navItems.map(item => (
              <NavLink key={item.name} item={item} mobile isActive={isActive(item.path)} onNavigate={closeDrawer} />
            ))}
          </nav>
          <div className="pt-4 border-t border-white/[0.06] mt-4">
            <Button
              variant="ghost"
              className="w-full justify-start gap-3.5 px-3.5 text-muted-foreground hover:text-foreground rounded-xl"
              onClick={handleLogout}
            >
              <LogOut className="h-[1.15rem] w-[1.15rem]" />
              Log out
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
