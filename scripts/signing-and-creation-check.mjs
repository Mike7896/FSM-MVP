/** Real route/services, recording database boundary. No credentials or network. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
const require=createRequire(import.meta.url);
const dialect=new PgDialect();
async function bundled(contents,stubs) {
  const b=await build({stdin:{contents,resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{name:'test-boundaries',setup(b){
    b.onResolve({filter:/.*/},a=>Object.hasOwn(stubs,a.path)?{path:a.path,namespace:'stub'}:undefined);
    b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path],loader:'js',resolveDir:process.cwd()}));
  }}]});
  const compiled={exports:{}};new Function('module','exports','require',b.outputFiles[0].text)(compiled,compiled.exports,require);return compiled.exports;
}
let writes=[],deposits=0;
const contract={id:'contract',organizationId:'org',type:'contract',status:'generated',number:'C1',header:{},scope:[],details:{contractSumCents:10000},signatures:[],frozenAt:null};
globalThis.__signingCheck={load:async()=>contract,insert:values=>{writes.push(values);return [{...values,id:'signature'}]},deposit:async()=>{deposits++;return null;}};
try {
  const {POST,signDocument}=await bundled(`export {POST} from './app/api/v1/documents/[id]/sign/route';export {signDocument} from './lib/signing/sign';`,{
    'server-only':'',
    '@/lib/api/auth':`export const requireCaller=async()=>({userId:'owner',email:'owner@example.test'});export const requireOrg=async()=>({organizationId:'org'});`,
    '@/lib/documents':`export const loadDocument=(...args)=>globalThis.__signingCheck.load(...args);export const issueDepositInvoice=(...args)=>globalThis.__signingCheck.deposit(...args);`,
    '@/lib/documents/repository':`export const loadDocument=(...args)=>globalThis.__signingCheck.load(...args);`,
    '@/lib/signing':`export {signDocument,SigningError} from '${process.cwd().replaceAll('\\','/')}/lib/signing/sign.ts';`,
    '@/lib/db':`export const db={insert:()=>({values:v=>({returning:async()=>globalThis.__signingCheck.insert(v)})})};`,
    '@/lib/observability':'export const reportError=()=>{};',
  });
  const input={documentId:'contract',organizationId:'org',party:'customer',printedName:'Homeowner',consented:true,mark:{kind:'typed'},authMethod:'account'};
  const request=party=>new Request('http://audit.test/api/v1/documents/contract/sign',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({party,printedName:input.printedName,consented:input.consented,mark:input.mark})});
  const denied=await POST(request('customer'),{params:Promise.resolve({id:'contract'})});
  assert.equal(denied.status,422);assert.equal(writes.length,0);assert.equal(deposits,0);
  await assert.rejects(()=>signDocument(input),/customer must sign through their own share link/);
  assert.equal(writes.length,0);
  const allowed=await POST(request('contractor'),{params:Promise.resolve({id:'contract'})});
  assert.equal(allowed.status,200);assert.equal(writes[0].party,'contractor');
  writes=[];
  await signDocument({...input,authMethod:'share_link'});
  assert.equal(writes[0].party,'customer');assert.equal(writes[0].authMethod,'share_link');
  console.log('PASS account route and service reject customer signatures; contractor signing and customer share-link signing remain valid');
} finally {delete globalThis.__signingCheck;}

let results=[],calls=[];
function query(action,table) {
  const call={action,table:table&&getTableName(table)};
  const chain={from(t){call.table=getTableName(t);return chain;},where(q){call.where=dialect.sqlToQuery(q);return chain;},limit(){return chain;},values(v){call.values=v;return chain;},
    returning(){call.returning=true;return chain;},then(resolve,reject){calls.push(call);const result=action==='select'||call.returning?results.shift():[];
      assert.notEqual(result,undefined,`Unexpected ${action} ${call.table}`);return Promise.resolve(result).then(resolve,reject);}};
  return chain;
}
const db={transaction:async fn=>fn(db),execute:async q=>{calls.push({action:'execute',query:dialect.sqlToQuery(q)});return [];},select:()=>query('select'),insert:t=>query('insert',t)};
const id='53ce002a-2b55-4bff-833d-fd7d2210cdca';
globalThis.__creationCheck={db,record:{id,title:'Original'},read:async(id,org,on)=>{assert.equal(on,db);assert.equal(org,'org');return globalThis.__creationCheck.record;}};
try {
  const {createQuote}=await bundled(`export {createQuote} from './lib/documents/operations/create-quote';`,{
    'server-only':'','@/lib/db':'export const db=globalThis.__creationCheck.db;',
    '../quote-record':'export const readQuoteRecord=(...args)=>globalThis.__creationCheck.read(...args);',
  });
  const args={organizationId:'org',userId:'owner',input:{creationId:id,customerId:'customer',jobId:'job',title:'Original'}};
  results=[[],[{id:'customer'}],[{id:'job'}],[],[{id}]];
  assert.equal((await createQuote(args)).id,id);assert.equal(results.length,0);
  assert.match(calls[0].query.sql,/pg_advisory_xact_lock/);
  assert.equal(calls.find(c=>c.action==='insert'&&c.table==='documents').values.id,id);
  const existing={organizationId:'org',createdBy:'owner',type:'quote'};
  calls=[];results=[[existing]];
  assert.equal((await createQuote({...args,input:{...args.input,title:'Changed retry'}})).title,'Original');
  assert.ok(!calls.some(c=>c.action==='insert'),'Replay cannot create a job/customer/document or overwrite original data');
  for(const overrides of [{organizationId:'other'},{createdBy:'other'},{type:'invoice'}]) {
    calls=[];results=[[{...existing,...overrides}]];
    await assert.rejects(()=>createQuote(args),/creation request is unavailable/);
    assert.ok(!calls.some(c=>c.action==='insert'));
  }
  console.log('PASS creation locks before writes, uses stable ID, returns existing quote on retry, and rejects cross-tenant/author/type collisions');
} finally {delete globalThis.__creationCheck;}
