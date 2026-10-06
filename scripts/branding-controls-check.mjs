/** Isolated browser check of the real form; no database, account, or payment changes. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE ?? 'C:/Users/Michel/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const stubs = {
  'next/navigation': 'export const useRouter=()=>({refresh(){}});',
  'next/link': 'export default function Link({children,...props}){return <a {...props}>{children}</a>}',
  '@/components/documents/document-sheet': 'export const DocumentFooter=()=>null;',
  '@/components/office/document-preview': 'export const OfficeDocumentPreview=({children})=><div>{children}</div>;',
  '@/components/quote/projection': 'export const QuoteProjection=({look})=><output data-testid="preview">{JSON.stringify(look)}</output>;',
};
const bundle = await build({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {BrandingForm} from './components/office/branding-form';
    const root=createRoot(document.getElementById('root')); window.saves=[];
    window.fetch=async(url,options)=>{window.saves.push(JSON.parse(options.body));return {ok:true}};
    window.renderForm=(allowed,key='same')=>root.render(<BrandingForm key={key} canSave={allowed} preset="with_logo_bold_header" identity={{businessName:'Sample shop',license:null,phone:null}} logoUrl={null}/>);
    window.renderForm(false);`, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, write: false, format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'isolated-preview', setup(b) {
    b.onResolve({ filter: /.*/ }, args => stubs[args.path] ? { path: args.path, namespace: 'stub' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: stubs[args.path], loader: 'jsx', resolveDir: process.cwd() }));
  } }],
});
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const options = page.getByRole('checkbox');
  await options.first().waitFor();
  async function assertLocked() {
    assert.equal(await options.nth(0).isChecked(), true, 'Plain selected');
    for (const index of [1, 2]) {
      const option = options.nth(index);
      assert.equal(await option.isDisabled(), true, 'Premium checkbox disabled');
      assert.equal(await option.isChecked(), false, 'Premium checkbox unchecked');
      await option.locator('..').locator('span').first().click({ force: true });
      await option.evaluate(el => el.click());
      await option.dispatchEvent('keydown', { key: ' ' });
      assert.equal(await option.isChecked(), false, 'Card, checkbox, and keyboard cannot select premium option');
    }
    assert.equal(await page.getByTestId('preview').innerText(), '{"logo":false,"bold":false}');
  }
  await assertLocked();
  assert.equal(await page.evaluate(() => window.saves.length), 0);
  console.log('PASS no branding access: both options disabled; no requests from clicks or keyboard');
  await page.evaluate(() => window.renderForm(true, 'pro'));
  await options.nth(1).locator('..').filter({ has: page.locator('button:not([disabled])') }).waitFor();
  assert.equal(await options.nth(1).isEnabled(), true);
  assert.equal(await options.nth(2).isEnabled(), true);
  await options.nth(1).click();
  await options.nth(2).click();
  assert.deepEqual(await page.evaluate(() => window.saves.map(s => s.documentPreset)), ['bold_header', 'plain']);
  console.log('PASS Pro: both options remain selectable and save');
  await options.nth(1).click();
  await options.nth(2).click();
  const count = await page.evaluate(() => window.saves.length);
  await page.evaluate(() => window.renderForm(false, 'pro'));
  await options.nth(1).locator('..').filter({ has: page.locator('button[disabled]') }).waitFor();
  await assertLocked();
  assert.equal(await page.evaluate(() => window.saves.length), count);
  console.log('PASS entitlement removed while mounted: both options unchecked and locked');
} finally { await browser.close(); }
