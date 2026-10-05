'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const flush=async()=>{for(let i=0;i<48;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function fixture() {
 let now=0,serial=0;const timers=new Map(),notices=[],saves=[];
 const setTimeout=(callback,delay=0)=>{const id=++serial;timers.set(id,{at:now+Math.max(0,Number(delay)||0),callback});return id;};
 const clearTimeout=id=>timers.delete(id);
 const context={module:{exports:{}},require:()=>({Plugin:class{},PluginSettingTab:class{},Modal:class{},Setting:class{},Platform:{isMacOS:false},Notice:class{constructor(text){notices.push(String(text));}}}),URL,setTimeout,clearTimeout,Date:{now:()=>now}};
 vm.runInNewContext(fs.readFileSync(__dirname+'/../src/main.js','utf8'),context);
 const Pocket=context.module.exports,p=new Pocket();
 Object.assign(p,{settings:{readingSource:'weread',readingFlow:'scroll'},ready:true,wereadReady:true,unloaded:false,navigationRevision:0,appearanceRevision:0,readingFlowTask:null});
 p.persist=()=>saves.push({...p.settings});p.isLiteratureEnabled=()=>false;p.syncNativeReaderPadding=async()=>true;p.applyAppearance=async()=>true;
 const step=async()=>{await flush();if(!timers.size)return false;const earliest=Math.min(...[...timers.values()].map(t=>t.at));now=earliest;for(const [id,timer]of [...timers])if(timer.at<=now){timers.delete(id);timer.callback();}await flush();return true;};
 const waitFor=async predicate=>{for(let i=0;i<150;i++){await flush();if(predicate())return;if(!await step())throw Error('No pending timer can reach expected state');}throw Error('Expected state did not arrive');};
 const settle=async task=>{let finished=false,result,error;Promise.resolve(task).then(value=>{finished=true;result=value;},reason=>{finished=true;error=reason;});for(let i=0;i<400;i++){await flush();if(finished){if(error)throw error;return result;}if(!await step())throw Error('A flow task stayed pending without a deadline');}throw Error('Flow task exceeded bounded fixture work');};
 const guest=(options={})=>{
  const state={flow:'scroll',fontReady:true,hasBook:true,calls:[],setters:[],...options.state};
  const window={__wrpGetFontState:()=>({ready:state.fontReady,size:14}),__wrpSetReadingFlow:flow=>{state.setters.push({flow,at:now});if(options.request)return options.request(flow,state);if(!state.fontReady)return false;state.flow=flow;return true;}};
  const document={querySelector:selector=>selector==='.readerChapterContent'?(state.hasBook?{}:null):selector==='.wr_horizontalReader'?(state.flow==='paged'?{}:null):null};
  const guestContext=vm.createContext({window,document});
  const webview={isConnected:true,executeJavaScript:async code=>{state.calls.push({code,at:now});if(options.execute)return options.execute(code,state,()=>vm.runInContext(code,guestContext));return vm.runInContext(code,guestContext);}};
  return {webview,state};
 };
 const native=guest();p.webview=native.webview;
 return {p,native,guest,notices,saves,timers,minimumPagedPocketHeight:Pocket._test.minimumPagedPocketHeight,syncNativeReaderPadding:Pocket.prototype.syncNativeReaderPadding,setTimeout,clearTimeout,step,waitFor,settle,get now(){return now;}};
}
const checks=[];
async function check(name,fn){await fn();checks.push(name);}
(async()=>{
 await check('Native paged minimum height reserves four lines at standard and extreme typography without changing side toolbar space',()=>{
  const h=fixture(),minimum=h.minimumPagedPocketHeight;
  assert.equal(minimum({fontSizePx:16,lineHeight:1.9},.9,30),320,'Standard 90% guest retains a 320px viewport plus toolbar');
  assert.equal(minimum({fontSizePx:16,lineHeight:1.9},.9,0),290,'Side toolbar contributes no vertical row');
  for(const profile of [{fontSizePx:10,lineHeight:1},{fontSizePx:16,lineHeight:1.9},{fontSizePx:42,lineHeight:3},{fontSizePx:72,lineHeight:4}])for(const zoom of [.5,.9,1,1.5]) {
   const height=minimum(profile,zoom,30),guestHeight=(height-32)/zoom;
   assert(guestHeight>=320-1e-9);assert(guestHeight>=profile.fontSizePx*profile.lineHeight*4+104-1e-9,'Typography-sized minimum keeps native header, pager and four lines');assert.equal(height,Math.ceil(height));
  }
 });
 await check('Invalid, unloaded, unopened and literature-paged flow requests never execute a guest or save settings',async()=>{
  for(const invalid of ['invalid','',null,undefined,0]){const h=fixture();assert.equal(await h.settle(h.p.setReadingFlow(invalid)),false);assert.equal(h.native.state.calls.length,0);assert.equal(h.saves.length,0);}
  for(const state of ['unloaded','not-ready','no-guest','cards']){const h=fixture();if(state==='unloaded')h.p.unloaded=true;if(state==='not-ready')h.p.ready=false;if(state==='no-guest')h.p.webview=null;if(state==='cards')h.p.isLiteratureEnabled=()=>true;assert.equal(await h.settle(h.p.setReadingFlow('paged')),false,state);assert.equal(h.native.state.calls.length,0);assert.equal(h.saves.length,0);}
 });
 await check('Official flow acknowledgement updates settings only after the matching guest reaches its requested mode',async()=>{
  const h=fixture();assert.equal(await h.settle(h.p.setReadingFlow('paged')),true);assert.equal(h.p.settings.readingFlow,'paged');assert.equal(h.saves.length,1);assert.equal(h.native.state.flow,'paged');assert.equal(h.timers.size,0,'Completed request deadlines are removed');assert.equal(h.notices.length,0);
  assert.equal(await h.settle(h.p.setReadingFlow('scroll')),true);assert.equal(h.p.settings.readingFlow,'scroll');assert.equal(h.native.state.flow,'scroll');assert.equal(h.timers.size,0);
 });
 await check('A busy native typography collection delays the switch and retries after it becomes ready',async()=>{
  const h=fixture();h.native.state.fontReady=false;h.setTimeout(()=>{h.native.state.fontReady=true;},750);
  assert.equal(await h.settle(h.p.setReadingFlow('paged')),true);assert(h.native.state.setters.length>=1);assert(h.native.state.setters[0].at>=750,'A mode switch must not race unfinished native typography');assert.equal(h.saves.length,1);assert.equal(h.notices.length,0);assert.equal(h.timers.size,0);
 });
 await check('A temporarily busy native mode setter is retried rather than rejected after the first false result',async()=>{
  const h=fixture();let attempts=0;const native=h.guest({request:(flow,state)=>{if(++attempts<3)return false;state.flow=flow;return true;}});h.p.webview=native.webview;
  assert.equal(await h.settle(h.p.setReadingFlow('paged')),true);assert.equal(attempts,3);assert.equal(h.saves.length,1);assert.equal(h.notices.length,0);
 });
 await check('Source change while native padding is pending retires the flow before it executes any guest',async()=>{
  const h=fixture(),padding=deferred();let called=false;h.p.syncNativeReaderPadding=()=>{called=true;return padding.promise;};const task=h.p.setReadingFlow('paged');await h.waitFor(()=>called);
  h.p.settings.readingSource='local';padding.resolve();assert.equal(await h.settle(task),false);assert.equal(h.native.state.calls.length,0);assert.equal(h.saves.length,0);assert.equal(h.p.settings.readingFlow,'scroll');assert.equal(h.notices.length,0);
 });
 await check('Native padding which loses its callback is bounded and a source switch retires the waiting host flow quietly',async()=>{
  const h=fixture();h.p.resolveNativeReaderPadding=()=>new Promise(()=>{});h.p.syncNativeReaderPadding=h.syncNativeReaderPadding;
  const task=h.p.setReadingFlow('paged');await h.waitFor(()=>!!h.p.nativeLayoutTask);
  h.p.settings.readingSource='local';h.p.webview=null;
  assert.equal(await h.settle(task),false);assert(h.now<=3000);assert.equal(h.p.nativeLayoutTask,null);assert.equal(h.native.state.calls.length,0);assert.equal(h.saves.length,0);assert.equal(h.notices.length,0);assert.equal(h.timers.size,0);
 });
 await check('Guest replacement during the switch cannot acknowledge with or alter the replacement guest',async()=>{
  const h=fixture(),held=deferred();const old=h.guest({execute:(code,state,evaluate)=>code.includes('__wrpSetReadingFlow')?held.promise:evaluate()});h.p.webview=old.webview;
  const task=h.p.setReadingFlow('paged');await h.waitFor(()=>old.state.calls.some(c=>c.code.includes('__wrpSetReadingFlow')));
  const fresh=h.guest({state:{flow:'paged'}});h.p.webview=fresh.webview;h.p.navigationRevision++;held.resolve(true);
  assert.equal(await h.settle(task),false);assert.equal(fresh.state.calls.length,0);assert.equal(h.saves.length,0);assert.equal(h.p.settings.readingFlow,'scroll');assert.equal(h.notices.length,0);
 });
 await check('Queued requests retain their source and guest at enqueue time instead of executing on a later source',async()=>{
  const h=fixture(),padding=deferred();let called=false;h.p.syncNativeReaderPadding=()=>{called=true;return padding.promise;};const first=h.p.setReadingFlow('paged');await h.waitFor(()=>called);const queued=h.p.setReadingFlow('scroll');
  const fresh=h.guest({state:{flow:'paged'}});h.p.settings.readingSource='local';h.p.webview=null;h.p.navigationRevision++;h.p.settings.readingSource='weread';h.p.webview=fresh.webview;padding.resolve();
  assert.equal(await h.settle(first),false);assert.equal(await h.settle(queued),false);assert.equal(fresh.state.calls.length,0);assert.equal(h.saves.length,0);assert.equal(h.notices.length,0);
 });
 await check('Unload during an in-flight guest call stops quietly without saving a delayed success',async()=>{
  const h=fixture(),held=deferred();const native=h.guest({execute:(code,state,evaluate)=>code.includes('__wrpSetReadingFlow')?held.promise:evaluate()});h.p.webview=native.webview;
  const task=h.p.setReadingFlow('paged');await h.waitFor(()=>native.state.calls.some(c=>c.code.includes('__wrpSetReadingFlow')));h.p.unloaded=true;h.p.webview=null;held.resolve(true);
  assert.equal(await h.settle(task),false);assert.equal(h.saves.length,0);assert.equal(h.p.settings.readingFlow,'scroll');assert.equal(h.notices.length,0);assert.equal(h.timers.size,0);
 });
 await check('A guest call that never resolves is bounded and cannot permanently block later reading flow requests',async()=>{
  const h=fixture();const hung=h.guest({execute:()=>new Promise(()=>{})});h.p.webview=hung.webview;
  assert.equal(await h.settle(h.p.setReadingFlow('paged')),false);assert.equal(h.saves.length,0);assert(h.now<=30000,'A missing renderer callback cannot retain an unbounded host wait');assert.equal(h.timers.size,0);
  const fresh=h.guest();h.p.webview=fresh.webview;h.p.navigationRevision++;assert.equal(await h.settle(h.p.setReadingFlow('paged')),true);assert.equal(h.saves.length,1);assert.equal(h.timers.size,0);
 });
 console.log(JSON.stringify({pass:true,checks},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
