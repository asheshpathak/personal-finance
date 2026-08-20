import {
  House,
  ReceiptText,
  ChartPie,
  Repeat,
  GitCompare,
  Landmark,
  Scale,
  Settings,
  Sparkles,
  TrendingUp,
  Wallet,
  Clapperboard,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * The app's destinations, in one place.
 *
 * Split into the handful that earn a permanent tab and the rest that live
 * behind "More". The split is not about importance in the abstract — it is
 * about *frequency*: a bottom tab is the most expensive real estate in the app
 * and belongs to the four things someone opens daily. Everything else is a
 * deliberate visit, and a deliberate visit can afford one extra tap.
 */

export interface NavItem {
  /**
   * Also the accessible name and the tooltip. The tab bar renders icons only —
   * five two-word labels do not fit across a 393px phone — so on touch this is
   * the only place a destination's name exists, and it carries the whole job.
   */
  name: string;
  icon: LucideIcon;
  path: string;
  blurb?: string;
}

/**
 * The rail's first group on a pointer. On touch the first three take tab-bar
 * slots either side of the action button, and anything past that falls into
 * "More" alongside the secondary group.
 *
 * The tab bar is a five-column grid with the action in the middle column, so it
 * has room for two on the left and one on the right before "More" claims the
 * last slot — which is what keeps the button centred by arithmetic rather than
 * by the two sides happening to balance.
 */
export const PRIMARY_NAV: NavItem[] = [
  { name: 'Home', icon: House, path: '/', blurb: 'Today at a glance' },
  { name: 'Activity', icon: ReceiptText, path: '/expenses', blurb: 'Everything you have recorded' },
  { name: 'Plan', icon: TrendingUp, path: '/plan', blurb: 'Where this month lands' },
  { name: 'Insights', icon: ChartPie, path: '/analytics', blurb: 'Where the money goes' },
];

/** Behind "More" on touch; the second group of the rail on a pointer. */
export const SECONDARY_NAV: NavItem[] = [
  { name: 'Budgets', icon: Wallet, path: '/budgets', blurb: 'Plan a period, section by section' },
  { name: 'Debts', icon: Landmark, path: '/debts', blurb: 'What is owed and what it costs to carry' },
  // Placed next to Debts rather than under the AI group: it needs no model, it
  // works on a deployment with no key, and it is the question people open the
  // app to ask. Filing it under "AI" would hide the app's best answer behind a
  // feature flag it does not depend on.
  { name: 'Can I afford it?', icon: Scale, path: '/afford', blurb: 'Weigh a purchase against everything else' },
  { name: 'Subscriptions', icon: Repeat, path: '/subscriptions', blurb: 'Recurring charges and what they cost' },
  { name: 'Snapshots', icon: GitCompare, path: '/snapshots', blurb: 'Planned against actual' },
  { name: 'Recap', icon: Clapperboard, path: '/recap', blurb: 'Your month, in slides' },
  { name: 'Plan with AI', icon: Sparkles, path: '/plan-budget', blurb: 'Build a budget by talking it through' },
  { name: 'Ask Tetra', icon: Sparkles, path: '/ask', blurb: 'Questions about your own money' },
  { name: 'Settings', icon: Settings, path: '/settings', blurb: 'Currency and preferences' },
];

export const ALL_NAV: NavItem[] = [...PRIMARY_NAV, ...SECONDARY_NAV];

/**
 * Whether a path is the current one.
 *
 * `/` has to match exactly — a prefix test would light the Home tab on every
 * page in the app. Everything else matches its subtree, so `/budgets/new` keeps
 * Budgets lit.
 */
export function isActivePath(itemPath: string, pathname: string): boolean {
  if (itemPath === '/') return pathname === '/';
  return pathname === itemPath || pathname.startsWith(`${itemPath}/`);
}
