const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(__dirname + '/../src/native-reader-bridge.js', 'utf8');

const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const flush = async () => { for(let i=0;i<24;i++) await Promise.resolve(); };
class Element {
  constructor(tag) { this.tagName=tag; this.dataset={}; this.style={cssText:''}; this.children=[]; this.parentElement=null; this.isConnected=true; this.className=''; }
  appendChild(child) { child.remove(); child.parentElement=this; child.isConnected=this.isConnected; this.children.push(child); return child; }
  remove() { if(this.parentElement) this.parentElement.children=this.parentElement.children.filter(x=>x!==this); this.parentElement=null; this.isConnected=false; }
}
function harness({ own=[], horizontal=false, font=false, theme=false, white=true, collect=false }={}) {
  const listeners={},tasks = new Map(), delays = new Map(), watches=[], once={}, requests=[], geometryCalls=[], rangeCalls=[], modeChanges=[];
  let timerId=0, clock=100000, themeTicks=0, bodyWhite=white, bodyLiterature=false; const themeChanges=[];
  const target = new Element('div');
  const head = new Element('head'), fontChanges=[]; let fontWait=null;
  const objects = Array.from({length:12},(_,offset)=>({ offset, getOffset:()=>offset, getTextLength:()=>1, rect:{x:17+offset*7,y:83,w:7,h:19} }));
  const union = { handleSwitchMode: value => modeChanges.push(value), $parent:null };
  const store = { state:{isWhiteTheme:white,readerRender:{canvasTop:72,canvasBottom:50}}, _actions:theme?{toggleTheme:[()=>{}]}:{}, dispatch:async(name,payload)=>{
    assert.equal(name,'toggleTheme','Theme calls must use the official native action');
    assert.equal(theme,true,'Unexpected config mutation without a theme action');
    assert.equal(payload.modifyCookie,false,'Embedded appearance must not change official saved appearance');
    themeChanges.push(JSON.parse(JSON.stringify(payload))); store.state.isWhiteTheme=payload.isWhite; bodyWhite=payload.isWhite;
  } };
  const reader = {
    $options:{name:'LegacyReader'}, $store:store, $parent:union, $refs:{renderTargetContainer:target}, bookId:'book_A', currentChapter:{chapterUid:1}, renderContentsVersion:1, chapterContentState:'DONE',
    notesListInCurrentChapter:own, _isDestroyed:false,
    findObjsWithPoints(a,b) { assert.deepEqual(JSON.parse(JSON.stringify(a)),{x:-1e6,y:-1e6}); assert.deepEqual(JSON.parse(JSON.stringify(b)),{x:1e6,y:1e9}); return objects; },
    findObjsInOffsetRange(all,start,end) { assert.equal(all,objects,'Native render objects must be reused'); rangeCalls.push([start,end]); return all.filter(o=>o.offset>=start&&o.offset<end); },
    getRectsByContentObjs(selected) { assert.ok(selected.every(o=>objects.includes(o)),'Geometry receives original native objects'); geometryCalls.push(selected.map(o=>o.offset)); return selected.length ? [{ x:selected[0].rect.x, y:83, w:selected.length*7, h:19 }] : []; },
    get isWhiteTheme() { return store.state.isWhiteTheme; },
    $nextTick:async()=>{themeTicks++;},
    $watch(getter,callback,options) { const watch={getter,callback,options,active:true}; watches.push(watch); return ()=>{watch.active=false;}; },
    $once(name,callback) { once[name]=callback; }
  };
  if(font) {
    reader.fontSizeLevel=1; reader.fontSizeLevelCount=7;
    reader.changeFontSize = level => {
      assert.equal(reader.chapterContentState,'DONE','Native recollection starts only from a complete layout');
      const style=head.children.find(el=>el.id==='weread-pocket-font-size');
      const lines=head.children.find(el=>el.id==='weread-pocket-line-height');
      const paragraphs=head.children.find(el=>el.id==='weread-pocket-paragraph-spacing');
      fontChanges.push({level,size:style?Number(style.dataset.wrpFontSize):[18,21,24,28,32,36,42][level-1],css:style?.textContent||'',lineHeight:Number(lines?.dataset.wrpLineHeight),lineCss:lines?.textContent||'',paragraphSpacing:Number(paragraphs?.dataset.wrpParagraphSpacing),paragraphCss:paragraphs?.textContent||''});
      reader.fontSizeLevel=level; reader.chapterContentState='PRERENDER';
      fontWait=deferred(); return fontWait.promise;
    };
  }
  if(collect) reader.collectPreRenderInfos=()=>Promise.resolve('native-collected');
  const window = { innerWidth:800, dispatchEvent:()=>{throw new Error('Legacy overlay must not mutate native padding');} };
  const document = {addEventListener(type,fn){(listeners[type]||=[]).push(fn);},removeEventListener(type,fn){listeners[type]=(listeners[type]||[]).filter(value=>value!==fn);}, body:{classList:{contains:name=>name==='wr_whiteTheme'?bodyWhite:bodyLiterature,toggle:(name,value)=>{bodyLiterature=!!value;},remove:()=>{bodyLiterature=false;}}}, head, documentElement:head, createElement:tag=>new Element(tag), querySelector:selector=>selector==='.wr_horizontalReader'&&horizontal?new Element('div'):null };
  const context = vm.createContext({ window, document, fetch:(url,options)=>{const wait=deferred(); requests.push({url,options,wait}); return wait.promise;}, setTimeout:(fn,delay=0)=>{const id=++timerId;tasks.set(id,fn);delays.set(id,delay);return id;}, clearTimeout:id=>{tasks.delete(id);delays.delete(id);}, AbortController, Date:{now:()=>clock}, console, Event:class Event{constructor(type){this.type=type;}}, __reader:reader });
  vm.runInContext(source+'\n__bound = bindNativeReader.call(__reader);',context,{timeout:1000});
  assert.equal(context.__bound,true);
  const runTimers=async(maxDelay=60)=>{const pending=[...tasks].filter(([id])=>(delays.get(id)||0)<=maxDelay);for(const [id,callback] of pending){tasks.delete(id);delays.delete(id);callback();}await flush();};
  const resolveRequest=async(index,marks)=>{requests[index].wait.resolve({ok:true,json:async()=>({underlines:marks})});await flush();};
  const fire=(index)=>{assert.ok(watches[index].active);watches[index].callback();};
  const completeFont=async()=>{
    assert.ok(fontWait,'A native font render must be pending'); const pending=fontWait; fontWait=null;
    reader.chapterContentState='DONE'; reader.renderContentsVersion++;
    for(const watch of watches) if(watch.active) watch.callback();
    pending.resolve(); await flush();
  };
  return {context,window,reader,target,head,listeners,fontChanges,completeFont,tasks,watches,requests,geometryCalls,rangeCalls,modeChanges,once,runTimers,resolveRequest,fire,store,themeChanges,advanceClock:value=>{clock+=value;},get themeTicks(){return themeTicks;},setNativeTheme:(white,syncBody=true)=>{store.state.isWhiteTheme=white;if(syncBody)bodyWhite=white;}};
}
const checks=[];
async function check(name,fn) { try { await fn(); checks.push({name,pass:true}); } catch(error) { checks.push({name,pass:false,error:error.message}); } }

(async()=>{
  await check('Native chapter channel accepts only original trusted keyboard events and clears on destroy',async()=>{
    const h=harness(),calls=[];h.reader.getChapterWithIdxOffset=direction=>h.reader.currentChapter.chapterUid+direction>0&&h.reader.currentChapter.chapterUid+direction<4?{}:null;
    h.reader.handleNextChapter=e=>{assert.equal(e.isTrusted,true);calls.push('next');h.reader.currentChapter.chapterUid++;};h.reader.handlePrevChapter=e=>{assert.equal(e.isTrusted,true);calls.push('previous');h.reader.currentChapter.chapterUid--;};
    const event=(key,isTrusted=true)=>({key,isTrusted,ctrlKey:true,altKey:true,shiftKey:true,metaKey:false,preventDefault(){this.prevented=true},stopImmediatePropagation(){this.stopped=true}}),key=h.listeners.keydown[0];
    key(event('F14',false));key({...event('F14'),shiftKey:false});assert.equal(calls.length,0,'Synthetic and unrelated keyboard events must be ignored');
    key(event('F14'));assert.deepEqual(calls,['next']);assert.equal(h.window.__wrpGetNativeNavigationState().chapterUid,2);assert.equal(h.window.__wrpGetNativeNavigationState().accepted,true);
    key(event('F13'));assert.deepEqual(calls,['next','previous']);key(event('F13'));assert.equal(calls.length,2,'First chapter does not call native previous');assert.equal(h.window.__wrpGetNativeNavigationState().accepted,false);
    h.once['hook:beforeDestroy']();assert.equal(h.listeners.keydown.length,0);assert.equal(h.window.__wrpGetNativeNavigationState,undefined);key(event('F14'));assert.equal(calls.length,2);
  });
  await check('Native chapter acknowledgement waits for success and exposes an asynchronous failure',async()=>{
    const h=harness(),wait=deferred();h.reader.getChapterWithIdxOffset=()=>({});
    h.reader.handlePrevChapter=()=>Promise.resolve({success:true});h.reader.handleNextChapter=()=>wait.promise;
    const key=h.listeners.keydown[0],event={key:'F14',isTrusted:true,ctrlKey:true,altKey:true,shiftKey:true,metaKey:false,preventDefault(){},stopImmediatePropagation(){}};
    key(event);assert.equal(h.window.__wrpGetNativeNavigationState().pending,true);
    wait.reject(new Error('Native chapter failed'));await flush();
    let state=h.window.__wrpGetNativeNavigationState();assert.equal(state.pending,false);assert.equal(state.error,'Native chapter failed');assert.equal(state.result,null);
    key({...event,key:'F13'});await flush();state=h.window.__wrpGetNativeNavigationState();assert.equal(state.error,null);assert.equal(state.pending,false);assert.equal(state.result.success,true);
  });
  await check('A delayed older native chapter result cannot overwrite the newest acknowledgement',async()=>{
    const h=harness(),old=deferred(),current=deferred();h.reader.getChapterWithIdxOffset=()=>({});h.reader.handlePrevChapter=()=>current.promise;h.reader.handleNextChapter=()=>old.promise;
    const key=h.listeners.keydown[0],event={key:'F14',isTrusted:true,ctrlKey:true,altKey:true,shiftKey:true,metaKey:false,preventDefault(){},stopImmediatePropagation(){}};
    key(event);key({...event,key:'F13'});current.resolve({success:true});await flush();old.reject(new Error('Stale chapter failure'));await flush();
    const state=h.window.__wrpGetNativeNavigationState();assert.equal(state.result.success,true);assert.equal(state.error,null);assert.equal(state.pending,false);
  });
  await check('Literature and a new window profile merge into one native recollection',async()=>{
    const h=harness({font:true,collect:true});
    h.window.__wrpSetLiteratureAppearance({enabled:true,english:'Custom English',paragraphs:3},true);
    assert.equal(h.fontChanges.length,0,'Wait until the profile is applied');
    h.window.__wrpApplyNativePadding(16,true,true,14,1.9,0,'dock:14:1.9:0');
    assert.equal(h.fontChanges.length,1);assert.equal(h.fontChanges[0].size,14);await h.completeFont();
    h.window.__wrpSetLiteratureAppearance({enabled:true,english:'Custom English',paragraphs:3},true);
    h.window.__wrpApplyNativePadding(16,true,true,14,1.9,0,'dock:14:1.9:0');
    assert.equal(h.fontChanges.length,1,'Unchanged settings remain cheap');
  });
  await check('Literature disabled configuration has no native reflow; repeated enable is idempotent',async()=>{
    const h=harness({font:true,collect:true});
    assert.equal(h.window.__wrpSetLiteratureAppearance({enabled:false,english:'Editable notes',paragraphs:3}),true);
    assert.equal(h.fontChanges.length,0,'Preparing English while disabled must not recollect the book');
    h.window.__wrpSetLiteratureAppearance({enabled:true,english:'Editable notes',paragraphs:3});
    assert.equal(h.fontChanges.length,1,'Enabling reserves space through a normal native recollection');
    await h.completeFont();
    assert.equal(await h.reader.collectPreRenderInfos(),'native-collected','Wrapper must return the native result');
    h.window.__wrpSetLiteratureAppearance({enabled:true,english:'Editable notes',paragraphs:3});
    assert.equal(h.fontChanges.length,1,'Applying unchanged appearance must not reflow twice');
    h.window.__wrpSetLiteratureAppearance({enabled:false,english:'Editable notes',paragraphs:3});await h.completeFont();
    assert.equal(h.fontChanges.length,2,'Disabling restores ordinary paragraph geometry');
  });
  await check('Dock bounds shifting at the same width recollect once and release chapter padding when removed',async()=>{
    const h=harness({font:true,collect:true});
    const config={enabled:true,english:'Docked card quote',paragraphs:3,dockBounds:{left:24.25,right:624.75}};
    h.target.clientWidth=600.5;
    const sheet=()=>h.head.children.find(el=>el.id==='weread-pocket-literature-typography');
    assert.equal(h.window.__wrpSetLiteratureAppearance(config),true);
    assert.equal(h.fontChanges.length,1);
    assert.match(sheet().textContent,/\.wr_page_reader\.wrp-literature-mode \.readerChapterContent\{padding-left:24\.25px!important;padding-right:max\(0px,calc\(100% - 624\.75px\)\)!important\}/,'Measured fractional bounds must be applied before native collection');
    await h.completeFont();
    h.window.__wrpSetLiteratureAppearance({...config,dockBounds:{...config.dockBounds}});
    assert.equal(h.fontChanges.length,1,'Identical measured bounds are idempotent');
    const shifted={...config,dockBounds:{left:24.75,right:625.25}};
    assert.equal(shifted.dockBounds.right-shifted.dockBounds.left,h.target.clientWidth);
    h.window.__wrpSetLiteratureAppearance(shifted);
    assert.equal(h.fontChanges.length,2,'Origin changes need native collection even when width is unchanged');
    assert.match(sheet().textContent,/padding-left:24\.75px!important/);
    await h.completeFont();
    h.window.__wrpSetLiteratureAppearance(shifted);
    assert.equal(h.fontChanges.length,2,'The completed bounds cannot create a render loop');
    h.window.__wrpSetLiteratureAppearance({...shifted,dockBounds:null});
    assert.equal(h.fontChanges.length,3,'Undocking restores the chapter geometry');
    assert.ok(!sheet().textContent.includes('.readerChapterContent{'),'Undocking releases chapter padding while retaining card typography');
    await h.completeFont();
    h.window.__wrpSetLiteratureAppearance({...shifted,enabled:false});
    assert.equal(h.fontChanges.length,4);
    assert.equal(sheet(),undefined,'Disabling cards removes all chapter and font overrides');
    await h.completeFont();
    assert.ok(h.fontChanges.every(change=>change.size===18),'Dock changes preserve the selected font');
  });
  await check('Literature typography reaches native descendants and restores ordinary fonts when disabled',async()=>{
    const h=harness({font:true,collect:true});
    const config={enabled:true,english:'Card quote',paragraphs:3,fontFamily:'"Card Host", sans-serif'};
    assert.equal(h.window.__wrpSetLiteratureAppearance(config),true);
    const sheet=h.head.children.find(el=>el.id==='weread-pocket-literature-typography');
    assert.ok(sheet,'Card typography must exist before native recollection');
    const rules=[...sheet.textContent.matchAll(/([^{}]+)\{([^{}]+)\}/g)];
    assert.ok(rules.length>=2,'Paragraph and native descendant typography are both required');
    assert.ok(rules.every(rule=>rule[1].split(',').every(selector=>selector.trim().startsWith('.wr_page_reader.wrp-literature-mode '))),'Every card typography selector must be mode-scoped');
    assert.ok(rules.some(rule=>rule[1].includes('.preRenderContent p')&&rule[2].includes('font-family:"Card Host", sans-serif!important')),'Native collection must use the host card font');
    const descendants=rules.find(rule=>rule[1].includes('.preRenderContent p *')&&rule[1].includes('.renderTargetContent p *'));
    assert.equal(descendants?.[2],'font-family:inherit!important','Native descendants inherit the host font without paragraph layout properties');
    await h.completeFont();
    assert.equal(h.window.__wrpSetLiteratureAppearance({...config,enabled:false}),true);
    assert.ok(!h.head.children.some(el=>el.id==='weread-pocket-literature-typography'),'Disabling removes font overrides before ordinary native recollection');
    await h.completeFont();
    h.window.__wrpSetLiteratureAppearance(config);await h.completeFont();
    h.once['hook:beforeDestroy']();
    assert.ok(!h.head.children.some(el=>el.id==='weread-pocket-literature-typography'),'Reader cleanup releases card typography');
  });
  await check('Literature hook cleanup restores native collector and prevents stale configuration',async()=>{
    const h=harness({font:true,collect:true}),wrapped=h.reader.collectPreRenderInfos;
    h.once['hook:beforeDestroy']();
    assert.notEqual(h.reader.collectPreRenderInfos,wrapped,'Release wrapper with the reader');
    assert.equal(await h.reader.collectPreRenderInfos(),'native-collected');
    assert.equal(h.window.__wrpSetLiteratureAppearance({enabled:true,english:'Late update'}),false);
    assert.equal(h.fontChanges.length,0);assert.equal(h.tasks.size,0);
  });
  await check('Unsupported native reader rejects literature mode without modifying fonts or mode',async()=>{
    const h=harness({font:true});assert.equal(h.window.__wrpSetLiteratureAppearance({enabled:true}),false);
    assert.equal(h.fontChanges.length,0);assert.equal(h.modeChanges.length,0);
  });
  await check('Native geometry and inclusive metadata endpoint',async()=>{
    const h=harness();h.window.__wrpApplyNativePadding(64,false,true);await h.runTimers();
    assert.equal(h.requests.length,1);assert.match(h.requests[0].url,/bookId=book_A&chapterUid=1$/);assert.equal(h.requests[0].options.credentials,'same-origin');
    await h.resolveRequest(0,[{range:'2-4',type:0}]);
    assert.deepEqual(h.rangeCalls,[[2,5]]);assert.deepEqual(h.geometryCalls,[[2,3,4]]);
    assert.equal(h.target.children.length,1);const layer=h.target.children[0];assert.equal(layer.parentElement,h.reader.$refs.renderTargetContainer);
    assert.equal(layer.dataset.wrpChapter,'book_A:1');assert.equal(layer.dataset.wrpRanges,'1');
    const css=layer.children[0].style.cssText;assert.match(css,/left:31px;top:83px;width:21px;height:19px;/);
    assert.equal(h.modeChanges.length,0);
  });
  await check('Own note overlap removed and both official mark types retained',async()=>{
    // Legacy's native Range objects are already half open: the official
    // renderer passes their end directly to getOffset() < end filtering.
    const h=harness({own:[{range:{start:3,end:4}}]});h.window.__wrpApplyNativePadding(48,true,true);await h.runTimers();
    await h.resolveRequest(0,[{range:'2-4',type:0},{range:'8-8',type:2}]);
    assert.deepEqual(h.rangeCalls,[[2,3],[4,5],[8,9]]);assert.deepEqual(h.geometryCalls,[[2],[4],[8]]);
    assert.equal(h.target.children[0].dataset.wrpRanges,'2');assert.equal(h.target.children[0].children.length,3);
    assert.ok(h.geometryCalls.every(offsets=>!offsets.includes(3)));
  });
  await check('Delayed old chapter fetch cannot paint new chapter',async()=>{
    const h=harness();h.window.__wrpApplyNativePadding(48,false,true);await h.runTimers();
    h.reader.currentChapter={chapterUid:2};h.reader.renderContentsVersion=2;h.fire(2);await h.runTimers();
    assert.equal(h.requests.length,2);await h.resolveRequest(1,[{range:'6-7',type:0}]);
    assert.equal(h.target.children[0].dataset.wrpChapter,'book_A:2');const current=h.target.children[0];
    await h.resolveRequest(0,[{range:'2-4',type:0}]);
    assert.equal(h.target.children.length,1);assert.equal(h.target.children[0],current);assert.deepEqual(h.geometryCalls,[[6,7]]);
  });
  await check('In flight coalescing, resize and reenable use one layer and cached metadata',async()=>{
    const h=harness();h.window.__wrpApplyNativePadding(48,false,true);await h.runTimers();
    h.reader.renderContentsVersion++;h.fire(0);await h.runTimers();assert.equal(h.requests.length,1);
    await h.resolveRequest(0,[{range:'2-4',type:0}]);await h.runTimers();assert.equal(h.target.children.length,1);
    h.reader.renderContentsVersion++;h.fire(0);await h.runTimers();assert.equal(h.requests.length,1);assert.equal(h.target.children.length,1);
    h.window.__wrpApplyNativePadding(48,false,false);await h.runTimers();assert.equal(h.target.children.length,0);
    h.window.__wrpApplyNativePadding(48,false,true);await h.runTimers();assert.equal(h.requests.length,1);assert.equal(h.target.children.length,1);
  });
  await check('Geometry changes during fetch redraw with latest native version',async()=>{
    const h=harness();h.window.__wrpApplyNativePadding(48,false,true);await h.runTimers();
    h.reader.renderContentsVersion=7;await h.resolveRequest(0,[{range:'2-4',type:0}]);
    assert.equal(h.target.children.length,0);await h.runTimers();assert.equal(h.target.children.length,1);assert.equal(h.requests.length,1);
    assert.equal(h.target.children[0].dataset.wrpRenderVersion,'7');
  });
  await check('Loading state blocks drawing before and after asynchronous metadata',async()=>{
    const h=harness();h.reader.chapterContentState='PRERENDER';h.window.__wrpApplyNativePadding(48,false,true);await h.runTimers();assert.equal(h.requests.length,0);
    h.reader.chapterContentState='DONE';h.fire(1);await h.runTimers();assert.equal(h.requests.length,1);
    h.reader.chapterContentState='PRERENDER';h.fire(1);await h.runTimers();await h.resolveRequest(0,[{range:'2-4',type:0}]);
    assert.equal(h.target.children.length,0,'A reply while native layout is loading must not draw over stale geometry');
    h.reader.chapterContentState='DONE';h.reader.renderContentsVersion++;h.fire(1);await h.runTimers();assert.equal(h.target.children.length,1);assert.equal(h.requests.length,1);
  });
  await check('Own notes watcher redraws without fetching metadata again',async()=>{
    const h=harness();h.window.__wrpApplyNativePadding(48,false,true);await h.runTimers();await h.resolveRequest(0,[{range:'2-4',type:0}]);
    h.reader.notesListInCurrentChapter=[{range:'2-4'}];h.fire(3);await h.runTimers();
    assert.equal(h.requests.length,1);assert.equal(h.target.children.length,1);assert.equal(h.target.children[0].children.length,0);assert.equal(h.watches[3].options.deep,true);
  });
  await check('Cleanup removes timers, watchers and DOM, including late replies',async()=>{
    const h=harness();h.window.__wrpApplyNativePadding(48,false,true);await h.runTimers();await h.resolveRequest(0,[{range:'2-4',type:0}]);
    h.reader.currentChapter={chapterUid:2};h.fire(2);await h.runTimers();assert.equal(h.requests.length,2);h.fire(0);assert.equal(h.tasks.size,2,'A queued draw and one request deadline remain');
    h.once['hook:beforeDestroy']();assert.ok(h.watches.every(w=>!w.active));assert.equal(h.tasks.size,0);assert.equal(h.target.children.length,0);
    await h.resolveRequest(1,[{range:'6-7',type:0}]);assert.equal(h.target.children.length,0);assert.equal(h.window.__wrpApplyNativePadding(48,false,true),false);
  });
  await check('Only explicit reading flow setter may switch official reading mode',async()=>{
    const h=harness();assert.deepEqual(h.modeChanges,[]);h.window.__wrpApplyNativePadding(48,false,true);await h.runTimers();await h.resolveRequest(0,[]);assert.deepEqual(h.modeChanges,[]);
    assert.equal(h.window.__wrpSetReadingFlow('continuous'),true);assert.deepEqual(h.modeChanges,[]);
    assert.equal(h.window.__wrpSetReadingFlow('paged'),true);assert.deepEqual(h.modeChanges,[true]);
    h.reader._isDestroyed=true;assert.equal(h.window.__wrpSetReadingFlow('paged'),false);
  });
  await check('Small font recollection uses new computed size at repeated native level 1',async()=>{
    const h=harness({font:true});
    assert.equal(h.window.__wrpGetFontState().size,18);
    for(const size of [16,14,12,10]) {
      const changing=h.window.__wrpSetFontSize(size);
      assert.equal(h.window.__wrpGetFontState().ready,false,'Requested size is not ready until native render completes');
      assert.equal(h.fontChanges.at(-1).level,1);
      assert.equal(h.fontChanges.at(-1).size,size,'Override must be installed before native collection');
      assert.match(h.fontChanges.at(-1).css,new RegExp('font-size:'+size+'px!important'));
      await h.completeFont();assert.equal(await changing,true);
      assert.equal(h.window.__wrpGetFontState().size,size);
      assert.equal(h.head.children.length,1,'Only one custom font stylesheet may exist');
    }
    assert.equal(h.fontChanges.length,4,'Changing within native level 1 must still recollect');
    assert.equal(await h.window.__wrpSetFontSize(10),true);
    assert.equal(h.fontChanges.length,4,'Repeating the current size should not reflow');
  });
  await check('Returning from small to 18 px removes override and recollects same native level',async()=>{
    const h=harness({font:true});const smaller=h.window.__wrpSetFontSize(14);await h.completeFont();assert.equal(await smaller,true);
    const normal=h.window.__wrpSetFontSize(18);
    assert.equal(h.head.children.length,0,'Remove override before collecting original 18 px geometry');
    assert.deepEqual(h.fontChanges.map(x=>[x.level,x.size]),[[1,14],[1,18]]);
    await h.completeFont();assert.equal(await normal,true);
    assert.equal(h.window.__wrpGetFontState().size,18);
    assert.equal(h.window.__wrpGetFontState().ready,true);
    const larger=h.window.__wrpSetFontSize(21);await h.completeFont();assert.equal(await larger,true);
    assert.equal(h.window.__wrpGetFontState().level,2);assert.equal(h.window.__wrpGetFontState().size,21);
  });
  await check('Unsupported and loading font requests do not mutate native state or CSS',async()=>{
    const h=harness({font:true});
    for(const invalid of [0,9,11,43,100,NaN,Infinity,'12',null,undefined]) assert.equal(await h.window.__wrpSetFontSize(invalid),false);
    assert.equal(h.fontChanges.length,0);assert.equal(h.head.children.length,0);
    h.reader.chapterContentState='PRERENDER';assert.equal(await h.window.__wrpSetFontSize(12),false);
    assert.equal(h.fontChanges.length,0);assert.equal(h.head.children.length,0);
    h.reader.chapterContentState='DONE';h.reader._isDestroyed=true;
    assert.equal(await h.window.__wrpSetFontSize(12),false);assert.equal(h.window.__wrpGetFontState(),null);
  });
  await check('Saved small font waits for native DONE and restores only once',async()=>{
    const h=harness({font:true});h.reader.chapterContentState='PRERENDER';
    h.window.__wrpApplyNativePadding(48,false,false,12);
    assert.equal(h.fontChanges.length,0);assert.equal(h.head.children.length,0);
    h.reader.chapterContentState='DONE';h.fire(4);
    assert.deepEqual(h.fontChanges.map(x=>[x.level,x.size]),[[1,12]]);
    await h.completeFont();assert.equal(h.window.__wrpGetFontState().size,12);
    const normal=h.window.__wrpSetFontSize(18);await h.completeFont();assert.equal(await normal,true);
    h.window.__wrpApplyNativePadding(28,true,false,12);h.window.__wrpApplyNativePadding(128,false,false,12);
    assert.equal(h.fontChanges.length,2,'Padding and reparent updates must not reapply obsolete preference');
    assert.equal(h.window.__wrpGetFontState().size,18);
  });
  await check('Reader destruction removes custom stylesheet and blocks late font completion',async()=>{
    const h=harness({font:true});const changing=h.window.__wrpSetFontSize(12);
    assert.equal(h.head.children.length,1);h.once['hook:beforeDestroy']();
    assert.equal(h.head.children.length,0);assert.ok(h.watches.every(w=>!w.active));
    await h.completeFont();assert.equal(await changing,false);assert.equal(h.window.__wrpGetFontState(),null);
    assert.equal(await h.window.__wrpSetFontSize(10),false);assert.equal(h.head.children.length,0);
  });
  await check('Native font failure restores previous override and permits a later successful change',async()=>{
    const h=harness({font:true});const initial=h.window.__wrpSetFontSize(14);await h.completeFont();assert.equal(await initial,true);
    const nativeChange=h.reader.changeFontSize;let attempts=0,failedCollectionSize=null;
    h.reader.changeFontSize=level=>{
      attempts++;
      if(attempts===1) {
        failedCollectionSize=Number(h.head.children.find(el=>el.id==='weread-pocket-font-size')?.dataset.wrpFontSize);
        throw new Error('Simulated native collection failure');
      }
      return nativeChange(level);
    };
    const failed=h.window.__wrpSetFontSize(12);
    assert.equal(failedCollectionSize,12,'Requested override was used for the failed collection');
    assert.equal(attempts,2,'A failed collection should invoke native recovery with the old level');
    assert.equal(h.fontChanges.at(-1).size,14,'Native recovery must collect restored CSS');
    assert.equal(h.reader.fontSizeLevel,1);
    await h.completeFont();assert.equal(await failed,false);
    assert.equal(h.window.__wrpGetFontState().size,14);assert.equal(h.window.__wrpGetFontState().ready,true);
    assert.equal(h.head.children.length,1);
    const retry=h.window.__wrpSetFontSize(12);await h.completeFont();assert.equal(await retry,true);
    assert.equal(h.window.__wrpGetFontState().size,12);
  });
  await check('Native theme changes use official rendering without changing saved web appearance',async()=>{
    const h=harness({theme:true});assert.deepEqual(h.themeChanges,[],'Binding does not change appearance');
    assert.equal(await h.window.__wrpApplyNativeTheme('light'),true);assert.deepEqual(h.themeChanges,[],'An already matching theme must not dispatch');
    assert.equal(await h.window.__wrpApplyNativeTheme('dark'),true);assert.deepEqual(h.themeChanges,[{isWhite:false,modifyCookie:false}]);
    assert.equal(h.reader.isWhiteTheme,false);assert.equal(h.themeTicks,2,'Both matching and changed themes await native DOM flush');
    assert.equal(await h.window.__wrpApplyNativeTheme('dark'),true);assert.equal(h.themeChanges.length,1,'Repeating the desired theme is idempotent');
    assert.equal(await h.window.__wrpApplyNativeTheme('light'),true);assert.deepEqual(h.themeChanges,[{isWhite:false,modifyCookie:false},{isWhite:true,modifyCookie:false}]);
    assert.deepEqual(h.modeChanges,[],'Appearance does not change reading flow');assert.equal(h.requests.length,0,'Appearance does not fetch chapter metadata');
  });
  await check('Native theme watcher enforces explicit plugin choice after an outside theme change',async()=>{
    const h=harness({theme:true});await h.window.__wrpApplyNativeTheme('dark');
    const watch=h.watches.find(w=>typeof w.getter()==='boolean');assert.ok(watch,'Native theme watcher exists');
    h.setNativeTheme(true);watch.callback();await flush();assert.equal(h.reader.isWhiteTheme,false);assert.equal(h.themeChanges.length,2);
    watch.callback();await flush();assert.equal(h.themeChanges.length,2,'A native update matching the desired theme must not create a loop');
    await h.window.__wrpApplyNativeTheme('light');h.setNativeTheme(false);watch.callback();await flush();assert.equal(h.reader.isWhiteTheme,true);
    assert.ok(h.themeChanges.every(change=>change.modifyCookie===false));
  });
  await check('Native theme rejects invalid, unsupported and destroyed requests without dispatch',async()=>{
    const absent=harness();assert.equal(await absent.window.__wrpApplyNativeTheme('dark'),false);assert.deepEqual(absent.themeChanges,[]);
    const h=harness({theme:true});for(const invalid of ['auto','system','DARK','',null,undefined,0,true]) assert.equal(await h.window.__wrpApplyNativeTheme(invalid),false);
    assert.equal(h.themeChanges.length,0);assert.equal(h.themeTicks,0);
    h.reader._isDestroyed=true;assert.equal(await h.window.__wrpApplyNativeTheme('dark'),false);assert.equal(h.themeChanges.length,0);
    h.reader._isDestroyed=false;h.once['hook:beforeDestroy']();assert.equal(await h.window.__wrpApplyNativeTheme('dark'),false);assert.equal(h.themeChanges.length,0);assert.ok(h.watches.every(w=>!w.active));
  });
  await check('Native theme acknowledgement waits for body class and rejects late destruction',async()=>{
    const h=harness({theme:true});h.setNativeTheme(false,false);
    assert.equal(await h.window.__wrpApplyNativeTheme('dark'),false,'Store alone cannot acknowledge a still stale DOM theme');
    assert.equal(h.themeChanges.length,0,'Mismatched DOM cannot cause redundant state dispatch');
    h.setNativeTheme(false);assert.equal(await h.window.__wrpApplyNativeTheme('dark'),true);
    const tick=deferred();h.reader.$nextTick=()=>tick.promise;
    const pending=h.window.__wrpApplyNativeTheme('light');h.once['hook:beforeDestroy']();tick.resolve();assert.equal(await pending,false);
    assert.ok(h.watches.every(w=>!w.active),'Theme watcher is removed with reader');
  });
  await check('Line spacing recollects original native objects at unchanged font level',async()=>{
    const h=harness({font:true});h.window.__wrpApplyNativePadding(48,false,true);await h.runTimers();await h.resolveRequest(0,[{range:'2-4',type:0}]);
    const changing=h.window.__wrpSetLineHeight(1.4);
    assert.equal(h.fontChanges.at(-1).lineHeight,1.4,'Line style must be installed before native collection');
    assert.match(h.fontChanges.at(-1).lineCss,/line-height:1.4!important/);
    assert.equal(h.fontChanges.at(-1).size,18);assert.equal(h.fontChanges.at(-1).level,1);
    await h.runTimers();assert.equal(h.target.children.length,0,'Old underline layer is cleared during reflow');
    await h.completeFont();assert.equal(await changing,true);await h.runTimers();
    assert.equal(h.window.__wrpGetFontState().lineHeight,1.4);
    assert.equal(h.target.children[0].dataset.wrpRenderVersion,'2');
    assert.equal(h.requests.length,1,'Reflow reuses cached chapter marks');
    assert.equal(await h.window.__wrpSetLineHeight(1.4),true);assert.equal(h.fontChanges.length,1,'Identical spacing does not recollect');
  });
  await check('Line spacing is preserved through small and native font changes',async()=>{
    const h=harness({font:true});let changing=h.window.__wrpSetLineHeight(2.5);await h.completeFont();assert.equal(await changing,true);
    changing=h.window.__wrpSetFontSize(12);assert.match(h.fontChanges.at(-1).css,/line-height:30px!important/);await h.completeFont();assert.equal(await changing,true);
    changing=h.window.__wrpSetLineHeight(1.2);assert.match(h.fontChanges.at(-1).css,/line-height:14.4px!important/);await h.completeFont();assert.equal(await changing,true);
    changing=h.window.__wrpSetFontSize(24);await h.completeFont();assert.equal(await changing,true);
    assert.equal(h.window.__wrpGetFontState().lineHeight,1.2);assert.equal(h.window.__wrpGetFontState().size,24);
    h.once['hook:beforeDestroy']();assert.equal(h.head.children.length,0,'All typography styles are cleaned up');
  });
  await check('Saved small font and line spacing restore in a single native recollection',async()=>{
    const h=harness({font:true});h.reader.chapterContentState='PRERENDER';
    h.window.__wrpApplyNativePadding(48,true,false,12,2.2);assert.equal(h.fontChanges.length,0);
    h.reader.chapterContentState='DONE';h.fire(4);assert.equal(h.fontChanges.length,1);assert.equal(h.fontChanges[0].lineHeight,2.2);assert.equal(h.fontChanges[0].size,12);
    await h.completeFont();assert.equal(h.window.__wrpGetFontState().lineHeight,2.2);
    const changing=h.window.__wrpSetLineHeight(1.5);await h.completeFont();assert.equal(await changing,true);
    h.window.__wrpApplyNativePadding(120,false,false,12,2.2);assert.equal(h.fontChanges.length,2);assert.equal(h.window.__wrpGetFontState().lineHeight,1.5,'Reparent must not restore obsolete spacing');
  });
  await check('Spacing failure recovers previous layout and rejects invalid or destroyed requests',async()=>{
    const h=harness({font:true});let changing=h.window.__wrpSetLineHeight(1.8);await h.completeFont();assert.equal(await changing,true);
    for(const value of [0,0.9,3.1,NaN,Infinity,'2',null,undefined])assert.equal(await h.window.__wrpSetLineHeight(value),false);
    const original=h.reader.changeFontSize;let calls=0;
    h.reader.changeFontSize=level=>{if(++calls===1)throw new Error('Native reflow failed');return original(level);};
    changing=h.window.__wrpSetLineHeight(2.8);assert.equal(h.fontChanges.at(-1).lineHeight,1.8);await h.completeFont();assert.equal(await changing,false);
    assert.equal(h.window.__wrpGetFontState().lineHeight,1.8);
    changing=h.window.__wrpSetLineHeight(2.1);h.once['hook:beforeDestroy']();await h.completeFont();assert.equal(await changing,false);assert.equal(await h.window.__wrpSetLineHeight(2.2),false);
  });
  await check('Gutter changes recollect real content width even at the same viewport width',async()=>{
    const h=harness({font:true});h.target.clientWidth=400;h.window.__wrpApplyNativePadding(48,false,false);
    assert.equal(h.fontChanges.length,0,'Initial binding keeps native layout');
    h.target.clientWidth=360;h.window.__wrpApplyNativePadding(68,false,false);
    assert.equal(h.fontChanges.length,1);assert.equal(h.fontChanges[0].size,18,'Gutter reflow preserves font');
    h.target.clientWidth=320;h.window.__wrpApplyNativePadding(88,false,false);
    assert.equal(h.fontChanges.length,1,'Busy native renderer defers a later width');
    await h.completeFont();assert.equal(h.fontChanges.length,2,'Newest pending width recollects after DONE');
    await h.completeFont();h.window.__wrpApplyNativePadding(88,false,false);assert.equal(h.fontChanges.length,2,'Stable width cannot cause a render loop');
  });
  await check('Paragraph gaps recollect native geometry independently of font and line height',async()=>{
    const h=harness({font:true});let changing=h.window.__wrpSetLineHeight(1.5);await h.completeFont();assert.equal(await changing,true);
    changing=h.window.__wrpSetParagraphSpacing(12);assert.match(h.fontChanges.at(-1).paragraphCss,/margin-top:0!important;margin-bottom:0!important;padding-top:0!important;padding-bottom:12px!important/);assert.equal(h.fontChanges.at(-1).lineHeight,1.5);assert.equal(h.fontChanges.at(-1).size,18);
    await h.completeFont();assert.equal(await changing,true);assert.equal(h.window.__wrpGetFontState().paragraphSpacing,12);
    changing=h.window.__wrpSetFontSize(28);await h.completeFont();assert.equal(await changing,true);assert.equal(h.fontChanges.at(-1).paragraphSpacing,12);
    changing=h.window.__wrpSetParagraphSpacing(0);assert.match(h.fontChanges.at(-1).paragraphCss,/margin-top:0!important;margin-bottom:0!important;padding-top:0!important;padding-bottom:0px!important/);await h.completeFont();assert.equal(await changing,true);assert.equal(h.window.__wrpGetFontState().paragraphSpacing,0);
    const count=h.fontChanges.length;assert.equal(await h.window.__wrpSetParagraphSpacing(0),true);assert.equal(h.fontChanges.length,count);
    for(const value of [-1,81,NaN,Infinity,'4',null,undefined])assert.equal(await h.window.__wrpSetParagraphSpacing(value),false);
    h.once['hook:beforeDestroy']();assert.equal(h.head.children.length,0);assert.equal(await h.window.__wrpSetParagraphSpacing(4),false);
  });
  await check('Moving among layout profiles restores all font sizes and newest queued spacing',async()=>{
    const h=harness({font:true});
    h.window.__wrpApplyNativePadding(16,true,false,12,1.4,6,'floating');await h.completeFont();assert.equal(h.window.__wrpGetFontState().size,12);
    h.window.__wrpApplyNativePadding(64,false,false,28,2.2,24,'tab');assert.equal(h.fontChanges.at(-1).level,4);assert.equal(h.fontChanges.at(-1).paragraphSpacing,24);await h.completeFont();
    assert.equal(h.window.__wrpGetFontState().size,28);assert.equal(h.window.__wrpGetFontState().lineHeight,2.2);
    h.window.__wrpApplyNativePadding(16,true,false,10,1.2,2,'dock');
    h.window.__wrpApplyNativePadding(48,false,false,18,1.6,10,'sidebar');
    h.window.__wrpApplyNativePadding(64,false,false,32,2.5,30,'tab-newest');
    const pendingCount=h.fontChanges.length;await h.completeFont();assert.equal(h.fontChanges.length,pendingCount+1);assert.equal(h.fontChanges.at(-1).size,32);assert.equal(h.fontChanges.at(-1).paragraphSpacing,30);
    await h.completeFont();const state=h.window.__wrpGetFontState();assert.equal(state.size,32);assert.equal(state.lineHeight,2.5);assert.equal(state.paragraphSpacing,30);assert.equal(state.preferenceKey,'tab-newest');
    h.window.__wrpApplyNativePadding(64,false,false,32,2.5,30,'tab-newest');assert.equal(h.fontChanges.length,pendingCount+1,'Repeated profile does not loop');
  });
  await check('Paragraph failure restores previous spacing and native recollection',async()=>{
    const h=harness({font:true});let changing=h.window.__wrpSetParagraphSpacing(8);await h.completeFont();assert.equal(await changing,true);
    const original=h.reader.changeFontSize;let attempts=0;h.reader.changeFontSize=level=>{if(++attempts===1)throw new Error('Paragraph collection failed');return original(level);};
    changing=h.window.__wrpSetParagraphSpacing(20);assert.equal(h.fontChanges.at(-1).paragraphSpacing,8);await h.completeFont();assert.equal(await changing,false);assert.equal(h.window.__wrpGetFontState().paragraphSpacing,8);
  });
  await check('Repeated draws pending on one render version perform native geometry once',async()=>{
    const h=harness();
    for(let i=0;i<25;i++){h.window.__wrpApplyNativePadding(48,false,true);await h.runTimers();}
    assert.equal(h.requests.length,1);assert.equal(h.geometryCalls.length,0);
    await h.resolveRequest(0,[{range:'2-4',type:0}]);
    assert.equal(h.geometryCalls.length,1,'Metadata coalescing also coalesces native geometry and DOM work');
    assert.equal(h.target.children.length,1);assert.equal(h.tasks.size,0,'A successful request clears its deadline');
    h.once['hook:beforeDestroy']();
  });
  await check('Chapter replacement, disabling and disposal abort ignored metadata requests promptly',async()=>{
    for(const change of ['chapter','disabled','dispose']) {
      const h=harness();h.window.__wrpApplyNativePadding(48,false,true);await h.runTimers();
      const old=h.requests[0];assert.equal(old.options.signal.aborted,false);
      if(change==='chapter'){h.reader.currentChapter={chapterUid:2};h.fire(2);await h.runTimers();assert.equal(h.requests.length,2);}
      if(change==='disabled'){h.window.__wrpApplyNativePadding(48,false,false);await h.runTimers();}
      if(change==='dispose'){h.once['hook:beforeDestroy']();await flush();}
      assert.equal(old.options.signal.aborted,true,change+' cancels pending fetch even when it never acknowledges abort');
      assert.equal(h.target.children.length,0);
      if(change!=='chapter')assert.equal(h.tasks.size,0,'Cancellation clears deadline without waiting for an ignored request');
      h.once['hook:beforeDestroy']();
    }
  });
  await check('A timed out metadata request settles, clears its deadline and permits retry',async()=>{
    const h=harness();h.window.__wrpApplyNativePadding(48,false,true);await h.runTimers();
    await h.runTimers(8000);assert.equal(h.requests[0].options.signal.aborted,true);assert.equal(h.target.children.length,0);assert.equal(h.tasks.size,0);
    h.window.__wrpApplyNativePadding(48,false,true);await h.runTimers();assert.equal(h.requests.length,2,'Timeout does not leave a permanently pending metadata cache');
    await h.resolveRequest(1,[{range:'2-4',type:0}]);assert.equal(h.geometryCalls.length,1);h.once['hook:beforeDestroy']();
  });
  await check('Metadata failure cooldown is time limited and retained for at most 20 chapters',async()=>{
    const h=harness();
    for(let chapter=1;chapter<=25;chapter++) {
      h.reader.currentChapter={chapterUid:chapter};h.window.__wrpApplyNativePadding(48,false,true);await h.runTimers();
      h.requests.at(-1).wait.reject(new Error('Network unavailable'));await flush();
    }
    assert.equal(h.requests.length,25);
    h.window.__wrpApplyNativePadding(48,false,true);await h.runTimers();assert.equal(h.requests.length,25,'Latest failure observes cooldown');
    h.reader.currentChapter={chapterUid:1};h.fire(2);await h.runTimers();assert.equal(h.requests.length,26,'Old failures are evicted rather than retained for every chapter');
    h.requests.at(-1).wait.reject(new Error('Network unavailable'));await flush();
    h.reader.currentChapter={chapterUid:25};h.advanceClock(15001);h.fire(2);await h.runTimers();assert.equal(h.requests.length,27,'Expired failures permit a fresh request');h.once['hook:beforeDestroy']();await flush();
  });
  await check('A synchronous DONE watcher cannot overlap an unfinished native collection',async()=>{
    const h=harness({font:true,collect:true}),pending=[];
    h.reader.changeFontSize=level=>{const wait=deferred();pending.push({level,wait});h.reader.fontSizeLevel=level;return wait.promise;};
    const first=h.window.__wrpSetFontSize(12);assert.equal(pending.length,1);assert.equal(h.window.__wrpGetFontState().ready,false);
    h.window.__wrpSetLiteratureAppearance({enabled:true,english:'Queued card quote'},true);
    h.window.__wrpApplyNativePadding(16,true,false,16,1.4,6,'latest-profile');
    for(const watch of h.watches)if(watch.active)watch.callback();
    assert.equal(pending.length,1,'Pending native Promise prevents a second collection even if state remains DONE');
    assert.equal(h.window.__wrpSetReadingFlow('paged'),false,'Flow cannot destroy a reader during collection');
    pending[0].wait.resolve();assert.equal(await first,true);await flush();
    assert.equal(pending.length,2,'Latest queued card/profile is recollected after the first task settles');
    pending[1].wait.resolve();await flush();
    const state=h.window.__wrpGetFontState();assert.equal(state.ready,true);assert.equal(state.size,16);assert.equal(state.lineHeight,1.4);assert.equal(state.paragraphSpacing,6);
    assert.equal(h.window.__wrpSetReadingFlow('paged'),true);assert.deepEqual(h.modeChanges,[true]);h.once['hook:beforeDestroy']();
    assert.equal(h.window.__wrpSetReadingFlow('paged'),false,'Disposed bridge cannot switch modes through a stale function');
  });
  await check('Underline drawing waits for an unfinished native Promise even if state remains DONE',async()=>{
    const h=harness({font:true}),collect=deferred();
    h.window.__wrpApplyNativePadding(48,false,true);await h.runTimers();assert.equal(h.requests.length,1);
    h.reader.changeFontSize=()=>collect.promise;
    const changing=h.window.__wrpSetFontSize(14);assert.equal(h.reader.chapterContentState,'DONE');
    await h.resolveRequest(0,[{range:'2-4',type:0}]);assert.equal(h.geometryCalls.length,0,'Metadata reply cannot use geometry from an unfinished typography collection');
    h.window.__wrpApplyNativePadding(48,false,true);await h.runTimers();assert.equal(h.geometryCalls.length,0,'Repeated appearance update cannot bypass the busy guard');
    collect.resolve();assert.equal(await changing,true);await h.runTimers();
    assert.equal(h.geometryCalls.length,1,'Promise completion reschedules the deferred draw without another state watcher');
    assert.equal(h.requests.length,1,'Completed draw uses the same cached metadata');assert.equal(h.target.children.length,1);h.once['hook:beforeDestroy']();
  });
  await check('Card preparation and collection errors never prevent the original native text collector from completing',async()=>{
    for(const stage of ['prepare','collected']) {
      const h=harness({collect:true}),native=h.reader.collectPreRenderInfos;
      h.window.__wrpSetLiteratureAppearance({enabled:true,english:'A quote.',paragraphs:3},true);
      if(stage==='prepare') {
        const content={isConnected:true,querySelectorAll:()=>[{style:{}}],getBoundingClientRect:()=>({width:400})};
        h.reader.$refs.preRenderContainer={isConnected:true,clientWidth:400,querySelectorAll:()=>[],querySelector:()=>content,getBoundingClientRect(){throw new Error('Transient native DOM geometry failure');}};
        h.reader.$refs.preRenderContent={$el:content};
      } else Object.defineProperty(h.reader,'renderContentsVersion',{get(){throw new Error('Transient native render-version getter failure');},configurable:true});
      assert.equal(await native.call(h.reader),'native-collected',stage+' decoration error must preserve official native collection result');
      h.once['hook:beforeDestroy']();assert.equal(h.head.children.length,0);
    }
  });
  await check('Embedded production bridge exactly matches validated standalone bridge',async()=>{
    const main=fs.readFileSync(__dirname+'/../main.js','utf8');
    const start=main.indexOf('      const bind = '),end=main.indexOf('      const walk = async ',start);
    assert.ok(start>=0&&end>start,'Production native bridge boundaries must be present');
    const embedded=main.slice(start+'      const bind = '.length,end).trim().replace(/;$/,'');
    assert.equal(embedded.replace(/\r\n/g,'\n').trim(),source.replace(/\r\n/g,'\n').trim(),'Installed production source should embed the same bridge validated by this harness');
  });
  const pass=checks.every(c=>c.pass);console.log(JSON.stringify({pass,checks},null,2));if(!pass)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
