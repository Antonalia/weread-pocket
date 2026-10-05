(async function validateLocalReaderStartup(options) {
  const {document,factory,css}=options,view=document.defaultView;
  const style=document.createElement('style');style.textContent=css;document.head.append(style);
  const cases=[],checks=[],pause=ms=>new Promise(resolve=>setTimeout(resolve,ms||70));
  const assert=(name,pass,details)=>{checks.push({name,pass:!!pass,...details?{details}: {}});if(!pass)throw new Error(name);};
  const until=async test=>{for(let i=0;i<40;i++){if(test()){await pause();return;}await pause();}throw new Error('startup background did not settle');};
  const appearance={fontSize:12,lineHeight:1.3,paragraphSpacing:0,contentPadding:12,continuousChapters:true,readingFlow:'scroll',literature:{enabled:false}};
  const fixture=(counts,readPrevious)=>({id:'synthetic-startup-book',title:'Synthetic startup fixture',chapters:Array.from({length:8},(_,index)=>({title:'Chapter '+index,href:'Text/'+index+'.xhtml'})),
    async readChapter(index){if(index===5&&readPrevious)return readPrevious();return {href:'Text/'+index+'.xhtml',paragraphs:Array.from({length:counts[index]||1},(_,number)=>'Synthetic paragraph '+number+'.')};}});
  const create=(hidden,height,initialAppearance)=>{
    const host=document.createElement('div');host.style.cssText='position:fixed;left:-20000px;top:0;width:380px;height:'+height+'px;display:'+(hidden?'none':'flex')+';visibility:hidden;';document.body.append(host);
    const saved=[],changes=[];let current=initialAppearance;
    const api=factory({host,document,onProgress:value=>saved.push({...value}),onChapter:index=>changes.push(index),onResize:()=>{if(current)api.applyAppearance(current);}});
    const update=value=>{current=value;api.applyAppearance(value);};
    const state={host,api,saved,changes,update};cases.push(state);if(current)update(current);return state;
  };
  let report;
  try{
    const short=create(false,640);
    await short.api.setBook(fixture({5:87,6:1,7:1}),{chapter:6,paragraph:0,offset:0,percent:75});
    short.update(appearance);await until(()=>short.api.stats.pendingChapterReads===0);await pause(260);
    assert('late continuous appearance preserves restored short chapter',short.api.chapter===6&&short.api.captureProgress().chapter===6&&!short.api.stats.chapterIndexes.includes(5),{progress:short.api.captureProgress(),stats:short.api.stats});
    assert('short startup never emits preceding chapter progress',short.saved.every(value=>value.chapter===6),{chapters:short.saved.map(value=>value.chapter)});
    const hidden=create(true,750);
    await hidden.api.setBook(fixture({5:87,6:48,7:12}),{chapter:6,paragraph:0,offset:0,percent:75});
    hidden.update({...appearance,fontSize:18,lineHeight:1.6});
    await until(()=>hidden.api.stats.pendingChapterReads===0);await pause(260);
    assert('hidden startup retains an explicit chapter layout anchor',hidden.api.captureProgress().chapter===6&&hidden.api.stats.awaitingLayout&&hidden.api.stats.chapterIndexes.includes(5),{progress:hidden.api.captureProgress(),stats:hidden.api.stats});
    hidden.host.style.display='flex';
    hidden.update({...appearance,fontSize:18,lineHeight:1.6});
    await pause(400);
    assert('revealing host restores target before visible progress capture',hidden.api.captureProgress().chapter===6&&hidden.api.chapter===6&&!hidden.api.stats.awaitingLayout,{progress:hidden.api.captureProgress(),stats:hidden.api.stats});
    assert('hidden start and reveal never emit earlier chapter',hidden.saved.every(value=>value.chapter===6),{chapters:hidden.saved.map(value=>value.chapter)});
    hidden.host.style.height='320px';hidden.update({...appearance,fontSize:16,lineHeight:1.5});
    hidden.host.style.height='750px';hidden.update({...appearance,fontSize:18,lineHeight:1.6});
    await pause(400);
    assert('rapid host resizing retains initial chapter anchor',hidden.api.captureProgress().chapter===6&&hidden.api.stats.renderedChapters<=3,{progress:hidden.api.captureProgress(),stats:hidden.api.stats});
    const moved=create(false,320,{...appearance,fontSize:32,lineHeight:1.5});
    moved.host.style.width='260px';
    await moved.api.setBook(fixture({5:87,6:87,7:87}),{chapter:6,paragraph:36,offset:.2,percent:75});
    await until(()=>moved.api.stats.pendingChapterReads===0);await pause(200);
    const moveAnchor=moved.api.captureProgress();
    moved.api.preserveProgress();moved.host.style.width='800px';moved.host.style.height='750px';moved.update({...appearance,fontSize:18,lineHeight:1.5});
    await pause(400);
    assert('host move preserves paragraph before reflow and scrollbar clamping',moved.api.captureProgress().chapter===moveAnchor.chapter&&moved.api.captureProgress().paragraph===moveAnchor.paragraph,{before:moveAnchor,after:moved.api.captureProgress()});
    let releasePrevious;
    const delayed=create(false,320,{...appearance,fontSize:16,lineHeight:1.5});
    await delayed.api.setBook(fixture({6:16,7:1},()=>new Promise(resolve=>{releasePrevious=()=>resolve({href:'Text/5.xhtml',paragraphs:Array.from({length:87},(_,number)=>'Previous synthetic paragraph '+number+'.')});})),{chapter:6,paragraph:0,offset:0,percent:75});
    await until(()=>!!releasePrevious);
    delayed.update({...appearance,fontSize:8,lineHeight:1});releasePrevious();await until(()=>delayed.api.stats.pendingChapterReads===0);await pause(260);
    assert('late previous preload is rejected after current chapter shrinks',delayed.api.chapter===6&&delayed.api.captureProgress().chapter===6&&!delayed.api.stats.chapterIndexes.includes(5),{progress:delayed.api.captureProgress(),stats:delayed.api.stats});
    assert('typography shrink never publishes earlier chapter progress',delayed.saved.every(value=>value.chapter===6),{chapters:delayed.saved.map(value=>value.chapter)});
    report={version:'0.4.0',runtime:'Obsidian desktop',passed:true,checks};
  }catch(error){report={version:'0.4.0',runtime:'Obsidian desktop',passed:false,error:error.message,checks};}
  finally{for(const state of cases){state.api.destroy();state.host.remove();}style.remove();}
  report.cleanup={allHostsRemoved:cases.every(state=>!state.host.isConnected),allSurfacesRemoved:cases.every(state=>!state.api.root.isConnected),styleRemoved:!style.isConnected};
  return report;
})
