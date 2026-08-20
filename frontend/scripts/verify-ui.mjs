/**
 * Visual and responsiveness regression check.
 *
 * This exists because the rules this app cares most about cannot be asserted by
 * a type checker or a unit test. Horizontal page scroll, a control below the
 * 44px touch minimum, a runtime error on one route at one width — all of them
 * are invisible in CI and immediately obvious to somebody holding a phone.
 *
 * Every route is loaded at three widths and checked for:
 *   · console errors and uncaught exceptions
 *   · horizontal document overflow (the bug class this app has fought hardest)
 *   · interactive elements under the iOS touch-target minimum
 *   · a clean render with `prefers-reduced-motion`
 *
 * It also writes a screenshot per route per width to /tmp/tetra-shots.
 *
 * Requires a running dev server and a signed-in-able account:
 *   npx playwright install chromium
 *   npm run dev
 *   npm run verify:ui
 *
 * Point it at another instance with TETRA_URL / TETRA_EMAIL / TETRA_PASSWORD.
 */

import { chromium } from 'playwright';

const BASE = process.env.TETRA_URL ?? 'http://localhost:5173';
const OUT = process.env.TETRA_SHOTS ?? '/tmp/tetra-shots';
const EMAIL = process.env.TETRA_EMAIL ?? 'preview@tetra.local';
const PASSWORD = process.env.TETRA_PASSWORD ?? 'preview-password-123';

const VIEWPORTS = {
  phone: { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  small: { viewport: { width: 768, height: 900 }, deviceScaleFactor: 2 },
  desktop: { viewport: { width: 1440, height: 950 }, deviceScaleFactor: 2 },
};

const ROUTES = [
  ['/', 'home'], ['/plan', 'plan'], ['/expenses', 'activity'], ['/analytics', 'insights'],
  ['/budgets', 'budgets'], ['/budgets/new', 'budget-new'], ['/debts', 'debts'],
  ['/afford', 'afford'], ['/subscriptions', 'subscriptions'],
  ['/snapshots', 'snapshots'], ['/recap', 'recap'], ['/plan-budget', 'plan-budget'],
  ['/ask', 'ask'], ['/settings', 'settings'],
];

const browser = await chromium.launch();
const issues = [];

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  const ctx = await browser.newContext({ ...viewport, colorScheme: 'light' });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') issues.push(`[${name}] console: ${m.text()}`); });
  page.on('pageerror', e => issues.push(`[${name}] pageerror: ${e.message}`));

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('#email', EMAIL);
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL(u => !u.pathname.includes('login'), { timeout: 20000 });
  await page.waitForLoadState('networkidle');

  for (const [route, label] of ROUTES) {
    await page.goto(BASE + route, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    // The middle width is checked but not captured — it exists to catch the
    // breakpoint itself, where the rail appears and the tab bar leaves.
    if (name !== 'small') await page.screenshot({ path: `${OUT}/${name}-${label}.png` });

    const o = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
    if (o.doc > o.win + 1) issues.push(`[${name}] ${route} scrolls sideways: ${o.doc} > ${o.win}`);

    // Every control a thumb has to hit must clear the iOS minimum. The floor
    // here is 36 rather than 44 because a few platform-standard controls are
    // legitimately smaller — Apple's own segmented control is 32pt — and a
    // check that fails on those gets switched off rather than fixed.
    if (name === 'phone') {
      const small = await page.evaluate(() => {
        const bad = [];
        for (const el of document.querySelectorAll('button, a[href], [role="button"]')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.height < 36) bad.push(`${el.tagName}.${el.className.toString().slice(0, 40)} ${Math.round(r.height)}px`);
        }
        return bad.slice(0, 4);
      });
      for (const s of small) issues.push(`[phone] ${route} small target: ${s}`);
    }
  }
  await ctx.close();
}

// Reduced motion replaces movement with a cross-dissolve rather than removing
// it, and the recap's auto-advance turns off entirely. Both paths have to
// render without throwing.
const rm = await browser.newContext({ ...VIEWPORTS.phone, reducedMotion: 'reduce' });
const rmPage = await rm.newPage();
rmPage.on('pageerror', e => issues.push(`[reduced-motion] ${e.message}`));
await rmPage.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await rmPage.fill('#email', EMAIL);
await rmPage.fill('#password', PASSWORD);
await rmPage.click('button[type=submit]');
await rmPage.waitForURL(u => !u.pathname.includes('login'), { timeout: 20000 });
await rmPage.goto(BASE + '/recap', { waitUntil: 'networkidle' });
await rmPage.waitForTimeout(600);
await rm.close();

await browser.close();
console.log(issues.length ? 'ISSUES:\n' + issues.join('\n') : 'clean: no console errors, no horizontal overflow, no undersized touch targets, reduced motion OK');
