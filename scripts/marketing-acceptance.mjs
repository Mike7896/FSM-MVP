/** Local, public marketing acceptance. No signup or payment submissions. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE ?? 'C:/Users/Michel/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base = 'http://localhost:3000';
const dir = 'docs/marketing-evidence';
const homepageOnly = process.argv.includes('--homepage-only');
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const results = [];
function check(name, value) { assert.ok(value, name); results.push({ name, passed: true }); console.log('PASS', name); }
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base, { waitUntil: 'networkidle' });
  check('One homepage heading', await page.locator('h1').count() === 1);
  check('No unfinished QuickBooks claim', !(await page.locator('main').innerText()).includes('QuickBooks'));
  const tour = page.locator('#product-tour');
  for (const [tab, total] of [['Quote', '$8,400'], ['Contract & deposit', '$4,200'], ['Change order', '$9,000'], ['Progress billing', '$2,280']]) {
    await tour.getByRole('tab', { name: tab, exact: true }).click();
    check(`${tab} shows its own example`, (await tour.getByRole('tabpanel').innerText()).includes(total));
    check(`${tab} has one visible panel`, await tour.getByRole('tabpanel').count() === 1);
  }
  await tour.getByRole('tab', { name: 'Quote', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await tour.locator('[role="tab"][data-state="active"]').filter({ hasText: 'Contract & deposit' }).waitFor();
  check('Tour supports arrow-key navigation', await tour.getByRole('tab', { name: 'Contract & deposit', exact: true }).getAttribute('aria-selected') === 'true');
  await tour.screenshot({ path: `${dir}/tour-desktop.png` });
  await page.getByText('Do I need to install an app?', { exact: true }).click();
  check('FAQ states browser availability honestly', await page.getByText(/Native mobile and desktop apps are not available yet/).isVisible());
  await page.getByRole('button', { name: 'Change theme' }).click();
  await page.getByRole('menuitem', { name: 'Dark', exact: true }).click();
  await page.locator('html.dark').waitFor();
  await page.getByRole('menu').waitFor({ state: 'hidden' });
  await page.reload({ waitUntil: 'networkidle' });
  await tour.scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await tour.screenshot({ path: `${dir}/tour-dark.png` });
  await page.getByRole('button', { name: 'Change theme' }).click();
  await page.getByRole('menuitem', { name: 'Light', exact: true }).click();
  await page.locator('html.light').waitFor();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const path of homepageOnly ? ['/'] : ['/', '/for/electricians', '/for/plumbers', '/for/roofers', '/for/remodelers', '/pricing']) {
      const response = await page.goto(base + path, { waitUntil: 'networkidle' });
      check(`${width}px ${path} loads`, response.status() === 200);
      check(`${width}px ${path} fits viewport`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      check(`${width}px ${path} has one H1`, await page.locator('h1').count() === 1);
      if (path.startsWith('/for/')) {
        check(`${path} preserves trade signup`, await page.getByRole('link', { name: 'Start your first quote' }).first().getAttribute('href') === `/signup?trade=${path.split('/').pop()}`);
      }
      if (width === 390) await page.screenshot({ path: `${dir}/${path.replaceAll('/', '-') || 'home'}-mobile.png`, fullPage: true });
    }
  }
  await page.goto(base);
  check('Mobile product navigation is visible', await page.getByRole('navigation', { name: 'Explore ServiceClerk' }).getByRole('link', { name: 'How it works' }).isVisible());
  await page.getByRole('navigation', { name: 'Explore ServiceClerk' }).getByRole('link', { name: 'How it works' }).click();
  await page.waitForURL('**/#product-tour');
  check('Mobile tour link reaches section', new URL(page.url()).hash === '#product-tour');
  await page.setViewportSize({ width: 390, height: 844 });
  await tour.screenshot({ path: `${dir}/tour-mobile.png` });
  const missing = await page.goto(base + '/for/not-a-trade');
  check('Unknown trade returns 404', missing.status() === 404);
  if (homepageOnly) results.push({ name: 'Pricing and known trade routes', skipped: 'Development database unavailable; rerun without --homepage-only when restored.' });
  check('No uncaught browser errors', errors.length === 0);
} finally {
  await browser.close();
  writeFileSync(`${dir}/${homepageOnly ? 'homepage-results' : 'results'}.json`, JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
}
