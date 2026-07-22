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
    <Link to={item.path} onClick={onNavigate} title={item.name}>
      <span
        className={cn(
          'flex items-center gap-3 rounded-xl py-3 min-h-[44px] text-sm font-medium transition-all duration-200',
          mobile ? 'px-3' : 'px-2 lg:px-3 justify-center lg:justify-start',
          isActive
            ? 'bg-foreground text-background shadow-sm'
            : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
        )}
      >
        <item.icon className="h-4 w-4 flex-shrink-0" />
        <span className={cn(!mobile && 'hidden lg:inline')}>{item.name}</span>
      </span>
    </Link>
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
      <div className="hidden md:flex w-16 lg:w-64 border-r bg-background/50 backdrop-blur-xl h-dvh sticky top-0 flex-col justify-between py-6 px-2 lg:px-4 flex-shrink-0 transition-all duration-300">
        <div>
          {/* Logo */}
          <div className="flex items-center gap-2 px-2 mb-8">
            <div className="w-8 h-8 bg-foreground rounded-lg flex items-center justify-center flex-shrink-0">
              <span className="text-background font-bold text-lg leading-none">T</span>
            </div>
            <span className="font-bold tracking-tight text-xl hidden lg:inline">Tetra</span>
          </div>

          {/* Greeting */}
          <div className="mb-8 px-2 hidden lg:block">
            <h2 className="text-lg font-semibold tracking-tight">Hi, User!</h2>
            <p className="text-sm text-muted-foreground">Welcome back</p>
          </div>

          {/* Nav label */}
          <div className="px-2 mb-2 text-xs font-semibold text-muted-foreground tracking-wider uppercase hidden lg:block">
            Overview
          </div>

          <nav className="space-y-1">
            {navItems.map((item) => (
              <NavLink key={item.name} item={item} isActive={isActive(item.path)} onNavigate={closeDrawer} />
            ))}
          </nav>
        </div>

        {/* Logout */}
        <div className="px-2">
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-xl hidden lg:flex"
            onClick={handleLogout}
          >
            <LogOut className="h-4 w-4" />
            Log out
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="w-full text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-xl flex lg:hidden"
            onClick={handleLogout}
            title="Log out"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* ── Mobile Top Bar ────────────────────────────────── */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 h-14 bg-background/80 backdrop-blur-xl border-b pt-[env(safe-area-inset-top)] box-content">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-foreground rounded-lg flex items-center justify-center">
            <span className="text-background font-bold text-sm leading-none">T</span>
          </div>
          <span className="font-bold tracking-tight text-lg">Tetra</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setMobileOpen(!mobileOpen)}
          className="rounded-xl h-11 w-11"
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
      </div>

      {/* ── Mobile Drawer ─────────────────────────────────── */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <div
        className={cn(
          'md:hidden fixed top-[calc(3.5rem+env(safe-area-inset-top))] left-0 bottom-0 z-50 w-72 max-w-[85vw] bg-background border-r shadow-2xl transition-transform duration-300 flex flex-col',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex flex-col h-full py-6 px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] overflow-y-auto overscroll-contain">
          <div className="mb-6">
            <h2 className="text-lg font-semibold tracking-tight">Hi, User!</h2>
            <p className="text-sm text-muted-foreground">Welcome back</p>
          </div>
          <div className="px-2 mb-2 text-xs font-semibold text-muted-foreground tracking-wider uppercase">
            Overview
          </div>
          <nav className="space-y-1 flex-1 min-h-0">
            {navItems.map((item) => (
              <NavLink key={item.name} item={item} mobile isActive={isActive(item.path)} onNavigate={closeDrawer} />
            ))}
          </nav>
          <div className="pt-4 border-t mt-4">
            <Button
              variant="ghost"
              className="w-full justify-start gap-3 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-xl"
              onClick={handleLogout}
            >
              <LogOut className="h-4 w-4" />
              Log out
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
