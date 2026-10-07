/** Real approval/signing components, simulated API responses, no server or database. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE ?? 'C:/Users/Michel/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const stubs = {
  'next/navigation': 'export const useRouter=()=>({refresh(){window.refreshed=true}});',
  'sonner': 'export const toast={error(message){window.lastError=message},success(){window.succeeded=true}};',
};
const bundle = await build({
  stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';
    import {ApproveButton} from './components/share/approve-button';
    import {SignBlock} from './components/signing/sign-block';
    window.requests=[]; window.succeeded=false;window.refreshed=false;
    window.fetch=async(url,options)=>{window.requests.push({url,body:JSON.parse(options.body)});
      return new Response(JSON.stringify(window.allow?{data:{status:'signed'}}:{error:{message:'This quote has changed. Reload and review the current price.'}}),{status:window.allow?200:409});};
    createRoot(document.getElementById('root')).render(<>
      <ApproveButton token="test" hash={'a'.repeat(64)} label="Approve quote"/>
      <SignBlock endpoint="/api/share/test/sign" reviewHash={'a'.repeat(64)} party="customer" defaultName="Test Homeowner"/>
    </>);`, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, write: false, format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'browser-boundaries', setup(b) {
    b.onResolve({ filter: /.*/ }, args => Object.hasOwn(stubs, args.path) ? { path: args.path, namespace: 'stub' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: stubs[args.path], loader: 'js' }));
  } }],
});
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.getByRole('button', { name: 'Approve quote' }).click();
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(), /quote has changed/);
  assert.equal(await page.getByRole('button', { name: 'Approve quote' }).isEnabled(), true);
  await page.getByRole('tab', { name: 'Type', exact: true }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Sign', exact: true }).click();
  await page.waitForFunction(() => window.lastError);
  assert.match(await page.evaluate(() => window.lastError), /quote has changed/);
  assert.equal(await page.evaluate(() => window.refreshed || window.succeeded), false);
  const requests = await page.evaluate(() => window.requests);
  assert.deepEqual(requests.map(r => r.body.hash), ['a'.repeat(64), 'a'.repeat(64)]);
  assert.equal(requests[1].body.consented, true);
  assert.equal(requests[1].body.mark.kind, 'typed');
  await page.evaluate(() => { window.allow = true; });
  await page.getByRole('button', { name: 'Sign', exact: true }).click();
  await page.waitForFunction(() => window.succeeded && window.refreshed);
  assert.deepEqual(errors, []);
  console.log('PASS browser: both actions send review token; stale review shows error without success/navigation; signing recovers on valid response');
} finally { await browser.close(); }
