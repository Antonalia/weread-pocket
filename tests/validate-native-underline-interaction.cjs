const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const factory = vm.runInNewContext(fs.readFileSync(__dirname+'/../src/native-underline-interaction.js','utf8')+';createNativeUnderlineInteraction', { document:{},window:{},setTimeout,clearTimeout,AbortController });
const deferred = () => { let resolve,reject; const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject}; };
const flush = () => new Promise(r=>setImmediate(r));
const reviews = [{review:{range:'10-20'}}];
const classList = () => {const values=new Set();return {add(name){values.add(name);},remove(name){values.delete(name);},contains(name){return values.has(name);}};};
let checks=0;
function setup(options={}) {
 const listeners=new Map(),calls=[],panels=[],messages=[],requests=[],listenerOptions=new Map(),registrations=[];
 const doc={addEventListener(k,f,options){registrations.push({type:k,listener:f,options});listeners.set(k,f);listenerOptions.set(k,options);},removeEventListener(k,f){if(listeners.get(k)===f){listeners.delete(k);listenerOptions.delete(k);}}};
 let key='book:chapter',enabled=true;
 const ownNotes={reviewList:[{own:true}],isFetching:false};
 const store={state:{bookReview:{noteReviews:ownNotes,bookmarks:{bookmarkList:[{own:true}]}}},_modules:{root:{_children:{bookReview:{_rawModule:{getters:{notes(state){assert.equal(store.state.bookReview.noteReviews,ownNotes);assert.notEqual(state.noteReviews,ownNotes);return {noteList:state.noteReviews.reviewList.map((review,i)=>({range:{start:10,end:21},review,id:i}))};}}}}}}}};
 const reader={bookId:'book',currentChapter:{chapterUid:'chapter'},chapterContentState:'DONE',renderContentsVersion:1,$refs:{renderTargetContainer:{contains(e){return e?.inside===true;}}},showReviewDetailPanel(notes){panels.push(notes);},$toast(text){messages.push(text);}};
 const env={AbortController,setTimeout,clearTimeout,...options.environment};
 const provider=options.native?null:({range},signal)=>{calls.push(range);const d=deferred();requests.push({...d,signal});return d.promise;};
 const interaction=factory({reader,store,chapterKey:()=>key,isEnabled:()=>enabled,eventDocument:doc,environment:env,requestReviews:provider});
 const element={isConnected:true,getBoundingClientRect(){return {left:10,right:120,top:40,bottom:60,width:110,height:20};}};
 interaction.setMarks([{element,range:{start:10,end:21}}],key,1);
 const event=(x=30,y=50,extra={})=>({clientX:x,clientY:y,button:0,target:{inside:true},preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},...extra});
 return {interaction,listeners,listenerOptions,registrations,calls,requests,panels,messages,reader,store,doc,element,event,setKey(v){key=v;},setEnabled(v){enabled=v;},env};
}
function nativePanelFixture() {
 const s=setup(),deletions=[],removedActions=[],closeButtons=[],contentNodes=[],renderedActions=[];
 const detail={$options:{name:'ReaderReviewDetailPanel'},onClickItem:null,onHide(){assert.equal(this,detail);s.nativeHides=(s.nativeHides||0)+1;},emitClickItem(type,note,index){this.onClickItem?.(type,note,index);}};
 const panel={
  classList:classList(),clientHeight:120,scrollHeight:500,scrollTop:50,contains(target){return target?.insideNotes===true;},
  querySelector(selector){if(selector==='.readerReviewDetail_item > .content')return contentNodes[0]||null;assert.equal(selector,'.wrp-notes-close');return closeButtons[0]||null;},
  querySelectorAll(selector){assert.equal(selector,'.readerReviewDetail_item > .actions');return renderedActions.filter(actions=>actions.isConnected);},
  prepend(button){closeButtons.unshift(button);}
 };
 const originalNotes=s.store.state.bookReview.noteReviews;
 s.doc.documentElement={classList:classList(),scrollTop:200};
 s.reader.$refs.publicDetail=detail;
 s.reader.$refs.unrelated={$options:{name:'AnotherPanel'},onClickItem:()=>deletions.push('unrelated')};
 s.reader.$nextTick=async()=>{};
 s.reader.hideReviewDetailPanel=()=>{s.closed=(s.closed||0)+1;s.detail?.onHide?.();};
 s.reader.showReviewDetailPanel=notes=>{
  s.panels.push(notes);
  // The native personal-note component rebinds a mutation callback and renders
  // a focusable Delete button for every review whenever show() is called.
  detail.onClickItem=(type,note,index)=>{deletions.push({type,note,index});originalNotes.reviewList.pop();};
  renderedActions.length=0;contentNodes.length=0;
  notes.forEach((note,index)=>{
   contentNodes.push({author:note.author,content:note.content,note});
   const button={tagName:'BUTTON',tabIndex:0,isConnected:true,activate(){detail.emitClickItem('delete',note,index);}};
   const actions={isConnected:true,button,remove(){this.isConnected=false;button.isConnected=false;removedActions.push(this);}};
   renderedActions.push(actions);
  });
 };
 s.doc.querySelector=selector=>{assert.equal(selector,'.readerReviewDetailPanel_bg');return panel;};
 s.doc.createElement=tag=>{
  assert.equal(tag,'button');
  return {attributes:{},listeners:new Map(),setAttribute(key,value){this.attributes[key]=value;},addEventListener(type,callback){this.listeners.set(type,callback);}};
 };
 return Object.assign(s,{detail,panel,deletions,removedActions,closeButtons,contentNodes,renderedActions,originalNotes});
}
async function openFixture(s) {
 const task=s.interaction.openRange({start:10,end:21});await flush();s.requests[0].resolve({pageReviews:reviews});assert.equal(await task,true);return s;
}
function scrollEvent(extra={}) {
 return {key:'ArrowDown',deltaY:40,target:{insideNotes:true},preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},...extra};
}
(async()=>{
 let s=setup();s.setEnabled(false);assert.equal(await s.interaction.openRange({start:10,end:21}),false);assert.equal(s.calls.length,0);s.interaction.dispose();checks++;
 s=setup();for(const range of [null,{start:NaN,end:2},{start:20,end:10},{start:1,end:1}])assert.equal(await s.interaction.openRange(range),false);assert.equal(s.calls.length,0);s.interaction.dispose();checks++;
 s=setup();let first=s.interaction.openRange({start:10,end:21}),second=s.interaction.openRange({start:10,end:21});await flush();assert.equal(s.calls.length,1);assert.equal(s.calls[0],'10-20');s.requests[0].resolve({pageReviews:reviews});assert.deepEqual(await Promise.all([first,second]),[false,true]);assert.equal(s.panels.length,1);await s.interaction.openRange({start:10,end:21});assert.equal(s.calls.length,1);s.interaction.dispose();checks++;
 for(const change of ['chapter','disabled','version','clear','dispose']){s=setup();const task=s.interaction.openRange({start:10,end:21});await flush();if(change==='chapter')s.setKey('other:chapter');if(change==='disabled')s.setEnabled(false);if(change==='version')s.reader.renderContentsVersion++;if(change==='clear')s.interaction.clear();if(change==='dispose')s.interaction.dispose();s.requests[0].resolve({pageReviews:reviews});assert.equal(await task,false,change);assert.equal(s.panels.length,0,change);assert.equal(s.messages.length,0,change);s.interaction.dispose();checks++;}
 s=setup();first=s.interaction.openRange({start:10,end:21});await flush();s.reader.renderContentsVersion=2;s.interaction.setMarks([{element:s.element,range:{start:10,end:21}}],'book:chapter',2);s.requests[0].resolve({pageReviews:reviews});assert.equal(await first,true,'Scrolling redraw must preserve an unchanged underline request');assert.equal(s.panels.length,1);s.interaction.dispose();checks++;
 s=setup();first=s.interaction.openRange({start:10,end:21});await flush();s.reader.renderContentsVersion=2;s.interaction.setMarks([{element:s.element,range:{start:40,end:51}}],'book:chapter',2);s.requests[0].resolve({pageReviews:reviews});assert.equal(await first,false,'A removed underline must not open after a redraw');assert.equal(s.panels.length,0);s.interaction.dispose();checks++;
 s=setup();first=s.interaction.openRange({start:10,end:21});await flush();second=s.interaction.openRange({start:40,end:51});await flush();assert(s.requests[0].signal.aborted);s.requests[1].resolve({pageReviews:reviews});assert.equal(await second,true);s.requests[0].resolve({pageReviews:reviews});assert.equal(await first,false);assert.equal(s.panels.length,1);s.interaction.dispose();checks++;
 s=setup();first=s.interaction.openRange({start:10,end:21});await flush();s.requests[0].resolve({pageReviews:[]});assert.equal(await first,true);assert.equal(s.panels.length,0);assert.equal(s.messages.length,1);s.interaction.dispose();checks++;
 s=setup();s.listeners.get('mousedown')(s.event());s.listeners.get('mousemove')(s.event(50,50));const dragged=s.event(50,50);s.listeners.get('click')(dragged);await flush();assert.equal(s.calls.length,0);assert(!dragged.stopped);s.interaction.dispose();checks++;
 s=setup();s.listeners.get('mousedown')(s.event());const clicked=s.event();s.listeners.get('click')(clicked);await flush();assert(clicked.stopped&&clicked.prevented);assert.equal(s.calls.length,1);s.requests[0].resolve({pageReviews:reviews});await flush();assert.equal(s.panels.length,1);s.interaction.dispose();checks++;
 for(const extra of [{target:{inside:false}},{ctrlKey:true},{clientX:200},{button:2}]){s=setup();s.listeners.get('mousedown')(s.event());const e=s.event(30,50,extra);s.listeners.get('click')(e);await flush();assert.equal(s.calls.length,0);assert(!e.stopped);s.interaction.dispose();checks++;}
 let payload,request; s=setup({native:true,environment:{__WRPA__:{async sr(p){payload=p.body;return 'signed';}},async fetch(path,opts){request={path,opts};return {ok:true,async json(){return {reviews:[{pageReviews:reviews}]};}};}}});assert.equal(await s.interaction.openRange({start:10,end:21}),true);assert.equal(request.path,'/web/book/readReviews');assert.equal(request.opts.method,'POST');assert.equal(request.opts.credentials,'same-origin');assert.equal(request.opts.headers['x-wrpa-0'],'signed');assert.equal(payload.reviews[0].range,'10-20');assert.equal(payload.reviews[0].count,30);assert.equal(request.opts.body,JSON.stringify(payload));s.interaction.dispose();checks++;
 s=setup();first=s.interaction.openRange({start:10,end:21});await flush();s.requests[0].reject(new Error('network'));assert.equal(await first,false);assert.equal(s.messages.length,1);second=s.interaction.openRange({start:10,end:21});await flush();assert.equal(s.calls.length,2);s.requests[1].resolve({pageReviews:reviews});assert.equal(await second,true);s.interaction.dispose();checks++;
 s=setup({native:true,environment:{async fetch(){throw new Error('Should not request without native signature');}}});assert.equal(await s.interaction.openRange({start:10,end:21}),false);assert.equal(s.messages.length,1);s.interaction.dispose();checks++;
 let timeoutCallback,cleared=false; s=setup({environment:{setTimeout(f){timeoutCallback=f;return 99;},clearTimeout(id){cleared=id===99;}}});first=s.interaction.openRange({start:10,end:21});await flush();timeoutCallback();assert.equal(await first,false);assert(s.requests[0].signal.aborted);assert(cleared);assert.equal(s.messages.length,1);s.interaction.dispose();checks++;
 s=setup();assert.equal(s.listeners.size,4);s.interaction.dispose();s.interaction.dispose();assert.equal(s.listeners.size,0);checks++;
 s=nativePanelFixture();
 const nativeAuthor=Object.freeze({name:'Public author',avatar:'avatar',vid:123}),nativeContent='An original public thought.\nA second paragraph.';
 const nativeNote=Object.freeze({range:Object.freeze({start:10,end:21}),id:'review-id',reviewId:'review-id',author:nativeAuthor,content:nativeContent,isPrivate:false,isFriendShip:false});
 s.store._modules.root._children.bookReview._rawModule.getters.notes=state=>{assert.equal(state.noteReviews.reviewList,reviews);assert.equal(state.bookmarks.bookmarkList.length,0);return {noteList:[nativeNote]};};
 const ownNotesBefore=JSON.stringify(s.originalNotes),unrelatedCallback=s.reader.$refs.unrelated.onClickItem;
 first=s.interaction.openRange({start:10,end:21});await flush();s.requests[0].resolve({pageReviews:reviews});assert.equal(await first,true);
 assert.equal(s.detail.onClickItem,null,'Public thoughts must have no native mutation callback');
 s.detail.emitClickItem('delete',nativeNote,0);assert.equal(s.deletions.length,0);assert.equal(JSON.stringify(s.originalNotes),ownNotesBefore);assert.equal(s.store.state.bookReview.noteReviews,s.originalNotes);
 assert.equal(s.reader.$refs.unrelated.onClickItem,unrelatedCallback,'Unrelated component callbacks must remain intact');checks++;
 assert.equal(s.removedActions.length,1);assert.equal(s.panel.querySelectorAll('.readerReviewDetail_item > .actions').length,0);assert(s.removedActions.every(actions=>!actions.isConnected&&!actions.button.isConnected),'Delete buttons must leave the DOM and keyboard focus order');
 s.removedActions[0].button.activate();assert.equal(s.deletions.length,0,'A stale action reference must not invoke a native deletion');checks++;
 assert.equal(s.panels[0][0],nativeNote);assert.equal(s.contentNodes[0].note,nativeNote);assert.equal(s.contentNodes[0].author,nativeAuthor);assert.equal(s.contentNodes[0].content,nativeContent);assert.equal(nativeNote.id,'review-id');assert.equal(nativeNote.isPrivate,false);assert.equal(nativeNote.isFriendShip,false);checks++;
 assert.equal(s.closeButtons.length,1);const close=s.closeButtons[0];assert.equal(close.className,'wrp-notes-close');assert.equal(close.type,'button');assert.equal(close.attributes['aria-label'],'关闭笔记');assert.equal(close.title,'关闭笔记');let closePrevented=false,closeStopped=false;close.listeners.get('click')({preventDefault(){closePrevented=true;},stopPropagation(){closeStopped=true;}});assert(closePrevented&&closeStopped);assert.equal(s.closed,1);checks++;
 await s.interaction.openRange({start:10,end:21});assert.equal(s.panels.length,2);assert.equal(s.calls.length,1);assert.equal(s.closeButtons.length,1,'Reopening must retain a single close button');assert.equal(s.removedActions.length,2);assert.equal(s.detail.onClickItem,null,'Reopening must disable the freshly rebound native delete callback');assert.equal(JSON.stringify(s.originalNotes),ownNotesBefore);s.interaction.dispose();checks++;
 s=setup();s.doc.querySelector=()=>null;s.reader.$nextTick=async()=>{};first=s.interaction.openRange({start:10,end:21});await flush();s.requests[0].resolve({pageReviews:reviews});assert.equal(await first,true,'An unavailable DOM panel must not break native note presentation');assert.equal(s.panels.length,1);assert.equal(s.messages.length,0);s.interaction.dispose();checks++;
 s=nativePanelFixture();
 delete s.reader.$refs.publicDetail; // The real official panel is a global Vue service, not a reader ref.
 const appContent={role:'native-reader-container'},serviceCalls=[],serviceOwnNotesBefore=JSON.stringify(s.originalNotes);
 const personalShow=s.reader.showReviewDetailPanel;
 s.reader.$refs.appContent=appContent;
 s.store.dispatch=()=>{throw new Error('Public note presentation must not dispatch a mutation');};
 s.reader.clearHighLight=function(){assert.equal(this,s.reader);s.highlightsCleared=(s.highlightsCleared||0)+1;};
 s.reader.$showReviewDetailPanel=options=>{serviceCalls.push(options);s.detail.onClickItem=options.onClickItem;s.detail.onHide=options.onHide;};
 s.reader.showReviewDetailPanel=notes=>{
  personalShow(notes);
  s.reader.$showReviewDetailPanel({parentNode:appContent,reviewNotes:notes,onHide:()=>{},onClickItem:s.detail.onClickItem});
 };
 first=s.interaction.openRange({start:10,end:21});await flush();s.requests[0].resolve({pageReviews:reviews});assert.equal(await first,true);
 assert.equal(serviceCalls.length,2);assert.equal(typeof serviceCalls[0].onClickItem,'function','Native personal show must first bind its delete handler');assert.equal(serviceCalls[1].onClickItem,null,'The public service presentation must replace the native delete handler');assert.equal(s.detail.onClickItem,null);
 assert.equal(serviceCalls[1].parentNode,appContent);assert.equal(serviceCalls[1].reviewNotes,serviceCalls[0].reviewNotes);assert.equal(serviceCalls[1].reviewNotes,s.panels[0],'The global service must receive the same native notes array');
 s.detail.emitClickItem('delete',s.panels[0][0],0);assert.equal(s.deletions.length,0);assert.equal(JSON.stringify(s.originalNotes),serviceOwnNotesBefore);assert.equal(s.store.state.bookReview.noteReviews,s.originalNotes);checks++;
 serviceCalls[1].onHide();assert.equal(s.highlightsCleared,1,'Closing the global service must clear the original native highlight');assert.equal(s.panels.length,1,'The same global native panel must be reused');assert.equal(s.closeButtons.length,1);assert.equal(s.panel.querySelectorAll('.readerReviewDetail_item > .actions').length,0);assert(s.removedActions.every(actions=>!actions.button.isConnected));checks++;
 await s.interaction.openRange({start:10,end:21});assert.equal(serviceCalls.length,4);assert.equal(serviceCalls[3].onClickItem,null);assert.equal(serviceCalls[3].reviewNotes,s.panels[1]);assert.equal(serviceCalls[3].parentNode,appContent);assert.equal(s.closeButtons.length,1);assert.equal(s.contentNodes.length,s.panels[1].length,'Repeated global show must replace native content without duplicating its DOM');assert.equal(s.calls.length,1);assert.equal(JSON.stringify(s.originalNotes),serviceOwnNotesBefore);
 delete s.reader.clearHighLight;assert.doesNotThrow(()=>serviceCalls[3].onHide(),'Global panel closure must tolerate an unavailable highlight hook');s.interaction.dispose();checks++;
 s=await openFixture(nativePanelFixture());
 assert(s.doc.documentElement.classList.contains('wrp-notes-open'));assert(s.panel.classList.contains('wrp-notes-scroll-active'));assert.equal(s.listeners.size,6);assert.equal(s.listenerOptions.get('wheel').capture,true);assert.equal(s.listenerOptions.get('wheel').passive,false);assert.equal(s.listenerOptions.get('keydown'),true);s.interaction.dispose();checks++;
 s=setup();s.doc.documentElement={classList:classList()};s.doc.querySelector=()=>null;await openFixture(s);assert(!s.doc.documentElement.classList.contains('wrp-notes-open'),'Missing native DOM must never lock the book');assert(!s.listeners.has('wheel'));assert(!s.listeners.has('keydown'));assert.equal(s.listeners.size,4);s.interaction.dispose();checks++;
 s=await openFixture(nativePanelFixture());
 let wheel=scrollEvent();s.listeners.get('wheel')(wheel);assert(wheel.stopped);assert(!wheel.prevented,'Wheel over a note must retain browser scrolling');assert.equal(s.doc.documentElement.scrollTop,200);
 wheel=scrollEvent({target:{insideNotes:false}});s.listeners.get('wheel')(wheel);assert(wheel.stopped&&wheel.prevented,'Wheel outside the active notes must not scroll the book');
 for(const extra of [{ctrlKey:true},{deltaY:0,deltaX:40}]){wheel=scrollEvent(extra);s.listeners.get('wheel')(wheel);assert(!wheel.stopped&&!wheel.prevented,'Zoom and horizontal wheel gestures must remain native');}
 wheel=scrollEvent({stopImmediatePropagation:undefined,stopPropagation(){this.stopped=true;}});s.listeners.get('wheel')(wheel);assert(wheel.stopped&&!wheel.prevented);s.interaction.dispose();checks++;
 s=await openFixture(nativePanelFixture());s.env.getComputedStyle=()=>undefined;
 const keyboard=key=>{const e=scrollEvent({key});s.listeners.get('keydown')(e);assert(e.stopped&&e.prevented);assert.equal(s.doc.documentElement.scrollTop,200);};
 const position=expected=>assert(Math.abs(s.panel.scrollTop-expected)<1e-6,`Expected note scroll position ${expected}, got ${s.panel.scrollTop}`);
 keyboard('ArrowDown');position(72.4);keyboard('ArrowUp');position(50);keyboard('PageDown');position(146);keyboard('PageUp');position(50);keyboard('End');position(380);keyboard('ArrowDown');position(380);keyboard('Home');position(0);keyboard('ArrowUp');position(0);keyboard(' ');position(96);
 let keyEvent=scrollEvent({key:' ',shiftKey:true});s.listeners.get('keydown')(keyEvent);assert.equal(s.panel.scrollTop,0);assert(keyEvent.prevented&&keyEvent.stopped);
 s.env.getComputedStyle=()=>({lineHeight:'20px'});keyboard('ArrowDown');assert.equal(s.panel.scrollTop,20);s.interaction.dispose();checks++;
 s=await openFixture(nativePanelFixture());
 for(const extra of [{key:'Escape'},{ctrlKey:true},{altKey:true},{metaKey:true},{target:{closest(){return {tagName:'INPUT'};}}}]){keyEvent=scrollEvent(extra);s.listeners.get('keydown')(keyEvent);assert(!keyEvent.prevented&&!keyEvent.stopped);assert.equal(s.panel.scrollTop,50,'Editor, modified and Escape keys must not navigate notes');}
 s.interaction.dispose();checks++;
 s=nativePanelFixture();const originalHide=s.detail.onHide;await openFixture(s);const boundHide=s.detail.onHide;assert.notEqual(boundHide,originalHide);
 s.reader.hideReviewDetailPanel();assert.equal(s.nativeHides,1);assert.equal(s.detail.onHide,originalHide,'Native hide callback must be restored after closing');assert(!s.doc.documentElement.classList.contains('wrp-notes-open'));assert(!s.panel.classList.contains('wrp-notes-scroll-active'));assert.equal(s.listeners.size,4);assert(!s.listeners.has('wheel'));assert(!s.listeners.has('keydown'));s.interaction.dispose();checks++;
 s=await openFixture(nativePanelFixture());
 const reflowHide=s.detail.onHide, reflowWheel=s.listeners.get('wheel'), reflowKey=s.listeners.get('keydown');
 for(const change of ['marks-cleared','render-version','underlines-disabled','marks-redrawn']) {
  if(change==='marks-cleared') s.interaction.clear();
  if(change==='render-version') {s.reader.renderContentsVersion++;s.interaction.clear();}
  if(change==='underlines-disabled') {s.setEnabled(false);s.interaction.clear();}
  if(change==='marks-redrawn') s.interaction.setMarks([{element:s.element,range:{start:10,end:21}}],'book:chapter',s.reader.renderContentsVersion);
  assert(s.doc.documentElement.classList.contains('wrp-notes-open'),change+' keeps the native note scroll lock');
  assert(s.panel.classList.contains('wrp-notes-scroll-active'));assert.equal(s.detail.onHide,reflowHide);
  assert.equal(s.listeners.get('wheel'),reflowWheel);assert.equal(s.listeners.get('keydown'),reflowKey);
  const outside=scrollEvent({target:{insideNotes:false}});reflowWheel(outside);assert(outside.prevented&&outside.stopped);
  checks++;
 }
 s.reader.hideReviewDetailPanel();assert(!s.doc.documentElement.classList.contains('wrp-notes-open'));assert.equal(s.listeners.size,4);s.interaction.dispose();checks++;
 s=nativePanelFixture();const hideBeforeDispose=s.detail.onHide;await openFixture(s);s.interaction.dispose();
 assert(!s.doc.documentElement.classList.contains('wrp-notes-open'));assert(!s.panel.classList.contains('wrp-notes-scroll-active'));assert.equal(s.detail.onHide,hideBeforeDispose);assert.equal(s.listeners.size,0);checks++;
 for(const cancel of ['clear','dispose']) {
  s=setup();const cancelled=s.interaction.openRange({start:10,end:21});await flush();s.interaction[cancel]();
  assert.equal(await cancelled,false,'Invalidation settles even a provider which ignores AbortSignal');
  assert(s.requests[0].signal.aborted);assert.equal(s.messages.length,0);assert.equal(s.panels.length,0);s.interaction.dispose();checks++;
 }
 s=nativePanelFixture();const stableOriginalHide=s.detail.onHide;await openFixture(s);const firstWheel=s.listeners.get('wheel'),firstKey=s.listeners.get('keydown');await s.interaction.openRange({start:10,end:21});await s.interaction.openRange({start:10,end:21});assert.equal(s.listeners.size,6);assert.equal(s.listeners.get('wheel'),firstWheel);assert.equal(s.listeners.get('keydown'),firstKey);assert.equal(s.closeButtons.length,1);s.detail.onHide();assert.equal(s.nativeHides,1,'Repeated opens must not stack native hide wrappers');assert.equal(s.detail.onHide,stableOriginalHide);assert.equal(s.listeners.size,4);assert(!s.doc.documentElement.classList.contains('wrp-notes-open'));s.interaction.dispose();checks++;
 s=nativePanelFixture();delete s.reader.$refs.publicDetail;const globalShows=[];s.reader.$refs.appContent={};s.reader.$showReviewDetailPanel=options=>{globalShows.push(options);s.detail.onClickItem=options.onClickItem;s.detail.onHide=options.onHide;};s.reader.clearHighLight=()=>{s.highlightsCleared=(s.highlightsCleared||0)+1;};await openFixture(s);assert(s.doc.documentElement.classList.contains('wrp-notes-open'));globalShows[0].onHide();assert.equal(s.highlightsCleared,1);assert(!s.doc.documentElement.classList.contains('wrp-notes-open'));assert(!s.panel.classList.contains('wrp-notes-scroll-active'));assert.equal(s.listeners.size,4);s.interaction.dispose();checks++;
 for(const transition of ['reflow','close','dispose']) {
  s=nativePanelFixture();const tick=deferred();s.reader.$nextTick=()=>tick.promise;
  const showing=s.interaction.openRange({start:10,end:21});await flush();s.requests[0].resolve({pageReviews:reviews});await flush();
  assert.equal(s.panels.length,1,'Native presentation precedes its DOM flush');
  if(transition==='reflow'){s.reader.renderContentsVersion++;s.interaction.clear();}
  if(transition==='close')s.reader.hideReviewDetailPanel();
  if(transition==='dispose')s.interaction.dispose();
  tick.resolve();await showing;
  assert.equal(s.doc.documentElement.classList.contains('wrp-notes-open'),transition==='reflow','Presentation lifetime survives reflow while close/dispose wins over a late DOM flush');
  s.interaction.dispose();checks++;
 }
 s=await openFixture(nativePanelFixture());const obsoleteHide=s.detail.onHide;
 await s.interaction.openRange({start:10,end:21});obsoleteHide();
 assert(s.doc.documentElement.classList.contains('wrp-notes-open'),'A late hide from the previous presentation must not unlock newly opened notes');
 assert.equal(s.nativeHides||0,0);s.reader.hideReviewDetailPanel();assert.equal(s.nativeHides,1);assert(!s.doc.documentElement.classList.contains('wrp-notes-open'));s.interaction.dispose();checks++;
 console.log(`PASS ${checks} native underline interaction checks`);
})().catch(e=>{console.error(e);process.exitCode=1;});
