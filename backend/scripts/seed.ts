import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { config } from '../src/config';
import User from '../src/models/User';
import Expense from '../src/models/Expense';
import Budget from '../src/models/Budget';
import Subscription from '../src/models/Subscription';
import Debt from '../src/models/Debt';
import IncomeSource from '../src/models/IncomeSource';
import Asset from '../src/models/Asset';
import DailyBrief from '../src/models/DailyBrief';
import { PERSONAS, buildPersona } from './personas';

dotenv.config();

/**
 * Loads one of the scenario personas into a real account.
 *
 * The evaluation harness runs the personas in memory, which is the right shape
 * for measuring the assistant and the wrong shape for looking at the app. A
 * screen that reads correctly against a comfortable salaried account can be
 * unusable against someone with five BNPL plans and ₹12,000 in the bank, and
 * the only way to find that out is to sign in as them.
 *
 * Usage:
 *   npm run seed -- --persona=credit-card-trap
 *   npm run seed -- --persona=laid-off --email=me@example.com
 *   npm run seed -- --list
 *
 * The account is **wiped and rewritten** each time, so re-seeding is how you get
 * back to a known state. It refuses to touch an account that was not created by
 * this script unless `--force` is passed — seeding over someone's real data
 * would be unrecoverable.
 */

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const match = argv.find(a => a.startsWith(`--${name}=`));
  return match ? match.slice(name.length + 3) : undefined;
};
const has = (name: string) => argv.includes(`--${name}`);

/** The marker that says an account is disposable. */
const SEED_DOMAIN = 'scenario.tetra.local';

async function main() {
  if (has('list')) {
    console.log('Personas:\n');
    for (const persona of PERSONAS) {
      console.log(`  ${persona.id.padEnd(24)} ${persona.title}`);
      console.log(`  ${' '.repeat(24)} ${persona.probes}\n`);
    }
    return;
  }

  const personaId = flag('persona');
  const definition = PERSONAS.find(p => p.id === personaId);
  if (!definition) {
    console.error(
      personaId
        ? `No persona "${personaId}". Run with --list to see them.`
        : 'Pass --persona=<id>. Run with --list to see them.'
    );
    process.exit(1);
  }

  const today = flag('today') ?? new Date().toISOString().slice(0, 10);
  const email = (flag('email') ?? `${definition.id}@${SEED_DOMAIN}`).toLowerCase();
  const password = flag('password') ?? 'scenario123';

  if (!email.endsWith(SEED_DOMAIN) && !has('force')) {
    console.error(
      `Refusing to wipe ${email}: it is not a scenario account.\n` +
        `Seeding replaces every expense, budget, subscription, debt, income source and balance on it.\n` +
        `Pass --force if you are certain.`
    );
    process.exit(1);
  }

  await mongoose.connect(config.mongoUri);
  console.log(`Connected to ${config.mongoUri.replace(/\/\/[^@]*@/, '//***@')}`);

  const persona = buildPersona(definition, today);

  let user = await User.findOne({ email });
  if (!user) {
    user = await User.create({
      email,
      password: await bcrypt.hash(password, await bcrypt.genSalt(10)),
      // Spelled out rather than passed through: `currency` has no schema
      // default (never-chosen must stay distinguishable from chose-USD), and
      // exactOptionalPropertyTypes rejects an explicit undefined.
      currency: persona.data.currency ?? 'USD',
    });
    console.log(`Created ${email} (password: ${password})`);
  } else {
    user.set('currency', persona.data.currency ?? 'USD');
    await user.save();
    console.log(`Reusing ${email}`);
  }

  const userId = user._id;

  // Wiped rather than merged. A persona is a whole financial life, and half of
  // one on top of half of another is a situation nobody is in.
  await Promise.all([
    Expense.deleteMany({ userId }),
    Budget.deleteMany({ userId }),
    Subscription.deleteMany({ userId }),
    Debt.deleteMany({ userId }),
    IncomeSource.deleteMany({ userId }),
    Asset.deleteMany({ userId }),
    DailyBrief.deleteMany({ userId }),
  ]);

  await IncomeSource.insertMany(
    persona.data.incomeSources.map(source => ({ userId, ...source }))
  );

  await Asset.insertMany(persona.data.assets.map(asset => ({ userId, ...asset })));

  await Subscription.insertMany(
    persona.data.subscriptions.map(sub => ({
      userId,
      name: sub.name,
      amount: sub.amount,
      frequency: sub.frequency,
      category: sub.category,
      autoRecord: sub.autoRecord ?? true,
      dueDayOfMonth: sub.dueDayOfMonth ?? null,
      dueDayOfWeek: sub.dueDayOfWeek ?? null,
      dueMonth: sub.dueMonth ?? null,
      // Anchored at today so the lazy charger does not re-post the history the
      // seed has already written, which would double every subscription charge.
      startDay: today,
      lastChargedDay: today,
      paymentMode: 'Credit Card',
    }))
  );

  await Debt.insertMany(
    persona.data.debts.map(debt => ({
      userId,
      name: debt.name,
      lender: debt.lender ?? '',
      category: debt.category,
      kind: debt.kind,
      principal: debt.principal ?? 0,
      openingBalance: debt.openingBalance,
      balanceAsOf: debt.balanceAsOf,
      annualRate: debt.annualRate,
      emiAmount: debt.instalment,
      frequency: debt.frequency,
      dueDayOfMonth: debt.dueDayOfMonth ?? null,
      dueDayOfWeek: debt.dueDayOfWeek ?? null,
      dueMonth: debt.dueMonth ?? null,
      termMonths: debt.termMonths ?? null,
      creditLimit: debt.creditLimit ?? null,
      minimumFraction: debt.minimumFraction ?? null,
      minimumFloor: debt.minimumFloor ?? null,
      prepayments: (debt.prepayments ?? []).map(p => ({ ...p, recorded: true })),
      rateChanges: debt.rateChanges ?? [],
      autoRecord: true,
      paymentMode: 'Bank Transfer',
      startDay: debt.balanceAsOf,
      // Same reason as subscriptions: the seed writes the instalment history
      // itself, so the charger must not walk it again.
      lastChargedDay: today,
      status: debt.status ?? 'active',
    }))
  );

  await Expense.insertMany(
    persona.data.expenses.map(expense => ({
      userId,
      amount: expense.amount,
      category: expense.category,
      paymentMode: expense.paymentMode ?? 'Bank Transfer',
      date: new Date(expense.date),
      description: expense.description ?? '',
      // Provenance is flattened to `manual`. The seed writes instalments and
      // subscription charges as ordinary rows because the real ones carry an
      // idempotency key tied to a live schedule, and forging those would let a
      // later catch-up run collide with them.
      source: 'manual',
    }))
  );

  console.log(`\nSeeded "${definition.title}"`);
  console.log(`  ${persona.data.expenses.length} payments`);
  console.log(`  ${persona.data.debts.length} debts, ${persona.data.subscriptions.length} subscriptions`);
  console.log(`  ${persona.data.incomeSources.length} income sources, ${persona.data.assets.length} balances`);
  console.log(`\nSign in as ${email} / ${password}`);
  console.log(`\n${definition.probes}`);

  await mongoose.disconnect();
}

main().catch(async err => {
  console.error(err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
