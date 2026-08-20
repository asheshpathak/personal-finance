import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Expenses from './pages/Expenses';
import Budgets from './pages/Budgets';
import BudgetFormPage from './pages/BudgetFormPage';
import BudgetViewPage from './pages/BudgetViewPage';
import Subscriptions from './pages/Subscriptions';
import Debts from './pages/Debts';
import Afford from './pages/Afford';
import BudgetChat from './pages/BudgetChat';
import Analytics from './pages/Analytics';
import Snapshots from './pages/Snapshots';
import Plan from './pages/Plan';
import Recap from './pages/Recap';
import Ask from './pages/Ask';
import Settings from './pages/Settings';
import Login from './pages/Login';
import { CurrencyProvider } from './context/CurrencyContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { QuickAddProvider } from './context/QuickAddContext';
import { DataRefreshProvider } from './context/DataRefreshContext';
import { QuickAddSheet } from './components/quickadd/QuickAddSheet';
import { Wordmark } from './components/layout/Wordmark';

/** Shown while the stored token is being proven — never the app shell. */
function BootSplash() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4" role="status" aria-live="polite">
        <Wordmark size={48} />
        <span className="text-subhead text-muted-foreground">Checking your session…</span>
      </div>
    </div>
  );
}

/**
 * Gate for every signed-in route.
 *
 * The `checking` state is deliberately its own branch rather than being folded
 * into "not authenticated": redirecting during the check would bounce a
 * perfectly valid session to the login screen on every refresh.
 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'checking') return <BootSplash />;
  if (status === 'anonymous') {
    // Remember where they were headed so login can return them there.
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
}

function LoginRoute() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'checking') return <BootSplash />;
  if (status === 'authenticated') {
    // The redirect lives here rather than in the form's submit handler. Both
    // run in the same tick after sign-in, and this one wins — so a handler that
    // navigated somewhere else would be silently overridden, which is how a
    // remembered deep link ends up dumping you on the dashboard instead.
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from && from !== '/login' ? from : '/'} replace />;
  }
  return <Login />;
}

/**
 * Keyed on the account so signing in remounts the currency provider, which
 * re-reads the preference for whoever just logged in.
 *
 * The quick-add sheet is mounted here rather than inside a route, and that
 * placement is load-bearing: a sheet inside a route unmounts mid-animation when
 * the route changes, and a half-entered payment vanishes with it.
 */
function AuthedApp() {
  const { user, isAuthenticated } = useAuth();

  return (
    <CurrencyProvider key={user?.id ?? String(isAuthenticated)}>
      <DataRefreshProvider>
        <QuickAddProvider>
          <Routes>
            <Route path="/login" element={<LoginRoute />} />
            <Route path="/expenses" element={<RequireAuth><Expenses /></RequireAuth>} />
            <Route path="/plan" element={<RequireAuth><Plan /></RequireAuth>} />
            <Route path="/budgets/new" element={<RequireAuth><BudgetFormPage /></RequireAuth>} />
            <Route path="/budgets/:id/edit" element={<RequireAuth><BudgetFormPage /></RequireAuth>} />
            {/* Declared after /budgets/new and /budgets/:id/edit so those keep
                matching first — this is the read-only view. */}
            <Route path="/budgets/:id" element={<RequireAuth><BudgetViewPage /></RequireAuth>} />
            <Route path="/budgets" element={<RequireAuth><Budgets /></RequireAuth>} />
            <Route path="/subscriptions" element={<RequireAuth><Subscriptions /></RequireAuth>} />
            <Route path="/debts" element={<RequireAuth><Debts /></RequireAuth>} />
            <Route path="/afford" element={<RequireAuth><Afford /></RequireAuth>} />
            {/* Declared before /budgets so it keeps matching first. */}
            <Route path="/plan-budget" element={<RequireAuth><BudgetChat /></RequireAuth>} />
            <Route path="/analytics" element={<RequireAuth><Analytics /></RequireAuth>} />
            <Route path="/snapshots" element={<RequireAuth><Snapshots /></RequireAuth>} />
            <Route path="/recap" element={<RequireAuth><Recap /></RequireAuth>} />
            <Route path="/ask" element={<RequireAuth><Ask /></RequireAuth>} />
            <Route path="/settings" element={<RequireAuth><Settings /></RequireAuth>} />
            <Route path="/*" element={<RequireAuth><Dashboard /></RequireAuth>} />
          </Routes>

          {isAuthenticated && <QuickAddSheet />}
        </QuickAddProvider>
      </DataRefreshProvider>
    </CurrencyProvider>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AuthedApp />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
