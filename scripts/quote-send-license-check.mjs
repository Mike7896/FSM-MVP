import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
let results=[],writes=[],captured=[],sent=[];
function chain(action){const q={from(){return q},innerJoin(){return q},leftJoin(){return q},where(){return q},limit(){return q},orderBy(){return q},set(v){writes.push(v);return q},values(v){writes.push(v);return q},then(resolve,reject){return Promise.resolve(action==='select'?results.shift():[]).then(resolve,reject)}};return q;}
const db={select:()=>chain('select'),update:()=>chain('update'),insert:()=>chain('insert'),transaction:async fn=>fn(db)};
globalThis.__sendTest={db,capture:async input=>{captured.push(input);return {}},send:async input=>sent.push(input)};
const stubs={
 'server-only':'',
 '@/lib/db':'export const db=globalThis.__sendTest.db;',
 '@/lib/admin/limits':'export const checkSendAllowance=async()=>{};',
 '@/lib/membership/activation':'export const withDocumentActivation=async(a,fn)=>fn();',
 '../header':'export const captureHeader=(v)=>globalThis.__sendTest.capture(v);',
 '../share-links':'export const ensureShareLink=async()=>({url:"https://example.test/share"});',
 '../quote-record':'export const readQuoteRecord=async()=>({customerName:"Customer",title:"Work",number:"Q1"});',
 '@/lib/quote':'export const draftFromRecord=x=>x;export const totals=()=>({totalCents:100,depositCents:0});',
 '@/lib/signing/lines':'export const signsOnQuote=()=>false;',
 '@/lib/queries/office':'export const getOfficeSignature=async()=>null;',
 '@/lib/email/letterhead':'export const letterheadFor=async()=>({name:"Business"});',
 '@/lib/email/enclosure':'export const enclose=async()=>({paper:"",pdf:null});',
 '@/lib/email/quote-email':'export const quoteMessage=()=>"Message";export const quoteEmail=async()=>({subject:"Quote",html:"",text:""});',
 '@/lib/email/send':'export class EmailNotConfiguredError extends Error{};export const emailConfigured=()=>true;export const sendEmail=v=>globalThis.__sendTest.send(v);'
};
try{
 const b=await build({stdin:{contents:"export {sendQuote} from './lib/documents/operations/send-quote';",resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/.*/},a=>Object.hasOwn(stubs,a.path)?{path:a.path,namespace:'stub'}:undefined);b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path],loader:'js',resolveDir:process.cwd()}));}}]});
 const mod={exports:{}};new Function('module','exports','require',b.outputFiles[0].text)(mod,mod.exports,createRequire(import.meta.url));
 for(const channel of ['email','link'])for(const mode of ['none','active','selected','missing-business']){
  writes=[];captured=[];sent=[];
  results=[[{id:'quote',type:'quote',jobId:'job',customerId:'customer',customerEmail:'customer@example.test',licenseId:mode==='selected'?'selected':null,frozenAt:null,status:'draft',sentAt:null,demo:false}],[{name:mode==='missing-business'?' ':'Business'}],mode==='active'?[{id:'active'}]:[]];
  if(channel==='email')results.push([{}],[{demo:false}]);
  const run=()=>mod.exports.sendQuote({organizationId:'org',quoteId:'quote',sender:{userId:'owner',email:'owner@example.test'},input:{channel}});
  if(mode==='missing-business'){await assert.rejects(run,/business name/);assert.equal(sent.length,0);assert.equal(writes.length,0);continue;}
  await run();assert.equal(captured[0].licenseId,mode==='none'?null:mode);assert.equal(sent.length,channel==='email'?1:0);assert.ok(writes.some(v=>v.status==='sent'));assert.ok(writes.some(v=>v.channel===channel));
 }
 console.log('PASS email and link sends without a license, active/selected license capture, and missing business-name rejection');
}finally{delete globalThis.__sendTest}

