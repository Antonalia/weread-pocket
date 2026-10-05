const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
let serial=0,frames=new Map(),surfaces=0;
const classes=()=>{const values=new Set();return {add:n=>values.add(n),remove:n=>values.delete(n),toggle:(n,on)=>on?values.add(n):values.delete(n),contains:n=>values.has(n)};};
const element=()=>({style:{},classList:classes(),attributes:{},setAttribute(n,v){this.attributes[n]=v;},appendChild(child){child.parentElement=this;child.mounts=(child.mounts||0)+1;},remove(){this.removed=true;}});
const observer=class{constructor(callback){this.callback=callback;}observe(target){this.target=target;}disconnect(){this.target=null;this.disconnects=(this.disconnects||0)+1;}};
const context={require:()=>({Plugin:class{},PluginSettingTab:class{}}),URL,module:{exports:{}},setTimeout,clearTimeout,clearInterval,
 document:{body:{createDiv(){surfaces++;return element();}}},window:{innerWidth:1000,innerHeight:800},ResizeObserver:observer,
 requestAnimationFrame:fn=>{const id=++serial;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id),getComputedStyle:host=>({visibility:host.visibility||'visible'})};
vm.runInNewContext(fs.readFileSync(__dirname+'/../main.js','utf8'),context);
const Pocket=context.module.exports;
const host=(left,top,width,height)=>({isConnected:true,parentElement:{querySelector:()=>({id:'reader-title'})},getBoundingClientRect(){return {left,top,width,height,right:left+width,bottom:top+height};}});
const p=new Pocket();p.panel={querySelector:()=>({id:'mini-title'})};p.webview=element();p.registerDomEvent=(target,name,callback)=>{(target.events||={})[name]=callback;};p.settings={hideBottomBar:true};p.visible=true;p.appearancePending=false;
p.cancelAutoHide=()=>{};p.trackPocketPointer=()=>{};
const mini=host(50,100,380,225),tab=host(200,50,800,600);
p.mountWebview(mini);const layer=p.readingSurface;
assert.equal(p.webview.parentElement,layer);assert.equal(p.webview.mounts,1);assert.equal(p.surfaceResizeObserver.target,mini);
p.mountWebview(tab);assert.equal(p.readingSurface,layer);assert.equal(surfaces,1);assert.equal(p.webview.mounts,1,'Changing location cannot disconnect or reparent the native guest');
assert.equal(p.appearancePending,false,'A retained document must not flash a loading screen');assert.equal(p.surfaceResizeObserver.target,tab);
assert.equal(layer.style.left,'200px');assert.equal(layer.style.height,'600px');assert.equal(p.webview.attributes['aria-labelledby'],'reader-title');
p.requestReadingSurfaceLayout();p.requestReadingSurfaceLayout();assert.equal(frames.size,1,'Layout events are coalesced into one frame');
for(const fn of frames.values())fn();frames.clear();
// The dock body is inset from the outer sidebar by the theme's divider width.
// Its retained native surface must follow that body, including live resize.
const guest=p.webview,dockGeometry={left:580,top:300,width:420,height:225,dividerWidth:3},dockBody=host(0,0,0,0);
dockBody.getBoundingClientRect=()=>{const {left,top,width,height,dividerWidth}=dockGeometry;return {left:left+dividerWidth,top,width:width-dividerWidth,height,right:left+width,bottom:top+height};};
const flushFrames=()=>{for(const fn of frames.values())fn();frames.clear();};
const assertDockBounds=(left,width,top,height)=>{
 assert.equal(layer.style.left,left+'px','The native surface leaves the outer resize handle exposed');
 assert.equal(layer.style.width,width+'px','The native surface uses the inset body width');
 assert.equal(layer.style.top,top+'px');assert.equal(layer.style.height,height+'px');
 assert.equal(layer.style.clipPath,'inset(0px 0px 0px 0px)');
 assert(!layer.classList.contains('wrp-surface-hidden'));
};
p.mountWebview(dockBody);flushFrames();assertDockBounds(583,417,300,225);
dockGeometry.dividerWidth=7;p.surfaceResizeObserver.callback();
assert.equal(frames.size,1,'Changing the theme divider width schedules a retained-surface layout');
flushFrames();assertDockBounds(587,413,300,225);
Object.assign(dockGeometry,{left:640,width:360,top:320,height:240});p.surfaceResizeObserver.callback();
flushFrames();assertDockBounds(647,353,320,240);
assert.equal(p.surfaceResizeObserver.target,dockBody);assert.equal(p.surfaceHost,dockBody);
assert.equal(p.readingSurface,layer);assert.equal(surfaces,1);assert.equal(p.webview,guest);
assert.equal(guest.parentElement,layer);assert.equal(guest.mounts,1,'Divider and sidebar resizing cannot reparent or replace the native guest');
// A complete sidebar reader needs the same inset as the docked mini reader.
// Its host's content box drives surface geometry, without moving the guest.
const styles=fs.readFileSync(__dirname+'/../styles.css','utf8');
assert.match(styles,/\.workspace-split\.mod-right-split\s+:is\(\.wrp-pocket-dock-view,\.wrp-reader-view\.wrp-reader-sidebar\)\s*\{[^}]*padding-inline-start:var\(--divider-width-hover,3px\)/,'Right dock and full sidebar both expose the inner divider');
assert.match(styles,/\.workspace-split\.mod-left-split\s+:is\(\.wrp-pocket-dock-view,\.wrp-reader-view\.wrp-reader-sidebar\)\s*\{[^}]*padding-inline-end:var\(--divider-width-hover,3px\)/,'Left dock and full sidebar mirror the divider inset');
const sidebarGeometry={left:650,top:90,width:350,height:710,dividerWidth:3,side:'right'},sidebarHost=host(0,0,0,0);
sidebarHost.getBoundingClientRect=()=>{const {left,top,width,height,dividerWidth,side}=sidebarGeometry;const innerLeft=left+(side==='right'?dividerWidth:0),innerWidth=width-dividerWidth;return {left:innerLeft,top,width:innerWidth,height,right:innerLeft+innerWidth,bottom:top+height};};
p.mountWebview(sidebarHost);flushFrames();assertDockBounds(653,347,90,710);
Object.assign(sidebarGeometry,{width:300,left:700,dividerWidth:8});p.surfaceResizeObserver.callback();
assert.equal(frames.size,1,'A sidebar inset or width change shares the single layout frame');
flushFrames();assertDockBounds(708,292,90,710);
Object.assign(sidebarGeometry,{side:'left',left:0,width:310,dividerWidth:5});p.surfaceResizeObserver.callback();
flushFrames();assertDockBounds(0,305,90,710);
assert.equal(Number.parseFloat(layer.style.left)+Number.parseFloat(layer.style.width),305,'A left sidebar leaves its right resize divider exposed');
assert.equal(p.surfaceResizeObserver.target,sidebarHost);
assert.equal(p.readingSurface,layer);assert.equal(surfaces,1);assert.equal(p.webview,guest);
assert.equal(guest.parentElement,layer);assert.equal(guest.mounts,1,'Sidebar divider updates preserve the existing guest and reading document');
p.mountWebview(tab);flushFrames();
const viewport={...layer.style};tab.isConnected=false;p.syncReadingSurface();assert(layer.classList.contains('wrp-surface-hidden'));assert.deepEqual(layer.style,viewport,'Inactive/detached views keep the previous viewport');
tab.isConnected=true;tab.visibility='hidden';p.syncReadingSurface();assert(layer.classList.contains('wrp-surface-hidden'));
tab.visibility='visible';p.visible=false;p.syncReadingSurface();assert(layer.classList.contains('wrp-surface-hidden'));p.requestReadingSurfaceLayout();assert.equal(frames.size,0,'Hidden reader does no scroll-event frame work');
p.visible=true;p.mountWebview(host(-20,10,380,225));assert.equal(layer.style.clipPath,'inset(0px 0px 0px 20px)');assert(!layer.classList.contains('wrp-surface-hidden'));
layer.events.pointerenter();assert(p.autoHideArmed);assert(p.pointerInPocket);
p.releasePocketDock=()=>{};p.updateFontButtons=()=>{};p.unbindGuestKeys=()=>{};p.panel.remove=()=>{};p.requestReadingSurfaceLayout();const pending=p.surfaceLayoutFrame;
p.onunload();assert(layer.removed);assert.equal(p.surfaceResizeObserver.target,null);assert(!frames.has(pending),'Unloading cancels pending position work and releases the only guest');
console.log('PASS: one persistent guest, location/visibility/clipping, dock and full sidebar dividers/resize, coalesced layout, mini hover and unload cleanup.');
