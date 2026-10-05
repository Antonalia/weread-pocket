(async function validateContinuousLocalReaderEdges(options) {
const {document,factory,css}=options;
const {URL,Event,WheelEvent}=document.defaultView;
const style=document.createElement('style');style.textContent=css;
const host=document.createElement('div');host.style.cssText='position:fixed;left:-20000px;top:0;width:380px;height:320px;display:flex;visibility:hidden;';document.head.append(style);document.body.append(host);
const checks=[],errors=[],assert=(name,pass,details)=>{checks.push({name,pass:!!pass,...details?{details}: {}});if(!pass)throw new Error(name);},pause=()=>new Promise(resolve=>setTimeout(resolve,70));
const api=factory({host,document,onError:error=>errors.push(error)}),scroll=api.root.querySelector('.wrp-local-scroll');
const config={fontSize:16,lineHeight:1.5,paragraphSpacing:0,contentPadding:12,continuousChapters:true,readingFlow:'scroll',literature:{enabled:false}};
const until=async test=>{for(let i=0;i<30;i++){if(test()){await pause();return;}await pause();}throw new Error('edge test did not settle');};
const wheel=delta=>scroll.dispatchEvent(new WheelEvent('wheel',{deltaY:delta,bubbles:true,cancelable:true}));
const tiny={id:'tiny-book',title:'Tiny synthetic book',chapters:Array.from({length:8},(_,index)=>({title:'Tiny '+index,href:'Text/'+index+'.xhtml'})),readChapter:async index=>({href:'Text/'+index+'.xhtml',paragraphs:['Tiny synthetic paragraph '+index+'.']})};
let report;
const originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL,created=new Set(),revoked=new Set();
URL.createObjectURL=function(blob){const url=originalCreate.call(this,blob);created.add(url);return url;};
URL.revokeObjectURL=function(url){if(created.has(url))revoked.add(url);return originalRevoke.call(this,url);};
try{
api.applyAppearance(config);await api.setBook(tiny);await pause();
assert('short starting chapters deliberately fit viewport',scroll.scrollHeight<=scroll.clientHeight,api.stats);
const visited=[];
for(let i=1;i<8;i++){wheel(120);await until(()=>api.chapter===i);visited.push(api.chapter);assert('tiny chapter '+i+' stays inside bound',api.stats.renderedChapters<=3);}
assert('wheel can traverse short chapters without giant padding',visited.join(',')==='1,2,3,4,5,6,7'&&api.captureProgress().percent===100&&scroll.scrollHeight<=scroll.clientHeight);
wheel(-120);await until(()=>api.chapter===6);wheel(-120);await until(()=>api.chapter===5);
assert('reverse wheel restores earlier short chapter',api.chapter===5&&api.stats.renderedChapters<=3);
await api.turn(-1);await until(()=>api.chapter===4);await api.turn(1);await until(()=>api.chapter===5);assert('toolbar page turning traverses short chapters',api.chapter===5);
const png=Uint8Array.from(document.defaultView.atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/agAAAABJRU5ErkJggg=='),character=>character.charCodeAt(0));
const releases=[],calls=[];
const images={id:'image-book',title:'Synthetic images',chapters:Array.from({length:5},(_,index)=>({title:'Images '+index,href:'Text/'+index+'.xhtml'})),
readChapter:async index=>({href:'Text/'+index+'.xhtml',html:'<p><img src="../Images/pixel.png" alt="Synthetic pixel"></p>'+Array.from({length:30},(_,i)=>'<p>Paragraph '+i+' maintains enough height for continuous image testing.</p>').join('')}),
readResource:async(href,index)=>{calls.push(index);if(index===0&&calls.filter(value=>value===0).length<=2)return new Promise(resolve=>releases.push(()=>resolve({mime:'image/png',data:png})));return {mime:'image/png',data:png};}};
await api.setBook(images);await until(()=>releases.length===1);
api.applyAppearance({...config,continuousChapters:false});await until(()=>releases.length===2);
releases[0]();await pause();assert('old resource response is ignored after mode generation changes',!api.root.querySelector('img')&&api.stats.imageBytes===0,api.stats);
releases[1]();await until(()=>!!api.root.querySelector('img'));
assert('new generation resumes pending image loading',api.root.querySelectorAll('img').length===1&&api.stats.imageBytes===png.byteLength,{stats:api.stats,calls});
api.applyAppearance(config);await until(()=>api.stats.chapterIndexes.includes(1)&&api.stats.pendingChapterReads===0);
const node=api.root.querySelector('[data-wrp-chapter="1"] [data-wrp-paragraph="10"]');scroll.scrollTop=node.getBoundingClientRect().top-scroll.getBoundingClientRect().top+scroll.scrollTop;scroll.dispatchEvent(new Event('scroll'));await until(()=>api.stats.chapterIndexes.includes(2));
const node2=api.root.querySelector('[data-wrp-chapter="2"] [data-wrp-paragraph="10"]');scroll.scrollTop=node2.getBoundingClientRect().top-scroll.getBoundingClientRect().top+scroll.scrollTop;scroll.dispatchEvent(new Event('scroll'));await until(()=>api.stats.chapterIndexes.includes(3));await pause();
assert('pruning image chapter revokes its object URL',!api.stats.chapterIndexes.includes(0)&&revoked.size>=2&&api.stats.imageBytes<=png.byteLength*3,{stats:api.stats,created:created.size,revoked:revoked.size});
const staleImageReleases=[];
const staleImage={...images,id:'stale-image-book',readResource:async()=>new Promise(resolve=>{staleImageReleases.push(()=>resolve({mime:'image/png',data:png}));})};
await api.setBook(staleImage);await until(()=>staleImageReleases.length>0);await api.setBook(tiny);for(const release of staleImageReleases)release();await pause();
assert('stale old-book image cannot enter new book',api.book===tiny&&!api.root.querySelector('img')&&api.stats.imageBytes===0);
api.destroy();assert('destroy revokes every synthetic resource URL',created.size===revoked.size&&api.stats.imageBytes===0&&api.stats.renderedChapters===0,{created:created.size,revoked:revoked.size});
report={version:'0.4.0',runtime:'Obsidian desktop',passed:true,checks,errors};
}catch(error){report={version:'0.4.0',runtime:'Obsidian desktop',passed:false,error:error.message,checks,stats:api.stats};}
finally{api.destroy();host.remove();style.remove();URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;}
report.cleanup={hostRemoved:!host.isConnected,styleRemoved:!style.isConnected,surfaceRemoved:!api.root.isConnected};
return report;
})
