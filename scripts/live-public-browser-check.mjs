/** Production public-page acceptance only: no signup, checkout or payments. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {parse} from 'dotenv';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_PACKAGE ?? 'C:/Users/Michel/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const env=parse(readFileSync('.env.production'));
const base=new URL(env.NEXT_PUBLIC_SITE_URL).origin;
const dir='docs/live-browser-evidence';mkdirSync(dir,{recursive:true});
const results=[];
const browser=await chromium.launch({channel:'msedge',headless:true});
function check(name,value){assert.ok(value,name);results.push({name,passed:true});console.log(`PASS ${name}`);}
try {
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  const page=await context.newPage();const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/pricing');
  await page.getByRole('tab',{name:'Annual · 2 months free',exact:true}).click();
  const copy=await page.locator('body').innerText();
  check('Live annual pricing shows $290 Starter and $490 Pro',copy.includes('$290')&&copy.includes('$490'));
  check('ACH pricing does not advertise a disabled ServiceClerk fee',!copy.includes('0.2%'));
  await page.screenshot({path:dir+'/pricing-desktop.png',fullPage:true});
  await page.getByRole('button',{name:'Start with Starter',exact:true}).click();
  await page.waitForURL('**/signup?**');
  const url=new URL(page.url());
  check('Live pricing selection reaches signup',url.origin===base&&url.searchParams.get('plan')==='starter'&&url.searchParams.get('interval')==='year');
  const next=await page.locator('form[action="/auth/google"] input[name="next"]').inputValue();
  check('Google signup preserves selected plan',next.includes('plan=starter')&&next.includes('interval=year'));
  await page.getByRole('button',{name:'Create account',exact:true}).click();
  check('Invalid signup is rejected before account creation',(await page.locator('body').innerText()).includes('valid email'));
  const sources=await page.locator('script[src]').evaluateAll(nodes=>nodes.map(n=>n.src));
  let bundle='';
  for(const source of sources){if(new URL(source).origin===base)bundle+=await (await context.request.get(source)).text();}
  // These forms can authenticate through server routes without shipping the
  // Supabase client. Absence is inconclusive, not a deployment failure.
  results.push({name:'Public bundle environment observation',productionSupabaseUrlPresent:bundle.includes(env.NEXT_PUBLIC_SUPABASE_URL),productionPublicKeyPresent:bundle.includes(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)});
  const local=parse(readFileSync('.env.local'));
  check('Signup client bundle does not contain dev Supabase URL',local.NEXT_PUBLIC_SUPABASE_URL===env.NEXT_PUBLIC_SUPABASE_URL || !bundle.includes(local.NEXT_PUBLIC_SUPABASE_URL));
  await page.setViewportSize({width:390,height:844});
  for(const path of ['/','/pricing','/signup']){
    await page.goto(base+path);
    check(`Mobile ${path} has no horizontal overflow`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:dir+`/${path==='/'?'home':path.slice(1)}-mobile.png`,fullPage:true});
  }
  check('Public browser flow has no uncaught JavaScript errors',errors.length===0);
}finally{await browser.close();writeFileSync(dir+'/results.json',JSON.stringify(results,null,2));}
