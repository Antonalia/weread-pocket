'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/../src/main.js','utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<64;i++)await Promise.resolve();};
function fixture() {
 let now=0,serial=0,attached=false;const timers=new Map(),commands=[],listeners=new Map();
 const state={bound:false,attaches:0,detaches:0,hangEvaluate:false,hangRelease:false,evaluate:deferred(),release:deferred(),binding:deferred(),hangBinding:false};
 const debuggerApi={
  isAttached:()=>attached,attach(){attached=true;state.attaches++;},detach(){attached=false;state.detaches++;for(const callback of [...(listeners.get('detach')||[])])callback();},
  on(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},removeListener(type,fn){listeners.get(type)?.delete(fn);},
  sendCommand(method,args){
   commands.push({method,args,at:now});
   if(method==='Runtime.evaluate')return state.hangEvaluate?state.evaluate.promise:Promise.resolve({result:{objectId:'listener'}});
   if(method==='Runtime.releaseObjectGroup')return state.hangRelease?state.release.promise:Promise.resolve({});
   if(method==='Runtime.callFunctionOn'){if(state.hangBinding)return state.binding.promise;state.bound=true;return Promise.resolve({result:{value:true}});}
   assert.equal(method,'Runtime.getProperties');
   if(args.objectId==='listener')return Promise.resolve({result:[],internalProperties:[{name:'[[Scopes]]',value:{objectId:'scopes'}}]});
   if(args.objectId==='scopes')return Promise.resolve({result:[{name:'0',value:{objectId:'closure',description:'Closure'}}]});
   assert.equal(args.objectId,'closure');return Promise.resolve({result:[{name:'reader',value:{type:'object',className:'LegacyReader',objectId:'reader'}}]});
  }
 };
 const guest={isDestroyed:()=>false,debugger:debuggerApi};
 const setTimeout=(callback,delay=0)=>{const id=++serial;timers.set(id,{callback,at:now+delay});return id;},clearTimeout=id=>timers.delete(id);
 const context={module:{exports:{}},URL,Date:{now:()=>now},setTimeout,clearTimeout,require:name=>name==='@electron/remote'?{webContents:{fromId:()=>guest}}:{Plugin:class{},PluginSettingTab:class{}}};
 vm.runInNewContext(source,context);const p=new context.module.exports();
 const webview={getWebContentsId:()=>77,executeJavaScript:async()=>state.bound};
 Object.assign(p,{ready:true,unloaded:false,navigationRevision:0,appearanceGeneration:0,appearanceRevision:0,appearanceEpoch:1,expanded:false,webview});
 p.activateLayoutProfile=()=>false;p.contentPadding=()=>16;p.layoutProfile=()=>({fontSizePx:14,lineHeight:1.9,paragraphSpacing:0});p.literatureConfig=()=>({enabled:false});p.isPopularUnderlinesEnabled=()=>true;p.typographyPreferenceKey=()=>'';p.resolvedTheme=()=> 'dark';
 const step=async()=>{await flush();if(!timers.size)return false;now=Math.min(...[...timers.values()].map(timer=>timer.at));for(const [id,timer]of [...timers])if(timer.at<=now){timers.delete(id);timer.callback();}await flush();return true;};
 const waitFor=async predicate=>{for(let i=0;i<100;i++){await flush();if(predicate())return;if(!await step())throw Error('No pending deadline reaches expected debugger state');}throw Error('Expected debugger state not reached');};
 const settle=async task=>{let finished=false,result,error;Promise.resolve(task).then(value=>{finished=true;result=value;},reason=>{finished=true;error=reason;});for(let i=0;i<100;i++){await flush();if(finished){if(error)throw error;return result;}if(!await step())throw Error('Native resolution retained an unbounded wait');}throw Error('Too many debugger lifecycle steps');};
 return {p,state,guest,webview,commands,timers,listeners,waitFor,settle,setTimeout,get now(){return now;},get attached(){return attached;}};
}
const checks=[];const check=async(name,fn)=>{await fn();checks.push(name);};
(async()=>{
 await check('Hanging evaluate and object-group release detach the owned connection before the 3 second host deadline',async()=>{
  const h=fixture();h.state.hangEvaluate=true;h.state.hangRelease=true;
  assert.equal(await h.settle(h.p.syncNativeReaderPadding()),false);assert(h.now<3000);assert.equal(h.attached,false);assert.equal(h.state.detaches,1);assert.equal(h.p.nativeDebuggerLease,null);assert.equal(h.p.nativeLayoutTask,null);assert.equal(h.timers.size,0);assert.equal(h.listeners.get('detach').size,0);
  const before=h.commands.length;h.state.evaluate.resolve({result:{objectId:'listener'}});h.state.release.resolve({});await flush();assert.equal(h.commands.length,before,'Late timed-out evaluate cannot continue scope discovery');
  h.state.hangEvaluate=false;h.state.hangRelease=false;assert.equal(await h.settle(h.p.syncNativeReaderPadding()),true);assert.equal(h.state.attaches,2);assert.equal(h.state.detaches,2);assert.equal(h.attached,false);assert.equal(h.timers.size,0);
 });
 await check('A hanging release on successful discovery cannot keep the plugin debugger attached',async()=>{
  const h=fixture();h.state.hangRelease=true;assert.equal(await h.settle(h.p.syncNativeReaderPadding()),true);assert.equal(h.now,250);assert.equal(h.attached,false);assert.equal(h.state.detaches,1);assert.equal(h.p.nativeDebuggerLease,null);assert.equal(h.timers.size,0);
 });
 await check('Source replacement during an unanswered command prevents all late discovery and allows a fresh binding',async()=>{
  const h=fixture();h.state.hangEvaluate=true;const task=h.p.syncNativeReaderPadding();await h.waitFor(()=>h.commands.some(command=>command.method==='Runtime.evaluate'));
  h.p.webview=null;h.p.navigationRevision++;assert.equal(await h.settle(task),false);assert.equal(h.attached,false);assert.equal(h.commands.filter(command=>command.method==='Runtime.getProperties').length,0);
  const before=h.commands.length;h.state.evaluate.resolve({result:{objectId:'listener'}});await flush();assert.equal(h.commands.length,before);
  h.p.webview=h.webview;h.state.hangEvaluate=false;assert.equal(await h.settle(h.p.syncNativeReaderPadding()),true);assert.equal(h.attached,false);assert.equal(h.timers.size,0);
 });
 await check('Cleanup of a lost lease preserves an external debugger connection established afterwards',async()=>{
  const h=fixture();h.state.hangEvaluate=true;const task=h.p.syncNativeReaderPadding();await h.waitFor(()=>h.attached);
  h.guest.debugger.detach();h.guest.debugger.attach();h.state.evaluate.resolve({result:{objectId:'listener'}});
  assert.equal(await h.settle(task),false);assert.equal(h.attached,true,'Old cleanup must never detach the externally reattached connection');assert.equal(h.state.detaches,1);assert.equal(h.commands.filter(command=>command.method==='Runtime.releaseObjectGroup').length,0);assert.equal(h.p.nativeDebuggerLease,null);assert.equal(h.listeners.get('detach').size,0);assert.equal(h.timers.size,0);
 });
 await check('A delayed initial page callback cannot attach a debugger after its native resolution has expired',async()=>{
  const h=fixture(),initial=deferred();h.webview.executeJavaScript=()=>initial.promise;const task=h.p.syncNativeReaderPadding();assert.equal(await h.settle(task),false);assert.equal(h.now,3000);assert.equal(h.state.attaches,0);
  initial.resolve(false);await flush();assert.equal(h.state.attaches,0);assert.equal(h.commands.length,0);assert.equal(h.timers.size,0);
 });
 await check('The guest binding declaration rejects expired and obsolete appearance operations before touching the reader',async()=>{
  const h=fixture();h.state.hangBinding=true;const task=h.p.syncNativeReaderPadding();await h.waitFor(()=>h.commands.some(command=>command.method==='Runtime.callFunctionOn'));
  const call=h.commands.find(command=>command.method==='Runtime.callFunctionOn'),declaration=call.args.functionDeclaration;
  assert.equal(await h.settle(task),false);assert.equal(h.attached,false);assert(h.now<3000);
  const protectedReader={get $options(){throw Error('An expired binding reached its retired reader');}};
  const late=vm.runInNewContext('('+declaration+'\n)',{Date:{now:()=>h.now},document:{getElementById:()=>({dataset:{wrpEpoch:'1',wrpRevision:'0'}})}});
  assert.equal(late.call(protectedReader),false,'Queued native binding is checked inside the guest when actually executed');
  const stale=vm.runInNewContext('('+declaration+'\n)',{Date:{now:()=>0},document:{getElementById:()=>({dataset:{wrpEpoch:'2',wrpRevision:'0'}})}});assert.equal(stale.call(protectedReader),false,'An appearance transition invalidates a queued binding even before its time deadline');
  const before=h.commands.length;h.state.binding.resolve({result:{value:true}});await flush();assert.equal(h.commands.length,before);assert.equal(h.timers.size,0);
 });
 console.log(JSON.stringify({pass:true,checks},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
