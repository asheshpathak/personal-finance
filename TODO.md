# Change log

## Rebuild — light UI, forecasting, AI

The app was dark-only violet-on-charcoal with gradient chrome. It is now light,
structured the way iOS structures a screen, and carries a forecast engine and an
optional Claude layer. Nothing in the existing business logic changed behaviour:
subscription scheduling, budget sectioning, the calendar-day conventions and the
auth model are all as they were.

Verified with `npm run verify:ui` — every route at 393 / 768 / 1440px, checked
for console errors, horizontal overflow, undersized touch targets and a clean
reduced-motion render.

---

## Design system

Full rationale in [DESIGN.md](DESIGN.md).

- [x] **Grey page, white cards.** The structural inversion that carries most of
      the "feels like iOS" — the opposite of Material, and why elevation needs
      almost no shadow.
- [x] Light palette on a fixed OKLCH lightness ladder, so "step 700" means
      "passes AA on white" in every hue.
- [x] Green pulled toward teal and red toward vermillion. The default fintech
      pair collapses to ΔE 0.055 under deuteranopia; this lands at 0.156.
- [x] Eight-slot chart palette, contrast- and CVD-validated. Assign by slot, never
      re-sort — the lightness zigzag is what a dichromat reads.
- [x] Category hues derive from the category *name*, not its rank, so a colour
      survives a reorder.
- [x] Inter with the optical-size axis loaded; Apple's Dynamic Type ladder as the
      scale; tabular numerals on every figure and none of the prose.
- [x] Four money formatters, with the locale derived from the **currency** —
      `Intl.NumberFormat('en-IN', {currency:'USD'})` renders dollars in lakhs.
- [x] SwiftUI spring parameters as `linear()` easings.
- [x] Glass on bars only, never on a card behind a column of figures.
- [x] Gone: the aurora gradient, the gradient wordmark, `shadow-glow`, Manrope,
      three unused MUI/emotion dependencies, the Vite template CSS.

## Navigation

- [x] **Floating tab bar with a centre action** on touch, replacing the hamburger
      drawer. Hidden navigation measurably reduces navigation use and task
      success; there was no reason to ship one when four destinations fit.
- [x] Collapsing rail on pointer devices — icons at `md`, full at `lg`.
- [x] Glass top bar with the large-title collapse: the page title cross-fades in
      only once the heading has scrolled away.
- [x] "More" sheet for the second tier of destinations.

## Recording a payment

- [x] **Custom number pad** rather than a text field. The OS keyboard takes 45%
      of the viewport and animates, so the amount scrolls out of view and the
      category chips can't share the surface.
- [x] Amount modelled as an integer of minor units, never a parsed float.
- [x] One-tap shortcuts, and a `00` key instead of a dead decimal point.
- [x] Sheet mounted above the router, so it survives navigation mid-entry.
- [x] Recent categories ranked by recency, offered as chips.
- [x] "Add another" offered before "Done" — recording one payment is usually
      recording two.

## Forecasting

- [x] `lib/forecast.ts` — period projection splitting deterministic scheduled
      charges from modelled variable spend, so known bills are arithmetic.
- [x] Gamma–Poisson shrinkage blending this period against history by elapsed
      exposure. Removes the day-two "on pace for ₹900,000" without a special case.
- [x] Day-of-week exposure weights, estimated as a ratio of medians and shrunk
      toward 1 on thin evidence.
- [x] Seeded block bootstrap for the p10/p50/p90 band — 2,000 paths resampling
      whole observed days, so zero-inflation and burstiness come for free.
- [x] Safe-to-spend with committed charges subtracted once, weighted for the
      weekday, and a floor that can never sit below money already spent.
- [x] Per-category outlook gated on evidence: paced when dense, floored at
      history when sparse.
- [x] `lib/subscriptionSchedule.ts` — enumerating future charges with the same
      month-end clamping the server bills on.

## Intelligence over your own data

- [x] `lib/recurring.ts` — untracked recurring charges, price drift against the
      recorded amount, dormant subscriptions. Gated on occurrence count, cadence
      match **and** a price-stability floor: without the last one a fortnightly
      Amazon habit is offered as a subscription.
- [x] `lib/anomaly.ts` — Iglewicz–Hoaglin modified z in log space, with seven
      guards against the false positives that make this feature unbearable.
- [x] `lib/rhythm.ts` — logging streak (never a spending outcome), no-spend days,
      calendar heatmap, notional round-up pot.
- [x] `lib/recap.ts` — monthly slides with data-sufficiency gating and a
      share-safe phrasing of every claim.
- [x] `lib/cashflow.ts` — Sankey layout, hand-rolled for a three-column flow.
- [x] `lib/robust.ts` — median, MAD, trimmed mean, seeded PRNG, and the note on
      why the sum of medians is not the median of the sum.

## AI (optional)

- [x] `POST /api/ai/capture` — a line of text into a filled-in expense draft.
- [x] `POST /api/ai/brief` — what stands out, constrained to a JSON shape so
      every insight carries a figure and a tone.
- [x] `POST /api/ai/review-plan` — a budget draft read against real history.
- [x] `POST /api/ai/chat` — SSE, with a read-only `query_expenses` tool whose
      `userId` is closure-captured and absent from the schema.
- [x] `GET /api/ai/status` — every AI surface hides itself when unconfigured.
- [x] Prompt caching with the volatile part after the breakpoint; per-account
      rate limiting; the gate answers JSON *before* committing to a stream.
- [x] Nothing is ever written without a human confirming it.

## Screens

- [x] **Home** — a decision first (safe to spend), then judgement (the briefing
      and anomalies), then record. Not a wall of charts.
- [x] **Plan** — the projection as a band, the accumulation curve, per-line
      outlook, and everything already committed.
- [x] **Activity** — search across notes, categories and methods; day-grouped
      list with inset separators; tap a row to open it.
- [x] **Insights** — Sankey, trend against the previous period, categories,
      payment mix, weekday rhythm. Every chart has a table twin.
- [x] **Subscriptions** — the annual figure as the headline, health checks,
      untracked recurring charges.
- [x] **Snapshots** — planned against actual, then next period's numbers.
- [x] **Recap** — the month as editorial slides, with amounts that can be hidden.
- [x] **Ask Tetra** — streamed answers over your own history.
- [x] Budgets, Settings, Login rebuilt on the same system.

## Accessibility and responsiveness

Every rule from the previous round is preserved and commented at its site.

- [x] `overflow-x: clip` on both `html` and `body`; `clip` not `hidden`, so
      sticky positioning survives.
- [x] `min-w-0` on flex children; `minmax(0,1fr)` on the dialog's grid track.
- [x] 16px minimum on touch inputs, so iOS Safari cannot zoom the viewport.
- [x] `overscroll-behavior: contain` on every inner scroller.
- [x] `dvh` throughout; safe-area insets in one place.
- [x] 44px touch targets, enforced by the verification sweep.
- [x] Reduced motion cross-dissolves rather than disappearing; the recap's
      auto-advance switches off entirely.
- [x] Colour is never the only channel — every delta carries a sign and an arrow.
- [x] PWA manifest, maskable icon, standalone display, iOS meta.

## Code health

- [x] State that used to be set inside effects is now adjusted during render
      where it is really "reset when a prop changes" — no frame of stale data.
- [x] `useFinances` derives `loading` from a version comparison rather than a
      flag set in an effect.
- [x] Superseded components deleted rather than left orphaned.

Remaining lint errors are all `react-refresh/only-export-components`, which the
codebase had before this change — contexts exporting their own hooks and `cva`
variants alongside components.

---

# Debts, income, and an assistant that can do arithmetic

The app could tell you what you spent. It could not tell you what you *had*,
what you *owed*, or what you *earned* — so the question people actually open a
money app to ask ("can I afford this?") had no answer, and every figure that
needed a denominator either did without one or quietly approximated it from
spending.

Three collections closed that: **income** and **savings balances** on the
account, in Settings, and **debts** as their own section.

## Debts

- [x] **A debt is an anchor plus events, never a stored balance.** The
      outstanding figure from your last statement, the date it was true, and then
      the instalments the schedule implies, the part-payments, and the rate
      changes — replayed forward on every read.

      This is the whole design and it is what the user's requirement actually
      needs. "If I part-pay in future it should not mess up the previous" is only
      true if the past is not a running figure a new event has to retroactively
      patch. Replaying gives it for free: a payment dated next March changes
      every instalment after next March and nothing before it, and one entered
      late, dated last March, is equally safe — the numbers simply come out
      right the next time anyone asks. No migration, nothing to reconcile.
- [x] Three kinds, because the maths differs and a credit card treated as a term
      loan produces a payoff date that does not exist: amortizing, revolving,
      interest-free.
- [x] **Negatively amortizing debt as a first-class state.** When the payment
      does not cover the interest, the balance grows every month and the loan has
      no end. It leads the page, it has no interest *total* (reporting the one
      month the projection managed before giving up understates it without
      limit), and it outranks every question about ordering the other debts.
- [x] Part payments show what they would do before you commit — interest saved,
      months removed, new payoff date — and, unasked, the same money as a
      permanently larger instalment, which usually wins and which almost nobody
      models.
- [x] Tenure-reduction versus instalment-reduction stored, never assumed. On a
      twenty-year loan the difference is routinely larger than the payment.
- [x] Rate changes as history rather than an overwrite, so a floating-rate loan's
      replay charges the old rate for the months it applied to.
- [x] Instalments post themselves on their due date, on the same lazy catch-up
      and the same uniqueness index that make subscription charges idempotent.
- [x] A due-date change stages to the next cycle — the same rule as
      subscriptions, for the same reason.
- [x] Deleting a debt keeps the instalments already recorded. That money left the
      account; deleting the debt is a statement about the future.

## Income and balances

- [x] Income moved from "a number typed into each budget" to an account-level
      collection. A budget now *seeds* from it and keeps its own snapshot, so a
      plan written in March still reads correctly after a raise in June.
- [x] Reliability is a stored field, not an assumption. A salary and a freelance
      retainer at the same monthly figure are not the same money, and every
      affordability answer that treats them identically is wrong in the direction
      that hurts.
- [x] Savings balances: one figure per account and the date it was last
      confirmed. Manually maintained, and honest about it — the staleness shows
      on the row rather than hiding inside it.
- [x] **Earmarking.** A fund marked "house down payment" is off limits for a
      television and counted in full towards a house. Ring-fencing without it
      told someone saving for a house that they could not afford a house.

## Can I afford it?

- [x] A deterministic verdict weighing four things in order: the emergency buffer
      after paying, the monthly position afterwards, whether more expensive debt
      is sitting there, and how reliable the income underneath it is.
- [x] Works with no purchase price at all — hiring someone, a rent rise, a new
      subscription. The first version answered "nothing to weigh up, the cost is
      zero" to a question entirely about the monthly side.
- [x] No model involved, so it works on a deployment with no API key — and the
      assistant reaches the same code through a tool, so the two can never
      disagree.

## Budgets

- [x] Top-down instead of a spreadsheet with hints: income first, instalments and
      subscriptions off the top because they are not decisions, and every
      category measured against what is genuinely left.
- [x] Instalments as their own section. An EMI is not a choice made inside a
      month; it is money that was never available to allocate.
- [x] **Drafts.** A plan can be wrong — half-filled, over-allocated, for a month
      that has not started — without any of that reaching the dashboard.
- [x] **Plan with AI**: the planner's draft, explained, then argued with. Ask for
      a lower dining-out line and it takes the change, says what it costs, and
      rebalances the rest so the total still holds.

## The assistant

- [x] Six tools, five of which exist so the assistant and the screens quote the
      same number by construction rather than by luck.
- [x] The context now carries the whole position as finished arithmetic — free
      cash flow, debt-to-income, runway, the interest each debt costs a month,
      the essential/discretionary split — rather than the ingredients.
- [x] `output_config.effort` is dropped on models that reject it, so pointing
      `ANTHROPIC_MODEL` at Haiku 4.5 works instead of 400ing every route.

## The daily read

- [x] The dashboard briefing is written once a day and says the same thing all
      day. A card that reworded itself on every page load taught people to skip
      it, and the month-pace comparison needs a fixed vantage point to mean
      anything.
- [x] Three parts: where you stand, how the month is going *measured at the same
      day of the month*, and what is worth reading.
- [x] Pace is computed, not asked for. Two models given identical data derived it
      two different ways and disagreed by tens of percent.
- [x] When the data moves underneath it, it says so and offers a fresh read
      rather than quietly rewriting itself.

## Scenario testing

- [x] Twenty-six synthetic financial lives, seeded and deliberately
      uncomfortable, and a harness that runs the *real* prompts and tools against
      them — plus `npm run seed` to load any of them into a real account and
      click through it.
- [x] Mechanical checks for the failures that matter in a money app (untraceable
      figures, the wrong currency symbol, a savings rate quoted for someone with
      no income recorded, a ring-fence offered up), and a second model for the
      rest.
- [x] Fifteen failures on the first full run, one on the last — and every fix in
      between was a real defect the suite found rather than a prompt tweak. They
      are listed in [README.md](README.md#scenario-testing).
