/** Isolated real React hook/form tests with controlled HTTP; no application database. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE ?? 'C:/Users/Michel/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const stubs = {
  'next/navigation': 'const router={refresh(){}};export const useRouter=()=>router;',
  'next/link': 'export default function Link({children,...props}){return <a {...props}>{children}</a>}',
  '@/components/documents/document-sheet': 'export const DocumentFooter=()=>null;',
  '@/components/office/logo-field': 'export const LogoField=()=>null;',
  '@/components/office/document-preview': 'export const OfficeDocumentPreview=()=>null;',
  '@/components/quote/projection': 'export const QuoteProjection=()=>null;',
};
const bundle = await build({
  stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {useQuoteDraft} from './components/quote-editor/use-quote-draft';
    import {emptyDraft,makeNode} from './lib/quote/draft';
    import {IdentityForm} from './components/office/identity-form';
    window.requests=[];window.pending=[];
    window.fetch=(url,options)=>{window.requests.push({url,...options});return new Promise((resolve,reject)=>window.pending.push({resolve,reject}));};
    window.respond=(index)=>{const request=window.requests[index];const p=JSON.parse(request.body);
      const record={...p,...p.terms,id:p.creationId??'existing',number:'Q1',jobId:'job',customerId:'customer',status:'draft',licenseId:null,packId:null,
        drawPattern:p.terms?.phases??[],scope:(p.scope??[]).map((n,i)=>({...n,id:n.id??'node-'+i,parentNodeId:null}))};
      window.pending.shift().resolve(new Response(JSON.stringify({data:record}),{status:200}));};
    const fresh=new URL(location.href).searchParams.has('new');
    const initial=emptyDraft({...fresh?{}:{id:'existing',title:'Old'},scope:[makeNode('item',{description:'Work',sellPriceCents:100})]});
    function Quote(){const editor=useQuoteDraft({initial,autosave:false});window.editor=editor;return <output>{editor.draft.title}</output>;}
    const root=createRoot(document.getElementById('root'));window.unmount=()=>root.unmount();
    root.render(location.pathname==='/office'?<IdentityForm office={{id:'org',name:'Test shop',phone:'',email:'',address:'',website:'',logoUrl:null}}
      license={null} presetName="Plain" logoOnDocuments={false} look={{logo:false,bold:false}}/>:<Quote/>);
  ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'test-boundaries', setup(b) {
    b.onResolve({ filter: /.*/ }, a => Object.hasOwn(stubs,a.path) ? { path:a.path,namespace:'stub' } : undefined);
    b.onLoad({ filter: /.*/, namespace:'stub' }, a => ({contents:stubs[a.path],loader:'jsx',resolveDir:process.cwd()}));
  } }],
});
const browser = await chromium.launch({channel:'msedge',headless:true});
const errors=[];
async function pageAt(path) {
  const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.clock.install();
  await page.route('http://localhost:9876/**',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
  await page.goto('http://localhost:9876'+path);await page.addScriptTag({content:bundle.outputFiles[0].text});return page;
}
try {
  const quote=await pageAt('/quote');await quote.waitForFunction(()=>window.editor);
  await quote.evaluate(()=>window.editor.update(d=>({...d,title:'New'})));await quote.getByText('New',{exact:true}).waitFor();
  await quote.evaluate(()=>{window.editor.saveNow().then(v=>window.first=v);});await quote.waitForFunction(()=>window.requests.length===1);
  await quote.evaluate(()=>{window.editor.saveNow().then(v=>window.second=v);});
  await quote.clock.runFor(15100);
  assert.deepEqual(await quote.evaluate(()=>[window.first,window.second]),[null,null]);
  await quote.evaluate(()=>window.respond(0));await quote.waitForFunction(()=>window.requests.length===2);
  await quote.evaluate(()=>window.respond(1));await quote.waitForFunction(()=>window.editor.status==='saved');
  const result=await quote.evaluate(()=>window.editor.saveNow());assert.equal(result.title,'New');
  console.log('PASS slow initial/in-flight flushes fail closed; settled saves return current content and row IDs');

  const fresh=await pageAt('/quote?new');await fresh.waitForFunction(()=>window.editor);
  await fresh.evaluate(()=>{window.editor.saveNow();});await fresh.waitForFunction(()=>window.requests.length===1);
  await fresh.evaluate(()=>window.pending.shift().reject(new TypeError('Lost create response')));
  await fresh.waitForFunction(()=>window.editor.status==='error');
  await fresh.evaluate(()=>window.editor.update(d=>({...d,title:'Edited after loss'})));await fresh.getByText('Edited after loss',{exact:true}).waitFor();
  await fresh.evaluate(()=>{window.editor.saveNow().then(v=>window.saved=v);});await fresh.waitForFunction(()=>window.requests.length===2);
  let requests=await fresh.evaluate(()=>window.requests);
  assert.equal(requests[0].body,requests[1].body,'Retry replays original creation, including its stable id');
  assert.match(JSON.parse(requests[1].body).creationId,/^[0-9a-f-]{36}$/);
  await fresh.evaluate(()=>window.respond(1));await fresh.waitForFunction(()=>window.requests.length===3);
  requests=await fresh.evaluate(()=>window.requests);
  assert.equal(requests[2].method,'PATCH');assert.equal(JSON.parse(requests[2].body).title,'Edited after loss');
  assert.ok(requests[2].url.endsWith(JSON.parse(requests[0].body).creationId));
  await fresh.evaluate(()=>window.respond(2));await fresh.clock.runFor(200);
  assert.equal(await fresh.evaluate(()=>window.saved?.title),'Edited after loss');
  console.log('PASS lost create response retains idempotency identity; later edits PATCH the recovered quote');

  const refused=await pageAt('/quote?new');await refused.waitForFunction(()=>window.editor);
  await refused.evaluate(()=>{window.editor.saveNow();});await refused.waitForFunction(()=>window.requests.length===1);
  await refused.evaluate(()=>window.pending.shift().resolve(new Response(JSON.stringify({error:{message:'Fix the title'}}),{status:422})));
  await refused.waitForFunction(()=>window.editor.status==='error');
  await refused.evaluate(()=>window.editor.update(d=>({...d,title:'Corrected'})));await refused.getByText('Corrected',{exact:true}).waitFor();
  await refused.evaluate(()=>{window.editor.saveNow();});await refused.waitForFunction(()=>window.requests.length===2);
  assert.equal(await refused.evaluate(()=>JSON.parse(window.requests[1].body).title),'Corrected');
  console.log('PASS explicit validation refusal allows corrected creation fields instead of endlessly replaying the invalid request');

  const office=await pageAt('/office');await office.getByLabel('Address',{exact:true}).fill('First address');
  const warned=await office.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;});
  assert.equal(warned,true);
  await office.evaluate(()=>window.dispatchEvent(new Event('pagehide')));await office.waitForFunction(()=>window.requests.length===1);
  assert.equal(await office.evaluate(()=>window.requests[0].keepalive),true);
  await office.getByLabel('Address',{exact:true}).fill('Latest address');
  await office.evaluate(()=>window.unmount());
  assert.equal(await office.evaluate(()=>window.requests.length),1,'Unmount cannot race the in-flight save');
  await office.evaluate(()=>window.pending.shift().resolve(new Response('{}',{status:200})));
  await office.waitForFunction(()=>window.requests.length===2);
  assert.equal(await office.evaluate(()=>JSON.parse(window.requests[1].body).address),'Latest address');
  await office.evaluate(()=>window.pending.shift().resolve(new Response('{}',{status:200})));
  console.log('PASS identity page exit warns, uses keepalive, and saves newer edits after the in-flight request');

  const invalid=await pageAt('/office');await invalid.getByLabel('Email',{exact:true}).fill('not-an-email');
  await invalid.evaluate(()=>window.dispatchEvent(new Event('pagehide')));await invalid.clock.runFor(1000);
  assert.equal(await invalid.evaluate(()=>window.requests.length),0,'Exit must not bypass validation');
  assert.deepEqual(errors,[]);
  console.log('PASS identity exit preserves validation; no browser runtime errors');
} finally {await browser.close();}
