/** Real dashboard/hooks with controlled HTTP and Realtime transports; no account or database writes. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE ?? 'C:/Users/Michel/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const panels = ['ActivityPanels', 'FounderKpis', 'FounderPanels', 'BusinessesPanel', 'FunnelPanel', 'HealthPanels', 'RevenuePanel', 'SupportPanel', 'TrendPanels'];
const skeletons = ['ActivityPanelsSkeleton', 'BusinessesPanelSkeleton', 'DashboardSkeleton', 'FounderKpisSkeleton', 'FounderPanelsSkeleton', 'FunnelPanelSkeleton', 'KpiGridSkeleton', 'RevenuePanelSkeleton', 'SupportAndHealthSkeleton', 'TrendPanelsSkeleton'];
const stubs = {
  '@/lib/supabase/client': `export function createClient(){return {
    auth:{getSession:async()=>({data:{session:null}})}, realtime:{setAuth:async()=>{}},
    channel(){const handlers=[];const channel={
      on(type,filter,handler){handlers.push({type,filter,handler});return channel},
      subscribe(callback){window.liveState=callback;window.push=(table,payload)=>handlers.find(h=>h.type==='postgres_changes'&&h.filter.table===table)?.handler(payload);
        window.changed=table=>handlers.find(h=>h.type==='broadcast').handler({payload:{table}});return channel},
    };return channel},removeChannel:async()=>{window.removed=true}
  }}`,
  './admin-panels': panels.map(name => `export const ${name}=()=>null;`).join('\n') + `
    export const Panel=({children,title})=><section><h2>{title}</h2>{children}</section>;
    export const OnlinePanel=({rows})=><output data-testid="presence">{JSON.stringify(rows)}</output>;
    export const KpiGrid=({metrics})=><output data-testid="users">{metrics.people.users}</output>;`,
  './dashboard-skeleton': skeletons.map(name => `export const ${name}=()=>null;`).join('\n'),
  './alerts': `const prefs=Object.fromEntries(['money','milestone','activity','problem'].map(k=>[k,{sound:false,toast:false,desktop:false,volume:0}]));
    export const useAlertPrefs=()=>[prefs,()=>{}]; export const desktopPermission=()=> 'default';
    export const askDesktopPermission=async()=>{}; export const notifyDesktop=()=>{}; export const playSound=()=>{};
    export const soundReady=()=>false; export const unlockSound=()=>{};`,
};
const bundle = await build({
  stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';
    import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
    import {AdminDashboard} from './components/admin/admin-dashboard';
    window.requests=[];window.pendingLive=[];window.failGroups=[];window.holdGroups=[];window.pendingMetrics=[];
    window.fixtures={activity:{people:{users:10},series:[],hourly:[],byKind:[],active:[]},business:{usage:{},money:{},funnel:{},newest:[],testUserIds:[]},
      revenue:{revenue:{},founderRevenue:{revenue:{},costs:{}}},engagement:{founderUsage:{}},support:{support:[],deliveries:[],failures:[],stripe:[]},system:{system:{}}};
    const response=(data,status=200)=>new Response(JSON.stringify(status===200?{data}:{error:{message:'Simulated refresh failure'}}),{status,headers:{'Content-Type':'application/json'}});
    window.fetch=(url,options={})=>{window.requests.push(url);const group=new URL(url,'http://test.local').searchParams.get('group');
      if(url==='/api/v1/admin/live')return new Promise((resolve,reject)=>{
        window.pendingLive.push((data,status=200)=>resolve(response(data,status)));options.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')));
      });
      if(window.holdGroups.includes(group))return new Promise(resolve=>window.pendingMetrics.push(()=>resolve(response(window.fixtures[group]))));
      return Promise.resolve(response(window.fixtures[group],window.failGroups.includes(group)?503:200));};
    window.event=id=>({id,occurred_at:new Date(1700000000000+id*1000).toISOString(),kind:'quote_created',level:'activity',organization_id:null,org_name:null,user_id:null,title:'Event '+id,amount_cents:null,test:false,internal:false,demo:false,data:{}});
    window.person=(id,area='quotes')=>({user_id:id,organization_id:null,area,device:'computer',last_seen:new Date().toISOString(),business:null});
    const client=new QueryClient({defaultOptions:{queries:{retry:1,retryDelay:50,refetchOnWindowFocus:false,staleTime:30000}}});
    const root=createRoot(document.getElementById('root'));
    root.render(<QueryClientProvider client={client}><AdminDashboard initialEvents={[window.event(100)]} initialPresence={[window.person('removed')]} adminEmail="admin@example.test"/></QueryClientProvider>);
    window.unmount=()=>root.unmount();`, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, write: false, format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'controlled-transports', setup(b) {
    b.onResolve({ filter: /.*/ }, args => stubs[args.path] ? { path: args.path, namespace: 'stub' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: stubs[args.path], loader: 'jsx', resolveDir: process.cwd() }));
  } }],
});
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.waitForFunction(() => window.liveState && document.querySelector('[data-testid="users"]')?.textContent === '10');
  await page.evaluate(() => {
    window.liveState('SUBSCRIBED');
    window.push('admin_events', { new: window.event(111) });
    window.push('user_presence', { eventType: 'UPDATE', new: window.person('updated', 'invoices') });
    window.push('user_presence', { eventType: 'DELETE', old: { user_id: 'removed' }, new: {} });
    window.pendingLive.shift()({ events: Array.from({ length: 11 }, (_, i) => window.event(100 + i)),
      presence: [window.person('removed'), window.person('updated'), window.person('restored')] });
  });
  await page.getByText('Event 101', { exact: true }).waitFor();
  await page.getByText('Event 111', { exact: true }).waitFor();
  assert.equal(await page.getByText('Event 110', { exact: true }).count(), 1);
  const presence = JSON.parse(await page.getByTestId('presence').innerText());
  assert.deepEqual(presence.map(row => row.user_id).sort(), ['restored', 'updated']);
  assert.equal(presence.find(row => row.user_id === 'updated').area, 'invoices');
  console.log('PASS recovery includes missed lower IDs and newer pushes; snapshot preserves concurrent presence update/delete');

  await page.waitForTimeout(1400); // Let the initial/reconnect coalescing window finish.
  await page.evaluate(() => { window.requests=[]; for(let i=0;i<20;i++) window.changed('user_activity_hours'); });
  await page.waitForFunction(() => window.requests.some(url => url.includes('group=engagement')));
  await page.waitForTimeout(150);
  const requests = await page.evaluate(() => window.requests);
  assert.equal(requests.length, 1);
  assert.ok(requests[0].includes('group=engagement'));
  console.log('PASS burst of 20 activity signals makes one engagement request, no revenue/system/feed requests');

  await page.evaluate(() => { window.requests=[];window.holdGroups=['engagement'];window.changed('user_activity_hours'); });
  await page.waitForFunction(() => window.pendingMetrics.length === 1);
  await page.evaluate(() => { window.changed('user_activity_hours');window.holdGroups=[];window.pendingMetrics.shift()(); });
  await page.waitForFunction(() => window.requests.length === 2);
  console.log('PASS write during in-flight request schedules a follow-up read');

  await page.evaluate(() => { window.failGroups=['activity'];window.changed('admin_events'); });
  await page.getByRole('alert').filter({ hasText: 'Unable to refresh: activity' }).waitFor();
  assert.equal(await page.getByTestId('users').innerText(), '10');
  assert.equal(await page.getByText('Data stale', { exact: true }).count(), 1);
  await page.evaluate(() => { window.failGroups=[];window.fixtures.activity.people.users=11;window.changed('admin_events'); });
  await page.waitForFunction(() => document.querySelector('[data-testid="users"]')?.textContent === '11');
  assert.equal(await page.getByRole('alert').count(), 0);
  console.log('PASS failed refresh preserves values with stale warning; successful retry clears warning');

  await page.evaluate(() => { window.liveState('CHANNEL_ERROR');window.liveState('SUBSCRIBED'); });
  await page.waitForFunction(() => window.pendingLive.length === 1);
  await page.evaluate(() => window.pendingLive.shift()({ events: [window.event(109),window.event(112)], presence: [window.person('reconnected')] }));
  await page.getByText('Event 112', { exact: true }).waitFor();
  assert.deepEqual(JSON.parse(await page.getByTestId('presence').innerText()).map(row => row.user_id), ['reconnected']);
  console.log('PASS reconnect replaces stale presence snapshot and deduplicates feed');

  await page.evaluate(() => { window.liveState('SUBSCRIBED');window.pendingLive.shift()(null,503); });
  await page.getByRole('alert').filter({ hasText: 'Recovery will retry automatically' }).waitFor();
  await page.waitForFunction(() => window.pendingLive.length === 1);
  await page.evaluate(() => window.pendingLive.shift()({ events: [window.event(99),window.event(112)], presence: [window.person('reconnected')] }));
  await page.getByText('Event 99', { exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('[role="alert"]'));
  console.log('PASS failed snapshot retries automatically and recovers a late lower-ID event');

  await page.waitForTimeout(1000);
  await page.evaluate(() => { window.requests=[];window.changed('user_activity_hours');window.unmount(); });
  await page.waitForTimeout(800);
  assert.deepEqual(await page.evaluate(() => window.requests), []);
  assert.equal(await page.evaluate(() => window.removed), true);
  assert.deepEqual(errors, []);
  console.log('PASS unmount cancels pending refresh and removes channel; no browser errors');
} finally { await browser.close(); }
