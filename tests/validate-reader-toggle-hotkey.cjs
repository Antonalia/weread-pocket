const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const Platform={isMacOS:false},context={require:()=>({Plugin:class{},PluginSettingTab:class{},Platform}),URL,module:{exports:{}},setTimeout,clearTimeout};
vm.runInNewContext(fs.readFileSync(__dirname+'/../main.js','utf8'),context);
const Pocket=context.module.exports,{matchesHotkey}=Pocket._test,checks=[];
const input=(key,extras={})=>({type:'keyDown',key,control:true,alt:true,...extras});
const check=async(name,fn)=>{await fn();checks.push(name);};
function fixture(mode='floating'){
 const p=new Pocket(),custom={};p.visible=true;p.settings={dockPocket:mode==='dock'};p.panel={hidden:false};p.expanded=mode==='sidebar'||mode==='tab';p.readerLeaf=p.expanded?{}:null;p.dockLeaf=mode==='dock'?{}:null;p.currentLocation=mode;
 p.app={hotkeyManager:{getHotkeys:id=>custom[id]},workspace:{activeEditor:{editor:{focus(){}}}}};
 p.isReaderInSidebar=()=>p.currentLocation==='sidebar';p.cancelAutoHide=()=>{};p.releasePocketDock=()=>{p.dockLeaf=null;p.dockCollapsed=false;};p.syncReadingSurface=()=>{p.synced=true;};p.requestReadingSurfaceLayout=()=>{};
 p.collapseToPocket=hide=>{assert.equal(hide,true);p.readerLeaf=null;p.visible=false;p.expanded=false;p.panel.hidden=true;p.synced=true;};
 p.show=()=>{p.visible=true;p.panel.hidden=false;p.currentLocation=p.settings.dockPocket?'dock':'floating';p.dockLeaf=p.settings.dockPocket?{}:null;};
 p.openReader=async location=>{await Promise.resolve();p.visible=true;p.expanded=true;p.readerLeaf={};p.currentLocation=location;p.dockLeaf=null;};
 p.setPocketDockCollapsed=value=>{p.dockCollapsed=value;};p.event={preventDefault(){p.prevented=(p.prevented||0)+1;}};return {p,custom};
}
(async()=>{
 await check('Unified shortcut matches exact modifiers and operating system',()=>{
  assert(matchesHotkey(input('r'),{modifiers:['Mod','Alt'],key:'R'}));assert(!matchesHotkey(input('r',{shift:true}),{modifiers:['Mod','Alt'],key:'R'}));
  Platform.isMacOS=true;assert(matchesHotkey(input('R',{control:false,meta:true}),{modifiers:['Mod','Alt'],key:'R'}));assert(!matchesHotkey(input('R'),{modifiers:['Mod','Alt'],key:'R'}));Platform.isMacOS=false;
  assert(matchesHotkey(input('Left',{alt:false}),{modifiers:['Ctrl'],key:'ArrowLeft'}));
 });
 for(const mode of ['floating','dock','sidebar','tab'])await check(`Same shortcut hides and restores original ${mode} location`,async()=>{
  const {p}=fixture(mode);p.handleGuestKeyInput(p.event,input('R'));await p.readerToggleTask;
  assert.equal(p.visible,false);assert.equal(p.panel.hidden,true);assert.equal(p.lastReadingLocation,mode);assert.equal(p.readerLeaf,null);
  p.handleGuestKeyInput(p.event,input('R'));await p.readerToggleTask;
  assert.equal(p.visible,true);assert.equal(p.currentLocation,mode);assert.equal(p.expanded,mode==='sidebar'||mode==='tab');assert.equal(p.prevented,2);
 });
 await check('Rapid repeated presses are serialized and restore the final expected state',async()=>{
  const {p}=fixture('sidebar');await Promise.all([p.toggle(),p.toggle(),p.toggle(),p.toggle()]);assert.equal(p.visible,true);assert.equal(p.currentLocation,'sidebar');
  await Promise.all([p.toggle(),p.toggle(),p.toggle()]);assert.equal(p.visible,false);assert.equal(p.lastReadingLocation,'sidebar');
 });
 await check('Collapsed dock expands first, then hides and restores with the same shortcut',async()=>{
  const {p}=fixture('dock');p.dockCollapsed=true;await p.toggle();assert.equal(p.visible,true);assert.equal(p.dockCollapsed,false);await p.toggle();assert.equal(p.visible,false);await p.toggle();assert.equal(p.visible,true);assert.equal(p.currentLocation,'dock');
 });
 await check('Custom shortcut applies immediately; retired H shortcut is ignored',async()=>{
  const {p,custom}=fixture();custom['weread-pocket:toggle']=[{modifiers:['Mod','Alt','Shift'],key:'J'}];custom['weread-pocket:hide']=[{modifiers:['Mod','Alt'],key:'H'}];
  p.handleGuestKeyInput(p.event,input('R'));p.handleGuestKeyInput(p.event,input('H'));assert.equal(p.readerToggleTask,undefined);assert.equal(p.visible,true);
  p.handleGuestKeyInput(p.event,input('j',{shift:true}));await p.readerToggleTask;assert.equal(p.visible,false);p.handleGuestKeyInput(p.event,input('j',{shift:true}));await p.readerToggleTask;assert.equal(p.visible,true);
 });
 await check('Empty custom binding disables default; multiple configured bindings work',async()=>{
  const {p,custom}=fixture();custom['weread-pocket:toggle']=[];p.handleGuestKeyInput(p.event,input('R'));assert.equal(p.readerToggleTask,undefined);
  custom['weread-pocket:toggle']=[{modifiers:['Ctrl'],key:'K'},{modifiers:[],key:'F9'}];p.handleGuestKeyInput(p.event,input('F9',{control:false,alt:false}));await p.readerToggleTask;assert.equal(p.visible,false);
  p.handleGuestKeyInput(p.event,input('K',{alt:false}));await p.readerToggleTask;assert.equal(p.visible,true);
 });
 await check('Key-up, held-key repeats, unload and unrelated keys do not flip visibility',async()=>{
  const {p}=fixture();for(const e of [input('R',{type:'keyUp'}),input('R',{isAutoRepeat:true}),input('H')])p.handleGuestKeyInput(p.event,e);assert.equal(p.readerToggleTask,undefined);
  p.unloaded=true;await p.toggle();assert.equal(p.visible,true);
 });
 await check('Escape still hides and the unified shortcut restores that same view',async()=>{
  const {p}=fixture('tab');p.handleGuestKeyInput(p.event,input('Escape',{alt:false,control:false}));assert.equal(p.visible,false);await p.toggle();assert.equal(p.visible,true);assert.equal(p.currentLocation,'tab');
 });
 console.log(JSON.stringify({pass:true,checks},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
