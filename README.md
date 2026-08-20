# Tetra

A personal expense tracker that answers the question people actually open a
money app to ask — *how much can I spend today* — and then tells them where the
month lands before it gets there.

Manual entry only. No bank connections, no Plaid, no aggregators. Everything
below is derived from payments you record, the income and balances you enter,
the debts and subscriptions you register, and the budgets you set.

- **Frontend** — React 19 + Vite + Tailwind, deployed to Vercel
- **Backend** — Express + TypeScript + MongoDB, deployed to Railway
- **AI** — Claude, server-side and entirely optional

Income and account balances live on the account, in Settings, and every figure
that needs them reads from there — the dashboard, the budget planner, the
affordability check and the assistant all quote the same numbers because they
all call the same function.

See [DESIGN.md](DESIGN.md) for the design system and
[DEPLOYMENT.md](DEPLOYMENT.md) for setup.

---

## What it does

### Record a payment in about three seconds

The action button in the centre of the tab bar opens a sheet with a **custom
number pad** — not a text field. That is the least obvious decision in the app
and the one that matters most: the OS keyboard takes 45% of the viewport and
animates in, so the layout jumps and the amount scrolls out of view, and the
category chips can't share the surface with it. With a custom pad the whole
entry is amount → category → done, one thumb, one panel.

Above it sit two faster paths: **shortcuts** (your own saved templates, one tap
records the whole payment) and **say it** — a line of text like `chai 30 cash`
or `swiggy 480 yesterday`, read by Claude into a filled-in draft you confirm.

### Know what today costs

**Safe to spend** is the headline on Home. Committed charges are subtracted once
rather than spread across days — which removes the biggest source of whiplash,
where rent posts and halves your allowance on a day you did nothing. Today's
share is weighted for the weekday it is, because a Saturday genuinely costs more
than a Tuesday.

The bar underneath shows spending **against the calendar**, not against a
pass/fail line. Being 60% through a budget is fine on day twenty and alarming on
day five, and only one of those framings is true.

### See where the period lands

The **Plan** page projects the period to its end as a *band*, not a point.

The model splits the total in two and only forecasts the half that needs it:

```
total = spent so far + scheduled charges (arithmetic) + variable spend (modelled)
```

The variable half uses a Gamma–Poisson posterior that blends this period's
signal with your own history, weighted by how much exposure has elapsed. On day
one the answer is essentially history; by day twenty it is essentially pacing.
That removes the "on pace to spend ₹900,000 this month" embarrassment that naive
`spent × days/elapsed` produces in the first week, with no special case.

The band comes from a seeded block bootstrap over your own daily totals — 2,000
paths, resampling whole observed days so the zero-day rate and the burstiness
come along for free. Seeded, because a figure that changes on re-render is a
figure nobody can act on.

### Know what you owe, and what it actually costs

**Debts** leads with the figure nobody has ever calculated: what each loan costs
you *per month in interest*. The balance is the number you already know and the
one that moves slowest. The interest cost is what decides which debt to attack
first, and on a portfolio of four it is rarely the one you'd guess.

A debt is stored as an **anchor plus events**, never as a running balance: the
outstanding figure from your last statement, the date it was true, and then the
instalments the schedule implies, any part-payments, and any rate changes,
replayed forward. That is what makes the part-payment behaviour work — record
one dated last March or next March and every figure after that day is right on
the next read, with nothing before it touched and no migration anywhere.

Recording a part payment shows you what it would do **before** you commit:
interest saved, months removed, the new payoff date — and, unasked, the same
money as a permanently larger instalment, which is usually the better deal and
almost nobody models it.

The page's loudest state is a debt whose payment does not cover its interest.
That balance grows every month and the loan has no end; it is the single most
consequential fact a person can be shown about their money, and it appears on no
statement anywhere.

### Answer "can I afford this?"

The question people actually open a money app to ask, and the one a spending
tracker structurally cannot answer — it only knows what left, not what is there
or what is owed. With income, debts and balances recorded it becomes arithmetic:

1. after paying, is the emergency buffer still intact — spending down to zero is
   not affording something;
2. does the *monthly* position still work, once any instalment and running cost
   are in;
3. is there more expensive debt sitting there — paying cash for a want while
   carrying a 42% balance is a guaranteed 42% loss;
4. how reliable is the income underneath it all.

No model is involved. The verdict is computed by the same code the assistant
reaches through a tool, so a conversational answer and the page can never
disagree — and it works on a deployment with no API key at all.

A balance can be **earmarked**: a fund marked "house down payment" is off limits
for a television and counted in full towards a house. Without that, ring-fencing
tells someone saving for a house that they cannot afford a house.

### Find the money leaking

- **Subscriptions** leads with the **annual** figure. Nine subscriptions at a few
  hundred each is invisible month to month and startling once a year.
- **Price drift** — the last charge came in above the price on record, so every
  budget line built on the old figure is now silently wrong.
- **Dormant** — nothing has posted for over a cycle. Cancelled at the provider,
  still reserving money in your plan.
- **Untracked recurring** — charges detected from your own history that nobody
  registered. Gated hard: three occurrences minimum, a recognisable cadence, and
  a price-stability floor, because a false positive here asks you to go and
  cancel something that doesn't exist.

### Look back, and forward

- **Insights** — where the money went, including a Sankey of income splitting
  into what was kept and what was spent.
- **Snapshots** — planned against actual, then the numbers to carry into the next
  period, one tap into a new budget.
- **Recap** — your month as slides, with amounts that can be hidden so a slide
  is still worth reading when you share it.

---

## The AI, and what it is for

Four features, all optional, all read-only over your own data. Claude never
writes an expense, edits a budget or deletes anything — the capture endpoint
returns a *draft* that lands in the form, and you press save. That boundary is
the whole safety story: the worst a bad completion can do is propose a wrong
number that a human then declines.

| Feature | Why a model rather than an algorithm |
| --- | --- |
| **Capture** | `chai 30 cash` is not something a parser handles. Merchant→category comes from your own history, so it learns your habits rather than guessing. |
| **Briefing** | Statistics produce forty true facts. Deciding which three are worth your attention this week is judgement. |
| **Plan review** | The app's own numbers already suggest a figure per line. What they can't do is notice that the plan *as a whole* is implausible. |
| **Ask Tetra** | Every chart answers a question someone designed it to answer. "What did I spend at that place near the office in March" is not one of them. |

Ask Tetra reaches past its context window through a read-only `query_expenses`
tool. The security property is structural rather than prompted: `userId` is
captured in a closure from the verified JWT and appears in no input schema, so
there is no sentence the model could emit that would read someone else's data.

Set `ANTHROPIC_API_KEY` in the backend environment to switch these on. Leave it
unset and every AI surface **hides itself** — no disabled buttons, no error
states, no degraded mode. The rest of the app is unaffected.

---

## Running it locally

```sh
# MongoDB on the default port
brew services start mongodb-community

# Backend
cd backend
cp .env.example .env          # set MONGODB_URI and JWT_SECRET
npm install && npm run dev    # :5001

# Frontend
cd frontend
echo 'VITE_API_URL=http://localhost:5001' > .env.local
npm install && npm run dev    # :5173
```

## Checking the UI

The rules this app cares most about — no horizontal scroll, 44px touch targets,
a clean render at every width — cannot be asserted by a type checker. There is a
sweep for them:

```sh
npx playwright install chromium   # once
npm run dev                       # in another shell
npm run verify:ui
```

It loads every route at 393 / 768 / 1440px and fails on console errors,
horizontal document overflow, undersized controls, or a broken reduced-motion
render. Screenshots land in `/tmp/tetra-shots`.

## Notes on the maths

Everything derived lives in pure, dependency-free modules under
`frontend/src/lib/`, so it runs on data already in memory and responds as you
type:

| Module | What it holds |
| --- | --- |
| `robust.ts` | median, MAD, trimmed mean, modified z, seeded PRNG |
| `forecast.ts` | period projection, day-of-week exposure, bootstrap band, safe-to-spend |
| `subscriptionSchedule.ts` | enumerating future charges, with month-end clamping |
| `recurring.ts` | recurring detection, price drift, dormancy |
| `anomaly.ts` | Iglewicz–Hoaglin outliers in log space, with seven false-positive guards |
| `rhythm.ts` | logging streak, no-spend days, calendar heatmap |
| `recap.ts` | monthly slides, with data-sufficiency gating |
| `cashflow.ts` | Sankey layout |
| `budgetIntel.ts` | per-category statistics and allocation suggestions |
| `snapshots.ts` | planned-vs-actual variance and carry-forward |

Two conventions run through all of it:

**Days are `YYYY-MM-DD` strings, not `Date` objects.** Everything user-facing in
this app is a calendar day, and the moment a day goes through `toISOString()` it
has shifted into UTC — which for anyone west of Greenwich lands on the previous
one. Dates are used only for arithmetic in between.

**The median is for "typical"; the trimmed mean is for anything that must
total.** Spending is right-skewed, so a mean is moved by one annual premium. But
the sum of medians is not the median of the sum, and a budget built from medians
systematically under-funds.

---

## The assistant

Ask Tetra reads a compressed picture of your money — income, debts with their
balances and payoff dates replayed from the anchor, subscriptions, savings
balances, six months of per-category history, and the last forty payments — and
reaches for a tool when the answer needs more than reading.

The tools matter more than the context. Six of them, and five exist for the same
reason: **they run the code the screens run.**

| Tool | Answers |
|---|---|
| `query_expenses` | anything further back than the summary — a merchant, an exact total |
| `check_affordability` | "can I afford X", including EMI plans and ongoing commitments |
| `compare_debt_strategies` | which debt first, and what the choice is worth |
| `simulate_debt_payment` | a lump sum or a bigger instalment against one loan |
| `project_cashflow` | anything about the future — including income stopping for a stretch |
| `draft_budget` | a complete plan for a period, with the reasoning per line |

A model can amortize a loan. The point is not capability, it is *agreement*: if
the assistant computes a payoff date by reasoning and the debts page computes one
by replaying the schedule, they will differ — occasionally, without warning — and
a person who catches that once stops trusting both.

Nothing writes. The worst a bad completion can do is propose a number a human
then declines.

### Planning a budget by talking about it

**Plan with AI** starts from the deterministic planner — income first,
instalments and subscriptions off the top, categories from your own medians —
says what the draft does and which two lines are most likely to be wrong, and
then argues with you about it. Ask for dining out at ₹6,000 and it will take the
change, tell you that you have been over ₹12,000 in five of the last six months,
rebalance the rest so the total still holds, and put the revised plan back on
screen.

What it produces is a **draft**: a budget that is not in force and does not touch
the dashboard until you activate it deliberately.

### The daily read

The dashboard's briefing is written **once a day** and says the same thing all
day. That is not a caching optimisation, it is the feature: a card that reworded
itself on every page load taught people to skip it, and "you are ahead of where
you usually are by the 20th" needs a fixed vantage point to mean anything.

It carries three things — where you stand overall, how the month is going
measured at the *same day of the month* as previous months, and the two to five
findings that are actually worth reading. When the data moves underneath it, it
says so and offers a fresh read rather than quietly rewriting itself.

---

## Scenario testing

`backend/scripts/` holds twenty-six synthetic financial lives and a harness that
runs the real assistant against them.

```bash
cd backend
npm run eval                                  # every persona, every question
npm run eval -- --personas=credit-card-trap   # one of them
npm run eval -- --context-only                # print the contexts, spend nothing
npm run seed -- --list                        # what the personas are
npm run seed -- --persona=laid-off            # load one into a real account
```

The personas are deliberately uncomfortable: a credit card compounding at 42%
against a payment that does not cover the interest, a freelancer whose income
halves in a bad quarter, someone two months into recording anything at all,
someone laid off and burning savings, five zero-interest BNPL plans running at
once, a fund ring-fenced for a house being asked about a house. A suite of
well-run finances would pass anything.

The harness imports the same voice prompt, task prompt, tool definitions and tool
implementations the server uses — the only substitution is where
`query_expenses` reads from — so a prompt change is evaluated the moment it is
made. Each answer is scored by mechanical checks (does every figure trace back to
the data; is the currency right; did it use the tool; did it surface the debt
that is growing; did it respect a ring-fence) and by a second model on the things
those cannot see.

It has already paid for itself. Every one of these was found by running it, not
by reading the code:

- a debt whose payment did not cover its interest reported a *finite* interest
  total — the one month the projection managed before giving up;
- the debt-ordering tool recommended clearing a small personal loan first while a
  42% card grew, because the two orderings' totals were within noise of each
  other and nothing checked whether one balance was running away;
- part-payment history was stored, drove the balance correctly, and appeared
  nowhere the assistant could read — so "how much have my part payments saved
  me" was answered "you have not made any";
- "can I afford to hire someone at ₹45,000 a month" returned "nothing to weigh up,
  the cost is zero", because affordability was written around a purchase price;
- a ring-fenced house fund made a house deposit unaffordable;
- a balance recorded three months ago was quoted as current;
- two models given the same data computed "how is this month going" two different
  ways and disagreed by tens of percent, so that figure is now computed once and
  handed over finished.

