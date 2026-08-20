import Expense from '../models/Expense';
import Budget from '../models/Budget';
import Subscription from '../models/Subscription';
import IncomeSource from '../models/IncomeSource';
import Debt from '../models/Debt';
import Asset from '../models/Asset';
import User from '../models/User';
import { buildPosition, type FinancialPosition, type PositionInput } from './financialPosition';
import type { DebtTerms } from './amortization';

/**
 * The database half of the financial position.
 *
 * Kept apart from `financialPosition.ts` on purpose: everything that reasons
 * about money is a pure function of rows, and this is the only place that knows
 * those rows live in Mongo. That separation is what lets the scenario harness
 * construct twenty-five synthetic financial lives in memory and get exactly the
 * figures the real app produces — no database, no fixtures, no drift.
 */

/**
 * How many expenses to read.
 *
 * Six complete months of medians plus the recent detail is what every consumer
 * actually uses; twelve hundred rows covers several years for a normal user and
 * bounds the query for an abnormal one.
 */
const EXPENSE_LIMIT = 1200;

export async function loadFinanceData(userId: string, today: string): Promise<PositionInput> {
  const [user, expenses, budgets, subscriptions, debts, incomeSources, assets] = await Promise.all([
    User.findById(userId).select('currency').lean(),
    Expense.find({ userId }).sort({ date: -1, createdAt: -1 }).limit(EXPENSE_LIMIT).lean(),
    Budget.find({ userId }).sort({ startDate: -1 }).limit(12).lean(),
    Subscription.find({ userId }).sort({ createdAt: -1 }).lean(),
    Debt.find({ userId }).sort({ createdAt: -1 }).lean(),
    IncomeSource.find({ userId }).sort({ amount: -1 }).lean(),
    Asset.find({ userId }).sort({ balance: -1 }).lean(),
  ]);

  return {
    today,
    currency: user?.currency === 'INR' ? 'INR' : 'USD',
    expenses: expenses.map(e => ({
      amount: Number(e.amount) || 0,
      category: String(e.category ?? 'Other'),
      date: new Date(e.date as Date).toISOString(),
      description: e.description ?? undefined,
      paymentMode: e.paymentMode ?? undefined,
      source: (e.source as 'manual' | 'subscription' | 'debt' | undefined) ?? 'manual',
    })),
    subscriptions: subscriptions.map(s => ({
      name: String(s.name),
      amount: Number(s.amount) || 0,
      frequency: s.frequency as 'daily' | 'weekly' | 'monthly' | 'yearly',
      category: String(s.category ?? 'Subscriptions'),
      autoRecord: s.autoRecord,
      dueDayOfMonth: s.dueDayOfMonth,
      dueDayOfWeek: s.dueDayOfWeek,
      dueMonth: s.dueMonth,
      startDay: s.startDay,
      lastChargedDay: s.lastChargedDay,
    })),
    debts: debts.map(d => ({
      ...(toTerms(d) as DebtTerms),
      _id: d._id,
      name: String(d.name),
      lender: d.lender ?? '',
      category: String(d.category),
      status: (d.status as 'active' | 'closed' | undefined) ?? 'active',
      creditLimit: d.creditLimit,
      startDay: d.startDay,
      lastChargedDay: d.lastChargedDay,
      termMonths: d.termMonths,
    })),
    incomeSources: incomeSources.map(i => ({
      name: String(i.name),
      type: String(i.type),
      amount: Number(i.amount) || 0,
      frequency: i.frequency as 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'half-yearly' | 'yearly' | 'one-off',
      reliability: (i.reliability as 'guaranteed' | 'likely' | 'variable') ?? 'guaranteed',
      typicalLow: i.typicalLow,
      payDayOfMonth: i.payDayOfMonth,
      startDay: i.startDay,
      endDay: i.endDay,
      active: i.active,
    })),
    assets: assets.map(a => ({
      name: String(a.name),
      kind: String(a.kind),
      balance: Number(a.balance) || 0,
      asOf: String(a.asOf),
      liquid: a.liquid,
      ringFenced: a.ringFenced,
      earmarkedFor: a.earmarkedFor ?? '',
    })),
    budgets: budgets.map(b => ({
      _id: b._id,
      startDate: new Date(b.startDate as Date).toISOString().slice(0, 10),
      endDate: new Date(b.endDate as Date).toISOString().slice(0, 10),
      isActive: b.isActive,
      isDraft: (b as { isDraft?: boolean }).isDraft ?? false,
      income: Number(b.income) || 0,
      categories: (b.categories ?? []).map(c => ({ name: String(c.name), allocatedAmount: Number(c.allocatedAmount) || 0 })),
      investments: (b.investments ?? []).map(c => ({ name: String(c.name), allocatedAmount: Number(c.allocatedAmount) || 0 })),
      savings: (b.savings ?? []).map(c => ({ name: String(c.name), allocatedAmount: Number(c.allocatedAmount) || 0 })),
      subscriptions: (b.subscriptions ?? []).map(s => ({
        name: String(s.name),
        amount: Number(s.amount) || 0,
        frequency: s.frequency as 'daily' | 'weekly' | 'monthly' | 'yearly',
      })),
    })),
  };
}

/** The terms a projection needs, read off a stored debt document. */
function toTerms(d: Record<string, any>): DebtTerms {
  return {
    kind: d.kind ?? 'amortizing',
    frequency: d.frequency,
    annualRate: Number(d.annualRate) || 0,
    instalment: Number(d.emiAmount) || 0,
    openingBalance: Number(d.openingBalance) || 0,
    balanceAsOf: String(d.balanceAsOf),
    dueDayOfWeek: d.dueDayOfWeek,
    dueDayOfMonth: d.dueDayOfMonth,
    dueMonth: d.dueMonth,
    prepayments: (d.prepayments ?? []).map((p: any) => ({
      day: String(p.day),
      amount: Number(p.amount) || 0,
      effect: p.effect ?? 'reduce-tenure',
    })),
    rateChanges: (d.rateChanges ?? []).map((r: any) => ({
      effectiveFrom: String(r.effectiveFrom),
      annualRate: Number(r.annualRate) || 0,
    })),
    minimumFraction: d.minimumFraction ?? undefined,
    minimumFloor: d.minimumFloor ?? undefined,
  };
}

export async function loadPosition(userId: string, today: string): Promise<FinancialPosition> {
  return buildPosition(await loadFinanceData(userId, today));
}
